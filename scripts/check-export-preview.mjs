/**
 * What the WordPress export would do, without doing it.
 *
 * The export endpoint's GET runs the whole mapping — template resolution,
 * internal links, affiliate links, section placement, the FAQ block and the
 * Feast related grid — and returns the plan without touching the site. That
 * makes it the honest way to answer "why did this land wrong in WordPress"
 * for an article that is already drafted, and it writes nothing at all.
 *
 *   npm run dev            (or npm start)
 *   npm run check:export -- <articleId>
 */
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();

async function main() {
  const wanted = process.argv[2];

  const article =
    wanted !== undefined
      ? await prisma.article.findUnique({
          where: { id: wanted },
          select: { id: true, title: true, content: true, userId: true },
        })
      : await prisma.article.findFirst({
          where: { mode: "drafter", content: { not: "" } },
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, content: true, userId: true },
        });

  if (article === null) throw new Error("No drafted article to preview.");

  const user = await prisma.user.findUnique({
    where: { id: article.userId },
    select: { id: true, email: true, name: true },
  });
  if (user === null) throw new Error("The article's owner no longer exists.");

  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  console.log(`\nArticle: ${article.title}`);
  console.log(`  ${String(article.content.length)} characters`);

  const res = await fetch(`${BASE}/api/articles/${article.id}/export`, {
    headers: { cookie: `session=${token}` },
  });
  const body = await res.json();

  if (!res.ok) {
    console.log(`\nPreview refused (${String(res.status)}):`, JSON.stringify(body));
    return;
  }

  const p = body.preview ?? body;

  console.log("\nTemplate");
  console.log("  ", JSON.stringify(p.template));

  console.log("\nSections");
  for (const s of p.sections ?? []) {
    console.log(
      `   ${String(s.blocksWritten).padStart(3)} blocks  ${String(s.label).padEnd(24)}` +
        `${s.inTemplate ? "" : " [not in template]"}${s.note ? ` — ${s.note}` : ""}`,
    );
  }

  console.log("\nSteps    ", JSON.stringify(p.steps));
  console.log("FAQs     ", p.faqs);
  console.log("Related  ", JSON.stringify(p.relatedPosts));
  console.log("Internal ", p.internalLinks, " unresolved:", (p.unresolvedInternal ?? []).length);
  console.log("Affiliate", (p.affiliateLinks ?? []).length);
  console.log("Recipe card preserved:", p.recipeCardPreserved);
  console.log("Needs review:", p.needsReview);
  if ((p.unmapped ?? []).length > 0) {
    console.log("Unmapped :", JSON.stringify(p.unmapped));
  }
  console.log("Focus kw ", JSON.stringify(p.focusKeyword));
  console.log("Robots   ", JSON.stringify(p.robots));
  console.log("Card     ", JSON.stringify(p.recipeCard));
  console.log("\nSEO      ", JSON.stringify(p.seo));
}

main()
  .catch((err) => {
    console.error("\n", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
