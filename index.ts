/**
 * fetcher-collector — razdfeed bot.
 *
 * Discovers all GitHub repositories named "razdfeed", reads each author's
 * .razdfeed.yml config, collects their posts from GitHub Discussions via
 * GraphQL, and writes two collections:
 *
 *   authors.json       — all authors in one file
 *   posts-1.json, ...  — paginated posts (PAGE_SIZE per file)
 *
 * Modes:
 *   bun run index.ts --local   → writes to ./dist/public/data (for testing)
 *   bun run index.ts            → publishes to razdfeed/razdfeed.github.io via API
 *   bun run index.ts --dry-run  → preview in console + ./dist/public/data
 *
 * GITHUB_TOKEN is always required (for search + GraphQL + user info).
 */

import { discoverAuthors } from './src/discover.ts';
import { fetchAuthorInfo, fetchDiscussions } from './src/collect.ts';
import { collectTelegramPosts } from './src/telegram.ts';
import { LocalSink, RemoteSink, type Sink } from './src/sink.ts';
import type {
  AuthorEntry,
  AuthorInfo,
  AuthorsFile,
  FeedPost,
  PostsPage,
  AuthorPostsFile,
} from './src/types.ts';

const TARGET_OWNER = 'razdfeed';
const TARGET_REPO = 'razdfeed.github.io';
const DATA_DIR = 'public/data';
const AUTHORS_DIR = `${DATA_DIR}/authors`;
const LOCAL_DIR = 'dist';
const PAGE_SIZE = 100;

const LOCAL_MODE = process.argv.includes('--local');
const DRY_RUN = process.argv.includes('--dry-run');

function now(): string {
  return new Date().toISOString();
}

function createSink(): Sink {
  if (LOCAL_MODE || DRY_RUN) return new LocalSink(LOCAL_DIR);
  return new RemoteSink(TARGET_OWNER, TARGET_REPO);
}

/** Build the page object for page N (1-indexed). */
let generatedAt = now();

function buildPage(
  page: number,
  allPosts: FeedPost[],
  totalPages: number,
): PostsPage {
  const start = (page - 1) * PAGE_SIZE;
  const posts = allPosts.slice(start, start + PAGE_SIZE);
  const nextPage = page < totalPages ? `posts-${page + 1}.json` : null;
  const prevPage = page > 1 ? `posts-${page - 1}.json` : null;
  return {
    generatedAt,
    page,
    pageSize: PAGE_SIZE,
    totalPosts: allPosts.length,
    totalPages,
    nextPage,
    prevPage,
    posts,
  };
}

