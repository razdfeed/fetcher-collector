/**
 * Telegram channel post collector — parses t.me/s/<channel> HTML pages,
 * converts formatting to Markdown, extracts media (images, videos, files),
 * and paginates backwards through the channel history.
 */

import { parse, type HTMLElement } from 'node-html-parser';
import TurndownService from 'turndown';
import type { Post, PostMedia } from './types.ts';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
});

turndown.addRule('tg-emoji', {
  filter: (node: HTMLElement) =>
    (node as unknown as { nodeName: string }).nodeName === 'TG-EMOJI',
  replacement: (_content: string, node: HTMLElement) => node.text || '',
});

turndown.addRule('tg-spoiler', {
  filter: (node: HTMLElement) =>
    (node as unknown as { nodeName: string }).nodeName === 'TG-SPOILER',
  replacement: (content: string) => `||${content.trim()}||`,
});

turndown.addRule('tg-math', {
  filter: (node: HTMLElement) =>
    (node as unknown as { nodeName: string }).nodeName === 'TG-MATH',
  replacement: (content: string) => `$${content.trim()}$`,
});

turndown.addRule('clean-links', {
  filter: 'a',
  replacement: (content: string, node: HTMLElement) => {
    const href = node.getAttribute('href') || '';
    const onclick = node.getAttribute('onclick') || '';
    if (onclick.includes('confirm')) {
      const m = href.match(/\\n\\n(.+)/);
      const realHref = m?.[1] ? m[1].replace(/['"]/g, '') : href;
      return `[${content.trim()}](${realHref})`;
    }
    return `[${content.trim()}](${href})`;
  },
});

function htmlToMarkdown(html: string): string {
  let md = turndown.turndown(html);
  md = md.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  return md;
}

function getTextContent(html: string): string {
  const root = parse(html);
  root.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return root.textContent.trim();
}

/** Fetch HTML of the public Telegram channel preview page (t.me/s/<channel>). */
async function fetchChannelPage(
  channel: string,
  before?: number,
): Promise<string> {
  const url = new URL(`https://t.me/s/${channel}`);
  if (before !== undefined) url.searchParams.set('before', String(before));
  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': DEFAULT_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  }
  return res.text();
}

interface TelegramRawPost {
  id: string;
  channel: string;
  url: string;
  text: string;
  textMarkdown: string;
  datetime: string | null;
  media: {
    images: string[];
    videos: string[];
  };
}

function parsePosts(html: string, channel: string): TelegramRawPost[] {
  const root = parse(html);
  const nodes = root.querySelectorAll('.tgme_widget_message[data-post]');

  const posts: TelegramRawPost[] = [];
  for (const node of nodes) {
    const dataPost = node.getAttribute('data-post') ?? '';
    const id = dataPost.split('/')[1] ?? '';
    const url = `https://t.me/${dataPost}`;

    const textNode = node.querySelector('.tgme_widget_message_text');
    let text = '';
    let textMarkdown = '';
    if (textNode) {
      const innerHtml = textNode.innerHTML;
      text = getTextContent(innerHtml);
      textMarkdown = htmlToMarkdown(innerHtml);
    }

    const timeEl = node.querySelector('time');
    const datetime = timeEl?.getAttribute('datetime') ?? null;

    const images: string[] = [];
    node.querySelectorAll('.tgme_widget_message_photo_wrap').forEach((wrap) => {
      const style = wrap.getAttribute('style') ?? '';
      const m = style.match(/background-image:url\(['"]?(.*?)['"]?\)/);
      if (m && m[1]) images.push(m[1]);
    });
    node.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      if (
        src.startsWith('http') &&
        !src.includes('telesco.pe/file') &&
        !images.includes(src)
      ) {
        images.push(src);
      }
    });

    const videos: string[] = [];
    node.querySelectorAll('video').forEach((v) => {
      const src = v.getAttribute('src') ?? v.getAttribute('data-src') ?? '';
      if (src && !videos.includes(src)) videos.push(src);
    });

    posts.push({
      id,
      channel,
      url,
      text,
      textMarkdown,
      datetime,
      media: { images, videos },
    });
  }

  return posts;
}

/**
 * Collect ALL posts of a public Telegram channel by paginating backwards
 * via ?before=<id>, then convert to Post[] with sourceType: 'telegram'.
 */
export async function collectTelegramPosts(
  channel: string,
  opts?: {
    onProgress?: (count: number, lastId: number) => void;
    maxPages?: number;
    delayMs?: number;
  },
): Promise<Post[]> {
  const onProgress = opts?.onProgress;
  const maxPages = opts?.maxPages ?? Number.POSITIVE_INFINITY;
  const delayMs = opts?.delayMs ?? 400;

  const seen = new Set<string>();
  const all: TelegramRawPost[] = [];
  let before: number | undefined = undefined;
  let pages = 0;

  while (pages < maxPages) {
    const html = await fetchChannelPage(channel, before);
    const pagePosts = parsePosts(html, channel);
    if (pagePosts.length === 0) break;

    let newCount = 0;
    let minId = Infinity;
    for (const p of pagePosts) {
      const key = `${p.channel}/${p.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(p);
        newCount++;
      }
      const numId = Number(p.id);
      if (!Number.isNaN(numId) && numId < minId) minId = numId;
    }

    onProgress?.(all.length, minId);

    if (newCount === 0) break;
    if (pagePosts.length < 2) break;
    if (!Number.isFinite(minId) || minId <= 1) break;

    before = minId;
    pages++;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  all.sort((a, b) => Number(a.id) - Number(b.id));

  return all
    .filter((p) => (p.textMarkdown ?? '').trim() || (p.text ?? '').trim())
    .map((p) => {
      const media: PostMedia = {
        images: p.media.images,
        videos: p.media.videos,
      };
      return {
        number: Number(p.id),
        title: '',
        body: p.textMarkdown || p.text,
        url: p.url,
        createdAt: p.datetime ?? '1970-01-01T00:00:00.000Z',
        updatedAt: p.datetime ?? '1970-01-01T00:00:00.000Z',
        author: p.channel,
        authorUrl: `https://t.me/${p.channel}`,
        authorAvatar: '',
        category: 'Telegram',
        labels: [],
        slug: `tg-${p.id}`,
        sourceType: 'telegram' as const,
        media: Object.keys(media.images).length || Object.keys(media.videos).length ? media : undefined,
      };
    });
}