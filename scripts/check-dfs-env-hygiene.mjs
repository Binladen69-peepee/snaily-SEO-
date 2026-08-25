/**
 * Safe credential hygiene check — never prints secret values.
 *   node --env-file-if-exists=.env.local scripts/check-dfs-env-hygiene.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.cwd(), ".env.local");
const raw = readFileSync(path);
const text = raw.toString("utf8");
const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;

function parse(name) {
  const re = new RegExp(`^${name}=(.*)$`, "m");
  const m = text.match(re);
  if (!m) return { present: false };
  let v = m[1];
  const trailingSpace = /\s$/.test(v);
  const leadingSpace = /^\s/.test(v);
  v = v.trim();
  let quoted = false;
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    quoted = true;
    v = v.slice(1, -1);
  }
  const env = (process.env[name] ?? "").trim();
  return {
    present: true,
    fileLen: v.length,
    envLen: env.length,
    match: v === env,
    leadingSpace,
    trailingSpace,
    quoted,
    hasHash: v.includes("#"),
    hasDollar: v.includes("$"),
    looksLikeEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  };
}

const login = parse("DATAFORSEO_LOGIN");
const password = parse("DATAFORSEO_PASSWORD");

console.log("UTF-8 BOM on .env.local:", hasBom ? "yes" : "no");
console.log("LOGIN:", JSON.stringify(login));
console.log("PASSWORD:", JSON.stringify({ ...password, looksLikeEmail: undefined }));

if (login.present && !login.looksLikeEmail && login.fileLen > 0) {
  console.log(
    "NOTE: DataForSEO login is usually the API login email from app.dataforseo.com — not the account password.",
  );
}
if (login.present && password.present && login.match && password.match) {
  console.log("File and process.env lengths match — parsing looks OK.");
} else if (login.present && password.present) {
  console.log(
    "MISMATCH: .env.local value does not match process.env — restart the dev server after saving.",
  );
}
