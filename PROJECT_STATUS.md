# Project Status

## Completed features

- Foundation (Next.js App Router, TypeScript, auth, shell, theming)
- Projects (CRUD, switcher, active project cookie)
- Keyword Research (search, match-type modes, SERP analysis, suggestions, compare, history)
- Quick Difficulty, Brainstorm, Bulk Analysis, Keyword Lists
- Deep Dive (multi-source autocomplete mining, intent tabs, on-demand SERP columns)
- Site Audit (crawler, issue checks, history, pagination/filter)
- Content Intelligence (priority, decay, comparison from latest audits)
- Google Connect (Search Console + GA4 OAuth, property selection, sync)
- Competitive Analysis (Explorer, Organic Keywords, Gap, Backlinks, URL Metrics)
- YouTube (Research, Difficulty, Lists)
- Rank Tracker (position history from Search Console)
- Content Optimizer (target length, headings, LSI terms, entities, questions, content score)
- WordPress connector (plugin + token handshake, post sync) and the four-step
  project setup wizard
- Drafter → WordPress: duplicates the client's real Blog Post Template,
  populates its sections, saves as a draft

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
| 4 | Content (WordPress) | Connector, sync, Content Library list and the Drafter draft export are done. Labels and notes are not built |
| 10 | Reports | Export, scheduled email reports |

## WordPress connector

The plugin is generated from `lib/wordpress/plugin.ts` and served as a zip by
`/api/wordpress/plugin`. It is read-only apart from creating **drafts** —
`post_status` is hard-coded and no post ID is accepted, so it cannot publish or
overwrite existing content even if called wrongly.

The PHP lives in a TypeScript template literal, so **every backslash it needs
must be written doubled**. `tsc` will not catch a mangled regex. After editing,
run `npm run check:plugin`, which emits the real file and runs `php -l` over it.

## The client boundary

A server component may **render** a client component, but it may not **call** a
function a client module exports. Doing so throws only at render time:

```
Attempted to call parseTab() from the server but parseTab is on the client.
```

`tsc` sees a valid import, the build succeeds, and the first sign is a blank
"Something went wrong" in production. That is how the Competitor Explorer broke.

Helpers both sides need go in a plain module under `lib/` —
`parseTab`/`OVERVIEW_TABS` live in `lib/domain-overview.ts` beside `parseRange`
for exactly this reason.

`npm run check:boundary` enforces it across every file.

## Deep Dive

`/deep-dive`. One keyword becomes a few hundred real phrases, sliced by intent.

Ideas come from **eight working sources**, hit directly rather than through
SerpApi — their autocomplete endpoints are free, so a search costs nothing and
is cached for 7 days in `SerpCache`:

| Source | Cost |
|--------|------|
| Google, Bing, YouTube, DuckDuckGo, Amazon, eBay Suggest | free |
| Related Keywords, Competitors | one SerpApi lookup |

**Deep sweep** re-asks each source for the keyword followed by every letter
a–z. That is what turns a 10-phrase autocomplete response into ~380; each
expansion caches independently. Measured: 381 ideas across five engines in 2.3s.

Three of KeySearch's sources are listed but disabled, with the reason on the
row rather than quietly returning Google's results under another name:

- **Database** — no licensed keyword dataset is connected (same reason volume
  and CPC are estimated everywhere else).
- **Etsy Suggest** — no public endpoint; returns 404 off-site.
- **Pinterest Suggest** — 403 without a logged-in session.

Which columns are real is the usual split, and the footer of the screen says so:

| Column | Tier |
|--------|------|
| The phrases themselves | Measured — a real search box returned them |
| Ranking Pages | Measured — live Google results, in order |
| Volume, CPC, PPC, Score, Est. Links, DA³ | Estimated |

`Est. Links`, `DA³` and `Ranking Pages` cost one SERP call per keyword, so they
stay blank until the author selects rows and presses **Analyse** — capped at 10
per request by `MAX_ENRICH`. Anything already in the SERP cache is free.

`DA³` is the mean Domain Authority of the top 3 results. `Est. Links` is the
median referring domains to the ranking *pages* — page-level, not domain-level,
or amazon.com's whole profile lands in a column whose real answers are small.

Tests: `npm run test:deep-dive` (hits the live endpoints — they are free).

## Drafting an article

One click. The author enters a keyword and pastes a recipe, presses **Draft
Article**, and the finished post appears in the editor a few minutes later.
Nothing else is asked of them.

Behind that is a durable background job, because a serverless function has 60
seconds and an article takes about six minutes. `POST /api/articles/[id]/draft-job`
creates a `DraftJob` row with fifteen `DraftJobStage` rows and returns
immediately; workers claim it, do as much as fits in their budget, persist, and
hand it on.

