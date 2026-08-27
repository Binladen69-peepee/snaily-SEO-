import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
const prisma = new PrismaClient();
const u = await prisma.user.findFirst({ select: { id: true, email: true, name: true } });
await prisma.$disconnect();
const token = await new SignJWT({ userId: u.id, email: u.email, name: u.name })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
const b = await chromium.launch({ channel: "msedge", headless: true });
for (const path of ["/content", "/posts"]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
  await ctx.addCookies([{ name: "session", value: token, domain: "localhost", path: "/" }]);
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3210${path}`, { waitUntil: "networkidle", timeout: 45000 }).catch(()=>{});
  await p.waitForTimeout(800);
  const offenders = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.toString?.() ?? "").slice(0, 70),
          right: Math.round(r.right), w: Math.round(r.width),
          text: (el.textContent ?? "").trim().slice(0, 40),
        });
      }
    });
    return out.slice(0, 6);
  });
  console.log(`\n${path} @390 — ${offenders.length} overflowing element(s)`);
  for (const o of offenders) console.log(`  <${o.tag}> right=${o.right} w=${o.w}  "${o.text}"\n     ${o.cls}`);
  await ctx.close();
}
await b.close();
