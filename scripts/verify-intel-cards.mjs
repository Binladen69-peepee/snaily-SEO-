/**
 * Clicking the spotlight cards, in a real browser, against production.
 *
 * The client reported the cards under "Fix these first" and "Highest
 * opportunity" as not clickable. Source assertions cover the wiring
 * (npm run test:intelligence-cards); this covers the part only a browser can
 * answer — whether clicking one actually brings the detail into view, with no
 * console error, and whether the page it opens agrees with the card.
 *
 *   TARGET=https://... node scripts/verify-intel-cards.mjs
 */
import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const BASE = process.env.TARGET ?? "http://localhost:3210";
const HOST = new URL(BASE).hostname;
const SECURE = BASE.startsWith("https");

const prisma = new PrismaClient();
const user = await prisma.user.findFirst({
  select: { id: true, email: true, name: true },
});
await prisma.$disconnect();
if (!user) {
  console.log("no user to sign in as");
  process.exit(1);
}

const token = await new SignJWT({
  userId: user.id,
  email: user.email,
  name: user.name,
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([
  {
    name: "session",
    value: token,
    domain: HOST,
    path: "/",
    secure: SECURE,
    httpOnly: true,
    sameSite: "Lax",
  },
]);

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/content`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1200);

/* ------------------------------------------------------------------ */
console.log("\nThe dashboard as it loads");

const provenance = (await page.locator("p.text-sm").first().textContent()) ?? "";
check(
  /Crawled .+ UTC .+ pages audited .+ current issue/.test(provenance),
  "the header names the crawl, its size and what it currently finds",
  provenance.trim().slice(0, 90),
);

const bodyText = (await page.locator("body").innerText()) ?? "";
check(
  !/Something went wrong/i.test(bodyText),
  "the page renders rather than falling back to an error",
);
check(
  !/Missing image alt text/i.test(bodyText),
  "no missing-alt issue is offered anywhere on the dashboard",
);

/* Cards, per section. */
const sections = page.locator("section", { has: page.locator("h2") });
const groups = {};
for (let i = 0; i < (await sections.count()); i += 1) {
  const s = sections.nth(i);
  const heading = ((await s.locator("h2").first().textContent()) ?? "").trim();
  if (heading === "Fix these first" || heading === "Highest opportunity") {
    groups[heading] = s;
  }
}

check(
  Object.keys(groups).length === 2,
  "both spotlight groups are on the page",
  Object.keys(groups).join(", "),
);

/* ------------------------------------------------------------------ */
for (const [heading, section] of Object.entries(groups)) {
  console.log(`\n${heading} — clicking a card`);

  const cards = section.locator("li button");
  const count = await cards.count();
  if (count === 0) {
    check(true, "no cards to click (nothing needs attention)", "empty state");
    continue;
  }

  const lines = ((await cards.first().innerText()) ?? "").split("\n");
  const label = lines.join(" ");
  // The path is its own line on the card; the home page's is just "/".
  const path = lines.find((l) => l.trim().startsWith("/"))?.trim() ?? "/";

  const before = errors.length;
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await cards.first().click();
  await page.waitForTimeout(1400);

  const row = page.locator("[data-page-row]").first();
  check(await row.isVisible(), `the detail row opens for ${path}`);

  // "In view" is the whole complaint: the row must be on screen after the click.
  const onScreen = await row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
  check(onScreen, "and is scrolled into view, not left below the fold");

  const rowUrl = (await row.getAttribute("data-page-row")) ?? "";
  const rowPath = rowUrl.replace(/^https?:\/\/[^/]+/, "") || "/";
  check(
    rowPath.replace(/\/$/, "") === path.replace(/\/$/, ""),
    "the row that opened is the page the card named",
    `card ${path} -> row ${rowPath}`,
  );

  const detail = (await row.innerText()) ?? "";
  check(
    /Why it matters|What to do|Severity|issue/i.test(detail),
    "the detail explains the issue rather than just repeating the score",
  );
  check(
    !/Missing image alt text/i.test(detail),
    "and does not claim missing alt text on a page that has none",
  );

  const summary = label.toLowerCase();
  const detailLower = detail.toLowerCase();
  const claimed = ["broken internal link", "title too long", "missing meta description"]
    .filter((c) => summary.includes(c));
  check(
    claimed.every((c) => detailLower.includes(c)),
    "every issue the card summarised is present in the detail",
    claimed.join("; ") || "card summarised no named issue",
  );

  check(errors.length === before, "the click raised no console error",
    errors.slice(before).join(" | ").slice(0, 120));

  // Back to the top, ready for the next group.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
}

/* ------------------------------------------------------------------ */
console.log("\nThe client's pages, looked up by hand");

for (const path of [
  "/vegan-taco-salad",
  "/lentil-meatballs-recipe",
  "/vegan-carbonara-recipe",
  "/vegan-italian-wedding-soup",
]) {
  const search = page.getByLabel("Search pages");
  await search.fill(path);
  await page.waitForTimeout(900);

  const rows = page.locator("tbody tr");
  const n = await rows.count();
  if (n === 0) {
    console.log(`  --    ${path} is not in the current crawl`);
    continue;
  }
  const text = ((await rows.first().innerText()) ?? "").toLowerCase();
  check(
    !text.includes("missing image alt"),
    `${path} is not reported as missing alt text`,
  );
}

console.log(`\nconsole errors on the whole run: ${String(errors.length)}`);
if (errors.length > 0) console.log(errors.slice(0, 5).join("\n"));

await browser.close();
console.log(
  failures === 0
    ? "\nAll spotlight card checks passed in a real browser.\n"
    : `\n${String(failures)} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
