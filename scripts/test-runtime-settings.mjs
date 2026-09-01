/**
 * Runtime provider settings: the store, and whether providers actually use it.
 *
 * The store already existed — encrypted at rest, masked in the UI, saved
 * through /api/settings. What did not exist was anything that read it back
 * into the environment before a provider looked there, so a key saved in the
 * UI was stored correctly and then ignored by DataForSEO, Google and SerpApi.
 * Rotating a key needed a redeploy, which is exactly what it was built to
 * avoid.
 *
 * These checks pin the resolution order and the two failure modes that made it
 * silent: a cleared setting that never reverted, and provider clients that
 * never re-read.
 *
 *   npm run test:runtime-settings
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const built = compile(["lib/settings.ts", "lib/dataforseo/config.ts"], {
  prefix: ".runtimesettings-",
});

try {
  const settings = await built.load("lib/settings.ts");
  const config = await built.load("lib/dataforseo/config.ts");

  /* ------------------------------------------------------------------ */
  console.log("\nThe resolution order");

  // Basic auth needs both halves, so both are set for these.
  process.env.DATAFORSEO_LOGIN = "env-login";
  process.env.DATAFORSEO_PASSWORD = "env-password";
  check(
    config.readCredentials()?.login === "env-login",
    "with nothing stored, the environment is used",
    config.readCredentials()?.login,
  );

  // Hydration overwrites process.env, which is what the provider reads.
  process.env.DATAFORSEO_LOGIN = "db-login";
  process.env.DATAFORSEO_PASSWORD = "db-password";
  check(
    config.readCredentials()?.login === "db-login",
    "a hydrated store value is what the provider reads",
    config.readCredentials()?.login,
  );

  // Half a credential pair is not a credential.
  delete process.env.DATAFORSEO_PASSWORD;
  check(
    config.readCredentials() === null,
    "a login with no password is unconfigured, not a half-usable credential",
  );

  delete process.env.DATAFORSEO_LOGIN;
  check(
    config.readCredentials() === null,
    "with neither, the provider reports unconfigured rather than guessing",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nMasking — the UI never receives a secret");

  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("lib/settings.ts", "utf8"),
  );

  check(
    /function mask\(/.test(src),
    "listSettings masks through a single mask() helper",
  );
  check(
    /return `\$\{value\.slice\(0, 4\)\}••••\$\{value\.slice\(-4\)\}`/.test(src),
    "a long secret is previewed as first four + last four only",
  );
  check(
    /if \(value\.length <= 8\) return "••••••••"/.test(src),
    "a short secret is fully masked rather than half-revealed",
  );
  check(
    /encryptToken\(value\)/.test(src),
    "values are encrypted before they reach the database",
  );
  check(
    !/console\.(log|info|warn|error)\([^)]*value/.test(src),
    "no code path logs a setting value",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nHydration — the part that was missing");

  check(
    /export async function ensureSettings/.test(src),
    "there is an idempotent hydration entry point",
  );
  check(
    /inflight \?\?= loadSettings\(\)/.test(src),
    "concurrent callers share one read rather than stampeding the database",
  );
  check(
    /SETTINGS_TTL_MS/.test(src),
    "hydration is cached for a bounded time, not once per process",
  );
  check(
    /export function invalidateSettings/.test(src),
    "saving can force the next read to be fresh",
  );
  check(
    /invalidateSettings\(\);/.test(src),
    "and saveSetting/clearSetting actually call it",
  );

  // The bug that made "clear" do nothing.
  check(
    /const bootEnv = new Map/.test(src),
    "the boot environment is captured so a cleared setting can revert",
  );
  check(
    /if \(original === undefined\) delete process\.env\[spec\.key\]/.test(src),
    "clearing a setting with no environment value unsets it, not leaves it stale",
  );

  /* ------------------------------------------------------------------ */
  console.log("\nProviders hydrate before reading credentials");

  const fs = await import("node:fs");
  const wired = [
    ["lib/dataforseo/client.ts", "DataForSEO"],
    ["lib/keywords/serp-api-guard.ts", "SerpApi"],
    ["app/api/auth/google/route.ts", "Google sign-in"],
    ["app/api/google/callback/route.ts", "Google callback"],
    /*
     * The AI client was the one provider that never hydrated, and the symptom
     * was silent: GROK_MODEL is an editable field in Integrations, so the owner
     * set "qwen/qwen3.8-27b", the value was stored and read back to them — and
     * sixteen stages then ran on the built-in default, with nothing anywhere
     * saying which model had actually written the article.
     */
    ["lib/ai.ts", "the AI writer"],
  ];
  for (const [file, label] of wired) {
    const text = fs.readFileSync(file, "utf8");
    check(
      /await ensureSettings\(\)/.test(text),
      `${label} hydrates the store before using credentials`,
      file,
    );
  }
  /* ------------------------------------------------------------------ */
  console.log("\nThe model is chosen at runtime, not compiled in");

  const ai = fs.readFileSync("lib/ai.ts", "utf8");
  check(
    /const configured = env\("GROK_MODEL", "GROQ_MODEL", "AI_MODEL"\)/.test(ai),
    "the model id comes from settings, under any of three names",
  );
  check(
    /await ensureSettings\(\);[\s\S]{0,120}const model = opts\.model \?\? aiModel\(\)/.test(ai),
    "and the store is read before the model is chosen, not after",
  );
  check(
    /DEFAULT_MODEL\[aiVendor\(\)\]/.test(ai),
    "an unset model still falls back to the vendor default",
  );

  // Comments in the spec name the models that were deliberately left out, so
  // they have to come off before asking what the list actually offers.
  const spec = (/\{\s*key: "GROK_MODEL",[\s\S]*?\n  \},/.exec(src)?.[0] ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
  check(/options: \[/.test(spec), "the model field offers known-good ids");
  check(
    /"qwen\/qwen3\.8-27b"/.test(spec),
    "  including the Qwen model the owner asked to test",
  );
  check(
    !/whisper|orpheus|prompt-guard/.test(spec),
    "  and not the speech or safety models, which cannot write an article",
  );
  check(
    /placeholder: "openai\/gpt-oss-120b"/.test(spec),
    "  with the real current default named, not the retired llama one",
  );
} finally {
  built.cleanup();
}

console.log(
  failures === 0 ? "\nAll runtime settings checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
