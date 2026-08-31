/**
 * Moz as the source of Domain Authority.
 *
 * The keyword table showed DataForSEO Rank under a column headed "DA": 39 for
 * cinnamonsnail.com where Moz reads 48-49, and 47 for iheartumami.com where
 * Moz reads 51. Those are two companies' scores over two link indexes, so the
 * gap is not something tuning closes — only reading Moz closes it.
 *
 *   npm run test:moz
 */
import { compile } from "./compile.mjs";

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const built = compile(["lib/moz/client.ts"], { prefix: ".moztest-" });

const CREDS = { accessId: "id", secretKey: "secret" };
const reply = (body, status = 200) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

try {
  const { fetchMozMetrics, verifyMozCredentials, MozError, readMozCredentials } =
    await built.load("lib/moz/client.ts");

  console.log("\nReading Moz's numbers");
  const { rows } = await fetchMozMetrics(["cinnamonsnail.com"], {
    credentials: CREDS,
    fetchImpl: reply({
      results: [{
        page: "cinnamonsnail.com", domain_authority: 48, page_authority: 41,
        spam_score: 2, root_domains_to_root_domain: 1216,
      }],
    }),
  });
  check(rows[0]?.domainAuthority === 48, "DA is taken from Moz verbatim", String(rows[0]?.domainAuthority));
  check(rows[0]?.pageAuthority === 41, "and so is PA");
  check(rows[0]?.spamScore === 2, "and spam score");
  check(rows[0]?.linkingRootDomains === 1216, "and linking root domains");

  console.log("\nFailures are typed, not guessed around");
  for (const [status, code, label] of [
    [401, "unauthorized", "bad credentials"],
    [429, "rate_limited", "rate limiting"],
    [500, "unavailable", "an outage"],
  ]) {
    let got = "";
    await fetchMozMetrics(["x.com"], { credentials: CREDS, fetchImpl: reply({}, status) })
      .catch((e) => { got = e instanceof MozError ? e.code : "wrong-type"; });
    check(got === code, `${label} -> ${code}`, got);
  }

  let missing = "";
  await fetchMozMetrics(["x.com"], { credentials: null, fetchImpl: reply({}) })
    .catch((e) => { missing = e.code ?? ""; });
  check(missing === "not_configured", "no credentials is its own state, not a failure");

  console.log("\nVerification spends one row and reports plainly");
  const ok = await verifyMozCredentials(CREDS, reply({
    results: [{ page: "moz.com", domain_authority: 91 }],
  }));
  check(ok.ok === true, "valid credentials verify");
  check(/91/.test(ok.detail ?? ""), "and the probe reports what it read", ok.detail);

  const bad = await verifyMozCredentials(CREDS, reply({}, 401));
  check(bad.ok === false, "invalid credentials do not verify");
  check(!/401|Unauthorized/i.test(bad.message), "without leaking the raw provider error", bad.message);

  console.log("\nCredentials come from the runtime store");
  delete process.env.MOZ_ACCESS_ID;
  delete process.env.MOZ_SECRET_KEY;
  check(readMozCredentials() === null, "absent credentials read as null");
  process.env.MOZ_ACCESS_ID = "a";
  check(readMozCredentials() === null, "half a credential is not a credential");
  process.env.MOZ_SECRET_KEY = "b";
  check(readMozCredentials()?.accessId === "a", "both halves present resolves");
} finally {
  built.cleanup();
}

console.log(failures === 0 ? "\nAll Moz checks passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
