import type { IssueCode } from "@/lib/audit/types";

/**
 * Rule-based recommendations.
 *
 * One entry per issue code — no LLM, no hidden logic. To cover a new audit
 * check, add its code here and every part of Content Intelligence (actions,
 * effort, opportunity scoring) picks it up automatically.
 */

export type Effort = "quick" | "moderate" | "involved";

export type Recommendation = {
  /** What to do, phrased as an instruction. */
  action: string;
  /** Why it matters, so the user can judge whether to bother. */
  why: string;
  effort: Effort;
};

/** How much work a fix costs. Divides the value of a fix in the opportunity score. */
export const EFFORT_COST: Record<Effort, number> = {
  quick: 1,
  moderate: 2,
  involved: 3,
};

export const EFFORT_LABEL: Record<Effort, string> = {
  quick: "Quick fix",
  moderate: "Moderate",
  involved: "Involved",
};

export const RECOMMENDATIONS: Record<IssueCode, Recommendation> = {
  missing_title: {
    action:
      "Write a unique title tag of 50–60 characters that leads with the page's main topic.",
    why: "The title is the headline in search results and the strongest on-page signal you control.",
    effort: "quick",
  },

  missing_meta_description: {
    action:
      "Add a 140–160 character meta description that summarises the page and gives a reason to click.",
    why: "Without one, search engines invent a snippet from the page body — usually a worse one.",
    effort: "quick",
  },

  title_too_long: {
    action: "Shorten the title to 50–60 characters, keeping the main keyword near the front.",
    why: "Long titles get truncated in search results and the cut-off text is often unhelpful.",
    effort: "quick",
  },

  meta_too_long: {
    action: "Trim the meta description to 140–160 characters.",
    why: "Google truncates longer snippets, so the important words may never appear.",
    effort: "quick",
  },

  missing_h1: {
    action: "Add a single H1 that states what the page is about.",
    why: "The H1 confirms the page's topic to both readers and crawlers.",
    effort: "quick",
  },

  multiple_h1: {
    action: "Keep the most relevant H1 and demote the rest to H2.",
    why: "Several H1s split the page's topical focus instead of reinforcing one.",
    effort: "quick",
  },

  duplicate_title: {
    action: "Rewrite the title so no other page on the site uses it.",
    why: "Duplicate titles make your own pages compete for the same query.",
    effort: "quick",
  },

  duplicate_meta_description: {
    action: "Write a description specific to this page's content.",
    why: "Repeated descriptions get ignored and replaced with auto-generated text.",
    effort: "quick",
  },

  missing_alt: {
    action: "Add descriptive alt text to every image that carries meaning.",
    why: "Alt text is required for screen readers and is how images get found in image search.",
    effort: "quick",
  },

  not_indexable: {
    action:
      "Remove the noindex directive if this page is meant to rank; otherwise drop its internal links.",
    why: "A noindex page cannot appear in search results no matter how good it is.",
    effort: "moderate",
  },

  broken_internal_link: {
    action: "Repoint or remove the broken links listed on this page.",
    why: "Broken links dead-end visitors and waste the crawl budget spent reaching them.",
    effort: "moderate",
  },

  blocked_internal_link: {
    action:
      "No action needed unless you expected these to be crawlable — the host answered the crawler with a block (403/429) or the request timed out. Readers clicking the link are unaffected.",
    why: "A host refusing a crawler says nothing about whether the destination works. These are listed so nothing is hidden, not because they are broken.",
    effort: "quick",
  },

  page_unreachable: {
    action:
      "Nothing to fix on the page. The host answered the crawler with a block (403/429) or the request timed out, so this page could not be read this time — readers are unaffected. If it keeps happening, allow the crawler's user agent through your firewall or CDN so the audit can see the page.",
    why: "A page the crawler could not fetch has not been assessed. It is listed so a gap in the audit is visible rather than silently counted as healthy.",
    effort: "quick",
  },

  decorative_image: {
    action:
      "Nothing to do. These images carry `alt=\"\"`, `role=\"presentation\"` or aria-hidden, which is the correct way to mark an image a screen reader should skip.",
    why: "Adding alt text to a decorative image makes the page worse for screen-reader users, not better.",
    effort: "quick",
  },

  short_content: {
    action:
      "Expand the page past 300 words by answering the questions a searcher would actually have.",
    why: "Thin pages rarely rank and can pull down how the whole site is assessed.",
    effort: "involved",
  },

  http_error: {
    action:
      "Restore the page, or 301-redirect the URL to the closest working equivalent.",
    why: "An erroring URL loses every ranking and internal link it had earned.",
    effort: "involved",
  },
};
