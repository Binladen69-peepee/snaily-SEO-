Hi Adam,

Taking your points in order, then a consolidated list of everything I need from you at the end.

---

## 1. Why the KeySearch and SnailySEO numbers don't match

You spotted the two real gaps. Both come from the same root cause, and neither is a bug — it's a missing data subscription.

**The DA/PA/Doms columns are blank because we have no backlink index.**

Page Authority, Domain Authority, linking domains and total links can only come from a crawler that has indexed the web's link graph — Moz, Majestic, Ahrefs or DataForSEO. We don't subscribe to one, so the tool reports "N/A" rather than showing a number.

That's a deliberate choice I want to flag, because it's a change from how the tool behaved earlier. Those columns *used* to be populated — but the values were generated from the domain name and its ranking position, not from any real link data. The effect was that the same site scored DA 89 at rank 1 and DA 68 at rank 5, a domain that doesn't exist outscored nytimes.com, and a client whose true DA is 48–51 was displayed as 71. I removed that. The rule now is that every number in the tool is either measured, labelled as an estimate derived from something real, or reported as unavailable. Nothing is invented.

So the N/A is the honest answer until we buy the data. Wiring in a provider turns those columns on.

**The keyword column differs for two separate reasons.**

*Volume and CPC are estimated, not real.* SerpApi returns genuine Google results — the ranking URLs, titles, positions, related searches, autocomplete — but it does not return search volume or cost-per-click. Those figures currently come from a formula based on phrase length and intent. That's why "charoset" shows 24,290 in our tool and 8,100 in KeySearch. KeySearch's 8,100 is real Google Keyword Planner data. Ours is a placeholder.

*The list is much shorter.* KeySearch found 345 keywords; we found 24. KeySearch queries a keyword database with hundreds of thousands of stored long-tail variants. We build our list from what one live Google page can tell us — related searches plus autocomplete — which caps out at roughly 20–30 phrases. That's why you see "alcohol free charoset," "almond charoset recipe" and similar low-volume long-tails on their side and not on ours.

Both are fixed by the same purchase. Details below.

---

## 2. Moz vs DataForSEO — cost and what each actually buys

The important thing to know before comparing price: **these two products solve different halves of the problem.**

| | Moz Links API | DataForSEO |
|---|---|---|
| PA / DA / linking domains / total links | Yes | Yes, but on its own scale |
| Keyword database (the 345-vs-24 gap) | No | Yes |
| Real search volume + CPC | No | Yes |
| Billing | Monthly subscription | Pay-as-you-go, no subscription |
| Minimum commitment | Monthly plan | $50 top-up |

Worth knowing: **PA and DA are Moz's own proprietary scores.** KeySearch's PA/DA columns are Moz numbers. DataForSEO returns equivalent authority metrics (Domain Rank, referring domains, backlink counts) but on its own scale, so the figures will be credible and real — they just won't read identically to KeySearch's.

### Expected cost at under 100 searches a month

**DataForSEO also sells SERP results, which means it replaces SerpApi rather than sitting alongside it.** Their Google SERP call is $0.002 — against SerpApi's paid plans at around $75/month. So the "upgrade SerpApi *and* pay for DataForSEO" scenario never has to happen.

One account, pay-as-you-go, $50 minimum top-up, no subscription:

| Item | Rate | At 100 searches |
|---|---|---|
| SERP results (the left-hand table) | $0.002 per search | $0.20 |
| Keyword database + real volume and CPC | $0.01 per search + $0.0001 per keyword returned | ~$3.00 |
| Authority metrics for the ranking URLs | $0.024 per request | ~$7.20 |
| **Total** | | **≈ $10 / month** |

That last line falls further in practice. The same domains recur constantly across SERPs, so caching authority data by domain for a month means most lookups cost nothing. **Realistically $6–10/month.**

There is no monthly commitment: a month where you run no searches costs nothing at all, and the $50 opening balance would last four to six months at this usage.

### On SerpApi

