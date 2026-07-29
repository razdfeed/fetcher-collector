/**
 * File sink abstraction — where collected JSON gets written.
 *
 * Two implementations:
 *   - LocalSink:  writes to a local directory (dist/) for testing
 *   - RemoteSink: writes to razdfeed/razdfeed.github.io via GitHub Contents API
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { putFile, listFiles, deleteFile } from './publish.ts';

export interface Sink {
  /** Write a file with text content. */
  write(path: string, content: string, message: string): Promise<void>;
  /** List files under a directory path. Returns full paths relative to root. */
  list(dirPath: string): Promise<string[]>;
  /** Delete a file. Returns true if it existed. */
  delete(path: string, message: string): Promise<boolean>;
  /** Human-readable description for logs. */
  readonly label: string;
}

/** Write files to a local directory (e.g. dist/data/). */
export class LocalSink implements Sink {
  readonly label: string;

  constructor(private rootDir: string) {
    this.label = `local:${this.rootDir}`;
  }

  async write(path: string, content: string, _message: string): Promise<void> {
    const full = join(this.rootDir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }

  async list(dirPath: string): Promise<string[]> {
    const full = join(this.rootDir, dirPath);
    if (!existsSync(full)) return [];
    const entries = readdirSync(full, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const childPath = `${dirPath}/${entry.name}`;
      if (entry.isDirectory()) {
        const nested = await this.list(childPath);
        files.push(...nested);
      } else if (entry.name.endsWith('.json')) {
        files.push(childPath);
      }
    }
    return files;
  }

  async delete(path: string, _message: string): Promise<boolean> {
    const full = join(this.rootDir, path);
    if (!existsSync(full)) return false;
    unlinkSync(full);
    return true;
  }
}

/** Write files to a GitHub repo via the Contents API. */
export class RemoteSink implements Sink {
  readonly label: string;

  constructor(
    private owner: string,
    private repo: string,
    private branch = 'main',
  ) {
    this.label = `remote:${owner}/${repo}`;
  }

  async write(path: string, content: string, message: string): Promise<void> {
    await putFile(this.owner, this.repo, path, content, message, this.branch);
  }

  async list(dirPath: string): Promise<string[]> {
    return listFiles(this.owner, this.repo, dirPath, this.branch);
  }

  async delete(path: string, message: string): Promise<boolean> {
    return deleteFile(this.owner, this.repo, path, message, this.branch);
  }
}