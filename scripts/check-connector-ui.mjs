/**
 * The connector panel, on both screens, in a real browser.
 *
 * The point of the shared panel is that Integrations and Project Settings can
 * never report different versions or hand out different archives. That is easy
 * to assert in a unit test and only actually true if both pages render it, so
 * this loads both and reads what a person would see — then downloads from each
 * and compares the bytes.
 *
 *   npm run check:connector-ui -- [baseUrl]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? process.env.TEST_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

function candidates() {
  const paths = [];
  const configured = (process.env.PLAYWRIGHT_PATH ?? "").trim();
  if (configured !== "") paths.push(configured);
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      shell: true,
    }).trim();
    paths.push(join(globalRoot, "playwright"));
  } catch {
    /* npm not on PATH is survivable. */
  }
  const cache = join(process.env.LOCALAPPDATA ?? homedir(), "npm-cache", "_npx");
  try {
    for (const dir of readdirSync(cache)) {
      paths.push(join(cache, dir, "node_modules", "playwright"));
    }
  } catch {
    /* No npx cache here. */
  }
  return paths;
}

const pick = (mod) => mod?.chromium ?? mod?.default?.chromium ?? null;

async function loadChromium() {
  try {
    const local = pick(await import("playwright"));
    if (local) return local;
  } catch {
    /* Fall through to the resolved paths. */
  }
  for (const path of candidates()) {
    try {
      const found = pick(await import(`file:///${path.replace(/\\/g, "/")}/index.js`));
      if (found) return found;
    } catch {
      /* Try the next one. */
    }
  }
  return null;
}

async function main() {
  const chromium = await loadChromium();
  if (chromium === null) {
    console.log("\nPlaywright not found. Run `npx playwright install chromium` once.");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findFirst({
    where: { email: "adam@cinnamonsnail.com" },
    select: { id: true, email: true, name: true },
  });
  const project = await prisma.project.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  const jwt = await new SignJWT({ userId: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "session",
      value: jwt,
      domain: new URL(BASE).hostname,
      path: "/",
      httpOnly: true,
      secure: BASE.startsWith("https"),
    },
  ]);

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const digests = [];

  for (const [label, url] of [
    ["Integrations", `${BASE}/integrations`],
    ["Project Settings", `${BASE}/projects/${project.id}`],
  ]) {
    console.log(`\n${label}  ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });

    const box = page.locator('[data-testid="connector-panel"]').first();
    await box.waitFor({ timeout: 30_000 }).catch(() => {});
    check(await box.isVisible().catch(() => false), "the connector panel renders");

    // The panel fetches its own status; wait for it to stop saying so.
    await page
      .waitForFunction(
        () => !(document.body.innerText || "").includes("Checking…"),
        { timeout: 30_000 },
      )
      .catch(() => {});
    const text = (await box.innerText().catch(() => "")).replace(/\s+/g, " ");

    check(/Installed version/i.test(text), "shows Installed Version");
    check(/Latest version/i.test(text), "shows Latest Version");
    check(/Connection/i.test(text), "shows Connection Status");
    check(/Download latest connector/i.test(text), "has a Download button");
    check(/Verify connection/i.test(text), "has a Verify button");

    const status = /(Up to date|Update required|Connection lost|Not installed)/.exec(text);
    check(status !== null, "shows one of the four states", status?.[1] ?? text.slice(0, 90));

    const latest = /Latest version ([\d.]+)/.exec(text);
    const installed = /Installed version ([\d.]+|Not installed)/.exec(text);
    console.log(
      `           installed=${installed?.[1] ?? "?"}  latest=${latest?.[1] ?? "?"}`,
    );

    // Download from this screen's own button.
    const href = await box
      .locator("a[download]")
      .first()
      .getAttribute("href")
      .catch(() => null);
    check(href === "/api/wordpress/plugin", "downloads from the shared route", String(href));

    const res = await context.request.get(`${BASE}${href}`);
    check(res.status() === 200, "the download answers 200");
    const body = Buffer.from(await res.body());
    const digest = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const disposition = res.headers()["content-disposition"] ?? "";
    console.log(`           ${body.length} bytes  sha256:${digest}`);
    check(
      /snaily-seo-connector-1\.4\.0\.zip/.test(disposition),
      "the archive is 1.4.0",
      disposition.replace(/^attachment;\s*/, ""),
    );
    digests.push({ label, digest, size: body.length });
  }

  console.log("\nBoth downloads");
  check(
    digests.length === 2 && digests[0].digest === digests[1].digest,
    "are byte-for-byte the same archive",
    digests.map((d) => `${d.label}:${d.digest}`).join("  "),
  );
  check(errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));

  await browser.close();
}

await main()
  .catch((err) => {
    console.error("\n", err instanceof Error ? err.stack : err);
    failures += 1;
  })
  .finally(() => prisma.$disconnect());

console.log(failures === 0 ? "\nConnector UI verified.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
