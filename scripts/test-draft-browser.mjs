/**
 * The Drafter in a real browser, at the three widths the client uses.
 *
 * Everything else in this suite talks to the API. This drives the actual page:
 * one click on Draft Article, the progress list appearing, a full reload
 * mid-generation, and the finished article showing up in the editor without
 * anybody pressing anything else.
 *
 * The reload is the point. A background job is only worth having if closing and
 * reopening the page picks it back up, and that is a claim about the browser —
 * the poll, the resume fetch, the state the editor rebuilds — not about the
 * server, which has already been tested on its own.
 *
 *   npm start
 *   node --env-file=.env scripts/test-draft-browser.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

/*
 * Playwright is not a dependency of this project and should not become one: it
 * pulls a browser download into every install, including Vercel's, to serve one
 * script that only ever runs by hand. So it is resolved wherever it happens to
 * live - a local install, a global one, or the npx cache that `npx playwright`
 * already populated - and PLAYWRIGHT_PATH overrides all of it.
 */
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
    /* npm not on PATH is not fatal; the npx cache may still have it. */
  }

  const cache = join(
    process.env.LOCALAPPDATA ?? homedir(),
    "npm-cache",
    "_npx",
  );
  try {
    for (const dir of readdirSync(cache)) {
      paths.push(join(cache, dir, "node_modules", "playwright"));
    }
  } catch {
    /* No npx cache on this machine. */
  }

  return paths;
}

/*
 * Playwright ships as CommonJS, so `await import()` may put its exports behind
 * `.default` depending on how well the named-export detector reads the file.
 * Both shapes are checked rather than assumed - the failure mode otherwise is
 * an undefined `chromium` several lines later, which reads as a Playwright bug.
 */
function pick(mod) {
  return mod?.chromium ?? mod?.default?.chromium ?? null;
}

async function loadChromium() {
  try {
    const local = pick(await import("playwright"));
    if (local !== null) return local;
  } catch {
    /* Not a local dependency, which is the expected case. */
  }

  for (const path of candidates()) {
    const entry = join(path, "index.js");
    if (!existsSync(entry)) continue;
    try {
      const found = pick(await import(pathToFileURL(entry).href));
      if (found !== null) return found;
    } catch {
      /* Wrong or broken copy; try the next one. */
    }
  }

  throw new Error(
    "Playwright was not found. Run `npx playwright install chromium` once, " +
      "or set PLAYWRIGHT_PATH to the package directory.",
  );
}

const chromium = await loadChromium();

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SHOTS =
  process.env.SHOT_DIR ??
  "C:/Users/pc/AppData/Local/Temp/claude/c--Users-pc-Documents-KeySearch-SEO-Tool/0d1d71d0-a1cb-46d6-9377-46448651b439/scratchpad/shots";

const ALL_VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

/*
 * ONLY_VIEWPORT re-runs one width without paying for the other two.
 * Overlapping runs also overwrite each other's screenshots, which is how a
 * failed run's "paused" panel ended up filed as the finished one - so a single
 * named run is the honest way to capture a specific state.
 */
const only = (process.env.ONLY_VIEWPORT ?? "").trim();
const VIEWPORTS =
  only === "" ? ALL_VIEWPORTS : ALL_VIEWPORTS.filter((v) => v.name === only);

const prisma = new PrismaClient();

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

const RECIPE = `Ingredients
2 tablespoons toasted sesame oil
1 bunch lacinato kale, stems removed
3 cloves garlic, thinly sliced
1 tablespoon white miso paste
2 teaspoons rice vinegar
1 teaspoon maple syrup

Instructions
1. Warm the sesame oil in a wide pan over medium heat.
2. Add the garlic and cook for 1 minute, until it turns pale gold.
3. Add the kale and cook for 4 minutes, tossing, until it wilts and darkens.
4. Whisk the miso, rice vinegar and maple syrup together, then stir it through.
5. Serve warm.`;

const articleIds = [];

/** Polls the page's rendered text for a pattern. Returns the match, or null. */
async function waitForText(page, pattern, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const flat = text.replace(/\s+/g, " ");

    const hit = pattern.exec(flat);
    if (hit !== null) return hit[0];

    /*
     * Stop early when the provider has cut us off.
     *
     * This is not a defect in the page - it is the failure UX doing its job,
     * and it looked exactly like a broken progress panel until the diagnostic
     * printed what the page actually said. Waiting out the remaining ten
     * minutes to conclude the same thing helps nobody.
     */
    if (/Daily .* token allowance used up|rate limit reached/i.test(flat)) {
      throw new ProviderExhausted(
        /Daily [^.]*\./.exec(flat)?.[0] ?? "The AI provider stopped answering.",
      );
    }

    await new Promise((r) => setTimeout(r, 1_000));
  }
  return null;
}