You can stay on the free tier today. One caution: each keyword search currently spends **two** SerpApi credits, not one — the search itself plus the autocomplete call — so 100 searches is 200 of your 250. You're at 49 this month, so there is room, but it is tighter than it looks.

Once DataForSEO is wired in, that constraint disappears entirely and SerpApi can be dropped.

### Dropping Moz

I'd previously offered Moz at $75/month as an optional extra for DA/PA that matches KeySearch number-for-number. **At this budget, forget it.** DataForSEO's authority figures are real and sourced; they simply sit on a different scale to Moz's. That is the right trade at $10/month.

### On "5x the cost of KeySearch"

If the only goal were KeySearch's features, you would be right and I would tell you to keep KeySearch — $20/month is a good price for what it does, and I would not try to talk you out of it.

But that is not what this tool now is. Published prices for the other two you asked me to replicate:
__________________________________________
|  Monthly                     | cost     |
|------------------------------|----------|
| KeySearch                    | $20      |
| Occasio                      | $69      |
| Clariti                      | **$129** | 
| **All three**                | **$218** |
| **This tool, at your usage** | **~$10** |
|------------------------------|----------|

No per-post caps, no per-seat limits, and you own it.

I need the DataForSEO login and password to wire it up.



## 3. How GEO Lab is meant to work

Fair question — it isn't a rank tracker and it doesn't behave like the rest of the tool, so it's genuinely unintuitive until the shape clicks.

**The premise:** when someone asks ChatGPT or Google's AI overview "what does vegan wedding catering cost in NJ," those systems answer by citing pages that give specific, verifiable, honest answers. GEO Lab exists to find the questions being asked and produce pages worth citing. It's a content pipeline, not a measurement tool.

**The workflow, start to finish:**

**Step 1 — Business Knowledge (one-time setup).** You fill in the Business Facts panel. This is the grounding record, and it's the whole safety mechanism: the generator is only allowed to state things recorded here. No service area on file means no city gets named. No pricing logic means no cost claim. This is why the tool won't run until it's filled in.

**Step 2 — Search Moments.** You type a seed topic ("NJ vegan caterer") and pick which of your pages it should support. The tool pulls real demand signal — Google's People Also Ask, related searches, and once Search Console is connected, the queries your site already gets impressions for but few clicks. That last one is the most valuable: it's Google telling you it's already showing your site for something you haven't properly answered.

Each signal is then mapped onto a grid of four search moments (Want to Know / Want to Go / Want to Do / Want to Buy) crossed with six trust categories (Pricing, Problems, Not a Fit, Comparison, How-To, Local Logistics). Each intersection becomes one article idea. "Not a Fit" content — honestly saying when someone doesn't need you — tends to earn the most citations precisely because it isn't selling.

**Step 3 — Redundancy Radar.** Automatically blocks ideas that duplicate a page you've already published or another idea in the same batch. It normalises place names first, so "vegan caterer Hoboken" and "vegan caterer Jersey City" get caught as the same article with a city swapped — which is exactly the kind of thin content that hurts you.

**Step 4 — AI Opportunities.** The planner view. Filter to high-intent (Want to Buy and Want to Do are the ones closest to a booking), tick the ones you want, hit Draft.

**Step 5 — Draft & Review.** Each article runs through six stages — outline, prose, FAQ, metadata, then a self-QA pass — rather than one AI call. Anything the QA pass is unsure about gets flagged for you to check.

**Step 6 — Export.** Copy for WordPress. Nothing publishes on its own, ever.

**A sensible rhythm:** one seed topic per service line per week → map the moments → draft the two or three highest-intent pieces → review and publish. Roughly an hour a week, producing content aimed squarely at the questions people actually ask before booking.

I'll walk you through a live run once the Business Facts are in — it'll take fifteen minutes and make far more sense than any written description.

---

## 4. The Occasio-style WordPress connection

Thanks for sending Occasio over — genuinely useful reference, and the connection model they use is the right one. Here's my read on it and what the equivalent involves for us.

