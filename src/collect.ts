/**
 * Collect posts from GitHub Discussions via GraphQL and author info via REST.
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

  let posts = all.map((d) => {
    return {
      number: d.number,
      title: d.title,
      body: d.body ?? '',
      url: d.url,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      author: d.author?.login ?? 'unknown',
      authorUrl: d.author?.url ?? '',
      authorAvatar: d.author?.avatarUrl ?? '',
      category: d.category?.name ?? '',
      labels: d.labels.nodes.map((l) => l.name),
      slug: `gh-${d.number}`,
      sourceType: 'github' as const,
    };
  });

  // Filter by category if configured (case-insensitive, skip the default)
  if (config.category) {
    const cfgCat = config.category.toLowerCase();
    if (cfgCat !== 'announcements') {
      posts = posts.filter((p) => p.category.toLowerCase() === cfgCat);
    }
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