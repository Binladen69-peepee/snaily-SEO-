/**
 * Compiles project TypeScript so a plain `node scripts/*.mjs` test can import
 * the real shipped modules instead of a copy that drifts.
 *
 * Builds inside the project rather than the OS temp dir: several of these
 * modules import the Prisma client, and Node only resolves node_modules by
 * walking up from the importing file, so a directory elsewhere on disk cannot
 * see it.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** Every .js file tsc wrote, at any depth. */
function emitted(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...emitted(path));
    else if (entry.name.endsWith(".js")) out.push(path);
  }
  return out;
}

export function compile(sources, { prefix = ".tstest-" } = {}) {
  const out = mkdtempSync(join(process.cwd(), prefix));

  writeFileSync(
    join(out, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: false,
        skipLibCheck: true,
        outDir: ".",
        rootDir: process.cwd(),
        // The project's own `@/*` alias, so a module that imports a sibling
        // still type-checks here. The emitted specifier is rewritten below.
        baseUrl: process.cwd(),
        paths: { "@/*": ["./*"] },
      },
      include: sources.map((s) => join(process.cwd(), s)),
    }),
  );

  try {
    execFileSync("npx", ["tsc", "-p", `"${join(out, "tsconfig.json")}"`], {
      stdio: "pipe",
      shell: true,
    });
  } catch (err) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`tsc failed:\n${String(err.stdout ?? err)}`);
  }

  /*
   * `@/lib/x` is a bundler alias tsc leaves in the emitted JS; rewrite it to a
   * relative path the Node ESM loader can resolve.
   *
   * Every emitted file is rewritten, not just the ones asked for: tsc also
   * emits whatever those import, and a transitively-pulled module with an
   * un-rewritten alias fails at load time with a confusing "Cannot find package
   * '@/lib'".
   */
  for (const file of emitted(out)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes('"@/')) continue;
    const depth = relative(out, file).split(/[\\/]/).length - 1;
    const up = "../".repeat(depth) || "./";
    writeFileSync(
      file,
      src.replace(/from "@\/(.*?)"/g, (_m, rest) => {
        /*
         * `@/lib/drafter/voice` may be a file or a directory. Next and tsc both
         * resolve the directory to its index; the Node ESM loader does not, so
         * a module split into a folder failed here with a confusing
         * ERR_MODULE_NOT_FOUND while working perfectly in the app.
         */
        const asFile = join(out, `${rest}.js`);
        const asIndex = join(out, rest, "index.js");
        const target =
          !existsSync(asFile) && existsSync(asIndex) ? `${rest}/index` : rest;
        return `from "${up}${target}.js"`;
      }),
    );
  }

  return {
    dir: out,
    load: (file) =>
      import(pathToFileURL(join(out, file.replace(/\.ts$/, ".js"))).href),
    cleanup: () => {
      rmSync(out, { recursive: true, force: true });
    },
  };
}

/** Tiny assertion counter, shared so each script does not reinvent one. */
export function checker() {
  const state = { passed: 0, failed: 0 };
  return {
    check(ok, label) {
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
      if (ok) state.passed += 1;
      else state.failed += 1;
    },
    section(name) {
      console.log(`\n${name}`);
    },
    report() {
      console.log(
        `\n${state.passed} passed, ${state.failed} failed, ${state.passed + state.failed} total`,
      );
      return state.failed;
    },
  };
}
