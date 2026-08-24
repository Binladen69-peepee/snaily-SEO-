/**
 * Lints the generated connector PHP.
 *
 * The plugin lives in a TypeScript template literal, so `tsc` sees a string
 * and nothing more — a mangled brace or a backslash that needed doubling gets
 * all the way to the site before anyone notices. This emits the real file and
 * runs `php -l` over it.
 *
 *   node scripts/check-plugin-php.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compile } from "./compile.mjs";

const built = compile(["lib/wordpress/plugin.ts", "lib/wordpress/zip.ts"], {
  prefix: ".phplint-",
});
const { PLUGIN_PHP, PLUGIN_VERSION } = await built.load("lib/wordpress/plugin.ts");

const dir = mkdtempSync(join(process.cwd(), ".phpsrc-"));
const file = join(dir, "snaily-seo-connector.php");
writeFileSync(file, PLUGIN_PHP, "utf8");

let code = 0;
try {
  const out = execFileSync("php", ["-l", file], { encoding: "utf8" });
  console.log(`Snaily SEO Connector ${PLUGIN_VERSION}: ${out.trim()}`);
} catch (err) {
  console.error(String(err.stdout ?? err));
  code = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
  built.cleanup();
}

process.exit(code);