**What their flow actually does.** You install a small plugin on cinnamonsnail.com, it generates a secret token, you paste that token into the tool, and from then on the two talk directly. That's better than the alternative — handing over WordPress admin credentials — for three reasons: the token only grants what the plugin chooses to expose, you can revoke it yourself at any time by deactivating the plugin, and it lets the tool read things the standard WordPress API doesn't expose, like word counts and Yoast or Rank Math SEO scores.

**Where we already are.** More of this exists than you'd expect:

| Occasio | Us |
|---|---|
| Dashboard, Analytics, Post Performance | Built |
| Content Audit | Built (Site Audit + Content Intelligence) |
| Keyword Planner | Built |
| Backlinks | Built — waiting on the data provider in section 2 |
| Google Analytics / Search Console connection | Built |
| WordPress connector plugin | **To build** |
| Guided setup wizard | **To build** |
| Playbooks, Calendar | Not built |

The tool already reads published post titles from cinnamonsnail.com — that's how GEO Lab knows not to suggest an article you've already written. What it can't do yet is read post *content* and performance, or write anything back.

**What the connector adds**, in order of value:

1. **Read** — every post and page with its content, word count, categories, publish and modified dates, and SEO plugin scores, synced and kept current. This is what makes Content Audit and Post Performance work against your actual content rather than against a crawl of it.
2. **Write drafts** — GEO Lab articles land in your WordPress drafts folder with one click, replacing the copy-and-paste step you have today.
3. **Apply fixes** — push title tag and meta description changes from the On-Page tool straight to the post.

**One decision I need from you, on item 3.** Write access to a live site is a meaningful permission to hand any tool. My strong recommendation is that we start **draft-only**: the tool can create and edit drafts, but cannot publish and cannot alter anything already live. You review and publish in WordPress as normal. We can loosen it later once you've seen the output and trust it. Worth noting Occasio takes a similar view — their plugin step has a "Skip for now" option, because the tool still works read-only without it.

**Timeline.** Roughly three weeks. The plugin itself is the small part; the sync engine and the guided setup wizard are the bulk of it. I'd sequence it *after* the data provider in section 2, since that's the item currently making the tool look weaker than KeySearch — but say the word if the WordPress connection matters more to you and I'll flip the order.

---

## 5. Consolidated list of everything I need from you

### A. Decisions and credentials

1. **Data provider decision** — DataForSEO, Moz, or both (my recommendation is DataForSEO first). Then the API credentials: DataForSEO login + password, or Moz Access ID + Secret Key.
2. **SerpApi plan.** We're on the free tier — 250 searches per month across the entire tool. This is a real constraint on top of everything above; it's part of why result sets look thin. Paid plans start around $75/month for 5,000 searches. Please confirm whether to upgrade.
3. **AI writing key** (Groq or xAI) for GEO Lab and Content Assistant drafting. Currently running on my development key, which needs to come off before handover.

### B. Google (you mentioned you'd handle the Cloud settings)

4. **Search Console property:** `cinnamonsnail.com`. A **Domain property** is strongly preferred — it covers www, non-www, http and https in one. If you only have a URL-prefix property, tell me the exact URL as it appears in Search Console, because it has to match character for character.
5. The Google account you connect with needs **Owner** or **Full user** permission on that property.
6. **Google Cloud project `snaily-seo`:**
   - Enable the **Google Search Console API** and the **Google Analytics Data API**.
   - OAuth consent screen: either publish it, or add your Google account under **Test users** — otherwise sign-in fails with a "not verified" block.
   - Authorised redirect URIs must include these two, exactly:
     - `https://cinnamon-snail-seo-tool.vercel.app/api/google/callback`
     - `http://localhost:3000/api/google/callback`
   - Scopes requested: `openid`, `email`, `profile`, `webmasters.readonly`, `analytics.readonly`. All read-only — the tool never writes to Search Console or Analytics.
7. **GA4 property ID**, if you want engagement data alongside Search Console.