| Stage | Does | Model calls |
|-------|------|-------------|
| validate | Parses the recipe paste, builds the voice brief | 0 |
| research | SERP, Search Console, the site's own post index | 0 |
| outline | Which sections this recipe earns, and their headings | 1 |
| sections | Writes them, two or three per call | 4–6 |
| recipe | Recipe card, split from the author's paste | 0 |
| faq | 3–5 questions, from real PAA data where there is any | 1 |
| expand | Tops up the thinnest sections, only if the draft is short | 0–2 |
| internal-links | Links mentions of real published recipes | 0 |
| affiliate-links | Links ingredients from Easy Affiliate Links | 0 |
| metadata | Title, SEO title, description, slug, excerpt | 1 |
| style-qa | Measures the draft against the house style | 0 |
| proofread | Typos only, in chunks, with the links masked | 3–4 |
| completeness | Placeholders, missing sections, raw links, length | 0 |
| assemble | Sanitises, normalises dashes, one H1 rule | 0 |
| save | Writes the article, keeping the author's own title | 0 |

Roughly **13 model calls and 29,000 tokens** for a 1,800-word post.

Three things make it survive production:

- **A lease.** `claimJob` is one `UPDATE … WHERE lease is expired`, so two
  workers cannot write the same job. A worker that dies leaves a stale lease
  that the next one reclaims.
- **A per-minute token window.** The provider meters prompt plus reply at 8,000
  tokens a minute and an article needs 29,000, so the job paces itself and
  yields rather than collecting a 429 that would burn a stage's retries in
  seconds.
- **Four ways to wake up.** The chain (`after()` calling the runner again), the
  open editor's status poll, a sweep of the signed-in user's own stalled jobs
  when they load the article list, and a daily cron sweeper. Any one of them
  alone finishes a job, so a dead function, a closed tab and a deploy
  mid-generation are all survivable.

  The cron is daily because Vercel's Hobby plan allows nothing more frequent;
  on Pro, `vercel.json` can drop to `*/5 * * * *` and the list-page sweep
  becomes belt-and-braces rather than the main safety net.

Every stage is idempotent: `@@unique([draftJobId, name])` plus a commit guarded
on `status: "running"`, so a retry that arrives after the original committed
finds the finished row and moves on instead of paying for the section twice.

Stopping keeps everything written so far, and **Pick up where it stopped**
resumes at the first unfinished stage rather than starting the article again.

## Foresight

An intelligence layer over data the app already holds — no new pipelines and no
new provider calls. `/foresight` reads synced Search Console rows, the cached
SerpApi responses, the latest audit and the WordPress post index, and models
what SEO work could produce.

The readiness gate decides what may be produced at all, and on this deployment
that matters: **no project has a Search Console property linked**, so the
traffic and revenue forecast is switched off rather than invented. What still
runs from cached SERPs and the audit — opportunity discovery, reachability,
time-to-rank, the priority matrix and the action plan — is what the page leads
with until Google is connected.

| Module | Does |
|--------|------|
| `readiness.ts` | Scores the evidence and gates every capability |
| `evidence.ts` | One pass over everything, in Postgres; nothing fetched |
| `ctr.ts` | Site CTR curve from GSC, else the industry curve, clearly labelled |
| `serp-features.ts` | Reads AI Overview / PAA / video etc. from the cache; adjustment derived where measurable, assumed and labelled otherwise |
| `trend.ts` | Damped Theil-Sen baseline, seasonality, changepoints |
| `reachability.ts` | Authority / content / technical / SERP gaps → likely…too ambitious |
| `time-to-rank.ts` | Fastest / expected / slower, never a date |
| `scenario.ts` | Conservative / expected / aggressive, as named levers |
| `simulate.ts` | Deterministic Monte Carlo → P10 / P50 / P90 |
| `backtest.ts` | Rolling-origin evaluation; confidence stays null until it runs |
| `opportunities.ts` + `plan.ts` | Findings, and a plan capped by stated capacity |
| `store.ts` | Saved forecasts, and scoring them against actuals later |

Three rules hold throughout:

- **Nothing is invented.** A figure with no trustworthy source is `unavailable`
  and renders as "Not available", never as zero. Search volume in particular is
  never fabricated — first-party impressions are the demand evidence.
- **Modelled is its own provenance.** A forecast is not a measurement, and the
  chip beside every number says which it is.
- **No confidence score without a backtest.** It reads "Unvalidated" until the
  model has been scored against real outcomes for that project.

The numeric engine is deterministic and contains no model call. An identical
forecast rebuilds byte-for-byte, which is what makes a saved one comparable
against reality months later.

## Drafter → WordPress export

