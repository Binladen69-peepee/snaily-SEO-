import { ctrForPosition } from "@/lib/keywords/ctr";
import type { DomainAuthority } from "@/lib/metrics/authority";
import { derived, estimated, type Measured } from "@/lib/metrics/provenance";

/**
 * Snaily Page Authority.
 *
 * There is no free source of page-level link data, so this is built from the
 * one link graph we genuinely own: the internal links of a site we have
 * crawled. That is a real graph — every edge was observed in an actual page —
 * and internal PageRank is exactly how a site distributes its own authority.
 *
 * Two confidence levels, and the difference is stated rather than blurred:
 *
 *   DERIVED    the page belongs to a site we crawled, so its internal PageRank
 *              is known and carries real weight in the score.
 *   ESTIMATED  the page was only seen in a SERP. All we have is its domain's
 *              authority and where it ranked, so the score is a projection.
 *
 * Page-level *external* links stay unavailable. Nothing here pretends
 * otherwise.
 */

const DAMPING = 0.85;
const ITERATIONS = 30;

export type LinkEdge = { from: string; to: string };

/**
 * Internal PageRank over a crawled site.
 *
 * Standard power iteration with a damping factor. Dangling pages — ones with
 * no outbound internal links — would otherwise leak rank out of the system, so
 * their mass is redistributed evenly each round.
 *
 * Returns values normalised so the strongest page on the site is 1.
 */
export function internalPageRank(
  urls: string[],
  edges: LinkEdge[],
): Map<string, number> {
  const nodes = [...new Set(urls)];
  const n = nodes.length;
  const out = new Map<string, number>();
  if (n === 0) return out;

  const index = new Map(nodes.map((u, i) => [u, i]));
  const outbound: number[][] = Array.from({ length: n }, () => []);
  const outDegree = new Array<number>(n).fill(0);

  for (const edge of edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    // Self-links carry no information about relative importance.
    if (from === undefined || to === undefined || from === to) continue;
    outbound[from]!.push(to);
    outDegree[from] = (outDegree[from] ?? 0) + 1;
  }

  let rank = new Array<number>(n).fill(1 / n);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const next = new Array<number>(n).fill(0);
    let dangling = 0;

    for (let i = 0; i < n; i++) {
      const degree = outDegree[i] ?? 0;
      if (degree === 0) {
        dangling += rank[i]!;
        continue;
      }
      const share = rank[i]! / degree;
      for (const target of outbound[i]!) {
        next[target] = (next[target] ?? 0) + share;
      }
    }

    const base = (1 - DAMPING) / n + (DAMPING * dangling) / n;
    for (let i = 0; i < n; i++) {
      next[i] = base + DAMPING * next[i]!;
    }
    rank = next;
  }

  const max = Math.max(...rank);
  for (let i = 0; i < n; i++) {
    out.set(nodes[i]!, max > 0 ? rank[i]! / max : 0);
  }
  return out;
}

export type PageAuthorityInput = {
  url: string;
  /** The domain's Snaily authority, when it could be scored. */
  domain: DomainAuthority | undefined;
  /** Normalised internal PageRank 0–1, when the site was crawled. */
  internalRank?: number | null;
  /** Organic position where this URL was observed, when it came from a SERP. */
  serpPosition?: number | null;
};

/**
 * Page Authority 0–100.
 *
 * Weighted toward the parent domain, which is both what the data supports and
 * how page-level authority actually behaves — a new page on a strong domain
 * genuinely does start ahead of a new page on a weak one.
 */
export function scorePage(input: PageAuthorityInput): Measured {
  const domainScore = input.domain?.score.value ?? null;

  const parts: { weight: number; value: number }[] = [];

  if (domainScore !== null) {
    parts.push({ weight: input.internalRank == null ? 0.8 : 0.55, value: domainScore });
  }

  if (input.internalRank != null) {
    parts.push({ weight: 0.3, value: input.internalRank * 100 });
  }

  if (input.serpPosition != null && input.serpPosition > 0) {
    // Ranking well is evidence about the page, not just the domain. Scaled by
    // the CTR curve so position 1 counts for far more than position 9.
    parts.push({ weight: 0.15, value: Math.min(100, (ctrForPosition(input.serpPosition) / 27.6) * 100) });
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) {
    return {
      value: null,
      provenance: "unavailable",
      note: "No usable signal for this page.",
    };
  }

  const score = Math.round(
    parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight,
  );

  if (input.internalRank != null) {
    return derived(
      score,
      "Snaily Page Authority — from this page's internal PageRank within its own site, its domain's authority, and where it ranks.",
    );
  }

  return estimated(
    score,
    "Snaily Page Authority, projected. This page's own site has not been crawled, so the score comes from its domain's authority and its ranking position only.",
  );
}
