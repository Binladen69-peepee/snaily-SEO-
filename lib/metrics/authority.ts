import { prisma } from "@/lib/db";
import {
  derived,
  unavailable,
  type Measured,
} from "@/lib/metrics/provenance";
import { loadSettings } from "@/lib/settings";
import {
  fetchDomainAgeYears,
  fetchOpenPageRank,
  fetchTrancoPageRank,
  openPageRankConfigured,
  wellKnownPageRank,
} from "@/lib/metrics/sources";
import {
  buildVisibilityIndex,
  corpusSize,
  type DomainVisibility,
} from "@/lib/metrics/visibility";

/**
 * Snaily Domain Authority and Trust.
 *
 * These are our own metrics, not Moz's. They are not calibrated against DA and
 * will not match it number for number; the goal is that the *ordering* is
 * sensible — wikipedia.org above allrecipes.com above a local caterer — and
 * that every point is traceable to something real.
 *
 * The formula is published in the UI beside the score. Four signals, each
 * genuinely observed:
 *
 *   55%  OpenPageRank   PageRank over the Common Crawl link graph
 *   30%  SERP presence  how often Google ranks it, in SERPs we already hold
 *   15%  Domain age     RDAP registration date
 *
 * A fourth signal — Common Crawl's indexed page count — was built and then
 * removed. Its cheap endpoint (`showNumPages`) returns a `blocks` figure of
 * 0–4 with almost no discrimination: measured live, nytimes.com returned 0
 * while cinnamonsnail.com returned 1, which would have ranked a small site
 * above the New York Times on "size". Real counts need per-domain pagination
 * over capture records, which is far too many requests to justify. A signal
 * that looks meaningful but is not is worse than no signal.
 *
 * Missing signals are not treated as zero — that would punish a strong domain
 * for a failed API call. Instead the weights of the signals we *do* have are
 * renormalised, and the count is reported so the UI can show confidence.
 */

/** Monthly, matching the Common Crawl graph rebuild cadence. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Empty rank rows are retried the same day, not locked for a month. */
const EMPTY_TTL_MS = 6 * 60 * 60 * 1000;

const WEIGHTS = {
  openPageRank: 0.55,
  serpVisibility: 0.3,
  domainAge: 0.15,
} as const;

export type AuthoritySignals = {
  openPageRank: number | null;
  /** Measured linking-domain count from the webgraph, when the API supplied it. */
  referringDomains?: number | null;
  domainAgeYears: number | null;
  visibility: DomainVisibility | null;
};

/**
 * Compresses an open-ended count onto 0–1.
 *
 * Log-scaled because authority signals are heavily skewed: the gap between 10
 * and 100 referring pages means far more than the gap between 10,000 and
 * 10,090. `ceiling` is the value treated as a full score.
 */
function logScale(value: number, ceiling: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log10(1 + value) / Math.log10(1 + ceiling));
}

export type ScoreTerm = { label: string; detail: string; weight: number; contribution: number };

export type DomainAuthority = {
  domain: string;
  score: Measured;
  trust: Measured;
  terms: ScoreTerm[];
  /** How many of the four signals were available. */
  signalCount: number;
  /** Common Crawl PageRank 0–10, used to derive link counts. */
  openPageRank: number | null;
  /**
   * Measured count of linking domains from the OpenPageRank webgraph.
   * When present this is REAL and replaces the modelled estimate entirely.
   */
  referringDomains: number | null;
};

/**
 * Turns raw signals into a 0–100 score.
 *
 * Pure and synchronous so it can be unit-tested and so the same maths runs
 * whether the inputs came from a live fetch or the cache.
 */
