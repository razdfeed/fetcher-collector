/**
 * Generate a human-friendly index.html that lists all JSON data files
 * in dist/public/data/. The page reads the JSON files client-side and
 * renders a nice browsable view with authors and paginated posts.
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST_DIR = join(process.cwd(), 'dist');
const DATA_DIR = join(DIST_DIR, 'public', 'data');

if (!existsSync(DATA_DIR)) {
  console.error('No data directory found. Run `bun run index.ts --local` first.');
  process.exit(1);
}

// Read JSON files to embed a server-side snapshot for instant load
const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));

interface AuthorsFile {
  generatedAt: string;
  count: number;
  authors: Array<{
    login: string;
    name: string;
    description: string;
    avatar: string;
    bio: string | null;
    htmlUrl: string;
    repo: string;
    sourceRepo: string;
    postCount: number;
    latestPostAt: string | null;
  }>;
}

interface PostsPage {
  page: number;
  pageSize: number;
  totalPosts: number;
  totalPages: number;
  nextPage: string | null;
  prevPage: string | null;
  posts: Array<{
    number: number;
    title: string;
    url: string;
    createdAt: string;
    author: string;
    authorLogin: string;
    authorName: string | null;
    authorAvatar: string;
    sourceRepo: string;
    category: string;
    labels: string[];
    slug: string;
  }>;
}

const authorsFile = files.find((f) => f === 'authors.json');
const postPages = files.filter((f) => f.startsWith('posts-')).sort();

const authors: AuthorsFile | null = authorsFile
  ? JSON.parse(readFileSync(join(DATA_DIR, authorsFile), 'utf-8'))
  : null;

const firstPage: PostsPage | null = postPages[0]
  ? JSON.parse(readFileSync(join(DATA_DIR, postPages[0]), 'utf-8'))
  : null;

const generatedAt = new Date().toISOString();

// Escape for embedding in HTML/JS
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>razdfeed — data</title>
<style>
  :root {
    --bg: #0d1117;
    --card: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #2f81f7;
    --accent-hover: #1f6feb;
    --green: #3fb950;
    --mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    min-height: 100vh;
  }
  .container { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
  header { margin-bottom: 40px; }
  h1 { font-size: 28px; font-weight: 600; margin-bottom: 8px; }
  h1 .logo { color: var(--accent); }
  .subtitle { color: var(--muted); font-size: 15px; }
  .stats {
    display: flex; gap: 24px; margin-top: 20px; flex-wrap: wrap;
  }
  .stat {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px 20px; min-width: 120px;
  }
  .stat .num { font-size: 24px; font-weight: 600; color: var(--accent); }
  .stat .label { font-size: 13px; color: var(--muted); margin-top: 2px; }

  section { margin-bottom: 48px; }
  h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  h2 .count { color: var(--muted); font-size: 14px; font-weight: 400; }

  .author-card {
    display: flex; align-items: flex-start; gap: 14px;
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px 18px; margin-bottom: 12px;
    transition: border-color 0.15s;
  }
  .author-card:hover { border-color: var(--accent); }
  .author-card img { width: 48px; height: 48px; border-radius: 50%; flex-shrink: 0; }
  .author-card .info { flex: 1; min-width: 0; }
  .author-card .name { font-weight: 600; font-size: 15px; }
  .author-card .login { color: var(--muted); font-size: 13px; }
  .author-card .desc { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .author-card .meta {
    display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: var(--muted);
    flex-wrap: wrap;
  }
  .author-card .meta code {
    font-family: var(--mono); font-size: 11px; color: var(--green);
    background: rgba(63,185,80,0.1); padding: 2px 6px; border-radius: 4px;
  }
  .badge {
    display: inline-block; background: rgba(47,129,247,0.15); color: var(--accent);
    font-size: 12px; padding: 2px 8px; border-radius: 12px; font-weight: 500;
  }

  .post-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 18px; margin-bottom: 10px;
    transition: border-color 0.15s;
  }
  .post-card:hover { border-color: var(--accent); }
  .post-card .title { font-weight: 600; font-size: 15px; }
  .post-card .title a { color: var(--text); text-decoration: none; }
  .post-card .title a:hover { color: var(--accent); }
  .post-card .meta {
    display: flex; gap: 10px; align-items: center; margin-top: 8px;
    font-size: 12px; color: var(--muted); flex-wrap: wrap;
  }
  .post-card .meta img { width: 18px; height: 18px; border-radius: 50%; }
  .post-card .labels { display: flex; gap: 6px; flex-wrap: wrap; }
  .label-tag {
    font-size: 11px; padding: 1px 8px; border-radius: 10px;
    background: rgba(139,148,158,0.15); color: var(--muted);
  }

  .pagination {
    display: flex; gap: 8px; justify-content: center; margin-top: 24px;
  }
  .pagination button {
    background: var(--card); border: 1px solid var(--border); color: var(--text);
    padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px;
    transition: all 0.15s;
  }
  .pagination button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .pagination button:disabled { opacity: 0.4; cursor: default; }
  .pagination .info { color: var(--muted); font-size: 13px; align-self: center; }

  .file-links {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px 18px;
  }
  .file-links a {
    display: inline-block; font-family: var(--mono); font-size: 13px;
    color: var(--accent); text-decoration: none; margin: 4px 8px 4px 0;
    padding: 4px 10px; background: rgba(47,129,247,0.08); border-radius: 6px;
  }
  .file-links a:hover { background: rgba(47,129,247,0.18); }

  .empty { color: var(--muted); font-style: italic; padding: 20px 0; }
  .generated { color: var(--muted); font-size: 12px; margin-top: 40px; text-align: center; }
  a.gh { color: var(--accent); text-decoration: none; }
  a.gh:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1><span class="logo">⚡ razdfeed</span> data</h1>
    <p class="subtitle">
      JSON-коллекции: посты из GitHub Discussions, собранные ботом
      <a class="gh" href="https://github.com/razdfeed/fetcher-collector">fetcher-collector</a>
    </p>
    <div class="stats">
      <div class="stat"><div class="num">${authors?.count ?? 0}</div><div class="label">авторов</div></div>
      <div class="stat"><div class="num">${firstPage?.totalPosts ?? 0}</div><div class="label">постов</div></div>
      <div class="stat"><div class="num">${postPages.length}</div><div class="label">страниц</div></div>
    </div>
  </header>

  <section>
    <h2>Авторы <span class="count">(${authors?.count ?? 0})</span></h2>
    <div id="authors"></div>
  </section>

  <section>
    <h2>Посты <span class="count">(${firstPage?.totalPosts ?? 0})</span></h2>
    <div id="posts"></div>
    <div class="pagination" id="pagination"></div>
  </section>

  <section>
    <h2>JSON файлы</h2>
    <div class="file-links">
      <a href="public/data/authors.json">authors.json</a>
      ${postPages.map((f) => `<a href="public/data/${f}">${f}</a>`).join('\n      ')}
    </div>
  </section>

  <p class="generated">Сгенерировано: ${generatedAt}</p>
</div>

<script>
const DATA_BASE = 'public/data';
let currentPage = 1;
let totalPages = ${firstPage?.totalPages ?? 1};
let totalPosts = ${firstPage?.totalPosts ?? 0};

const authorsData = ${authors ? JSON.stringify(JSON.stringify(authors)) : 'null'};
const firstPageData = ${firstPage ? JSON.stringify(JSON.stringify(firstPage)) : 'null'};

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderAuthors() {
  const el = document.getElementById('authors');
  if (!authorsData) { el.innerHTML = '<p class="empty">Нет авторов.</p>'; return; }
  const data = JSON.parse(authorsData);
  if (!data.authors || data.authors.length === 0) { el.innerHTML = '<p class="empty">Нет авторов.</p>'; return; }
  el.innerHTML = data.authors.map(a => \`
    <div class="author-card">
      <img src="\${a.avatar}" alt="\${a.login}" loading="lazy" />
      <div class="info">
        <div class="name">\${a.name} <a class="gh" href="\${a.htmlUrl}">@\${a.login}</a></div>
        \${a.bio ? \`<div class="desc">\${a.bio}</div>\` : ''}
        <div class="meta">
          <span>📝 \${a.postCount} постов</span>
          \${a.latestPostAt ? \`<span>последний: \${formatDate(a.latestPostAt)}</span>\` : ''}
          <code>source: \${a.sourceRepo}</code>
        </div>
      </div>
    </div>
  \`).join('');
}

async function loadPage(page) {
  const res = await fetch(\`\${DATA_BASE}/posts-\${page}.json\`);
  if (!res.ok) { document.getElementById('posts').innerHTML = '<p class="empty">Ошибка загрузки.</p>'; return; }
  const data = await res.json();
  currentPage = data.page;
  totalPages = data.totalPages;
  totalPosts = data.totalPosts;
  renderPosts(data);
  renderPagination();
}

function renderPosts(data) {
  const el = document.getElementById('posts');
  if (!data.posts || data.posts.length === 0) { el.innerHTML = '<p class="empty">Нет постов.</p>'; return; }
  el.innerHTML = data.posts.map(p => \`
    <div class="post-card">
      <div class="title">
        <a href="\${p.url}" target="_blank" rel="noopener">\${p.title}</a>
      </div>
      <div class="meta">
        <img src="\${p.authorAvatar}" alt="" loading="lazy" />
        <span>\${p.authorName || p.authorLogin}</span>
        <span>·</span>
        <span>\${formatDate(p.createdAt)}</span>
        <span>·</span>
        <code style="font-size:11px;color:var(--green)">\${p.sourceRepo}</code>
        \${p.labels && p.labels.length ? \`
          <span class="labels">\${p.labels.map(l => \`<span class="label-tag">\${l}</span>\`).join('')}</span>\` : ''}
      </div>
    </div>
  \`).join('');
}

function renderPagination() {
  const el = document.getElementById('pagination');
  el.innerHTML = \`
    <button onclick="loadPage(\${currentPage - 1})" \${currentPage === 1 ? 'disabled' : ''}>← Назад</button>
    <span class="info">страница \${currentPage} из \${totalPages}</span>
    <button onclick="loadPage(\${currentPage + 1})" \${currentPage === totalPages ? 'disabled' : ''}>Вперёд →</button>
  \`;
}

// Init
renderAuthors();
if (firstPageData) {
  renderPosts(JSON.parse(firstPageData));
  renderPagination();
} else {
  document.getElementById('posts').innerHTML = '<p class="empty">Нет постов.</p>';
}
</script>
</body>
</html>`;

mkdirSync(DIST_DIR, { recursive: true });
writeFileSync(join(DIST_DIR, 'index.html'), html, 'utf-8');
console.log(`Generated index.html in ${DIST_DIR}`);
console.log(`  authors: ${authors?.count ?? 0}, posts: ${firstPage?.totalPosts ?? 0}, pages: ${postPages.length}`);