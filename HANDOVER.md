# Snaily SEO — handover

Self-hosted SEO tooling for The Cinnamon Snail. Next.js 15 App Router,
TypeScript strict, Prisma + Supabase Postgres, Tailwind v4, deployed to Vercel.

## Running it

```bash
npm install
npm run dev            # localhost:3000
npm run build          # prisma generate && next build
npm run deploy         # vercel --prod --yes, straight from this directory
```

Deploys do **not** come from git. `npm run deploy` uploads the working
directory. Whatever is on disk is what ships.

## Configuration: two layers, in this order

1. **Runtime settings** — encrypted rows in `AppSetting`, edited in
   Integrations. Changing a key here takes effect on the next request, no
   deploy.
2. **Environment variables** — `.env.local` locally, Vercel env in production.
   Only the fallback.

`lib/settings.ts` resolves them. `ensureSettings()` hydrates the encrypted
store into `process.env` before any provider reads it, cached 30s so a key
saved on one serverless instance reaches the others quickly. Provider code
must `await ensureSettings()` before reading credentials — the DataForSEO
client, the SerpApi guard and the three Google OAuth routes already do.

Secrets are encrypted with `AUTH_SECRET`. **If `AUTH_SECRET` changes, every
stored secret and every OAuth token becomes unreadable.**

## Providers

- **DataForSEO** — primary for SERP, keyword autocomplete and domain
  authority. `preferProvider` defaults to DataForSEO; only an explicit
  `"serpapi"` puts SerpApi first.
- **SerpApi** — fallback only. The account is currently exhausted (0/250).
- **Google** — sign-in, Search Console, Analytics. The OAuth client is
  `791613313131-…`; its authorised redirect URI must exactly match
  `<origin>/api/google/callback`.

Authority values are **DataForSEO Rank (0–100)**, never Moz DA/PA. Do not
relabel them.

## WordPress connector

A plugin, generated from `lib/wordpress/plugin.ts` and served as a ZIP from
`/api/wordpress/plugin`. Current version **1.5.0**.

It can create drafts, update drafts, upload media, and set alt text on an
existing image. It **refuses to modify a published post** — that guard is the
reason installing it is safe, so think hard before relaxing it.

`npm run check:plugin` lints the generated PHP.
`npm run check:plugin-zip` asserts the archive contains the behaviour it claims.

The PHP lives inside a TypeScript template literal: **no backticks anywhere in
that file**, and escape backslashes.

Drafts are attributed to the author configured in Settings → Snaily SEO
(defaults to the first administrator), whoever sent them from the app.

## Tests

```bash
npm run test:content-audit      # alt / link classification, clean-page maths
npm run test:intelligence-cards # spotlight cards, stale issues, score inputs
npm run test:fix-actions        # the media-alt fix and its refusals
npm run test:runtime-settings   # provider resolution order, masking
npm run test:integrations       # provider grouping, verify-before-save
npm run test:card-fields        # recipe-card derivation
npm run test:content-library    # filtering, paging, debounce
npm run test:document           # ArticleDocument, Tamale Pie taxonomy
npm run test:dataforseo         # provider adapter
npm run test:style              # writing-style gates
# …and: editor jobs links affiliate merge foresight export-fields
#        quality drafter-research countries control-panel serp-normalized
```

Browser checks need Edge (already on Windows):

```bash
npm install --no-save playwright-core
TARGET=https://cinnamon-snail-seo-tool.vercel.app node scripts/verify-responsive.mjs
```

Verifies 390/768/1024/1440 for overflow, plus keyboard focus.

```bash
TARGET=https://cinnamon-snail-seo-tool.vercel.app node scripts/verify-intel-cards.mjs
```

Clicks a card in each spotlight group and checks the detail actually arrives on
screen, names the page the card named, and raises no console error.

**Run these against production, not `next start`.** `next start` answers 400
for chunk URLs containing the `(app)` route-group parentheses; the resulting
"Loading chunk failed" banner is one long URL that reads as a layout overflow.
Vercel serves those chunks correctly.

