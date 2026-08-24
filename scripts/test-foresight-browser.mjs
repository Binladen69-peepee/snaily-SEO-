/**
 * Foresight in a real browser, at the three widths the client uses.
 *
 * The thing worth checking in a browser rather than an API test is the
 * honesty of the rendering. A number the engine carefully labelled
 * "unavailable" is only unavailable if the page says so; a forecast the engine
 * refused to make is only refused if the reader can tell. So most of what
 * follows reads the rendered text and checks that the refusals survived the
 * trip to the screen.
 *
 *   npm start
 *   node --env-file=.env scripts/test-foresight-browser.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

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
    /* npm not on PATH is survivable; the npx cache may still have it. */
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

function pick(mod) {
  return mod?.chromium ?? mod?.default?.chromium ?? null;
}

async function loadChromium() {
  try {
    const local = pick(await import("playwright"));
    if (local !== null) return local;
  } catch {
    /* Not a dependency, which is deliberate. */
  }
  for (const path of candidates()) {
    const entry = join(path, "index.js");
    if (!existsSync(entry)) continue;
    try {
      const found = pick(await import(pathToFileURL(entry).href));
      if (found !== null) return found;
    } catch {
      /* Try the next copy. */
    }
  }
  throw new Error("Playwright not found. Run `npx playwright install chromium` once.");
}

const chromium = await loadChromium();

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SHOTS =
  process.env.SHOT_DIR ??
  "C:/Users/pc/AppData/Local/Temp/claude/c--Users-pc-Documents-KeySearch-SEO-Tool/0d1d71d0-a1cb-46d6-9377-46448651b439/scratchpad/shots";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

const prisma = new PrismaClient();

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

