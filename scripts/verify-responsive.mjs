/**
 * Responsive and keyboard verification, driven through a real browser.
 *
 * playwright-core with the Edge that ships with Windows, so no browser needed
 * downloading. Signs in by minting the same session JWT the app issues, which
 * is the only way to reach these screens at all.
 *
 *   TARGET=https://... node scripts/verify-responsive.mjs
 */
import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const BASE = process.env.TARGET ?? "http://localhost:3210";
const HOST = new URL(BASE).hostname;
const SECURE = BASE.startsWith("https");
const prisma = new PrismaClient();
const user = await prisma.user.findFirst({ select: { id: true, email: true, name: true } });
await prisma.$disconnect();
if (!user) { console.log("no user to sign in as"); process.exit(1); }

const token = await new SignJWT({ userId: user.id, email: user.email, name: user.name })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

const WIDTHS = [390, 768, 1024, 1440];
const PAGES = [["/content","Content Intelligence"],["/posts","Content Library"],["/geo-lab","GEO Lab"],["/integrations","Integrations"]];

const browser = await chromium.launch({ channel: "msedge", headless: true });
let fail = 0;
console.log("page                  width  overflow  status");
console.log("-".repeat(58));

for (const [path, name] of PAGES) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addCookies([{ name: "session", value: token, domain: HOST, path: "/", secure: SECURE, httpOnly: true, sameSite: "Lax" }]);
    const page = await ctx.newPage();
    let status = "ok";
    try {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 });
      if (res && res.status() >= 400) status = `http ${res.status()}`;
      await page.waitForTimeout(700);
    } catch (e) { status = "load error"; }

    // Horizontal overflow: does the document scroll wider than the viewport?
    const over = await page.evaluate(() => {
      const d = document.documentElement;
      return { scroll: d.scrollWidth, client: d.clientWidth };
    }).catch(() => ({ scroll: 0, client: 1 }));
    const overflow = over.scroll > over.client + 1;
    if (overflow || status !== "ok") fail++;
    console.log(`${name.padEnd(21)} ${String(w).padStart(5)}  ${overflow ? `YES +${over.scroll - over.client}px` : "no      "}  ${status}`);
    await ctx.close();
  }
}

/* ---- Keyboard reachability ------------------------------------------- */
console.log("\nKeyboard navigation @1024");
for (const [path, name] of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  await ctx.addCookies([{ name: "session", value: token, domain: HOST, path: "/", secure: SECURE, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600);

  // Tab through the first stretch and confirm focus actually moves and is visible.
  const seen = new Set();
  let visibleRing = 0;
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        key: `${el.tagName}:${(el.textContent ?? "").trim().slice(0, 18)}`,
        onScreen: r.width > 0 && r.height > 0,
        ring: cs.outlineStyle !== "none" || cs.boxShadow !== "none",
      };
    }).catch(() => null);
    if (info) { seen.add(info.key); if (info.ring && info.onScreen) visibleRing += 1; }
  }
  const ok = seen.size >= 5 && visibleRing > 0;
  if (!ok) fail++;
  console.log(`  ${name.padEnd(21)} ${seen.size} focus stops, ${visibleRing} with a visible ring  ${ok ? "ok" : "PROBLEM"}`);
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? "\nNo horizontal overflow at any width.\n" : `\n${fail} problem(s)\n`);
