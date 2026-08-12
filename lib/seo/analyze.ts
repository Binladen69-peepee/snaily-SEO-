import { runChecks } from "@/lib/audit/checks";
import { fetchSinglePage } from "@/lib/audit/crawler";
import type { Issue } from "@/lib/audit/types";

export type OnPageResult = {
  url: string;
  status: number;
  title: string;
  metaDescription: string;
  h1: string[];
  wordCount: number;
  canonical: string;
  indexable: boolean;
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinkCount: number;
  issues: Issue[];
  score: number;
  checks: {
    id: string;
    label: string;
    pass: boolean;
    detail: string;
  }[];
};

function scoreFromIssues(issues: Issue[]): number {
  let penalty = 0;
  for (const i of issues) {
    if (i.severity === "high") penalty += 20;
    else if (i.severity === "medium") penalty += 10;
    else penalty += 4;
  }
  return Math.max(0, Math.min(100, 100 - penalty));
}

export async function analyzeUrl(url: string): Promise<OnPageResult> {
  const page = await fetchSinglePage(url);

  const issues = runChecks(
    { ...page, brokenLinks: [], issues: [] },
    {
      duplicateTitles: new Set(),
      duplicateDescriptions: new Set(),
      minWordCount: 300,
    },
  );

  const checks = [
    {
      id: "status",
      label: "Page loads successfully",
      pass: page.status >= 200 && page.status < 400,
      detail:
        page.status >= 200 && page.status < 400
          ? `HTTP ${String(page.status)}`
          : page.status === 0
            ? "Could not reach the page"
            : `HTTP ${String(page.status)}`,
    },
    {
      id: "title",
      label: "Title tag present",
      pass: page.title.trim() !== "",
      detail: page.title.trim() !== "" ? page.title : "Missing",
    },
    {
      id: "title-length",
      label: "Title length (50–60 ideal)",
      pass: page.title.length > 0 && page.title.length <= 60,
      detail:
        page.title.length === 0
          ? "No title"
          : `${String(page.title.length)} characters`,
    },
    {
      id: "meta",
      label: "Meta description present",
      pass: page.metaDescription.trim() !== "",
      detail:
        page.metaDescription.trim() !== ""
          ? `${String(page.metaDescription.length)} characters`
          : "Missing",
    },
    {
      id: "meta-length",
      label: "Meta length (140–160 ideal)",
      pass:
        page.metaDescription.length > 0 && page.metaDescription.length <= 160,
      detail:
        page.metaDescription.length === 0
          ? "No meta description"
          : `${String(page.metaDescription.length)} characters`,
    },
    {
      id: "h1",
      label: "Single H1 heading",
      pass: page.h1.length === 1,
      detail:
        page.h1.length === 0
          ? "No H1"
          : page.h1.length === 1
            ? page.h1[0]!
            : `${String(page.h1.length)} H1 tags`,
    },
    {
      id: "content",
      label: "Enough body copy (300+ words)",
      pass: page.wordCount >= 300,
      detail: `${String(page.wordCount)} words`,
    },
    {
      id: "indexable",
      label: "Indexable (no noindex)",
      pass: page.indexable,
      detail: page.indexable ? "Page can be indexed" : "Blocked by noindex",
    },
    {
      id: "images",
      label: "Images have alt text",
      pass: page.imagesTotal === 0 || page.imagesMissingAlt === 0,
      detail:
        page.imagesTotal === 0
          ? "No images"
          : `${String(page.imagesMissingAlt)} of ${String(page.imagesTotal)} missing alt`,
    },
  ];

  return {
    url: page.url,
    status: page.status,
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
    wordCount: page.wordCount,
    canonical: page.canonical,
    indexable: page.indexable,
    imagesTotal: page.imagesTotal,
    imagesMissingAlt: page.imagesMissingAlt,
    internalLinkCount: page.internalLinks.length,
    issues,
    score: scoreFromIssues(issues),
    checks,
  };
}
