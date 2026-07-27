/**
 * Discover authors: search GitHub for repositories named "razdfeed".
 */

import { restPublic, fetchRawFile } from './github.ts';
import type { BlogConfig, DiscoveredAuthor, Source } from './types.ts';

/**
 * Search for repositories named exactly "razdfeed" via GraphQL.
 * Returns up to 100 owner/repo pairs.
 */
export async function discoverRazdfeedRepos(): Promise<
  { owner: string; repo: string }[]
> {
  const data = await restPublic<{
    total_count: number;
    incomplete_results: boolean;
    items: Array<{
      full_name: string;
      owner: { login: string };
      name: string;
      fork: boolean;
      private: boolean;
    }>;
  }>('/search/repositories?q=razdfeed+in:name&sort=updated&order=desc&per_page=100');

  return data.items
    .filter((r) => r.name.toLowerCase() === 'razdfeed' && !r.fork && !r.private)
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
function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/^["']|["']$/g, '');
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
}

function parseGithubDiscussionsUrl(url: string): { repo: string; category?: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/discussions\/categories\/(.+)/);
  if (!m) return null;
  return { repo: `${m[1]}/${m[2]}`, category: m[3] };
}

function parseTelegramUrl(url: string): { channel: string } | null {
  const m = url.match(/t\.me\/(.+)/);
  if (!m || !m[1]) return null;
  return { channel: m[1] };
}

function githubUrlFromRepo(repo: string, category?: string): string {
  const [owner, name] = repo.split('/');
  if (!owner || !name) return `https://github.com/${repo}`;
  return `https://github.com/${owner}/${name}/discussions/categories/${category ?? 'announcements'}`;
}

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
    sources: [],
  };

  const lines = text.split('\n');
  let inLabels = false;
  let inTelegram = false;
  let inSources = false;
  let currentSource: Partial<Source> | null = null;

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

    // item under sources:
    if (inSources) {
      const itemMatch = raw.match(/^\s+-\s*(.*)$/);
      if (itemMatch) {
        const itemBody = itemMatch[1].trim();
        currentSource = {};
        config.sources.push(currentSource as Source);
        if (itemBody) {
          // inline one-line item: "- type: github"
          const inlineMatch = itemBody.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
          if (inlineMatch && inlineMatch[1] && inlineMatch[2]) {
            const key = inlineMatch[1].trim();
            const val = inlineMatch[2].trim().replace(/^["']|["']$/g, '');
            if (key === 'type') currentSource.type = val as 'github' | 'telegram';
            if (key === 'url') currentSource.url = normalizeUrl(val);
            if (key === 'repo') currentSource.repo = val;
            if (key === 'category') currentSource.category = val;
            if (key === 'channel') currentSource.channel = val;
          }
        }
        continue;
      }
      const nestedMatch = raw.match(/^\s+(\w[\w-]*)\s*:\s*(.*)$/);
      if (nestedMatch && nestedMatch[1] && nestedMatch[2] && currentSource) {
        const key = nestedMatch[1].trim();
        const val = nestedMatch[2].trim().replace(/^["']|["']$/g, '');
        if (key === 'type') currentSource.type = val as 'github' | 'telegram';
        if (key === 'url') currentSource.url = normalizeUrl(val);
        if (key === 'repo') currentSource.repo = val;
        if (key === 'category') currentSource.category = val;
        if (key === 'channel') currentSource.channel = val;
        continue;
      }
      if (raw.trim().length > 0 && !raw.match(/^\s*#/)) {
        inSources = false;
        currentSource = null;
      }
    }

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
      case 'discussions': {
        // discussions: https://github.com/owner/repo/discussions/categories/announcements
        const parsed = parseGithubDiscussionsUrl(val);
        if (parsed) {
          config.sourceRepo = parsed.repo;
          if (parsed.category) {
            const cat = parsed.category;
            config.category = cat.charAt(0).toUpperCase() + cat.slice(1);
          }
          config.sources.push({
            type: 'github',
            url: normalizeUrl(val),
            repo: parsed.repo,
            category: parsed.category,
          });
        }
        inTelegram = false;
        break;
      }
      case 'telegram': {
        const parsed = parseTelegramUrl(val);
        if (parsed) {
          config.telegram = parsed;
          config.sources.push({
            type: 'telegram',
            url: normalizeUrl(val),
            channel: parsed.channel,
          });
        } else if (!val) {
          inTelegram = true;
        }
        break;
      }
      case 'sources':
        inSources = true;
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

  // Derive repo / channel from url if missing
  for (const source of config.sources) {
    if (source.type === 'github' && !source.repo && source.url) {
      const parsed = parseGithubDiscussionsUrl(source.url);
      if (parsed) {
        source.repo = parsed.repo;
        source.category = source.category ?? parsed.category;
      }
    }
    if (source.type === 'telegram' && !source.channel && source.url) {
      const parsed = parseTelegramUrl(source.url);
      if (parsed) {
        source.channel = parsed.channel;
      }
    }
  }

  // Legacy fallback: no sources but old keys present
  if (config.sources.length === 0) {
    if (config.sourceRepo) {
      config.sources.push({
        type: 'github',
        url: githubUrlFromRepo(config.sourceRepo, config.category.toLowerCase()),
        repo: config.sourceRepo,
        category: config.category.toLowerCase(),
      });
    }
    if (config.telegram?.channel) {
      config.sources.push({
        type: 'telegram',
        url: `https://t.me/${config.telegram.channel}`,
        channel: config.telegram.channel,
      });
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
    const srcs = config.sources.map((s) => `${s.type}:${s.repo ?? s.channel ?? s.url}`).join(', ');
    console.log(`  ${owner}/${repo}: ${config.name} (${srcs || 'no sources'})`);
    authors.push({ owner, repo, config });
  }

  return authors;
}