One note on timing: Search Console history only begins from the first sync, so the Rank Tracker has nothing to chart until then. The sooner this is connected, the sooner that data starts accumulating — worth doing ahead of the provider decision.

### C. Business Facts for GEO Lab — the exact fields

| # | Field | What's needed |
|---|---|---|
| 1 | Event types / business focus | Weddings, corporate, private parties, pop-up and cart bookings… |
| 2 | Consulting scope | What a culinary consulting engagement includes, and who it's for |
| 3 | **Service area (required)** | Counties and regions actually served. Be specific — nothing runs without this |
| 4 | Travel policy | What genuinely happens for an event outside that area |
| 5 | Pricing logic | What moves an estimate up or down. **Logic only — no quotes or figures** |
| 6 | Booking / lead time | How far ahead you realistically need, by event size |
| 7 | Guest counts | Minimum and maximum. Leave blank if there's no real limit |
| 8 | Dietary handling | Fully vegan events, mixed groups, common allergen accommodations |
| 9 | Past events | **3–5 events**, one per line. No client names or private details — general texture only |
| 10| Never-claim rules | Hard rules the generator may never break, one per line. E.g. "no health claims," "no guaranteed pricing," "no availability promises" |

Numbers 3, 9 and 10 are the ones that matter most. Service area unlocks the tool at all; past events are what make drafts sound like you rather than like a template; never-claim rules are enforced in every prompt and in the QA pass.

Plain prose is fine — bullet points in an email, or a voice note I'll transcribe. Don't polish it.

### D. Anchor URLs — four live URLs

These are the pages every supporting article links back to:

1. **Catering** (NJ/NY/PA + travel)
2. **Culinary Consulting**
3. **Galactic MegaStallion** (pop-ups / cart)
4. **Other / general brand** — homepage or main landing page

If any of these doesn't exist yet, just say so and I'll leave it blank. The tool won't invent a link to a page that isn't there.

### E. Access

8. **Temporary KeySearch login** — yes please, genuinely useful. Once the data provider is wired in I want to run the same searches on both and show you a like-for-like comparison, so you can see exactly what you're paying for.
9. **WordPress** — no credentials needed. Once the connector in section 4 is built I'll send you a ZIP file and a three-step install, exactly like Occasio's. What would help now: confirm which SEO plugin the site runs (Yoast, Rank Math, All in One SEO, or none), so the connector reads the right scores. If you'd like to speed things up, an administrator login lets me build and test against the real site instead of a local copy — but that's optional and you may prefer not to.
10. **The draft-only decision** from section 4 — confirm you're happy for the tool to create drafts but never publish or edit live pages.

---

## 6. Where the project stands right now

**Recently shipped:**
- On-Page SEO tool
- Content Intelligence interface improvements

**In progress this week:**
- GEO Lab rebuilt into the staged workflow described above — transparent GEO Score with visible arithmetic, Redundancy Radar, opportunity planner, batch drafting and export
- Business Facts panel expanded with completeness tracking, so you can see what's still missing
- Responsive pass across the whole app for tablet and phone

**Waiting on the items above:**
- Real PA/DA and link metrics — blocked on the provider decision (A1)
- Real search volume and the full keyword database — same
- Rank Tracker history and GEO Lab's Search Console signal — blocked on the Google setup (B4–B6)
- GEO Lab drafting — blocked on Business Facts and anchor URLs (C, D)

**Still to build:** the WordPress connector and guided setup described in section 4, plus the reports/export module.

**Suggested order:** data provider first (it's the one thing actively making the tool look worse than KeySearch), WordPress connector second, then reports. Roughly a month for all three. Tell me if you'd rather have the WordPress connection first — it's your call and it doesn't cost us anything to reorder.

Nothing in items C and D costs anything or depends on the provider decision, so if you can send those over first, I can have GEO Lab producing real drafts for you this week while the data question is being settled.

Happy to jump on a call for any of this — particularly the GEO Lab walkthrough, which really is much easier shown than written.

Best,
