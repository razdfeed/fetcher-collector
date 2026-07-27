/**
 * GitHub API helpers: GraphQL + REST wrappers.
 */

const GRAPHQL_URL = 'https://api.github.com/graphql';
const REST_URL = 'https://api.github.com';

function token(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

export async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const t = token();
  if (!t) throw new Error('GITHUB_TOKEN is required for GraphQL');
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub GraphQL ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { errors?: unknown; data?: T };
  if (json.errors) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

export async function rest<T>(
  path: string,
  init: RequestInit = {},
  requireToken = true,
): Promise<T> {
  const t = token();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (t) {
    headers.Authorization = `Bearer ${t}`;
  } else if (requireToken) {
    throw new Error('GITHUB_TOKEN is required for this request');
  }

  const res = await fetch(`${REST_URL}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub REST ${res.status} ${path}: ${body}`);
  }
  return (await res.json()) as T;
}

/** Public REST request (no token required). */
export async function restPublic<T>(path: string, init: RequestInit = {}): Promise<T> {
  return rest<T>(path, init, false);
}

/** Fetch raw file content from a repo via raw.githubusercontent.com. */
export async function fetchRawFile(
  owner: string,
  repo: string,
  path: string,
  ref = 'main',
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}