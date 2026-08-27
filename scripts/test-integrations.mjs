/**
 * Provider grouping, credential verification and the typeahead's contract.
 *
 * The two behaviours worth pinning here are the ones whose absence is silent:
 * a credential pair saved as two independent halves, and a failed replacement
 * overwriting a working key. Both look fine until an integration stops working
 * and nobody can say when it changed.
 *
 *   npm run test:integrations
 */
import { readFileSync } from "node:fs";

import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const built = compile(
  ["lib/integrations/providers.ts", "lib/integrations/verify.ts", "lib/settings.ts"],
  { prefix: ".integrations-" },
);

try {
  const { PROVIDERS, providerForKey, providerById, STATUS_LABEL } =
    await built.load("lib/integrations/providers.ts");
  const { verifyProvider } = await built.load("lib/integrations/verify.ts");
  const { SETTINGS } = await built.load("lib/settings.ts");

  /* ------------------------------------------------------------------ */
  console.log("\nOne card per provider, not per key");

  const dfs = providerById("dataforseo");
  check(
    dfs.keys.length === 2 &&
      dfs.keys.includes("DATAFORSEO_LOGIN") &&
      dfs.keys.includes("DATAFORSEO_PASSWORD"),
    "DataForSEO owns both halves of its credential",
    dfs.keys.join(", "),
  );

  const google = providerById("google");
  check(
    google.keys.includes("GOOGLE_CLIENT_ID") &&
      google.keys.includes("GOOGLE_CLIENT_SECRET"),
    "Google owns its client ID and secret together",
    google.keys.join(", "),
  );

  check(
    providerForKey("DATAFORSEO_PASSWORD")?.id === "dataforseo",
    "a key resolves back to its provider",
  );
  check(providerForKey("GROK_MODEL")?.id === "grok", "and so does a non-secret key");

  // Every setting must belong somewhere, or it silently disappears from the UI.
  const orphans = SETTINGS.filter((s) => providerForKey(s.key) === null).map(
    (s) => s.key,
  );
  check(
    orphans.length === 0,
    "every setting key belongs to exactly one provider",
    orphans.join(", ") || "(none orphaned)",
  );

  // And no key may be claimed twice, or a save would race itself.
  const seen = new Map();
  let dupes = 0;
  for (const p of PROVIDERS) {
    for (const k of p.keys) {
      if (seen.has(k)) dupes += 1;
      seen.set(k, p.id);
    }
  }
  check(dupes === 0, "no key is claimed by two providers");

  /* ------------------------------------------------------------------ */
  console.log("\nVerification refuses half a credential");

  const halfDfs = await verifyProvider("dataforseo", {
    DATAFORSEO_LOGIN: "someone@example.com",
  });
  check(
    !halfDfs.ok,
    "DataForSEO with no password does not verify",
    halfDfs.message,
  );

  const halfGoogle = await verifyProvider("google", {
    GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com",
  });
  check(
    !halfGoogle.ok,
    "Google with no secret does not verify",
    halfGoogle.message,
  );

  const unverifiable = await verifyProvider("openpagerank", {
    OPENPAGERANK_API_KEY: "anything",
  });
  check(
    unverifiable.ok,
    "a provider with no probe saves rather than blocking configuration",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA failed replacement keeps the working credential");

  const route = readFileSync("app/api/settings/provider/route.ts", "utf8");

  check(
    /if \(!result\.ok && force !== true\)/.test(route),
    "the route refuses to save when verification failed",
  );
  check(
    /keptExisting: true/.test(route),
    "and says the previous credentials were kept",
  );
  check(
    route.indexOf("verifyProvider") < route.indexOf("saveSetting"),
    "verification happens BEFORE anything is written",
  );
  check(
    /await revealSetting\(key\)/.test(route),
    "an untouched field is read back so a half-edit is still verified in full",
  );
  check(
    /const foreign = submitted\.filter/.test(route),
    "a request cannot write keys belonging to another provider",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nSecrets do not travel outward");

  check(
    /settings: await listSettings\(\)/.test(route),
    "the response carries masked previews, never raw values",
  );
  check(
    !/revealSetting/.test(route.split("return NextResponse.json({\n    ok: true")[1] ?? ""),
    "no revealed value is placed in the success response",
  );
  check(
    /verification \$\{result\.ok \? "passed" : "overridden"\}/.test(route),
    "the audit line records the outcome without the secret",
  );

  const card = readFileSync("components/integrations/provider-card.tsx", "utf8");
  check(
    /placeholder=\{/.test(card) && /\$\{view\.preview\}/.test(card),
    "the masked preview is a placeholder, never the input's value",
  );
  check(
    !/localStorage|sessionStorage/.test(card),
    "no credential is written to browser storage",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nTypeahead: the four things that make it cheap");

  const ta = readFileSync("components/keywords/keyword-typeahead.tsx", "utf8");

  check(/const DEBOUNCE_MS = 2[5-9]\d/.test(ta), "debounced in the 250-300ms band");
  check(/const MIN_CHARS = 3/.test(ta), "a minimum length before any request");
  check(
    /inflight\.current\?\.abort\(\)/.test(ta),
    "a stale request is aborted so it cannot overwrite a newer one",
  );
  check(/cache\.current\.get\(key\)/.test(ta), "repeated queries are served from cache");
  check(
    /if \(cache\.current\.size > 100\)/.test(ta),
    "and that cache is bounded",
  );
  check(
    /err\.name === "AbortError"/.test(ta),
    "an abort is not reported to the user as an error",
  );

  check(/role="combobox"/.test(ta), "the input is a combobox");
  check(/aria-activedescendant/.test(ta), "the active option is announced");
  check(/role="listbox"/.test(ta) && /role="option"/.test(ta), "options are options");
  check(/e\.key === "Escape"/.test(ta), "Escape closes");
  check(/e\.key === "ArrowDown"/.test(ta) && /e\.key === "ArrowUp"/.test(ta), "arrows navigate");
  check(/e\.key === "Enter"/.test(ta), "Enter selects");
  check(
    /Suggestions are unavailable right now\./.test(ta),
    "a provider failure degrades to a message, not a blocked input",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nStatus vocabulary");

  for (const s of ["not_configured", "connected", "auth_failed", "unavailable", "verifying"]) {
    check(typeof STATUS_LABEL[s] === "string", `  ${s} has an owner-facing label`);
  }
  check(
    !Object.values(STATUS_LABEL).some((l) => /error|exception|401|403/i.test(l)),
    "no label leaks a raw provider error",
  );
} finally {
  built.cleanup();
}

console.log(
  failures === 0 ? "\nAll integration checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