Send to WordPress **duplicates the client's own "Blog Post Template" post**
(cinnamonsnail.com #37284) and writes the article into its existing sections.
It does not generate markup. The template is the source of truth for structure,
so the `wp:group` wrappers, `feast-top-tip` classes, two-column step grid,
Feast jump-to and related-recipes blocks, Yoast FAQ block and WP Recipe Maker
card all survive untouched.

| Module | Does |
|--------|------|
| `lib/wordpress/blocks.ts` | Gutenberg parser/serialiser. Lossless — verified byte-for-byte against all 1285 synced posts (`npm run test:blocks`) |
| `lib/wordpress/template.ts` | Finds the template post, groups it into sections by heading wording |
| `lib/wordpress/section-mapper.ts` | Writes the article into the template's own shells |
| `lib/wordpress/draft-export.ts` | Links, payload, the draft-only guard, the send |

Two things about the template are load-bearing and easy to break:

- **Step numbers come from CSS**, via the `numpic turn2` class on each step
  image — not from the heading. Step headings are replaced with the generated
  ones; the image classes never are. Extra steps clone a column pair and
  continue the four-class rotation (`turn2, turn3, turn, none`).
- **Images are never uploaded.** The client's photo and alt-text workflow owns
  those. The template's empty image blocks are preserved; app-hosted images in
  a draft are dropped rather than shipped as URLs that would 404.

Nothing can publish. The plugin hard-codes `draft`, and `assertDraftOnly`
independently refuses a non-draft status, a write aimed at the template post,
and an update targeting a published post.

Which post is the template is set per project in **Project settings → Blog post
template** (`Project.wpTemplatePostId`). Unset falls back to auto-detection by
title and section match, and the export preview says which it used.

Testing: `npm run test:template` runs three recipes through the whole path
offline. `npm run test:export-live` creates real drafts on the connected site
and reads them back — it cannot publish, and prints every draft ID it made.

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
| `WordPressConnection` | Connector token per project (AES-256-GCM at rest) |
| `WpPost` | Posts/pages synced from WordPress (including the template draft) |

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
| `GROK_API_KEY`                           | For drafting    | Groq `gsk_…` or xAI `xai-…`; the endpoint is picked from the prefix  |                      |
| `GROK_MODEL`                             | No              | Default `openai/gpt-oss-120b`. Set this when a model is retired      |                      |
| `AI_TPM_BUDGET`                          | No              | Tokens per request, prompt + reply. Default 7,600 for an 8k plan     |                      |
| `AI_MAX_OUTPUT_TOKENS`                   | No              | Ceiling on one reply. Default 3,000                                  |                      |
| `AI_RETRY_LIMIT`                         | No              | Attempts per stage. Default 3                                        |                      |
| `AI_STAGE_TIMEOUT`                       | No              | Per-call timeout, ms. Default 50,000                                 |                      |
| `AI_REASONING_EFFORT`                    | No              | `low` (default) / `medium` / `high` / `off` for gpt-oss-style models  |                      |
| `AI_REASONING_RESERVE`                   | No              | Reply tokens kept back for hidden reasoning. Default 300             |                      |
| `CRON_SECRET`                            | For recovery    | Authorises `/api/cron/draft-jobs`; without it that route refuses all |                      |
| `NEXT_PUBLIC_APP_URL`                    | Off Vercel      | How the deployment reaches itself to chain job workers               |                      |
------------------------------------------------------------------------------------------------------------------------------------------

## Local development

`npm run dev` is pinned to **port 3000**. If it ever starts elsewhere, a stale
Node process is holding the port — stop it and restart rather than changing the
port.

## Deployment

`npm run deploy` ships the **working directory** to Vercel production
(`cinnamon-snail-seo-tool`) — not a git commit. Uncommitted edits go live, so
check `git status` first.

There is no git remote and no Vercel Git integration, so nothing deploys on its
own. `.vercelignore` keeps `.env*` and the docs out of the upload. Roll back
from the Vercel dashboard, which keeps every previous deployment.

## Known limitations

- Search Console history only starts from the first sync; the Rank Tracker has
  nothing to plot before then.
- Sites behind bot protection (Cloudflare, consent walls) cannot be crawled or
  read; those screens say so rather than showing zeros.
- A crashed crawl can leave an audit stuck in `running`, which blocks new
  audits for that project. Stale audits older than 2 hours are auto-failed on
  server boot and before starting a new crawl.
- Drafting takes about six minutes, almost all of it waiting on the provider's
  8,000-tokens-per-minute allowance rather than on the model. A larger plan
  would shorten it in direct proportion; nothing in the code needs to change
  beyond `AI_TPM_BUDGET`.
- The style check reports banned words rather than replacing them. The right
  substitute depends on the sentence, and a machine picking synonyms in a voice
  this specific does more damage than the original word.

## Next implementation priority

Content labels and notes (#4), or Reports (#10).
