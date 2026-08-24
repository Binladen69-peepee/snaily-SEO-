/**
 * Finds server code reaching into a "use client" module for anything that is
 * not a component.
 *
 * React lets a server component *render* a client component. It cannot call a
 * client function, and it cannot read a client module's plain values — the
 * bundler replaces every export with a client reference, so a function throws
 *
 *   Attempted to call parseTab() from the server but parseTab is on the client.
 *
 * and a constant is quietly the wrong object. TypeScript sees a valid import
 * and the build succeeds, so the first sign is a blank "Something went wrong"
 * in production. That is exactly how the Competitor Explorer broke.
 *
 * The rule: a non-client file may import components and types from a client
 * module, and nothing else. Helpers both sides need belong in a plain module
 * under lib/.
 *
 *   node scripts/check-client-boundary.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
}

for (const dir of ["app", "components", "lib"]) walk(join(ROOT, dir));

const isClient = new Map();
/** name -> "component" | "value", per module. */
const exportKind = new Map();

for (const file of files) {
  const src = readFileSync(file, "utf8");
  // The directive has to be the first statement, so only the head matters.
  isClient.set(file, /^\s*["']use client["']/m.test(src.slice(0, 400)));

  const kinds = new Map();

  // `export function Foo` / `export default function Foo`
  for (const m of src.matchAll(
    /^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/gm,
  )) {
    kinds.set(m[1], /^[A-Z]/.test(m[1]) ? "component" : "value");
  }

  /*
   * `export const Foo = …`. The initialiser decides: an arrow function or a
   * wrapper call (memo/forwardRef) with an uppercase name is a component;
   * anything else — an array, an object, a number — is data, and data is just
   * as broken across the boundary as a function is.
   */
  for (const m of src.matchAll(
    /^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*([\s\S]{0,80})/gm,
  )) {
    const [, name, init] = m;
    const looksCallable =
      /^(?:\(|async\s|function\b|React\.(?:memo|forwardRef)\b|memo\(|forwardRef\()/.test(
        init.trim(),
      ) || /^[A-Za-z0-9_$.]+\s*\(\s*(?:function|\()/.test(init.trim());
    kinds.set(
      name,
      /^[A-Z]/.test(name) && looksCallable ? "component" : "value",
    );
  }

  // Bare `export default function () {}` / `export default Foo`
  if (/^export\s+default\b/m.test(src)) kinds.set("default", "component");

  exportKind.set(file, kinds);
}

const moduleKey = (file) =>
  relative(ROOT, file).split(/[\\/]/).join("/").replace(/\.tsx?$/, "");

const byKey = new Map(files.map((file) => [moduleKey(file), file]));

/** Resolves an import specifier to one of our files, or undefined. */
function resolveSpecifier(fromFile, spec) {
  let key;
  if (spec.startsWith("@/")) {
    key = spec.slice(2);
  } else if (spec.startsWith(".")) {
    key = relative(ROOT, resolve(dirname(fromFile), spec))
      .split(/[\\/]/)
      .join("/");
  } else {
    return undefined;
  }
  key = key.replace(/\.tsx?$/, "");
  return byKey.get(key) ?? byKey.get(`${key}/index`);
}

const IMPORT = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;

const problems = [];

for (const file of files) {
  if (isClient.get(file) === true) continue;

  const src = readFileSync(file, "utf8");

  for (const m of src.matchAll(IMPORT)) {
    const clause = m[1].trim();
    // `import type { … }` erases at compile time and is always safe.
    if (clause.startsWith("type ")) continue;

    const target = resolveSpecifier(file, m[2]);
    if (target === undefined || isClient.get(target) !== true) continue;

    const kinds = exportKind.get(target) ?? new Map();
    const flag = (name, how) => {
      problems.push({ file: moduleKey(file), name, from: moduleKey(target), how });
    };

    // `import * as M from "…"` — every export is reachable, none checkable.
    const namespace = /^\*\s+as\s+([A-Za-z0-9_$]+)$|,\s*\*\s+as\s+([A-Za-z0-9_$]+)/.exec(
      clause,
    );
    if (namespace) {
      flag(namespace[1] ?? namespace[2], "namespace import");
      continue;
    }

    const named = /\{([\s\S]*?)\}/.exec(clause);
    if (!named) continue;

    for (const raw of named[1].split(",")) {
      const spec = raw.trim();
      if (spec === "" || spec.startsWith("type ")) continue;
      const name = (spec.split(/\s+as\s+/)[0] ?? "").trim();
      if (name === "") continue;
      if (kinds.get(name) === "value") flag(name, "value import");
    }
  }
}

for (const p of problems) {
  console.log(`FAIL  ${p.file}`);
  console.log(`        ${p.how}: \`${p.name}\` from client module ${p.from}`);
  console.log("        Move it to a plain module so both sides can use it.\n");
}

console.log(
  problems.length === 0
    ? `No server-to-client value imports. Checked ${String(files.length)} files.`
    : `${String(problems.length)} client-boundary problem(s).`,
);

process.exit(problems.length === 0 ? 0 : 1);
