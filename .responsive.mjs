/** Responsive verification at the four widths, against a real logged-in app. */
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
await browser.close();
console.log(fail === 0 ? "\nNo horizontal overflow at any width.\n" : `\n${fail} problem(s)\n`);
