/**
 * Free, public sources behind the Snaily authority scores.
 *
 * None of these is a paid SEO provider and none needs a subscription:
 *
 *  - OpenPageRank — PageRank recomputed over the Common Crawl link graph.
 *    Free tier is 30,000 domains/month, 100 domains per request. Needs a key.
 *  - RDAP — the registry protocol that replaced WHOIS. Registration date is
 *    published for most gTLDs. No key.
 *
 * Every function here returns null rather than throwing on failure. A missing
 * signal must degrade the score's confidence, never break the page.
 */

const TIMEOUT_MS = 5_000;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------
 * OpenPageRank
 * ---------------------------------------------------------------------- */

export function openPageRankConfigured(): boolean {
  return (process.env.OPENPAGERANK_API_KEY ?? "").trim() !== "";
}

export type OpenPageRankResult = {
  domain: string;
  /** 0–10, logarithmic, from the Common Crawl link graph. */
  rank: number | null;
  /** Position in OpenPageRank's global ordering, when published. */
  position: number | null;
  /**
   * Authority-weighted count of distinct linking domains.
   *
   * This is a MEASURED quantity straight from the webgraph — the real thing the
   * `link-counts` curve was only ever approximating. Whenever it is present it
   * must replace the modelled estimate and the figure becomes REAL.
   */
  referringDomains: number | null;
};

/**
 * Response shape of the current bulk endpoint.
 *
 * The service moved from domcop.com to Keywords Everywhere: the old
 * `GET /api/v1.0/getPageRank` with an `API-OPR` header is gone, replaced by
 * `POST /v1/domains/bulk` with bearer auth and different field names. The old
 * shape is still parsed below so a legacy key keeps working.
 */
type OprResponse = {
  results?: {
    domain?: string;
    found?: boolean;
    open_page_rank?: number | string;
    rank?: number | string | null;
    referring_domains?: number | string | null;
  }[];
  /** Legacy shape, kept for backwards compatibility. */
  response?: {
    domain?: string;
    page_rank_decimal?: number | string;
    rank?: number | string | null;
    status_code?: number;
  }[];
};

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Link-graph rank for up to 100 domains in one call.
 *
 * Batching matters: the free allowance is counted in domains, but the rate
 * limit is per request, so one call for a whole SERP costs the same as one
 * call for a single domain.
 */
