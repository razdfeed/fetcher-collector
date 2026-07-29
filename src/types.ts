/**
 * Shared types for the simplified razdfeed data format.
 *
 * Output is just two collections:
 *   - authors.json   → all authors in one file
 *   - posts-{n}.json → paginated posts (100 per page)
 *
 * @see razdfeed.github.io frontend
 */

export interface PostMedia {
  images: string[];
  videos: string[];
}

export interface LinkPreview {
  url: string;
  image: string | null;
  siteName: string | null;
  title: string | null;
  description: string | null;
}

export interface Post {
  number: number;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  authorUrl: string;
  authorAvatar: string;
  category: string;
  labels: string[];
  slug: string;
  sourceType: 'github' | 'telegram';
  media?: PostMedia;
  linkPreview?: LinkPreview;
  forwardedFrom?: string | null;
  forwardedFromUrl?: string | null;
}

export interface AuthorInfo {
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  html_url: string;
  blog: string | null;
}

export interface Source {
  type: 'github' | 'telegram';
  url: string;
  /** GitHub owner/repo (for type=github). */
  repo?: string;
  /** GitHub discussions category (for type=github). */
  category?: string;
  /** Telegram channel username (for type=telegram). */
  channel?: string;
}

/** Parsed .razdfeed.yml (minimal hand-parse, no YAML lib needed). */
export interface BlogConfig {
  owner: string;
  repo: string;
  name: string;
  description: string;
  language: string;
  category: string;
  labels: string[];
  sources: Source[];
  /** Legacy: explicit GitHub repo override. */
  sourceRepo?: string;
  /** Legacy: telegram channel. */
  telegram?: { channel: string };
  /** Legacy: discussions URL. */
  discussions?: string;
}

export interface DiscoveredAuthor {
  owner: string;
  repo: string;
  config: BlogConfig | null;
}

/** Post enriched with author info for the global feed. */
export interface FeedPost {
  number: number;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  authorUrl: string;
  authorAvatar: string;
  authorName: string | null;
  authorLogin: string;
  /** Repository this post was fetched from (e.g. "dealenx/dealenx"). */
  sourceRepo: string;
  sourceType: 'github' | 'telegram';
  category: string;
  labels: string[];
  slug: string;
  media?: PostMedia;
  linkPreview?: LinkPreview;
  forwardedFrom?: string | null;
  forwardedFromUrl?: string | null;
}

/** One author entry in authors.json. */
export interface AuthorEntry {
  login: string;
  name: string;
  description: string;
  language: string;
  avatar: string;
  bio: string | null;
  htmlUrl: string;
  blog: string | null;
  /** Repository where the author's .razdfeed.yml lives (e.g. "dealenx/razdfeed"). */
  repo: string;
  /** Source this author entry represents (e.g. "dealenx/dealenx" or "t.me/dealenxdev"). */
  sourceRepo: string;
  /** Source type for this entry. */
  sourceType: 'github' | 'telegram';
  postCount: number;
  latestPostAt: string | null;
}

/** authors.json — all authors in one file. */
export interface AuthorsFile {
  generatedAt: string;
  count: number;
  authors: AuthorEntry[];
}

/** posts-{n}.json — one page of the global feed. */
export interface PostsPage {
  generatedAt: string;
  page: number;
  pageSize: number;
  totalPosts: number;
  totalPages: number;
  /** Filename of the next page, or null if this is the last. */
  nextPage: string | null;
  /** Filename of the previous page, or null if this is the first. */
  prevPage: string | null;
  posts: FeedPost[];
}