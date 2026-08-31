import type { Issue } from "@/lib/audit/types";
import { RECOMMENDATIONS } from "@/lib/intelligence/recommendations";
import {
  detectDecay,
  opportunityScore,
  pageHealth,
  priorityScore,
} from "@/lib/intelligence/score";
import type {
  Comparison,
  IntelReport,
  IssueDelta,
  PageIntel,
  PageSnapshot,
} from "@/lib/intelligence/types";
import { isDefect } from "@/lib/audit/types";
import { prisma } from "@/lib/db";
import { getPagePerformance, toPath } from "@/lib/google/performance";

/** A page is "needs attention" at this priority or above. */
const ATTENTION_THRESHOLD = 40;
/** How many changed items the comparison panel carries. Counts stay exact. */
const DELTA_LIMIT = 50;

type PageRow = {
  url: string;
  path: string;
  status: number;
  title: string;
  wordCount: number;
  internalLinkCount: number;
  brokenLinks: string[];
  imagesMissingAltSrc: string[];
  lastModified: Date | null;
  issues: unknown;
};

function parseIssues(value: unknown): Issue[] {
  if (!Array.isArray(value)) return [];
  return value as Issue[];
}

/**
 * Stored issues, reconciled against what the current rules would find.
 *
 * A page's issue list is computed once, at crawl time, and kept as JSON. That
 * makes a crawl a snapshot of what the code believed on the day it ran — so
 * correcting a rule does not correct the reports already sitting in the
 * database, and the owner keeps being shown a defect the current code would
 * never raise. It is why the missing-alt fix appeared not to work: his latest
 * crawl flagged 80 of the 80 pages it could read, every one of them written
 * before the image classifier existed.
 *
 * Only evidence stored on the row can be reconciled here — most of what a
 * check reads (heading counts, canonical, word counts) is not kept — so this
 * is deliberately narrow rather than a re-run of every check. A missing-alt
 * issue names images: the row records which ones, the fix action needs them,
 * and an issue that cannot name a single image is not one the reader can see,
 * act on or confirm.
 *
 * A re-crawl produces the same answer. This makes the dashboard honest in the
 * meantime, and keeps an older crawl honest when it is read for comparison.
 */
function reconcile(issues: Issue[], row: PageRow): Issue[] {
  if (row.imagesMissingAltSrc.length > 0) return issues;
  return issues.filter((i) => i.code !== "missing_alt");
}

function toSnapshot(doc: PageRow): PageSnapshot {
  return {
    url: doc.url,
    path: doc.path,
    status: doc.status,
    title: doc.title,
    wordCount: doc.wordCount,
    internalLinkCount: doc.internalLinkCount,
    brokenLinks: doc.brokenLinks,
    imagesMissingAltSrc: doc.imagesMissingAltSrc,
    lastModified: doc.lastModified?.toISOString() ?? null,
    issues: reconcile(parseIssues(doc.issues), doc),
  };
}

function codesOf(issues: Issue[]): Set<string> {
  return new Set(issues.map((i) => i.code));
}

/**
 * Builds the Content Intelligence report for a project's most recent completed
 * audit, comparing it against the one before it.
 *
 * Reads existing audit data only — Content Intelligence stores nothing of its
 * own, so it always reflects the latest crawl with no extra sync step.
 */