export function scoreDomain(
  domain: string,
  signals: AuthoritySignals,
  corpus: number,
): DomainAuthority {
  const measuredReferringDomains = signals.referringDomains ?? null;
  const rank = signals.openPageRank ?? wellKnownPageRank(domain);
  const resolved: AuthoritySignals = {
    ...signals,
    openPageRank: rank,
  };
  const terms: ScoreTerm[] = [];
  let weightUsed = 0;
  let weighted = 0;

  const add = (label: string, detail: string, weight: number, normalised: number) => {
    terms.push({
      label,
      detail,
      weight,
      contribution: Math.round(normalised * weight * 100),
    });
    weightUsed += weight;
    weighted += normalised * weight;
  };

  if (resolved.openPageRank !== null) {
    // PageRank is already logarithmic on 0–10, so it maps linearly.
    add(
      "Link graph",
      signals.openPageRank != null
        ? `PageRank ${resolved.openPageRank.toFixed(2)} / 10`
        : `Known publisher floor ${resolved.openPageRank.toFixed(2)} / 10`,
      WEIGHTS.openPageRank,
      Math.min(1, resolved.openPageRank / 10),
    );
  }

  if (resolved.visibility !== null && corpus > 0) {
    const v = resolved.visibility;
    // Share of the corpus it appears in, lifted by how well it ranks there.
    const coverage = Math.min(1, v.queries / Math.max(1, corpus));
    const quality = Math.min(1, v.weightedShare / Math.max(1, v.appearances) / 27.6);
    // Google expanding sitelinks is an explicit vote of confidence, so it lifts
    // the term rather than forming a weight of its own.
    const sitelinkRate = Math.min(1, v.sitelinkHits / Math.max(1, v.appearances));

    add(
      "SERP presence",
      `ranks in ${String(v.queries)} of ${String(corpus)} tracked searches, average position ${String(v.averagePosition)}` +
        (v.sitelinkHits > 0
          ? `, sitelinks shown ${String(v.sitelinkHits)} time${v.sitelinkHits === 1 ? "" : "s"}`
          : ""),
      WEIGHTS.serpVisibility,
      Math.min(1, coverage * 0.5 + quality * 0.35 + sitelinkRate * 0.15),
    );
  }

  if (resolved.domainAgeYears !== null) {
    add(
      "Domain age",
      `registered ${String(resolved.domainAgeYears)} years ago`,
      WEIGHTS.domainAge,
      logScale(resolved.domainAgeYears, 25),
    );
  }

  if (weightUsed === 0) {
    const note =
      "No authority signal could be read for this domain.";
    return {
      domain,
      score: unavailable(note),
      trust: unavailable(note),
      terms: [],
      signalCount: 0,
      openPageRank: resolved.openPageRank,
      referringDomains: measuredReferringDomains,
    };
  }

  // Renormalise against the weight actually available, so a missing signal
  // lowers confidence rather than silently dragging the score toward zero.
  const score = Math.round(Math.min(100, (weighted / weightUsed) * 100));

  /*
   * Trust is deliberately a different question from authority: not "how strong
   * is this domain" but "how established and stable is it". Age and link-graph
   * standing carry it; raw size does not.
   */
  const trustParts: number[] = [];
  if (resolved.domainAgeYears !== null) trustParts.push(logScale(resolved.domainAgeYears, 20));
  if (resolved.openPageRank !== null) trustParts.push(Math.min(1, resolved.openPageRank / 10));
  if (resolved.visibility !== null) {
    trustParts.push(Math.min(1, resolved.visibility.queries / 10));
  }

  const trust =
    trustParts.length === 0
      ? null
      : Math.round((trustParts.reduce((a, b) => a + b, 0) / trustParts.length) * 100);

  return {
    domain,
    terms,
    signalCount: terms.length,
    openPageRank: resolved.openPageRank,
    referringDomains: measuredReferringDomains,
    score: derived(
      score,
      `Snaily Domain Authority — a 0–100 score from ${String(terms.length)} of 3 free signals. Not Moz DA; the ordering is comparable, the numbers are not.`,
      terms.map((t) => ({
        label: t.label,
        detail: t.detail,
        weight: Math.round(t.weight * 100),
      })),
    ),
    trust:
      trust === null
        ? unavailable("Not enough signals to judge how established this domain is.")
        : derived(trust, "Snaily Trust — how established and stable the domain looks, from age, link-graph standing and ranking consistency."),
  };
}