async function main() {
  const mode = DRY_RUN ? 'DRY RUN' : LOCAL_MODE ? 'LOCAL' : 'PUBLISH';
  const sink = createSink();

  console.log(`[${now()}] fetcher-collector starting (${mode})`);
  console.log(`  sink: ${sink.label}`);
  console.log(`  data dir: ${DATA_DIR}, page size: ${PAGE_SIZE}`);

  // 1. Discover all razdfeed authors
  const authors = await discoverAuthors();
  console.log(`Discovered ${authors.length} authors with .razdfeed.yml`);

  if (authors.length === 0) {
    console.log('No authors found. Nothing to do.');
    return;
  }

  // 2. Collect posts + author info for each
  const authorEntries: AuthorEntry[] = [];
  const allFeedPosts: FeedPost[] = [];

  for (const { owner, repo, config } of authors) {
    if (!config) continue;

    console.log(`\nCollecting ${owner} (${config.sources.length} source(s))...`);

    const authorInfo = await fetchAuthorInfo(owner);
    const authorName = config.name || authorInfo?.name || owner;

    let authorPostCount = 0;
    let authorLatestPostAt: string | null = null;
    let firstSourceRepo = '';
    let firstSourceType: 'github' | 'telegram' = 'github';

    for (const source of config.sources) {
      if (source.type === 'github' && source.repo) {
        const [srcOwner, srcRepo] = source.repo.split('/');
        if (!srcOwner || !srcRepo) {
          console.log(`  Skipping invalid github source: ${source.repo}`);
          continue;
        }

        console.log(`  Collecting GitHub discussions from ${source.repo} ...`);
        const posts = await fetchDiscussions(srcOwner, srcRepo, {
          ...config,
          category: source.category ?? config.category,
        });
        console.log(`    ${posts.length} discussion posts collected`);

        if (!firstSourceRepo) {
          firstSourceRepo = source.repo;
          firstSourceType = 'github';
        }
        authorPostCount += posts.length;
        const latest = posts[0]?.createdAt ?? null;
        if (latest && (!authorLatestPostAt || latest > authorLatestPostAt)) {
          authorLatestPostAt = latest;
        }

        for (const post of posts) {
          allFeedPosts.push({
            ...post,
            authorLogin: owner,
            authorName,
            sourceRepo: source.repo,
          });
        }
      }

      if (source.type === 'telegram' && source.channel) {
        const channel = source.channel;
        console.log(`  Collecting Telegram posts from t.me/s/${channel} ...`);
        const posts = await collectTelegramPosts(channel, {
          maxPages: 20,
          delayMs: 400,
          onProgress: (count, lastId) => {
            console.log(`    collected ${count} posts, oldest id so far: ${lastId}`);
          },
        });
        console.log(`    ${posts.length} telegram posts collected`);

        if (!firstSourceRepo) {
          firstSourceRepo = `t.me/${channel}`;
          firstSourceType = 'telegram';
        }
        authorPostCount += posts.length;
        const latest = posts[0]?.createdAt ?? null;
        if (latest && (!authorLatestPostAt || latest > authorLatestPostAt)) {
          authorLatestPostAt = latest;
        }

        for (const post of posts) {
          allFeedPosts.push({
            ...post,
            authorLogin: owner,
            authorName,
            sourceRepo: `t.me/${channel}`,
          });
        }
      }
    }

    authorEntries.push({
      login: owner,
      name: authorName,
      description: config.description,
      language: config.language,
      avatar: authorInfo?.avatar_url ?? '',
      bio: authorInfo?.bio ?? null,
      htmlUrl: authorInfo?.html_url ?? `https://github.com/${owner}`,
      blog: authorInfo?.blog ?? null,
      repo: `${owner}/${repo}`,
      sourceRepo: firstSourceRepo,
      sourceType: firstSourceType,
      postCount: authorPostCount,
      latestPostAt: authorLatestPostAt,
    });
  }

  // 3. Sort global feed: newest posts first
  allFeedPosts.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  generatedAt = now();

  // 4. Build authors.json
  const authorsFile: AuthorsFile = {
    generatedAt,
    count: authorEntries.length,
    authors: authorEntries.sort((a, b) => a.login.localeCompare(b.login)),
  };

  // 5. Build per-author posts: authors/{login}.json
  const authorPostsByLogin = new Map<string, FeedPost[]>();
  for (const post of allFeedPosts) {
    const list = authorPostsByLogin.get(post.authorLogin) ?? [];
    list.push(post);
    authorPostsByLogin.set(post.authorLogin, list);
  }

  const authorPostsFiles: AuthorPostsFile[] = authorEntries.map((entry) => {
    const posts = authorPostsByLogin.get(entry.login) ?? [];
    return {
      generatedAt,
      login: entry.login,
      postCount: posts.length,
      posts,
    };
  });

  // 6. Paginate posts into posts-{n}.json
  const totalPages = Math.max(1, Math.ceil(allFeedPosts.length / PAGE_SIZE));
  const pages: PostsPage[] = [];
  for (let p = 1; p <= totalPages; p++) {
    pages.push(buildPage(p, allFeedPosts, totalPages));
  }

  // 7. Summary
  console.log('\n=== Summary ===');
  console.log(`Authors: ${authorsFile.count}, Posts: ${allFeedPosts.length}, Pages: ${totalPages}`);
  console.log(`Author files: ${authorPostsFiles.length}`);

  if (DRY_RUN) {
    console.log('\n(Dry run — preview only. Files written to dist/ for inspection.)');
    console.log('\nauthors.json:');
    console.log(JSON.stringify(authorsFile, null, 2));
    console.log('\nposts-1.json (page 1):');
    console.log(JSON.stringify({ ...pages[0]!, posts: `[${pages[0]!.posts.length} posts]` }, null, 2));
    if (pages.length > 1) {
      console.log(`\n... and ${pages.length - 1} more page(s)`);
    }
    console.log(`\nFiles in: ${LOCAL_DIR}/${DATA_DIR}/`);
    return;
  }

  // 8. Write files
  await sink.write(
    `${DATA_DIR}/authors.json`,
    JSON.stringify(authorsFile, null, 2),
    `chore(data): authors (${authorsFile.count})`,
  );

  for (const authorPosts of authorPostsFiles) {
    const filename = `authors/${authorPosts.login}.json`;
    await sink.write(
      `${DATA_DIR}/${filename}`,
      JSON.stringify(authorPosts, null, 2),
      `chore(data): ${filename} (${authorPosts.postCount} posts)`,
    );
    console.log(`  wrote ${filename} — ${authorPosts.postCount} posts`);
  }

  for (const page of pages) {
    const filename = `posts-${page.page}.json`;
    await sink.write(
      `${DATA_DIR}/${filename}`,
      JSON.stringify(page, null, 2),
      `chore(data): ${filename} (page ${page.page}/${totalPages}, ${page.posts.length} posts)`,
    );
    console.log(`  wrote ${filename} — ${page.posts.length} posts, next: ${page.nextPage ?? 'end'}`);
  }

  // 9. Prune stale files from previous runs
  const existing = await sink.list(DATA_DIR);
  const expectedFiles = new Set([
    'authors.json',
    ...authorPostsFiles.map((a) => `authors/${a.login}.json`),
    ...pages.map((p) => `posts-${p.page}.json`),
  ]);
  const expectedAuthorFiles = new Set(
    authorPostsFiles.map((a) => `authors/${a.login}.json`),
  );
  for (const filePath of existing) {
    const fileName = filePath.split('/').pop() ?? '';
    if (fileName.startsWith('posts-') && !expectedFiles.has(fileName)) {
      console.log(`  pruning stale ${fileName}`);
      await sink.delete(filePath, `chore(data): prune stale ${fileName}`);
    }
    if (filePath.startsWith(`${DATA_DIR}/authors/`) && !expectedAuthorFiles.has(filePath.replace(`${DATA_DIR}/`, ''))) {
      console.log(`  pruning stale author file ${filePath}`);
      await sink.delete(filePath, `chore(data): prune stale author file`);
    }
  }

  console.log(`\n[${now()}] Done. Sink: ${sink.label}`);
  if (LOCAL_MODE) {
    console.log(`Files in: ${LOCAL_DIR}/${DATA_DIR}/`);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});