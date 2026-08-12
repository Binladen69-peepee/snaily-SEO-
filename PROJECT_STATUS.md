# Project Status

## Completed features

- Foundation (Next.js App Router, TypeScript, auth, shell, theming)
- Projects (CRUD, switcher, active project cookie)
- Keyword Research (search, match-type modes, SERP analysis, suggestions, compare, history)
- Quick Difficulty, Brainstorm, Bulk Analysis, Keyword Lists
- Site Audit (crawler, issue checks, history, pagination/filter)
- Content Intelligence (priority, decay, comparison from latest audits)
- Google Connect (Search Console + GA4 OAuth, property selection, sync)
- Competitive Analysis (Explorer, Organic Keywords, Gap, Backlinks, URL Metrics)
- YouTube (Research, Difficulty, Lists)
- Rank Tracker (position history from Search Console)
- Content Optimizer (target length, headings, LSI terms, entities, questions, content score)

Auth: custom JWT cookie (`jose`) + bcrypt — not Supabase Auth. Registration
works once, creating the owner; all later accounts come from the Users page.

Data: Supabase Postgres via Prisma 6.

## Where each number comes from

The app never presents a guess as a measurement. Three tiers, labelled in the UI:

| Tier | Examples | Source |
|------|----------|--------|
| Measured — Google | Ranked keywords, position, clicks, impressions, CTR | Search Console |
| Measured — live | SERP rankings, YouTube videos/views/ages, page word counts, headings, load time, citing pages | SerpApi + direct fetch |
| Estimated | Search volume, CPC, keyword difficulty, Page/Domain Authority, backlink counts | `lib/keywords/estimate.ts`, deterministic |

Estimates stay estimates until a keyword/backlink database is bought. Every
0–100 score in the app is the plain sum of the reasons shown beside it.

## Known data boundaries

- **What a domain ranks for** is only measurable for a site you own, through
  Search Console. Competitor screens report what a site *targets*, read from its
  own titles, H1s and meta descriptions.
- **Backlinks** are not indexed. The Backlink Checker returns real *citing
  pages* via Google; authority figures beside them are estimated.
- SerpApi's free tier is 250 searches/month. Every call is cached for 7 days in
  `SerpCache`, and bulk analysis deliberately spends zero credits.

## Remaining features

| # | Feature | Notes |
|---|---------|--------|
| 4 | Content (WordPress) | Posts/pages list, labels, notes — needs a WP plugin or REST credentials |
| 10 | Reports | Export, scheduled email reports |

## Current database schema summary

| Model | Purpose |
|-------|---------|
| `User` | Accounts (`email` unique, `passwordHash`, `role`) |
| `Project` | Per-user websites (`userId` + `url` unique) |
| `SearchHistory` | Keyword search recents |
| `KeywordList` | Named lists; `keywords` JSON array |
| `Audit` / `AuditPage` | Site crawl results |
| `SerpCache` | Cached third-party SERP/autocomplete responses |
| `GoogleConnection` | Encrypted OAuth tokens per project + service |
| `GscPageMetric` / `GscQueryMetric` | Search Console performance |
| `Ga4PageMetric` | GA4 engagement per landing page |

Relations cascade on parent delete. Primary keys are cuid strings.

## Environment variables
__________________________________________________________________________________________________________________________________________
| Variable                                 |                 | Required                                                             | Notes                |
|------------------------------------------|----------------------------------------------------------------------|----------------------|
| `DATABASE_URL`                           | Yes             | Supabase Postgres URI (pooler host — direct is IPv6-only)            |                      |
| `AUTH_SECRET`                            | Yes             | JWT signing key                                                      |                      | 
| `SERPAPI_KEY`                            | No              | Absent = mock provider. Powers keyword, YouTube and citation lookups |                      |
| `GOOGLE_CLIENT_ID``GOOGLE_CLIENT_SECRET` | No              |                                                    | Search Console + GA4 |
| `GOOGLE_TOKEN_KEY`                       | With OAuth      | AES-256-GCM key for token storage                                    |                      |
| `KEYWORD_PROVIDER`                       | No              | Forces `serpapi` or  `mock`                                           |                      |
| `ALLOW_PRIVATE_CRAWL`                    | No              | `1` only for local crawl testing                                     |                      |
------------------------------------------------------------------------------------------------------------------------------------------

## Local development

`npm run dev` is pinned to **port 3000**. If it ever starts elsewhere, a stale
Node process is holding the port — stop it and restart rather than changing the
port.

## Known limitations

- Search Console history only starts from the first sync; the Rank Tracker has
  nothing to plot before then.
- Sites behind bot protection (Cloudflare, consent walls) cannot be crawled or
  read; those screens say so rather than showing zeros.
- A crashed crawl can leave an audit stuck in `running`, which blocks new
  audits for that project. Stale audits older than 2 hours are auto-failed on
  server boot and before starting a new crawl.

## Next implementation priority

Open — WordPress content source (#4) or Reports (#10).
