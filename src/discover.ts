/**
 * Discover authors: search GitHub for repositories named "razdfeed".
 */

import { graphql } from './github.ts';
import { fetchRawFile } from './github.ts';
import type { BlogConfig, DiscoveredAuthor } from './types.ts';

/**
 * Search for repositories named exactly "razdfeed" via GraphQL.
 * Returns up to 100 owner/repo pairs.
 */
export async function discoverRazdfeedRepos(): Promise<
  { owner: string; repo: string }[]
> {
  const query = `
    query($query: String!) {
      search(query: $query, type: REPOSITORY, first: 100) {
        nodes {
          ... on Repository {
            name
            nameWithOwner
            owner { login }
            isFork
            isPrivate
          }
        }
      }
    }
  `;

  const data = await graphql<{
    search: {
      nodes: Array<{
        name: string;
        nameWithOwner: string;
        owner: { login: string };
        isFork: boolean;
        isPrivate: boolean;
      }>;
    };
  }>(query, { query: 'razdfeed in:name' });

  return data.search.nodes
    .filter((r) => r.name.toLowerCase() === 'razdfeed' && !r.isFork && !r.isPrivate)
    .map((r) => ({ owner: r.owner.login, repo: r.name }));
}

/**
 * Minimal .razdfeed.yml parser — handles flat key: value and simple lists.
 * We avoid a full YAML dependency to keep the runtime tiny.
 *
 * Example .razdfeed.yml:
 *   name: "My Blog"
 *   description: Персональный блог
 *   language: ru
 *   category: Announcements
 *   labels:
 *     - published
 *     - devops
 *   repo: dealenx/blog-discussions
 */
export function parseRazdfeedConfig(
  text: string,
  owner: string,
  repo: string,
): BlogConfig {
  const config: BlogConfig = {
    owner,
    repo,
    name: owner,
    description: '',
    language: 'ru',
    category: 'Announcements',
    labels: [],
  };

  const lines = text.split('\n');
  let inLabels = false;
  let inTelegram = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // list item under labels:
    if (inLabels && /^\s*-\s+/.test(line)) {
      const val = line.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, '');
      if (val) config.labels.push(val);
      continue;
    }
    inLabels = false;

    // nested key under telegram:
    if (inTelegram && /^\s+\w/.test(raw)) {
      const tm = raw.match(/^\s+(\w[\w-]*)\s*:\s*(.*)$/);
      if (tm && tm[1] && tm[2]) {
        const tk = tm[1].trim();
        const tv = tm[2].trim().replace(/^["']|["']$/g, '');
        if (tk === 'channel') {
          config.telegram = { channel: tv };
        }
      }
      continue;
    }
    inTelegram = false;

    const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!m || !m[1]) continue;
    const key = m[1].trim();
    const val = (m[2] ?? '').trim().replace(/^["']|["']$/g, '');

    switch (key) {
      case 'name':
        config.name = val || owner;
        break;
      case 'description':
        config.description = val;
        break;
      case 'language':
        config.language = val || 'ru';
        break;
      case 'category':
        config.category = val;
        break;
      case 'repo':
        config.sourceRepo = val;
        break;
      case 'discussions':
        // discussions: https://github.com/owner/repo/discussions/categories/announcements
        if (val) {
          const dm = val.match(/github\.com\/([^/]+)\/([^/]+)\/discussions\/categories\/(.+)/);
          if (dm && dm[1] && dm[2]) {
            config.sourceRepo = `${dm[1]}/${dm[2]}`;
            if (dm[3]) config.category = dm[3];
          }
        }
        inTelegram = false;
        break;
      case 'telegram':
        if (val) {
          // telegram: https://t.me/dealenxdev
          const tgMatch = val.match(/t\.me\/(.+)/);
          if (tgMatch && tgMatch[1]) {
            config.telegram = { channel: tgMatch[1] };
          } else {
            config.telegram = { channel: val };
          }
        } else {
          inTelegram = true;
        }
        break;
      case 'labels':
        inLabels = true;
        if (val) {
          // inline list: labels: [a, b]
          const inline = val.replace(/[\[\]]/g, '').split(',').map((s) =>
            s.trim().replace(/^["']|["']$/g, '')
          ).filter(Boolean);
          config.labels.push(...inline);
        }
        break;
    }
  }

  return config;
}

/**
 * Discover and resolve all razdfeed authors: find repos named "razdfeed",
 * then read .razdfeed.yml from each to get blog config.
 */
export async function discoverAuthors(): Promise<DiscoveredAuthor[]> {
  const repos = await discoverRazdfeedRepos();
  console.log(`Found ${repos.length} razdfeed repositories`);

  const authors: DiscoveredAuthor[] = [];

  for (const { owner, repo } of repos) {
    const text = await fetchRawFile(owner, repo, '.razdfeed.yml', 'main');
    if (text === null) {
      console.log(`  ${owner}/${repo}: no .razdfeed.yml, skipping`);
      continue;
    }
    const config = parseRazdfeedConfig(text, owner, repo);
    const tg = config.telegram ? `, telegram: ${config.telegram.channel}` : '';
    console.log(`  ${owner}/${repo}: ${config.name} (repo=${config.sourceRepo ?? owner + '/' + repo}${tg})`);
    authors.push({ owner, repo, config });
  }

  return authors;
}