## Things that will bite you

- **Emoji headings are load-bearing.** `lib/wordpress/sections.ts` maps a post's
  H2s onto template sections by their text. Renaming a heading changes where its
  content lands on export.
- **The recipe is immutable.** Ingredients and instructions are copied verbatim
  from the author's paste — never reordered, corrected, split into amounts, or
  inferred. Structured data is a factual claim; a guessed cook time is a lie at
  scale.
- **Derive, never invent.** `lib/drafter/card-fields.ts` fills course, cuisine
  and keyword from categories the article already has. Times, yield and cost
  stay empty because only the author knows them.
- **`alt=""` is correct markup**, not a missing alt. `lib/audit/images.ts`
  classifies images as content / decorative / chrome; only a content image with
  no alt attribute is a defect, and only when the crawl can name the image —
  a count with no source is not reportable, fixable or verifiable.
- **A crawl is a snapshot of what the code believed that day.** Issues are
  computed once, at crawl time, and stored as JSON, so correcting a check does
  not correct reports already in the database. `reconcile()` in
  `lib/intelligence/report.ts` re-tests stored issues against the evidence on
  the row on the way out. Only evidence the row stores can be reconciled; for
  anything else, re-run the audit.
- **Scores count defects, not everything reported.** `decorative_image`,
  `blocked_internal_link` and `page_unreachable` are informational — they are
  shown, never scored. Scoring them once put "11 decorative images correctly
  marked" on Fix these first.
- **Never format a date or number by runtime locale on these screens.** They
  render on Vercel in UTC and hydrate in the reader's zone; a bare
  `toLocaleString()` is a hydration error on every non-UTC load. Use
  `lib/intelligence/dates.ts` and `formatNumber`.
- **A blocked page is not a broken page.** Cloudflare answers the crawler with
  429 on cinnamonsnail.com. `lib/audit/link-status.ts` separates
  valid/redirect/blocked/timeout/broken, and only 404/410/5xx counts.
- **Utilities belong in `@utility`,** not `@layer base` — a base-layer class
  loses the cascade. That is what made `.scroll-x` compute to
  `overflow-x: visible`.

## Backing this up (do this first)

There is no git remote. The full history is bundled at:

```
~/snaily-backup/snaily-seo-complete.bundle     (verified complete, 1.4 MB)
```

A bundle is a clone source, so that one file is a working backup:

```bash
git clone ~/snaily-backup/snaily-seo-complete.bundle recovered-snaily
```

To put it on GitHub — **create the repository as PRIVATE** (see the secret note
below), then:

```bash
git remote add origin https://github.com/<you>/snaily-seo.git
git push -u origin master
git push origin --all && git push origin --tags
git ls-remote origin          # confirm the remote has every ref
```

Nothing in the working tree contains a secret: `.env` and `.env.local` are
ignored, `.env.example` holds placeholders only, and a scan of every tracked
file for `GOCSPX-`, `sk-`, `xoxb-`, `AIza` and private-key headers is clean.

### One secret is in git history

Commit `1708eb8` contains a real Google client secret for the **877448…**
client, in `.env.example`, commented out. It was removed from the working tree
but history was deliberately not rewritten.

**Revoke that secret in Google Cloud.** It is not the client the app uses
(`791613…` is), so revoking it changes nothing operationally. Until it is
revoked, keep the repository private.

If you would rather purge it than revoke it, `git filter-repo --replace-text`
over that one file works — but rewriting history invalidates the bundle above
and any clone, so revoke first and treat rewriting as optional.

## Open items

- **No git remote.** See "Backing this up" above — the bundle is a stopgap, not
  a substitute for pushing somewhere.
- **Revoke the `877448…` Google client secret** (details above).
- **The media-alt fix has never written a new value in production**, because the
  site has no genuine missing-alt image (30 posts, 433 content images, zero
  missing). It is verified through a no-op write and 30 unit tests.
