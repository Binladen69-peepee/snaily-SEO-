import { runChecks, type CheckContext } from "@/lib/audit/checks";
import { crawlSite } from "@/lib/audit/crawler";
import {
  SEVERITY_WEIGHT,
  type CrawledPage,
  type Issue,
  type IssueCode,
} from "@/lib/audit/types";
import { prisma } from "@/lib/db";

const MIN_WORD_COUNT = 300;

/** Sum of severity weights — higher means this page needs attention sooner. */
function issueScore(page: CrawledPage): number {
  return page.issues.reduce((sum, i) => sum + SEVERITY_WEIGHT[i.severity], 0);
}

/**
 * Health score, 0–100.
 *
 * Same shape as the keyword Opportunity Score: a transparent weighted penalty
 * normalised against how bad the crawl could realistically have been.
 */
function healthScore(pages: CrawledPage[]): number {
  if (pages.length === 0) return 0;

  const penalty = pages.reduce((sum, p) => sum + issueScore(p), 0);
  // ~3 medium issues per page is treated as a total failure.
  const worstCase = pages.length * 6;

  return Math.max(0, Math.min(100, Math.round(100 - (penalty / worstCase) * 100)));
}

function findDuplicates(values: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.trim();
    if (key === "") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * Runs a full audit and writes results.
 *
 * Called without awaiting from the API route: the request returns an audit id
 * immediately and the client polls for progress.
 */
export async function runAudit(
  auditId: string,
  projectId: string,
  startUrl: string,
  maxPages: number,
) {
  try {
    const { pages: fetched, brokenUrls } = await crawlSite({
      startUrl,
      maxPages,
      onProgress: async (crawled, found) => {
        await prisma.audit.update({
          where: { id: auditId },
          data: { pagesCrawled: crawled, pagesFound: found },
        });
      },
    });

    const ctx: CheckContext = {
      duplicateTitles: findDuplicates(fetched.map((p) => p.title)),
      duplicateDescriptions: findDuplicates(
        fetched.map((p) => p.metaDescription),
      ),
      minWordCount: MIN_WORD_COUNT,
    };

    const pages: CrawledPage[] = fetched.map((p) => {
      const broken = p.internalLinks.filter((l) => brokenUrls.has(l));
      const withLinks = { ...p, brokenLinks: broken, issues: [] };
      return { ...withLinks, issues: runChecks(withLinks, ctx) };
    });

    const issueCounts = {} as Record<IssueCode, number>;
    let totalIssues = 0;
    for (const page of pages) {
      for (const issue of page.issues) {
        issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
        totalIssues++;
      }
    }

    // Replace any previous rows for this audit, then insert fresh.
    await prisma.auditPage.deleteMany({ where: { auditId } });

    if (pages.length > 0) {
      await prisma.auditPage.createMany({
        data: pages.map((p) => ({
          auditId,
          projectId,
          url: p.url,
          path: safePath(p.url),
          status: p.status,
          title: p.title,
          metaDescription: p.metaDescription,
          h1: p.h1,
          wordCount: p.wordCount,
          canonical: p.canonical,
          indexable: p.indexable,
          lastModified: p.lastModified !== null ? new Date(p.lastModified) : null,
          imagesTotal: p.imagesTotal,
          imagesMissingAlt: p.imagesMissingAlt,
          internalLinkCount: p.internalLinks.length,
          brokenLinks: p.brokenLinks,
          issues: p.issues,
          issueCodes: p.issues.map((i: Issue) => i.code),
          issueScore: issueScore(p),
        })),
        skipDuplicates: true,
      });
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: "completed",
        pagesCrawled: pages.length,
        healthScore: healthScore(pages),
        issueCounts,
        totalIssues,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: "failed",
        error:
          err instanceof Error ? err.message : "The crawl could not complete.",
        finishedAt: new Date(),
      },
    });
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}
