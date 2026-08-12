const TIMEOUT_MS = 12_000;
const USER_AGENT = "SnailySEO/1.0 (+technical check)";

export type TechnicalSeoResult = {
  origin: string;
  robots: {
    found: boolean;
    status: number;
    hasSitemap: boolean;
    sitemapUrl: string | null;
    disallowRules: number;
    blocksAll: boolean;
  };
  sitemap: {
    found: boolean;
    status: number;
    url: string | null;
    urlCount: number;
  };
};

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = res.ok ? await res.text() : "";
    return { status: res.status, text };
  } catch {
    return { status: 0, text: "" };
  }
}

function parseRobots(text: string) {
  const disallow: string[] = [];
  let sitemap: string | null = null;
  let applies = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [rawKey, ...rest] = trimmed.split(":");
    const key = rawKey?.trim().toLowerCase() ?? "";
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*";
    else if (key === "disallow" && applies && value !== "") disallow.push(value);
    else if (key === "sitemap" && value !== "") sitemap = value;
  }

  return { disallow, sitemap };
}

function countSitemapUrls(xml: string): number {
  return (xml.match(/<loc>/gi) ?? []).length;
}

export async function checkTechnicalSeo(siteUrl: string): Promise<TechnicalSeoResult> {
  const origin = new URL(siteUrl).origin;

  const robotsRes = await fetchText(`${origin}/robots.txt`);
  const robotsParsed =
    robotsRes.status === 200 ? parseRobots(robotsRes.text) : { disallow: [], sitemap: null };

  const sitemapCandidates = [
    robotsParsed.sitemap,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
  ].filter((u): u is string => u !== null && u !== "");

  let sitemapFound = false;
  let sitemapStatus = 0;
  let sitemapUrl: string | null = null;
  let urlCount = 0;

  for (const candidate of [...new Set(sitemapCandidates)]) {
    const res = await fetchText(candidate);
    if (res.status === 200 && res.text.includes("<")) {
      sitemapFound = true;
      sitemapStatus = res.status;
      sitemapUrl = candidate;
      urlCount = countSitemapUrls(res.text);
      break;
    }
  }

  const blocksAll = robotsParsed.disallow.some((r) => r === "/" || r === "/*");

  return {
    origin,
    robots: {
      found: robotsRes.status === 200,
      status: robotsRes.status,
      hasSitemap: robotsParsed.sitemap !== null,
      sitemapUrl: robotsParsed.sitemap,
      disallowRules: robotsParsed.disallow.length,
      blocksAll,
    },
    sitemap: {
      found: sitemapFound,
      status: sitemapStatus,
      url: sitemapUrl,
      urlCount,
    },
  };
}
