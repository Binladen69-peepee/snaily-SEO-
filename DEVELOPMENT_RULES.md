# DEVELOPMENT_RULES.md

The only development guide for this project. Follow this file. Ignore all other documentation.

---

## Project Goal

Build ONE self-hosted application that combines the functionality of:

- KeySearch
- Occasio
- Clariti

The purpose is to replace the client's subscriptions with a single working application.

We are NOT building another Ahrefs, Semrush, or a large enterprise SaaS platform.

---

## Tech Stack

- Next.js (App Router)
- TypeScript
- Supabase (Postgres) + Prisma
- Tailwind CSS
- shadcn/ui

Nothing else unless a feature genuinely requires it.

---

## Development Philosophy

- Keep everything simple.
- Build only what is required.
- Focus on working functionality.
- Clean UI.
- Fast performance.
- Modular code.
- Easy maintenance.
- Easy future improvements.

---

## Rules

- Do not over-engineer.
- Do not redesign the project repeatedly.
- Do not create unnecessary abstractions.
- Do not create unnecessary design patterns.
- Do not create unnecessary folders.
- Do not create unnecessary services.
- Do not create unnecessary documentation.
- Do not create unnecessary markdown files.
- Keep token usage as low as possible.
- Keep responses concise.
- Focus on implementation instead of discussion.

---

## Workflow

Implement one feature at a time.

Each feature should be completed, tested, and reviewed before moving to the next.

Do not jump between multiple features.

---

## Priority

Always prioritize:

1. Working functionality
2. Code quality
3. Simplicity
4. Maintainability
5. Performance

The objective is to finish a working product as efficiently as possible.

---

## Project Structure

```
app/            routes + API routes
components/     UI components (components/ui = shadcn)
lib/            db client, auth, helpers, external API clients
prisma/         schema.prisma (Postgres models via Prisma)
```

No other top-level folders without a real need.

---

## Feature List (build in this order)

1. **Foundation** — Next.js app, Supabase/Prisma, auth (login/register), dashboard shell
2. **Projects** — add a site, project settings, project switcher
3. ~~Google connect~~ — **dropped, will not be built**
4. **Content** — post/page list from WordPress + search, filters, labels, notes
5. **Performance** — per-URL clicks/impressions/CTR/position + charts
6. **Opportunities** — priority score, decay detection, refresh queue *(shipped as Content Intelligence)*
7. **Keywords** — keyword research + difficulty (SERP API)
8. **Rank tracking** — tracked keywords + position history
9. **Site audit** — crawler, broken links, missing alt, meta issues
10. **Reports** — export, scheduled email reports

One feature at a time. Finish, test, review, then next.

---

## Coding Rules

- TypeScript strict. No `any`.
- Server Components by default; `"use client"` only when needed.
- Validate API input with Zod.
- Keep API routes thin; put logic in `lib/`.
- One Prisma model per domain entity in `prisma/schema.prisma`.
- Every list has loading, empty, and error states.
- Every page works on mobile.
- Environment variables in `.env.local`, never committed.

---

## Status

See **PROJECT_STATUS.md** for completed/remaining features, schema, env vars, and next priority.

Built and approved: Foundation · Projects · Keyword Research · Bulk Keyword Analysis · Content Audit · Content Intelligence