/** Reads cached rows and reports which domains still need fetching. */
async function loadCached(domains: string[]) {
  try {
    const rows = await prisma.domainMetric.findMany({
      where: { domain: { in: domains } },
    });
    const fresh = new Map<string, (typeof rows)[number]>();
    const stale: string[] = [];

    for (const domain of domains) {
      const row = rows.find((r) => r.domain === domain);
      const ttl = row?.openPageRank != null ? TTL_MS : EMPTY_TTL_MS;
      if (row && Date.now() - row.fetchedAt.getTime() < ttl) {
        fresh.set(domain, row);
      } else {
        stale.push(domain);
      }
    }
    return { fresh, stale };
  } catch {
    // A missing DomainMetric table must not blank the SERP — score live.
    return { fresh: new Map(), stale: domains };
  }
}

/**
 * Authority for a set of domains — typically the ten on one SERP.
 *
 * Batched end to end: one OpenPageRank call covers up to 100 domains, and the
 * visibility index is built once for the whole set. Cached rows are reused for
 * a month, so a repeat search costs nothing at all.
 */
export async function getDomainAuthority(
  input: string[],
): Promise<Map<string, DomainAuthority>> {
  await loadSettings();

  const domains = [...new Set(
    input.map((d) => d.replace(/^www\./, "").toLowerCase()).filter((d) => d !== ""),
  )];

  const out = new Map<string, DomainAuthority>();
  if (domains.length === 0) return out;

  const [{ fresh, stale }, visibility, corpus] = await Promise.all([
    loadCached(domains),
    buildVisibilityIndex().catch(() => new Map()),
    corpusSize().catch(() => 0),
  ]);

  // Only the stale set costs anything externally.
  if (stale.length > 0) {
    const ranks = openPageRankConfigured()
      ? await fetchOpenPageRank(stale)
      : new Map<
          string,
          { rank: number | null; position: number | null; referringDomains: number | null }
        >();

    // Common Crawl and RDAP are per-domain, so they run with a small amount of
    // concurrency rather than all at once — these are free public endpoints
    // and hammering them would be rude as well as unreliable.
    for (let i = 0; i < stale.length; i += 4) {
      const batch = stale.slice(i, i + 4);
      await Promise.all(
        batch.map(async (domain) => {
          const opr = ranks.get(domain);
          let pageRank = opr?.rank ?? null;
          if (pageRank == null) pageRank = wellKnownPageRank(domain);
          if (pageRank == null) pageRank = await fetchTrancoPageRank(domain);

          const domainAgeYears = await fetchDomainAgeYears(domain);

          const signals: AuthoritySignals = {
            openPageRank: pageRank,
            referringDomains: opr?.referringDomains ?? null,
            domainAgeYears,
            visibility: visibility.get(domain) ?? null,
          };

          const scored = scoreDomain(domain, signals, corpus);
          out.set(domain, scored);

          const data = {
            openPageRank: signals.openPageRank,
            openPageRankPos: opr?.position ?? null,
            referringDomains: opr?.referringDomains ?? null,
            linkDataRelease: opr?.referringDomains != null ? "OpenPageRank webgraph" : "",
            linkDataFetchedAt: opr?.referringDomains != null ? new Date() : null,
            domainAgeYears,
            snailyDa: scored.score.value,
            snailyTrust: scored.trust.value,
            signalsUsed: scored.terms.map((t) => t.label),
            fetchedAt: new Date(),
          };

          try {
            await prisma.domainMetric.upsert({
              where: { domain },
              create: { domain, ...data },
              update: data,
            });
          } catch {
            // Scoring still returns even if the cache write fails.
          }
        }),
      );
    }
  }

  // Cached rows are re-scored rather than read back verbatim: the visibility
  // term changes as the SERP corpus grows, even when the fetched signals have not.
  for (const [domain, row] of fresh) {
    out.set(
      domain,
      scoreDomain(
        domain,
        {
          openPageRank: row.openPageRank ?? wellKnownPageRank(domain),
          referringDomains: row.referringDomains,
          domainAgeYears: row.domainAgeYears,
          visibility: visibility.get(domain) ?? null,
        },
        corpus,
      ),
    );
  }

  return out;
}
