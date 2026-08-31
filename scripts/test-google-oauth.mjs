/**
 * Google OAuth connect-flow and diagnostics unit tests.
 *
 *   npm run test:google-oauth
 */

import { readFileSync } from "node:fs";

import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";
process.env.AUTH_SECRET ??= "test-auth-secret-for-unit-tests";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const start = readFileSync("app/api/auth/google/route.ts", "utf8");
const callback = readFileSync("app/api/google/callback/route.ts", "utf8");
const properties = readFileSync("app/api/google/properties/route.ts", "utf8");
const account = readFileSync("lib/google/account.ts", "utf8");
const oauth = readFileSync("lib/google/oauth.ts", "utf8");
const diagSrc = readFileSync("lib/google/diagnostics.ts", "utf8");

console.log("Google OAuth connect flow");

check(
  /const intent = session \? "connect" : "login"/.test(start),
  "a signed-in user starts Connect, not a new login",
);
check(/await ensureSettings\(\)/.test(start), "start hydrates runtime settings");
check(/await ensureSettings\(\)/.test(callback), "callback hydrates runtime settings");
check(/await ensureSettings\(\)/.test(properties), "property discovery hydrates runtime settings");
check(
  /await ensureSettings\(\)/.test(account),
  "getGoogleClient hydrates runtime settings before building the OAuth client",
);
check(
  /intent === "drive" \|\| state\.intent === "connect"/.test(callback),
  "callback attaches tokens to the current session on connect",
);
check(
  /saveGoogleAccount\(session\.userId/.test(callback),
  "connect does not require the Google email to already be a user row",
);

check(
  !/client_secret|CLIENT_SECRET/.test(diagSrc.split("export function diagnosticQuery")[1] ?? "client_secret"),
  "diagnostic query builder source does not embed the client secret",
);

const built = compile(["lib/google/diagnostics.ts", "lib/google/oauth.ts"], {
  prefix: ".googletest-",
});

try {
  const diag = await built.load("lib/google/diagnostics.ts");

  check(
    diag.PRODUCTION_GOOGLE_CLIENT_ID ===
      "791613313131-vv8pdras4h79ad591takno3cp63u0mse.apps.googleusercontent.com",
    "production client id is the client's current OAuth client",
  );
  check(
    diag.PRODUCTION_REDIRECT_URI ===
      "https://cinnamon-snail-seo-tool.vercel.app/api/google/callback",
    "production redirect URI is the registered callback",
  );

  const q = diag.diagnosticQuery(
    {
      environmentConfigured: true,
      settingsHydrated: true,
      clientIdSuffix: "cp63u0mse",
      clientIdMatchesProduction: true,
      redirectUri: diag.PRODUCTION_REDIRECT_URI,
      redirectUriMatchesProduction: true,
      scopes: [],
      host: "https://cinnamon-snail-seo-tool.vercel.app",
    },
    { step: "token_exchange", consent: "ok", tokenExchange: "fail", error: "OAuth client rejected" },
  );
  check(q.includes("oauth_configured=yes"), "diagnostics report environment configured");
  check(q.includes("oauth_token=fail"), "diagnostics report token exchange result");
  check(!/secret|refresh_token|access_token|code=/.test(q), "diagnostics omit secrets and codes");

  const blocked = diag.consentErrorMessage("access_denied");
  check(
    /test user|Access blocked|cancelled/i.test(blocked),
    "access_denied is explained, not shown as a generic failure",
    blocked,
  );

  check(/login_hint/.test(oauth), "reconnect sends login_hint so Google opens the same account");
} finally {
  built.cleanup?.();
}

if (failures > 0) {
  console.error(`\n${String(failures)} Google OAuth test(s) failed.`);
  process.exit(1);
}
console.log("\nAll Google OAuth unit tests passed.");
