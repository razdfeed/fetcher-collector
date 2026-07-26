/**
 * Publish collected JSON to the razdfeed/razdfeed.github.io repository
 * via the GitHub REST Contents API. This avoids needing git credentials
 * or a clone — we push files directly through the API.
 */

import { rest } from './github.ts';

interface ContentApiFile {
  path: string;
  sha: string;
}

/** Get current SHA of a file (needed to update it). Returns null if not found. */
async function getFileSha(owner: string, repo: string, path: string): Promise<string | null> {
  try {
    const data = await rest<{ sha?: string }>(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'GET',
    });
    return data.sha ?? null;
  } catch {
    return null;
  }
}

/** Create or update a file via the Contents API. */
export async function putFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  commitMessage: string,
  branch = 'main',
): Promise<void> {
  const sha = await getFileSha(owner, repo, path);
  const body: Record<string, unknown> = {
    message: commitMessage,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
  };
  if (sha) body.sha = sha;

  await rest(`/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Delete a file if it exists (for pruning stale posts). */
export async function deleteFile(
  owner: string,
  repo: string,
  path: string,
  commitMessage: string,
  branch = 'main',
): Promise<boolean> {
  const sha = await getFileSha(owner, repo, path);
  if (!sha) return false;
  await rest(`/repos/${owner}/${repo}/contents/${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: commitMessage, sha, branch }),
  });
  return true;
}

/** List files under a directory path in a repo. */
export async function listFiles(
  owner: string,
  repo: string,
  dirPath: string,
  ref = 'main',
): Promise<string[]> {
  try {
    const data = await rest<Array<{ path: string; type: string }>>(
      `/repos/${owner}/${repo}/contents/${dirPath}?ref=${ref}`,
      { method: 'GET' },
    );
    return data.filter((f) => f.type === 'file').map((f) => f.path);
  } catch {
    return [];
  }
}