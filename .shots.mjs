import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
const OUT = process.argv[2];
const prisma = new PrismaClient();
const user = await prisma.user.findFirst({ select: { id: true, email: true, name: true } });
await prisma.$disconnect();
const token = await new SignJWT({ userId: user.id, email: user.email, name: user.name })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
const browser = await chromium.launch({ channel: "msedge", headless: true });
for (const [path, name] of [["/content","content"],["/posts","library"],["/geo-lab","geo"],["/integrations","integrations"]]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3210${path}`, { waitUntil: "networkidle", timeout: 45000 }).catch(()=>{});
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/ui-${name}.png` });
  console.log("shot:", name);
  await ctx.close();
}
await browser.close();
