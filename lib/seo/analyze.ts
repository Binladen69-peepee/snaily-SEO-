import { runChecks } from "@/lib/audit/checks";
import { fetchSinglePage } from "@/lib/audit/crawler";
import type { Issue } from "@/lib/audit/types";
import { checkTechnicalSeo } from "@/lib/seo/technical";

export type CheckStatus = "pass" | "warning" | "fail";

export type OnPageCheck = {
  id: string;
  label: string;
  pass: boolean;
  status: CheckStatus;
  detail: string;
};

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
  checks: OnPageCheck[];
};

function scoreFromChecks(checks: OnPageCheck[]): number {
  if (checks.length === 0) return 100;
  let sum = 0;
  for (const c of checks) {
    if (c.status === "pass") sum += 1;
    else if (c.status === "warning") sum += 0.5;
  }
  return Math.round((sum / checks.length) * 100);
}

function check(
  id: string,
  label: string,
  pass: boolean,
  detail: string,
): OnPageCheck {
  return { id, label, pass, status: pass ? "pass" : "fail", detail };
}

export async function analyzeUrl(
  url: string,
  targetKeyword?: string,
): Promise<OnPageResult> {
  const [page, techResult] = await Promise.all([
    fetchSinglePage(url),
    checkTechnicalSeo(url),
  ]);

  const issues = runChecks(
    { ...page, brokenLinks: [], blockedLinks: [], issues: [] },
    {
      duplicateTitles: new Set(),
      duplicateDescriptions: new Set(),
      minWordCount: 300,
    },
  );

  /* ── Core on-page checks (same 9 as before) ──────────────────────── */

  const checks: OnPageCheck[] = [
    check(
      "status",
      "Page loads successfully",
      page.status >= 200 && page.status < 400,
      page.status >= 200 && page.status < 400
        ? `HTTP ${String(page.status)}`
        : page.status === 0
          ? "Could not reach the page"
          : `HTTP ${String(page.status)}`,
    ),
    check(
      "title",
      "Title tag present",
      page.title.trim() !== "",
      page.title.trim() !== "" ? page.title : "Missing",
    ),
    check(
      "title-length",
      "Title length (50–60 ideal)",
      page.title.length > 0 && page.title.length <= 60,
      page.title.length === 0
        ? "No title"
        : `${String(page.title.length)} characters`,
    ),
    check(
      "meta",
      "Meta description present",
      page.metaDescription.trim() !== "",
      page.metaDescription.trim() !== ""
        ? `${String(page.metaDescription.length)} characters`
        : "Missing",
    ),
    check(
      "meta-length",
      "Meta length (140–160 ideal)",
      page.metaDescription.length > 0 && page.metaDescription.length <= 160,
      page.metaDescription.length === 0
        ? "No meta description"
        : `${String(page.metaDescription.length)} characters`,
    ),
    check(
      "h1",
      "Single H1 heading",
      page.h1.length === 1,
      page.h1.length === 0
        ? "No H1"
        : page.h1.length === 1
          ? page.h1[0]!
          : `${String(page.h1.length)} H1 tags`,
    ),
    check(
      "content",
      "Enough body copy (300+ words)",
      page.wordCount >= 300,
      `${String(page.wordCount)} words`,
    ),
    check(
      "indexable",
      "Indexable (no noindex)",
      page.indexable,
      page.indexable ? "Page can be indexed" : "Blocked by noindex",
    ),
    check(
      "images",
      "Images have alt text",
      page.imagesTotal === 0 || page.imagesMissingAlt === 0,
      page.imagesTotal === 0
        ? "No images"
        : `${String(page.imagesMissingAlt)} of ${String(page.imagesTotal)} missing alt`,
    ),
  ];

  /* ── Technical SEO checks (robots.txt & sitemap) ──────────────────── */

  const robotsPass = techResult.robots.found && !techResult.robots.blocksAll;
  checks.push({
    id: "robots-txt",
    label: "robots.txt present",
    pass: techResult.robots.found,
    status: robotsPass ? "pass" : techResult.robots.found ? "warning" : "warning",
    detail: techResult.robots.found
      ? techResult.robots.blocksAll
        ? "Found but blocks all crawlers"
        : `Found — ${String(techResult.robots.disallowRules)} disallow rule${techResult.robots.disallowRules !== 1 ? "s" : ""}`
      : "No robots.txt found",
  });

  checks.push({
    id: "sitemap",
    label: "XML sitemap found",
    pass: techResult.sitemap.found,
    status: techResult.sitemap.found ? "pass" : "warning",
    detail: techResult.sitemap.found
      ? `${techResult.sitemap.url ?? "Found"} (~${String(techResult.sitemap.urlCount)} URLs)`
      : "No sitemap found at common paths",
  });

  /* ── Keyword-specific checks (only when a keyword is provided) ───── */

  if (targetKeyword && targetKeyword.trim() !== "") {
    const kw = targetKeyword.trim().toLowerCase();

    const titleHasKw = page.title.toLowerCase().includes(kw);
    checks.push(
      check(
        "kw-title",
        "Keyword in page title",
        titleHasKw,
        titleHasKw
          ? `"${targetKeyword.trim()}" found in title`
          : `"${targetKeyword.trim()}" not found in title`,
      ),
    );

    const h1HasKw = page.h1.some((h) => h.toLowerCase().includes(kw));
    checks.push(
      check(
        "kw-h1",
        "Keyword in H1",
        h1HasKw,
        h1HasKw
          ? `"${targetKeyword.trim()}" found in H1`
          : page.h1.length === 0
            ? "No H1 on the page"
            : `"${targetKeyword.trim()}" not found in any H1`,
      ),
    );

    const fullUrl = page.url.toLowerCase();
    const kwSlug = kw.replace(/\s+/g, "-");
    const kwUnderscore = kw.replace(/\s+/g, "_");
    const kwConcat = kw.replace(/\s+/g, "");
    const urlHasKw =
      fullUrl.includes(kw) ||
      fullUrl.includes(kwSlug) ||
      fullUrl.includes(kwUnderscore) ||
      fullUrl.includes(kwConcat);
    checks.push({
      id: "kw-url",
      label: "Keyword in URL",
      pass: urlHasKw,
      status: urlHasKw ? "pass" : "warning",
      detail: urlHasKw
        ? `"${targetKeyword.trim()}" found in URL path`
        : `"${targetKeyword.trim()}" not in URL — consider including it for relevance`,
    });

    const metaHasKw = page.metaDescription.toLowerCase().includes(kw);
    checks.push(
      check(
        "kw-meta",
        "Keyword in meta description",
        metaHasKw,
        metaHasKw
          ? `"${targetKeyword.trim()}" found in meta description`
          : page.metaDescription.trim() === ""
            ? "No meta description on the page"
            : `"${targetKeyword.trim()}" not found in meta description`,
      ),
    );

    const bodyText = page.bodyText ?? "";
    const words = bodyText.split(/\s+/).filter(Boolean);
    const first100 = words.slice(0, 100).join(" ").toLowerCase();
    const earlyHasKw = first100.includes(kw);
    checks.push({
      id: "kw-early",
      label: "Keyword in first 100 words",
      pass: earlyHasKw,
      status: earlyHasKw ? "pass" : "warning",
      detail: earlyHasKw
        ? `"${targetKeyword.trim()}" appears early in the content`
        : `"${targetKeyword.trim()}" not found in the first 100 words`,
    });

    const totalWords = words.length;
    if (totalWords === 0) {
      checks.push({
        id: "kw-density",
        label: "Keyword density",
        pass: false,
        status: "fail",
        detail: "No body content to analyze",
      });
    } else {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
      const matches = bodyText.match(regex);
      const count = matches?.length ?? 0;
      const density = (count / totalWords) * 100;
      const densityStr = density.toFixed(2);

      let status: CheckStatus;
      let densityPass: boolean;
      if (density === 0) {
        status = "fail";
        densityPass = false;
      } else if (density < 0.5) {
        status = "warning";
        densityPass = false;
      } else if (density > 3) {
        status = "warning";
        densityPass = false;
      } else {
        status = "pass";
        densityPass = true;
      }

      const suffix =
        density < 0.5 && density > 0
          ? " — consider using it more naturally"
          : density > 3
            ? " — may appear over-optimized"
            : "";

      checks.push({
        id: "kw-density",
        label: "Keyword density",
        pass: densityPass,
        status,
        detail:
          count === 0
            ? `"${targetKeyword.trim()}" not found in body content`
            : `${densityStr}% (${String(count)} occurrence${count !== 1 ? "s" : ""} in ${String(totalWords)} words)${suffix}`,
      });
    }
  }

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
    score: scoreFromChecks(checks),
    checks,
  };
}