/** The AI account ran out of allowance. An environment fact, not a test result. */
class ProviderExhausted extends Error {
  constructor(message) {
    super(message);
    this.name = "ProviderExhausted";
  }
}

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, userId: true, _count: { select: { wpPosts: true } } },
  });
  const project = [...projects].sort(
    (a, b) => b._count.wpPosts - a._count.wpPosts,
  )[0];

  const user = await prisma.user.findUnique({
    where: { id: project.userId },
    select: { id: true, email: true, name: true },
  });

  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  const browser = await chromium.launch();

  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n${viewport.name} — ${String(viewport.width)}px`);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await context.addCookies([
        {
          name: "session",
          value: token,
          domain: "localhost",
          path: "/",
          httpOnly: true,
        },
      ]);

      const page = await context.newPage();

      /*
       * Only the widest run drives a whole generation. The narrower two check
       * layout and the progress panel, which is what changes with width; making
       * all three write an article would triple the provider bill to learn
       * nothing about CSS.
       */
      const full = viewport.width === 1440;

      // The article is created from inside the page so the session cookie the
      // context carries is the one that authorises it.
      await page.goto(`${BASE}/content-assistant`, { waitUntil: "domcontentloaded" });

      const created = await page.evaluate(
        async ([projectId, recipe]) => {
          const res = await fetch("/api/articles", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId,
              title: "Vegan Miso Garlic Kale",
              keyword: "vegan miso garlic kale",
              mode: "drafter",
              recipe,
            }),
          });
          return res.json();
        },
        [project.id, RECIPE],
      );
      articleIds.push(created.id);

      await page.goto(`${BASE}/content-assistant/${created.id}`, {
        waitUntil: "domcontentloaded",
      });

      // One click is the whole interaction: the editor starts the job itself
      // when it opens on an empty drafter article.
      const heading = page.getByText("Writing your article", { exact: false });
      await heading.waitFor({ timeout: 45_000 });
      check(true, "the progress panel appears without any further clicking");

      const stageList = page.locator("ul li");
      check((await stageList.count()) >= 4, "the stage list is rendered");

      const stepsLine = await waitForText(page, /\d+ of 15 steps complete/, 30_000);
      check(
        stepsLine !== null,
        `real stage progress is shown ("${(stepsLine ?? "nothing").trim().slice(0, 40)}")`,
      );

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      check(overflow <= 1, `the page does not scroll sideways (${String(overflow)}px)`);

      const panelFits = await page.evaluate(() => {
        const el = document.querySelector('[role="progressbar"]')?.parentElement;
        if (!el) return false;
        const box = el.getBoundingClientRect();
        return box.left >= -1 && box.right <= window.innerWidth + 1;
      });
      check(panelFits, "the progress panel fits the viewport");

      await page.screenshot({
        path: `${SHOTS}/drafting-${viewport.name}.png`,
        fullPage: false,
      });

      /*
       * Stop the narrow runs before moving on. Left going, they carry on
       * writing in the background and compete with the next viewport for the
       * same per-minute token allowance - which showed up as the desktop run
       * failing to reload in time, an entirely self-inflicted failure that says
       * nothing about the page.
       */
      if (!full) {
        await page.evaluate(async (articleId) => {
          const res = await fetch(`/api/articles/${articleId}/draft-job`);
          const data = await res.json();
          if (data.job) {
            await fetch(`/api/draft-jobs/${data.job.id}/cancel`, { method: "POST" });
          }
        }, created.id);
      }

      if (full) {
        /* ---------------------------------------------------------- */
        console.log("  reloading mid-generation…");
        await new Promise((r) => setTimeout(r, 20_000));
        await page.reload({ waitUntil: "domcontentloaded" });

        /*
         * Polled from the page's own text rather than waited on with a
         * locator. `getByText` resolves against a live DOM that React is still
         * hydrating, and a miss there reports only "timeout", which says
         * nothing about whether the panel was absent, late, or worded
         * differently. Reading the text tells us which.
         */
        const progressLine = await waitForText(page, /(\d+) of 15 steps complete/, 90_000);
        if (progressLine === null) {
          await page.screenshot({ path: `${SHOTS}/reload-failure.png` });
          const seen = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          console.log(`  page said: ${seen.slice(0, 400)}`);
        }
        check(progressLine !== null, "the progress panel comes back after a reload");

        const done = Number(/(\d+) of 15/.exec(progressLine ?? "")?.[1] ?? "0");
        check(done >= 1, `and picks the job back up at step ${String(done)}`);

        /* ---------------------------------------------------------- */
        console.log("  waiting for the article…");
        const ready = await waitForText(page, /Your article is ready/, 12 * 60_000);
        check(ready !== null, "generation finishes with the page open");

        const editorText = await page.locator(".prose-editor").innerText();
        const words = editorText.split(/\s+/).filter(Boolean).length;
        check(words > 800, `the editor holds the finished article (${String(words)} words)`);
        check(
          !/\[insert|TODO|!\[/i.test(editorText),
          "and no placeholder text reached the page",
        );

        const headings = await page.locator(".prose-editor h2").allInnerTexts();
        check(headings.length >= 5, `${String(headings.length)} sections rendered`);

        const links = await page.locator('.prose-editor a[href^="http"]').count();
        check(links > 0, `${String(links)} links are clickable in the editor`);

        const rawSyntax = /\]\(|https?:\/\/\S+\s/.test(editorText);
        check(!rawSyntax, "no raw URLs or markdown syntax visible in the prose");

        await page.screenshot({
          path: `${SHOTS}/finished-${viewport.name}.png`,
          fullPage: false,
        });
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots in ${SHOTS}`);
}

try {
  await main();
} catch (err) {
  if (err?.name === "ProviderExhausted") {
    console.log(`\n  SKIPPED — ${err.message}`);
    console.log("  The layout checks above still ran. Retry when the allowance resets.");
  } else {
    console.error("\n" + String(err?.stack ?? err));
    failures += 1;
  }
} finally {
  for (const id of articleIds) {
    await prisma.article.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
}

console.log(failures === 0 ? "\nBrowser checks passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
