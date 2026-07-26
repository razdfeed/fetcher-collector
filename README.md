# fetcher-collector

Бот-сборщик для **razdfeed** — платформы блогов на основе GitHub Discussions.

## Как это работает

```
┌─────────────────┐     ┌──────────────────────┐     ┌───────────────────────────┐
│  Авторы         │     │  fetcher-collector   │     │  razdfeed.github.io       │
│  (GitHub repos  │     │  (этот бот)           │     │  (Next.js фронтенд)       │
│  named razdfeed)│     │                       │     │                           │
│                 │     │  1. Поиск репо        │     │  public/data/             │
│  .razdfeed.yml  │────▶│     "razdfeed"        │────▶│   {author}/posts.json    │
│  + Discussions  │     │  2. Чтение .razdfeed  │     │   {author}/author.json    │
│                 │     │  3. Сбор постов       │     │   {author}/{slug}.json   │
│                 │     │     через GraphQL     │     │   index.json              │
│                 │     │  4. Запись JSON      │     │   all-posts.json          │
└─────────────────┘     │     (local или API)   │     └───────────────────────────┘
                        └──────────────────────┘
```

**Полностью serverless**: GitHub Actions по расписанию → GitHub API → GitHub Pages. Никакого сервера арендовать не нужно.

## Принцип работы

1. **Поиск авторов**: бот ищет все публичные репозитории с названием `razdfeed` через GitHub Search API (GraphQL).
2. **Чтение конфига**: из каждого найденного репо читается `.razdfeed.yml` — настройки блога (имя, категория, метки, опционально другой репо-источник).
3. **Сбор постов**: из Discussions репозитория-источника собираются посты через GitHub GraphQL API, с фильтрацией по категории и меткам.
4. **Публикация**: JSON-файлы пушатся в репозиторий `razdfeed/razdfeed.github.io` через GitHub Contents API (без git-клонирования).

## Выходной формат

Два файла-коллекции в `public/data/` репозитория `razdfeed.github.io`:

```
public/data/
├── authors.json       # Все авторы в одном файле
├── posts-1.json        # Посты, страница 1 (до 100 постов)
├── posts-2.json        # Посты, страница 2 (если > 100 постов)
└── posts-{n}.json      # ... и т.д., пагинация по 100 постов
```

### authors.json

```json
{
  "generatedAt": "2026-07-26T09:14:54Z",
  "count": 1,
  "authors": [
    {
      "login": "dealenx",
      "name": "dealenx",
      "description": "",
      "language": "ru",
      "avatar": "https://...",
      "bio": null,
      "htmlUrl": "https://github.com/dealenx",
      "blog": null,
      "repo": "dealenx/razdfeed",
      "postCount": 0,
      "latestPostAt": null
    }
  ]
}
```

### posts-{page}.json (пагинация)

```json
{
  "page": 1,
  "pageSize": 100,
  "totalPosts": 250,
  "totalPages": 3,
  "nextPage": "posts-2.json",
  "prevPage": null,
  "posts": [ { ... FeedPost ... } ]
}
```

Фронтенд загружает `posts-1.json`, видит `totalPages` и `nextPage` —
и при необходимости подгружает следующую страницу. Посты отсортированы
по дате (новые сверху).

## Локальный запуск

```bash
# LOCAL — собирает и пишет файлы в ./dist/public/data (для теста, без публикации)
export GITHUB_TOKEN=ghp_...
bun run local
# или: bun run index.ts --local

# DRY-RUN — превью в консоли + файлы в ./dist/public/data
bun run dev
# или: bun run index.ts --dry-run

# PUBLISH — собирает и публикует в razdfeed/razdfeed.github.io через API
bun run collect
# или: bun run index.ts
```

`GITHUB_TOKEN` нужен всегда (для поиска репо, GraphQL, инфо автора).
Результат локального запуска: `dist/public/data/`

## CI

Workflow `.github/workflows/collect.yml` запускается каждый час и собирает посты всех авторов. Нужен secret `RAZDFEED_TOKEN` — GitHub PAT с доступом к `repo` (для записи в `razdfeed.github.io`) и `read` для Discussions.

## Как автору подключить блог

1. Создать публичный репозиторий с названием `razdfeed` (например `yourname/razdfeed`).
2. Добавить файл `.razdfeed.yml` (см. `.razdfeed.example.yml`).
3. Включить Discussions в репозитории (Settings → Features → Discussions).
4. Создать Discussions-категорию для постов (по умолчанию `Announcements`).
5. Бот сам найдёт репозиторий при следующем запуске.