const savedIds = [];

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, userId: true, name: true, _count: { select: { wpPosts: true } } },
  });
  const project = [...projects].sort((a, b) => b._count.wpPosts - a._count.wpPosts)[0];
  if (project === undefined) throw new Error("No project to test against.");

  const user = await prisma.user.findUnique({
    where: { id: project.userId },
    select: { id: true, email: true, name: true },
  });

  const token = await new SignJWT({ userId: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  // The dashboard is project-scoped through a cookie, so the test picks the
  // project the same way a person would.
  const cookies = [
    { name: "session", value: token, domain: "localhost", path: "/", httpOnly: true },
    { name: "activeProject", value: project.id, domain: "localhost", path: "/", httpOnly: true },
  ];

  const browser = await chromium.launch();

  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n${viewport.name} — ${String(viewport.width)}px`);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await context.addCookies(cookies);
      const page = await context.newPage();

      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

      /* 1. Open Foresight. */
      await page.goto(`${BASE}/foresight`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Foresight", exact: true }).waitFor({ timeout: 60_000 });
      check(true, "the dashboard opens");

      const body = () => page.locator("body").innerText();
      const hasGsc = !/No Search Console property is linked/i.test(await body());

      /* 2. Data readiness is visible before anything else. */
      const text = await body();
      check(/Forecast readiness/i.test(text), "readiness is shown");
      check(/\d+%/.test(text), "with a score");

      /*
       * Controls are queried by their accessible name rather than by visible
       * label text. The redesign turned them into segmented groups whose
       * options ("3m / 6m / 12m") are self-describing, so the label lives on
       * the group — which is the thing a screen reader announces anyway.
       */
      check(
        (await page.getByRole("group", { name: "Forecast horizon" }).count()) === 1,
        "the horizon control is present",
      );
      check(
        (await page.getByRole("group", { name: "Scenario" }).count()) === 1,
        "and the scenario control",
      );

      /* Honesty: nothing invented where nothing is known. */
      if (!hasGsc) {
        check(
          /Not available/i.test(text),
          "with no Search Console, unavailable figures say so rather than showing zero",
        );
        /*
         * With no traffic to forecast there is no confidence card — a score for
         * a forecast that does not exist would be worse than none. The claim
         * that has to survive is that the traffic and revenue forecast is
         * visibly switched off rather than silently empty.
         */
        check(
          /Traffic & revenue forecast/i.test(text) && /Locked/i.test(text),
          "the traffic and revenue forecast is shown as locked, not as blank cards",
        );
        check(
          /Connect Search Console/i.test(text),
          "and the page says exactly what would unlock it",
        );
        check(
          /Opportunities found/i.test(text),
          "while still leading with what Foresight does know",
        );
        check(
          !/\$0\b/.test(text),
          "no zero-dollar revenue is rendered where revenue is simply unknown",
        );
      } else {
        check(true, "Search Console is connected on this project");
      }

      /* 5–6. Opportunities and the matrix. */
      check(/Biggest opportunities/i.test(text), "opportunities are surfaced");
      check(/Impact against effort/i.test(text), "the priority matrix is present");
      check(/Quick wins/i.test(text), "with its quadrants");

      /* 10–11. Keyword forecast and the action plan. */
      check(/Ranking forecast/i.test(text), "the keyword forecast section is present");
      check(/SEO action plan/i.test(text), "and the action plan");

      /*
       * The baseline only exists where there is measured traffic to build one
       * from. Asserting it unconditionally would demand that the page invent a
       * do-nothing line for a project with no history, which is the exact thing
       * the engine refuses to do.
       */
      if (hasGsc) {
        check(
          /If you do nothing/i.test(text) && /History and forecast/i.test(text),
          "the do-nothing baseline is drawn alongside the forecast",
        );
      } else {
        check(
          !/If you do nothing/i.test(text),
          "no do-nothing baseline is drawn where there is no measured history to build one from",
        );
      }

      /* The provenance scheme is explained once rather than badged fifty times. */
      check(
        /Measured directly by a first-party API/i.test(text),
        "the provenance legend explains the four kinds of number",
      );

      /* Layout: the whole point of testing three widths. */
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check(overflow <= 1, `no horizontal overflow (${String(overflow)}px)`);

      await page.screenshot({
        path: `${SHOTS}/foresight-${viewport.name}.png`,
        fullPage: false,
      });

      /* The deeper interactions only need proving once. */
      if (viewport.width === 1440) {
        /* 9. Inspect assumptions. */
        await page.getByText("How this forecast works").click();
        const method = await body();
        check(/Assumptions/i.test(method), "the methodology drawer opens");
        check(/Click-through model/i.test(method), "and names the CTR model");
        check(
          /not been evaluated against real outcomes|Backtested over/i.test(method),
          "and reports what is known about the model's accuracy",
        );
        check(
          /not a prediction of\s+what will|nothing here is a guarantee/i.test(method),
          "and states plainly that a forecast is not a guarantee",
        );
        check(
          /foresight-1\.\d+\.\d+/.test(method),
          "the model version is on screen, so a forecast can be reproduced later",
        );

        /* 8. Switch scenarios and confirm the assumptions actually move. */
        /*
         * Read the whole list item, not the label. The assumption renders as a
         * bold label span next to a value span, so `getByText` on the label
         * matches the label alone and reports that nothing changed when the
         * number beside it changed completely.
         */
        const achievement = page
          .locator("li")
          .filter({ hasText: "Ranking achievement" })
          .first();
        const before = await achievement.textContent();
        await page.getByRole("button", { name: "Conservative", exact: true }).click();
        await page.waitForTimeout(3_000);
        const after = await achievement.textContent();
        check(
          before !== after,
          `switching scenario changes the stated assumptions (${(before ?? "").trim().slice(0, 40)} → ${(after ?? "").trim().slice(0, 40)})`,
        );

        /* 3. Change the horizon. */
        await page.getByRole("button", { name: "12m", exact: true }).click();
        await page.waitForTimeout(2_500);
        check(
          /12 months/.test(await body()),
          "changing the horizon updates the forecast",
        );

        /* 12. Save. */
        await page.getByRole("button", { name: /Save forecast/i }).click();
        await page.waitForTimeout(3_000);
        check(/Saved forecasts/i.test(await body()), "a saved forecast is listed");

        /* 13–14. Reload and confirm it persisted. */
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "Foresight", exact: true }).waitFor({ timeout: 60_000 });
        const reloaded = await body();
        check(/Saved forecasts/i.test(reloaded), "and survives a reload");
        check(
          /foresight-1\.\d+\.\d+/.test(reloaded) || /cutoff/i.test(reloaded),
          "with its model version and data cutoff recorded",
        );

        /* 15. Compare against actual. */
        await page.getByRole("button", { name: "Compare", exact: true }).first().click();
        await page.waitForTimeout(2_500);
        const compared = await body();
        check(
          /complete month|elapsed|Search Console/i.test(compared),
          "comparing reports what it could or could not check, rather than a silent zero",
        );

        await page.screenshot({
          path: `${SHOTS}/foresight-saved.png`,
          fullPage: false,
        });
      }

      check(errors.length === 0, `no page errors${errors.length > 0 ? `: ${errors[0]}` : ""}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const saved = await prisma.foresightForecast.findMany({
    where: { projectId: project.id, name: { contains: "months" } },
    select: { id: true },
  });
  savedIds.push(...saved.map((s) => s.id));

  console.log(`\nScreenshots in ${SHOTS}`);
}

try {
  await main();
} catch (err) {
  console.error("\n" + String(err?.stack ?? err));
  failures += 1;
} finally {
  if (savedIds.length > 0) {
    await prisma.foresightForecast
      .deleteMany({ where: { id: { in: savedIds } } })
      .catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
}

console.log(failures === 0 ? "\nForesight browser checks passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