export async function buildReport(
  userId: string,
  projectId: string,
): Promise<IntelReport | null> {
  const completed = await prisma.audit.findMany({
    where: { userId, projectId, status: "completed" },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  const latest = completed[0];
  const previous = completed[1];

  if (!latest) return null;

  const [currentDocs, previousDocs] = await Promise.all([
    prisma.auditPage.findMany({ where: { auditId: latest.id } }),
    previous
      ? prisma.auditPage.findMany({ where: { auditId: previous.id } })
      : Promise.resolve([]),
  ]);

  const prevByUrl = new Map<string, PageSnapshot>(
    previousDocs.map((d) => [d.url, toSnapshot(d)]),
  );

  // Real Google performance, keyed by pathname. Empty when GSC/GA4 are not
  // connected — every consumer treats that as "fall back to structure".
  const performance = await getPagePerformance(String(projectId));

  const now = Date.now();
  // Without a previous audit nothing is "new" — it's all just the current state.
  const hasPrevious = previousDocs.length > 0;

  const pages: PageIntel[] = currentDocs.map((doc) => {
    const snapshot = toSnapshot(doc);
    const before = prevByUrl.get(snapshot.url);

    const perf = performance.get(toPath(snapshot.url));
    const decay = detectDecay(snapshot, before, now);
    const beforeCodes = before ? codesOf(before.issues) : new Set<string>();
    const nowCodes = codesOf(snapshot.issues);

    return {
      ...snapshot,
      priority: priorityScore(snapshot, decay, perf),
      opportunity: opportunityScore(snapshot, perf),
      performance: perf ?? null,
      health: pageHealth(snapshot),
      decay,
      // A page added since the last crawl arrives with all of its issues new.
      newIssues: !hasPrevious
        ? []
        : before
          ? snapshot.issues.filter((i) => !beforeCodes.has(i.code))
          : snapshot.issues,
      resolvedIssues: before
        ? before.issues.filter((i) => !nowCodes.has(i.code))
        : [],
      isNew: hasPrevious && !before,
    };
  });

  pages.sort((a, b) => b.priority.score - a.priority.score);

  const quickWins = pages.reduce(
    (sum, p) =>
      sum + p.issues.filter((i) => RECOMMENDATIONS[i.code].effort === "quick").length,
    0,
  );

  const totalPriority = pages.reduce((sum, p) => sum + p.priority.score, 0);

  return {
    auditId: latest.id,
    auditDate: latest.startedAt.toISOString(),
    healthScore: latest.healthScore,
    summary: {
      hasPerformance: performance.size > 0,
      totalPages: pages.length,
      pagesFound: Math.max(latest.pagesFound, pages.length),
      needsAttention: pages.filter((p) => p.priority.score >= ATTENTION_THRESHOLD)
        .length,
      /*
       * Clean means "nothing to fix", not "nothing to say". A page whose only
       * entries are an image correctly marked decorative, or a note that the
       * crawler was blocked, has no defect on it.
       */
      cleanPages: pages.filter(
        (p) => p.issues.filter((i) => isDefect(i.code)).length === 0,
      ).length,
      decayingPages: pages.filter((p) => p.decay.length > 0).length,
      avgPriority:
        pages.length === 0 ? 0 : Math.round(totalPriority / pages.length),
      quickWins,
    },
    comparison: previous
      ? buildComparison(
          previous.id,
          previous.startedAt.toISOString(),
          latest.healthScore - previous.healthScore,
          latest.totalIssues - previous.totalIssues,
          pages.length - previousDocs.length,
          pages,
          prevByUrl,
        )
      : null,
    pages,
  };
}

function buildComparison(
  previousId: string,
  previousDate: string,
  healthDelta: number,
  issueDelta: number,
  pagesDelta: number,
  pages: PageIntel[],
  prevByUrl: Map<string, PageSnapshot>,
): Comparison {
  const newIssues: IssueDelta[] = [];
  const resolvedIssues: IssueDelta[] = [];
  const newPages: { path: string; url: string }[] = [];
  let newIssueCount = 0;
  let resolvedIssueCount = 0;
  let changedPages = 0;

  const seen = new Set<string>();

  for (const page of pages) {
    seen.add(page.url);
    if (page.isNew) newPages.push({ path: page.path, url: page.url });

    if (page.newIssues.length > 0 || page.resolvedIssues.length > 0) {
      changedPages++;
    }

    for (const issue of page.newIssues) {
      newIssueCount++;
      if (newIssues.length < DELTA_LIMIT) {
        newIssues.push({
          path: page.path,
          url: page.url,
          code: issue.code,
          detail: issue.detail,
        });
      }
    }

    for (const issue of page.resolvedIssues) {
      resolvedIssueCount++;
      if (resolvedIssues.length < DELTA_LIMIT) {
        resolvedIssues.push({
          path: page.path,
          url: page.url,
          code: issue.code,
          detail: issue.detail,
        });
      }
    }
  }

  const removedPages = [...prevByUrl.values()]
    .filter((p) => !seen.has(p.url))
    .map((p) => ({ path: p.path, url: p.url }));

  return {
    previousId,
    previousDate,
    healthDelta,
    issueDelta,
    pagesDelta,
    newIssueCount,
    resolvedIssueCount,
    newIssues,
    resolvedIssues,
    newPages: newPages.slice(0, DELTA_LIMIT),
    removedPages: removedPages.slice(0, DELTA_LIMIT),
    changedPages,
  };
}
