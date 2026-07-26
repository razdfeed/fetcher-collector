/**
 * Collect posts from GitHub Discussions via GraphQL and author info via REST.
 * Also supports Telegram channel posts via telegram_posts.json.
 */

import { graphql, rest } from './github.ts';
import type { AuthorInfo, BlogConfig, Post } from './types.ts';

interface DiscussionNode {
  number: number;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string; url: string; avatarUrl: string } | null;
  labels: { nodes: Array<{ name: string }> };
  category: { name: string } | null;
}

/**
 * Fetch Telegram posts from the author's GitHub Pages (telegram_posts.json).
 * The author's razdfeed repo should have a GitHub Actions workflow that
 * collects Telegram posts and publishes them to GitHub Pages.
 */
export async function fetchTelegramPosts(
  owner: string,
  channel: string,
): Promise<Post[]> {
  const url = `https://${owner}.github.io/razdfeed/telegram_posts.json?t=${Date.now()}`;
  console.log(`  Fetching Telegram posts from ${url}`);

  try {
    const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'razdfeed-collector' } });
    if (!res.ok) {
      console.log(`  Telegram posts not available (HTTP ${res.status})`);
      return [];
    }

    const data = await res.json() as Array<{
      id: string;
      channel: string;
      url: string;
      text: string;
      textMarkdown: string;
      datetime: string | null;
      views: string | null;
      isEdited: boolean;
      media: {
        images: string[];
        videos: string[];
        files: Array<{ url: string; localPath: string | null; name: string | null; size: string | null; mime: string | null }>;
      };
    }>;

    if (data.length > 0) {
      const nullDates = data.filter((p) => !p.datetime).length;
      console.log(`  First post datetime: ${JSON.stringify(data[0]?.datetime)}, total: ${data.length}, null dates: ${nullDates}`);
    }

    return data
      .filter((p) => (p.textMarkdown ?? '').trim() || (p.text ?? '').trim())
      .map((p) => {
        const firstLine = (p.text ?? '').split('\n')[0]?.trim() ?? '';
        const title = firstLine.slice(0, 80) || `Post ${p.id}`;
        return {
          number: Number(p.id),
          title,
          body: p.textMarkdown || p.text,
          url: p.url,
          createdAt: p.datetime ?? new Date().toISOString(),
          updatedAt: p.datetime ?? new Date().toISOString(),
          author: p.channel,
          authorUrl: `https://t.me/${p.channel}`,
          authorAvatar: '',
          category: 'Telegram',
          labels: [],
          slug: `tg-${p.id}`,
          sourceType: 'telegram' as const,
        };
      });
  } catch (e) {
    console.log(`  Failed to fetch Telegram posts: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Fetch discussions from a repo, paginating through all of them.
 * Optionally filter by category and/or labels.
 */
export async function fetchDiscussions(
  owner: string,
  repo: string,
  config: BlogConfig,
): Promise<Post[]> {
  const all: DiscussionNode[] = [];
  let cursor: string | null = null;
  const pageSize = 50;

  for (let page = 0; page < 10; page++) {
    const query = `
      query($owner: String!, $repo: String!, $first: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          discussions(first: $first, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) {
            pageInfo { hasNextPage endCursor }
            nodes {
              number title body url createdAt updatedAt
              author { login url avatarUrl }
              labels(first: 20) { nodes { name } }
              category { name }
            }
          }
        }
      }
    `;

    let data: {
      repository: {
        discussions: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: DiscussionNode[];
        } | null;
      } | null;
    };

    try {
      data = await graphql(query, {
        owner, repo, first: pageSize, after: cursor,
      });
    } catch (e) {
      console.log(`  GraphQL discussions failed for ${owner}/${repo}: ${(e as Error).message}`);
      break;
    }

    const discussions = data.repository?.discussions;
    if (!discussions) break;
    all.push(...discussions.nodes);

    if (!discussions.pageInfo.hasNextPage) break;
    cursor = discussions.pageInfo.endCursor;
  }

  let posts = all.map((d) => ({
    number: d.number,
    title: d.title,
    body: d.body,
    url: d.url,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    author: d.author?.login ?? 'unknown',
    authorUrl: d.author?.url ?? '',
    authorAvatar: d.author?.avatarUrl ?? '',
    category: d.category?.name ?? '',
    labels: d.labels.nodes.map((l) => l.name),
    slug: String(d.number),
    sourceType: 'github' as const,
  }));

  // Filter by category if configured and not the default
  if (config.category && config.category !== 'Announcements') {
    posts = posts.filter((p) => p.category === config.category);
  }

  // Filter by labels (post must include at least one configured label)
  if (config.labels.length > 0) {
    posts = posts.filter((p) => p.labels.some((l) => config.labels.includes(l)));
  }

  return posts;
}

/** Fetch GitHub user info via REST, matching the frontend AuthorInfo shape. */
export async function fetchAuthorInfo(login: string): Promise<AuthorInfo | null> {
  try {
    const data = await rest<{
      login: string;
      name: string | null;
      avatar_url: string;
      bio: string | null;
      html_url: string;
      blog: string | null;
    }>(`/users/${login}`);
    return data;
  } catch {
    return null;
  }
}

/**
 * Resolve the actual source repo for posts from a blog config.
 *
 * Priority:
 *   1. .razdfeed.yml `repo: owner/name`  — explicit override
 *   2. {owner}/{owner}                  — default: repo named after the user
 *   3. {owner}/razdfeed                 — fallback: the razdfeed repo itself
 *
 * Example: discovered repo "dealenx/razdfeed" → posts from "dealenx/dealenx"
 * unless .razdfeed.yml sets `repo: dealenx/blog-discussions`.
 */
export function resolveSourceRepo(config: BlogConfig): { owner: string; repo: string } {
  if (config.sourceRepo) {
    const [owner, repo] = config.sourceRepo.split('/');
    if (owner && repo) return { owner, repo };
  }
  // Default: posts live in a repo named after the user (e.g. dealenx/dealenx)
  return { owner: config.owner, repo: config.owner };
}