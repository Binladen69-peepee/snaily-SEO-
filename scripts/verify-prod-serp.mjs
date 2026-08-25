/**
 * Verify production Keyword Research + DataForSEO after Vercel env deploy.
 * Never prints credentials. Uses AUTH_SECRET + DB to mint a session cookie.
 *
 *   node --env-file-if-exists=.env.local scripts/verify-prod-serp.mjs
 */

import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const BASE =
  process.env.PROD_BASE_URL?.trim() ||
  "https://cinnamon-snail-seo-tool.vercel.app";
const KEYWORD = process.env.VERIFY_SERP_KEYWORD ?? "vegan italian sausage";
const COUNTRY = process.env.VERIFY_SERP_COUNTRY ?? "us";

const prisma = new PrismaClient();
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const secret = (process.env.AUTH_SECRET ?? "").trim();
  if (!secret) throw new Error("AUTH_SECRET missing in env");

  const owner = await prisma.user.findFirst({
    where: { role: "owner" },
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("No owner user in database");

  const token = await new SignJWT({
    userId: owner.id,
    email: owner.email,
    name: owner.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(secret));

  const headers = {
    cookie: `session=${token}`,
    accept: "application/json",
  };

  console.log(`Production base: ${BASE}`);
  console.log(`Keyword: "${KEYWORD}" (${COUNTRY})\n`);

  // 1) Health — DataForSEO must be authenticated on the deployed app.
  console.log("Settings health (owner)");
  const healthRes = await fetch(`${BASE}/api/settings/health?refresh=1`, {
    headers,
  });
  const healthBody = await healthRes.json();
  check(healthRes.ok, `health HTTP ${String(healthRes.status)}`);
  const dfs = (healthBody.checks ?? []).find(
    (c) => c.id === "DATAFORSEO_LOGIN" || c.label === "DataForSEO",
  );
  check(!!dfs, "DataForSEO health check present");
  if (dfs) {
    console.log(`    summary: ${dfs.summary}`);
    console.log(`    level: ${dfs.level}`);
    check(
      dfs.level === "healthy" || /AUTHENTICATED/i.test(dfs.summary ?? ""),
      "DataForSEO authenticated/available on production",
      dfs.summary ?? dfs.reason ?? "",
    );
    check(
      !/not configured/i.test(dfs.summary ?? ""),
      "not reporting 'Not configured'",
    );
  }

  // 2) Keyword detail — must return organic results, not provider-missing error.
  console.log("\nKeyword Research detail");
  const detailUrl = `${BASE}/api/keywords/detail?q=${encodeURIComponent(KEYWORD)}&country=${COUNTRY}&lang=en`;
  const detailRes = await fetch(detailUrl, { headers });
  const detail = await detailRes.json();
  check(detailRes.ok, `detail HTTP ${String(detailRes.status)}`);
  check(
    !String(detail.error ?? "").includes("No SERP provider"),
    "no 'No SERP provider' error",
    detail.error ?? "",
  );
  const serp = Array.isArray(detail.serp) ? detail.serp : [];
  check(serp.length > 0, `organic results loaded (${String(serp.length)})`);
  if (serp[0]) {
    console.log(`    #1: ${serp[0].title?.slice(0, 80) ?? "(no title)"}`);
    console.log(`    domain: ${serp[0].domain ?? ""}`);
  }
  const questions = Array.isArray(detail.questions) ? detail.questions : [];
  const related = Array.isArray(detail.related) ? detail.related : [];
  check(
    questions.length > 0 || related.length > 0,
    `PAA/related present (PAA ${String(questions.length)}, related ${String(related.length)})`,
  );
  console.log(`    provider field: ${detail.provider ?? "(none)"}`);

  // 3) Clear fresh cache for this keyword so we observe the live primary provider
  //    (otherwise a SerpApi-cached row would hide DataForSEO preference).
  console.log("\nClearing serp_norm cache for live primary-provider check");
  const deleted = await prisma.serpCache.deleteMany({
    where: {
      country: COUNTRY,
      engine: "serp_norm",
      query: { contains: KEYWORD.toLowerCase() },
    },
  });
  console.log(`    deleted ${String(deleted.count)} serp_norm row(s)`);

  // Re-fetch after cache clear
  console.log("\nKeyword Research detail (post cache-clear)");
  const detail2Res = await fetch(detailUrl, { headers });
  const detail2 = await detail2Res.json();
  check(detail2Res.ok, `detail2 HTTP ${String(detail2Res.status)}`);
  check(
    !String(detail2.error ?? "").includes("No SERP provider"),
    "no provider-missing error after cache clear",
  );
  const serp2 = Array.isArray(detail2.serp) ? detail2.serp : [];
  check(serp2.length > 0, `organic after clear (${String(serp2.length)})`);

  // 4) Prove which SERP backend wrote the new cache row.
  console.log("\nSerpCache provenance (shared DB)");
  const cacheRows = await prisma.serpCache.findMany({
    where: {
      country: COUNTRY,
      OR: [
        { engine: "serp_norm", query: { contains: KEYWORD.toLowerCase() } },
        { engine: "google", query: KEYWORD.toLowerCase() },
      ],
    },
    orderBy: { fetchedAt: "desc" },
    take: 5,
    select: { engine: true, query: true, fetchedAt: true, payload: true },
  });

  const fresh = cacheRows.find((r) => {
    const age = Date.now() - r.fetchedAt.getTime();
    return age < 15 * 60 * 1000 && r.engine === "serp_norm";
  });
  check(!!fresh, "fresh serp_norm row for this keyword (<15m)");
  if (fresh) {
    const payload = fresh.payload;
    const provider =
      payload && typeof payload === "object" && "provider" in payload
        ? String(payload.provider)
        : "unknown";
    console.log(`    engine: ${fresh.engine}`);
    console.log(`    provider: ${provider}`);
    console.log(`    fetchedAt: ${fresh.fetchedAt.toISOString()}`);
    const organic =
      payload && typeof payload === "object" && Array.isArray(payload.organicResults)
        ? payload.organicResults.length
        : 0;
    const paa =
      payload && typeof payload === "object" && Array.isArray(payload.paa)
        ? payload.paa.length
        : 0;
    console.log(`    organic in cache: ${String(organic)}, paa: ${String(paa)}`);

    check(
      provider === "dataforseo",
      "live primary provider is DataForSEO",
      provider,
    );
    check(provider !== "serpapi", "SerpApi was not called first / not the live provider");
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nPASS — production DataForSEO SERP verified");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