export async function fetchOpenPageRank(
  domains: string[],
): Promise<Map<string, OpenPageRankResult>> {
  const out = new Map<string, OpenPageRankResult>();
  const key = (process.env.OPENPAGERANK_API_KEY ?? "").trim();
  const unique = [...new Set(domains.map((d) => d.toLowerCase()).filter((d) => d !== ""))];
  if (key === "" || unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);

    let data: OprResponse | null = null;
    try {
      const res = await fetch(
        "https://openpagerank.keywordseverywhere.com/v1/domains/bulk",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ domains: batch }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        },
      );
      if (res.ok) data = (await res.json()) as OprResponse;
    } catch {
      data = null;
    }

    if (data === null) continue;

    for (const row of data.results ?? []) {
      const domain = (row.domain ?? "").toLowerCase();
      if (domain === "") continue;
      // `found: false` means the domain is simply not in the graph, which is
      // itself informative — it is a weak domain, not a failed lookup.
      out.set(domain, {
        domain,
        rank: row.found === false ? null : toNumber(row.open_page_rank),
        position: toNumber(row.rank),
        referringDomains: toNumber(row.referring_domains),
      });
    }

    // Legacy domcop response, in case an old key is still in use.
    for (const row of data.response ?? []) {
      const domain = (row.domain ?? "").toLowerCase();
      if (domain === "" || out.has(domain)) continue;
      out.set(domain, {
        domain,
        rank: row.status_code === 200 ? toNumber(row.page_rank_decimal) : null,
        position: toNumber(row.rank),
        referringDomains: null,
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------
 * RDAP — domain age
 * ---------------------------------------------------------------------- */

type RdapResponse = {
  events?: { eventAction?: string; eventDate?: string }[];
};

/**
 * Registration date, via the IANA RDAP bootstrap.
 *
 * rdap.org redirects to the authoritative registry for the TLD, so one URL
 * covers every gTLD that publishes RDAP. Many ccTLDs redact dates entirely —
 * that returns null, and the score simply drops the age term.
 */
export async function fetchDomainAgeYears(domain: string): Promise<number | null> {
  const root = domain.split("/")[0]!.replace(/^www\./, "");
  const data = await getJson<RdapResponse>(`https://rdap.org/domain/${encodeURIComponent(root)}`);
  if (data === null) return null;

  const created = (data.events ?? []).find(
    (e) => e.eventAction === "registration",
  )?.eventDate;
  if (typeof created !== "string" || created === "") return null;

  const ms = Date.now() - new Date(created).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;

  return Math.round((ms / (365.25 * 86_400_000)) * 10) / 10;
}

/* -------------------------------------------------------------------------
 * Tranco — keyless popularity rank
 * ---------------------------------------------------------------------- */

type TrancoResponse = {
  ranks?: { date?: string; rank?: number }[];
};

/**
 * Convert a Tranco 1…N rank onto OpenPageRank's 0–10 scale.
 *
 * log10 so the gap between #1 and #10 is larger than #100,000 and #100,010.
 * Rank 1 → 10, rank 1,000,000 → 2.
 */
export function pageRankFromTranco(rank: number): number {
  if (!Number.isFinite(rank) || rank < 1) return 0;
  return Math.max(0, Math.min(10, 10 - Math.log10(rank) * (8 / 6)));
}

/**
 * Latest Tranco rank for one domain. No API key.
 *
 * The public endpoint is 1 query/second; callers should cache the result
 * (we store it on DomainMetric for a month). Returns null on 429/failure
 * rather than throwing — a missing rank must not blank the SERP table.
 */
export async function fetchTrancoPageRank(domain: string): Promise<number | null> {
  const root = domain.replace(/^www\./, "").toLowerCase();
  if (root === "") return null;

  const data = await getJson<TrancoResponse>(
    `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(root)}`,
  );
  const latest = [...(data?.ranks ?? [])]
    .filter((r) => typeof r.rank === "number" && Number.isFinite(r.rank) && r.rank >= 1)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0]?.rank;
  if (latest == null) return null;
  return pageRankFromTranco(latest);
}

/* -------------------------------------------------------------------------
 * Well-known publisher floors
 * ---------------------------------------------------------------------- */

/**
 * Stable 0–10 floors for domains that dominate real SERPs.
 *
 * Used only when no live rank (OpenPageRank or Tranco) came back, so a
 * wikipedia.org result is never shown as N/A just because an API key is
 * missing. Values are in OpenPageRank's ballpark, not Moz DA.
 */
const WELL_KNOWN_RANK: Record<string, number> = {
  "wikipedia.org": 9.5,
  "youtube.com": 9.8,
  "facebook.com": 9.6,
  "instagram.com": 9.4,
  "twitter.com": 9.3,
  "x.com": 9.3,
  "linkedin.com": 9.2,
  "reddit.com": 8.8,
  "amazon.com": 9.6,
  "nytimes.com": 8.7,
  "bbc.co.uk": 8.6,
  "bbc.com": 8.6,
  "theguardian.com": 8.3,
  "washingtonpost.com": 8.2,
  "cnn.com": 8.4,
  "forbes.com": 8.1,
  "healthline.com": 7.6,
  "webmd.com": 7.8,
  "mayoclinic.org": 8.0,
  "nih.gov": 8.5,
  "cdc.gov": 8.4,
  "britannica.com": 7.9,
  "allrecipes.com": 7.2,
  "seriouseats.com": 6.4,
  "bonappetit.com": 6.6,
  "foodnetwork.com": 7.0,
  "epicurious.com": 6.3,
  "simplyrecipes.com": 6.1,
  "budgetbytes.com": 5.4,
  "pinterest.com": 8.9,
  "tiktok.com": 8.7,
  "medium.com": 7.4,
  "quora.com": 7.5,
  "tripadvisor.com": 7.8,
  "imdb.com": 8.4,
  "github.com": 8.6,
  "stackoverflow.com": 8.3,
  "apple.com": 9.4,
  "microsoft.com": 9.3,
  "google.com": 10,
  "gov.uk": 8.2,
  "who.int": 8.1,
};

export function wellKnownPageRank(domain: string): number | null {
  const host = domain.replace(/^www\./, "").toLowerCase();
  if (host === "") return null;
  const exact = WELL_KNOWN_RANK[host];
  if (exact !== undefined) return exact;
  for (const [suffix, rank] of Object.entries(WELL_KNOWN_RANK)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return rank;
  }
  return null;
}
