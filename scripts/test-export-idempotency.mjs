/**
 * One export is one draft, and no retry anywhere makes it two.
 *
 * This is the regression suite for the duplicate-draft bug: the client saw
 * several WordPress drafts of one recipe, and every layer that could produce
 * them is exercised here against a fake WordPress that counts inserts. A real
 * site is not needed and deliberately not used — the assertion is about how
 * many posts get created, and the only way to test that honestly is to own the
 * thing doing the creating.
 *
 * The four layers, each with its own section below:
 *   1. the connector client, which used to re-POST down a second URL shape
 *      whenever the first one timed out;
 *   2. the export planner, which now targets the draft the article already has
 *      rather than whatever the browser believed;
 *   3. `sendExport`, which must not fall through to creating a draft after an
 *      update whose outcome it does not know;
 *   4. the connector plugin, which recognises a repeat of an export it has
 *      already carried out and updates that draft instead.
 *
 *   npm run test:export-idempotency
 */
import { readFileSync } from "node:fs";

import { checker, compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

const built = compile(
  ["lib/db.ts", "lib/wordpress/plugin.ts", "lib/wordpress/client.ts"],
  { prefix: ".idem-" },
);
const Client = await built.load("lib/wordpress/client.ts");

const t = checker();

/* ---------------------------------------------------------------------------
 * A WordPress that counts what it was asked to create
 * ------------------------------------------------------------------------ */

const SITE = "https://example.test";
const TOKEN = "test-token";

/**
 * Stands in for the connector plugin, including its article binding.
 *
 * `fail` decides what happens to each request in turn, so a test can say "the
 * first attempt times out" and then assert on how many posts exist.
 */
function fakeWordPress({ script = [], dedupe = true } = {}) {
  const site = {
    posts: new Map(),
    inserts: 0,
    updates: 0,
    requests: [],
    nextId: 5000,
  };

  let step = 0;

  // The client calls `fetch(url, init)` with a URL object, so both arguments
  // matter: the body being asserted on arrives in the second one.
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init.body ?? "{}"));
    site.requests.push(url.toString());

    const behaviour = script[step] ?? "ok";
    step += 1;

    /*
     * A timeout is the case that mattered. The real client aborts the fetch,
     * so the error has to be the one `AbortSignal.timeout` throws — the client
     * branches on its name to decide whether the site may have acted.
     */
    if (behaviour === "timeout") {
      // The site did the work; the answer is what went missing.
      applyWrite(site, url, body, dedupe);
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }
    if (behaviour === "refused") {
      // Nothing reached WordPress at all.
      throw new TypeError("fetch failed");
    }
    if (behaviour === "404") {
      return new Response(JSON.stringify({ code: "rest_no_route" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    const result = applyWrite(site, url, body, dedupe);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  return site;
}

/** The plugin's own create-or-update decision, in miniature. */
function applyWrite(site, url, body, dedupe) {
  const path = url.pathname.includes("/draft")
    ? url.pathname
    : (url.searchParams.get("rest_route") ?? "");
  const updateId = /\/draft\/(\d+)/.exec(path)?.[1];

  if (updateId !== undefined) {
    site.updates += 1;
    const post = site.posts.get(Number(updateId));
    if (post !== undefined) post.title = body.title;
    return { id: Number(updateId), status: "draft", edit_link: "e", deduped: false };
  }

  if (dedupe && body.article_id !== "") {
    for (const [id, post] of site.posts) {
      if (post.article === body.article_id) {
        site.updates += 1;
        post.title = body.title;
        return { id, status: "draft", edit_link: "e", deduped: true };
      }
    }
  }

  site.nextId += 1;
  site.inserts += 1;
  site.posts.set(site.nextId, { title: body.title, article: body.article_id });
  return { id: site.nextId, status: "draft", edit_link: "e", deduped: false };
}

const payload = (articleId = "art_1") => ({
  title: "Vegan Thai Red Curry",
  content: "<p>body</p>",
  articleId,
});

const realFetch = globalThis.fetch;

/* ---------------------------------------------------------------------------
 * 1. The connector client
 * ------------------------------------------------------------------------ */

t.section("connector client: a timed-out write is never re-sent");

{
  // The bug, exactly: the pretty URL times out after WordPress inserted the
  // post, and the client used to try `?rest_route=` next and insert it again.
  const site = fakeWordPress({ script: ["timeout"], dedupe: false });
  let thrown = null;
  try {
    await Client.createDraft(SITE, TOKEN, payload());
  } catch (err) {
    thrown = err;
  }

  t.check(site.inserts === 1, `exactly one post created, not two (got ${site.inserts})`);
  t.check(site.requests.length === 1, "no second request was sent");
  t.check(thrown !== null, "the caller is told the outcome is unknown");
  t.check(
    Client.isIndeterminate(thrown),
    "the failure is indeterminate, not a plain network error",
  );
  t.check(
    !Client.isConnectivityFailure(thrown),
    "an indeterminate write is not reported as a lost connection",
  );
}

{
  // The other side of the same coin: a connection that was never established
  // reached no WordPress, so the second URL shape must still be tried. That
  // fallback is why two shapes exist and breaking it would break real sites.
  const site = fakeWordPress({ script: ["refused", "ok"], dedupe: false });
  const created = await Client.createDraft(SITE, TOKEN, payload());

  t.check(created.id > 0, "a refused connection still falls back to the other URL");
  t.check(site.inserts === 1, `one post created via the fallback (got ${site.inserts})`);
}

{
  // A timed-out *update* must not be retried either: the plugin trashes and
  // rebuilds the recipe card on every update, so a repeat is not free.
  const site = fakeWordPress({ script: ["timeout"], dedupe: false });
  let thrown = null;
  try {
    await Client.updateDraft(SITE, TOKEN, 4242, payload());
  } catch (err) {
    thrown = err;
  }
  t.check(Client.isIndeterminate(thrown), "a timed-out update is indeterminate too");
  t.check(site.updates === 1, `the update was applied once (got ${site.updates})`);
}

{
  // Reads are unchanged: they may and must still try every shape.
  const site = fakeWordPress({ script: ["timeout", "ok"], dedupe: false });
  let reached = false;
  try {
    await Client.fetchTaxonomies(SITE, TOKEN);
    reached = true;
  } catch {
    reached = false;
  }
  t.check(
    reached || site.requests.length > 1,
    "a read still retries the second URL shape",
  );
}

t.section("connector client: the article id travels with every write");

{
  const site = fakeWordPress();
  await Client.createDraft(SITE, TOKEN, payload("art_xyz"));
  const post = [...site.posts.values()][0];
  t.check(post.article === "art_xyz", "the draft is bound to the article that made it");
}

/* ---------------------------------------------------------------------------
 * 2. The site's own duplicate guard
 * ------------------------------------------------------------------------ */

t.section("connector plugin: a repeated create updates rather than duplicates");

{
  // Two creates for one article — the shape a lost response leaves behind.
  const site = fakeWordPress();
  const first = await Client.createDraft(SITE, TOKEN, payload("art_1"));
  const second = await Client.createDraft(SITE, TOKEN, {
    ...payload("art_1"),
    title: "Vegan Thai Red Curry (edited)",
  });

  t.check(site.inserts === 1, `one draft for one article (got ${site.inserts})`);
  t.check(second.id === first.id, "the second create returns the first draft");
  t.check(second.deduped === true, "the site reports that it reused the draft");
  t.check(
    site.posts.get(first.id).title === "Vegan Thai Red Curry (edited)",
    "the existing draft got the new content",
  );
}

{
  // A different article is a different draft. The guard must not collapse two
  // genuinely separate recipes into one post.
  const site = fakeWordPress();
  await Client.createDraft(SITE, TOKEN, payload("art_1"));
  await Client.createDraft(SITE, TOKEN, payload("art_2"));
  t.check(site.inserts === 2, `two articles keep two drafts (got ${site.inserts})`);
}

t.section("connector plugin source carries the binding");

{
  const php = readFileSync("lib/wordpress/plugin.ts", "utf8");
  t.check(
    php.includes("SNAILY_SEO_ARTICLE_META"),
    "the plugin defines the article-binding meta key",
  );
  t.check(
    php.includes("snaily_seo_bound_draft"),
    "create looks for a draft already bound to the article",
  );
  t.check(
    php.includes("'post_status'      => 'draft'"),
    "the lookup only ever matches drafts, never a published post",
  );
  t.check(
    /snaily_seo_bind_article\(\$id, snaily_seo_article_key\(\$request\)\)/.test(php),
    "update binds too, so drafts made before this get protected on re-export",
  );
  t.check(
    php.includes('export const PLUGIN_VERSION = "1.6.0"'),
    "the plugin version was bumped so sites are prompted to update",
  );
}

/* ---------------------------------------------------------------------------
 * 3. The export planner and sender
 * ------------------------------------------------------------------------ */

globalThis.fetch = realFetch;

const planned = compile(
  [
    "lib/db.ts",
    "lib/markdown.ts",
    "lib/text.ts",
    "lib/content/affiliate.ts",
    "lib/content/link-index.ts",
    "lib/drafter/editorial.ts",
    "lib/drafter/recipe.ts",
    "lib/drafter/sanitize.ts",
    "lib/drafter/post-template.ts",
    "lib/google/token-crypto.ts",
    "lib/wordpress/blocks.ts",
    "lib/wordpress/client.ts",
    "lib/wordpress/plugin.ts",
    "lib/wordpress/sync.ts",
    "lib/wordpress/template.ts",
    "lib/wordpress/section-mapper.ts",
    "lib/wordpress/draft-export.ts",
  ],
  { prefix: ".idemplan-" },
);
const Export = await planned.load("lib/wordpress/draft-export.ts");

t.section("export planner: the article row decides, not the browser");

{
  const source = readFileSync("lib/wordpress/draft-export.ts", "utf8");
  t.check(
    source.includes("opts.forceNew !== true && article.wpDraftId !== null"),
    "an article with a draft targets that draft by default",
  );
  t.check(
    !source.includes("opts.update === true"),
    "the old opt-in `update` flag is gone from the planner",
  );

  const route = readFileSync("app/api/articles/[id]/export/route.ts", "utf8");
  t.check(
    !route.includes("buildExport(article, { update:"),
    "the route no longer passes the browser's opinion into the planner",
  );
  t.check(
    route.includes("claimExport(article.id)"),
    "the route claims the article before exporting it",
  );
  t.check(
    route.includes("releaseExport(article.id)"),
    "the claim is released when the export finishes",
  );
  t.check(
    /finally\s*\{\s*await releaseExport/.test(route),
    "released in a finally, so a failed export does not lock the article",
  );
  t.check(
    route.includes("wpExportingAt"),
    "the claim is held in the database, where concurrent invocations can see it",
  );

  const dialog = readFileSync("components/articles/wp-export-dialog.tsx", "utf8");
  t.check(
    dialog.includes("if (inFlight.current) return;"),
    "the dialog latches synchronously, so a double-click sends once",
  );
  t.check(
    !/body: JSON.stringify\(\{ dest: "wordpress", update \}\)/.test(dialog),
    "the dialog no longer tells the server whether this is an update",
  );
}

t.section("sendExport: an unknown update outcome never becomes a new draft");

{
  // The worst case there was: the update reached WordPress, the answer did
  // not, and the old fallback created a draft beside the one it had just
  // written. That is two drafts from one click.
  const site = fakeWordPress({ script: ["timeout"], dedupe: false });
  const plan = {
    targetPostId: 4242,
    template: { wpId: 37284, title: "T", status: "draft", configured: true },
    payload: payload(),
  };

  let thrown = null;
  try {
    await Export.sendExport({ siteUrl: SITE, token: TOKEN }, plan);
  } catch (err) {
    thrown = err;
  }

  t.check(thrown !== null, "the export fails rather than inventing a second draft");
  t.check(site.inserts === 0, `no draft was created (got ${site.inserts})`);
}

{
  // The two failures that *may* fall through still do: a connector too old to
  // have the update route, and a draft the author has since published.
  const site = fakeWordPress({ script: ["404", "404", "ok"], dedupe: false });
  const plan = {
    targetPostId: 4242,
    template: { wpId: 37284, title: "T", status: "draft", configured: true },
    payload: payload(),
  };
  const result = await Export.sendExport({ siteUrl: SITE, token: TOKEN }, plan);

  t.check(site.inserts === 1, "an old connector still gets the author's work onto the site");
  t.check(result.updated === false, "and it is reported as a creation");
}

{
  // A create the site deduped is reported to the author as an update, because
  // that is what happened to the post.
  const site = fakeWordPress();
  await Client.createDraft(SITE, TOKEN, payload("art_9"));
  const plan = {
    targetPostId: null,
    template: { wpId: 37284, title: "T", status: "draft", configured: true },
    payload: payload("art_9"),
  };
  const result = await Export.sendExport({ siteUrl: SITE, token: TOKEN }, plan);

  t.check(result.deduped === true, "the deduped flag reaches the caller");
  t.check(result.updated === true, "a deduped create reads as an update, not a creation");
  t.check(site.inserts === 1, `still one draft (got ${site.inserts})`);
}

t.section("nothing exports on its own");

{
  // The client asked whether Snaily was creating drafts by itself. It is not,
  // and this is the check that keeps it that way: the only caller of a
  // WordPress write is the route a person's click reaches.
  const { execFileSync } = await import("node:child_process");
  const hits = execFileSync(
    process.execPath,
    [
      "-e",
      `const { readdirSync, readFileSync, statSync } = require("node:fs");
       const { join } = require("node:path");
       const out = [];
       const walk = (dir) => {
         for (const e of readdirSync(dir, { withFileTypes: true })) {
           const p = join(dir, e.name);
           if (e.isDirectory()) { if (!/node_modules|\\.next/.test(p)) walk(p); }
           else if (/\\.tsx?$/.test(p) && /sendExport|createDraft\\(/.test(readFileSync(p, "utf8"))) out.push(p);
         }
       };
       for (const d of ["app", "lib", "components"]) walk(d);
       console.log(out.join("\\n"));`,
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((l) => l.trim().replace(/\\/g, "/"))
    .filter(Boolean);

  const allowed = new Set([
    "lib/wordpress/client.ts",
    "lib/wordpress/draft-export.ts",
    "app/api/articles/[id]/export/route.ts",
  ]);
  const unexpected = hits.filter((h) => !allowed.has(h));

  t.check(
    unexpected.length === 0,
    `only the export route writes drafts${unexpected.length > 0 ? ` — found ${unexpected.join(", ")}` : ""}`,
  );

  const cron = readFileSync("vercel.json", "utf8");
  t.check(
    !/export/i.test(cron),
    "no cron job points at an export endpoint",
  );

  const finishing = readFileSync("lib/jobs/stages/finishing.ts", "utf8");
  t.check(
    !/sendExport|createDraft\(/.test(finishing),
    "the drafting pipeline does not export to WordPress when it finishes",
  );
}

globalThis.fetch = realFetch;
built.cleanup?.();
planned.cleanup?.();

process.exit(t.report() === 0 ? 0 : 1);
