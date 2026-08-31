"use client";

import { useEffect, useMemo, useState } from "react";

type Status = {
  environmentConfigured: boolean;
  settingsHydrated: boolean;
  clientIdSuffix: string | null;
  clientIdMatchesProduction: boolean | null;
  redirectUri: string;
  redirectUriMatchesProduction: boolean | null;
  scopes: string[];
  host: string;
};

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={
          ok === false
            ? "text-[11px] font-medium text-destructive"
            : ok === true
              ? "text-[11px] font-medium text-success"
              : "break-all text-[11px] text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Safe OAuth diagnostics. Never renders secrets or tokens.
 */
export function GoogleOAuthDiagnostics({
  search,
}: {
  search?: Record<string, string | string[] | undefined>;
}) {
  const [status, setStatus] = useState<Status | null>(null);

  const [urlSearch, setUrlSearch] = useState<Record<string, string>>({});

  useEffect(() => {
    setUrlSearch(Object.fromEntries(new URLSearchParams(window.location.search)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/google/oauth-status")
      .then((res) => res.json() as Promise<Status & { error?: string }>)
      .then((data) => {
        if (cancelled || data.error) return;
        setStatus(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const fromUrl = useMemo(() => {
    const merged = { ...urlSearch, ...(search as Record<string, string> | undefined) };
    const get = (k: string) => {
      const v = merged[k] ?? search?.[k];
      return Array.isArray(v) ? v[0] : v;
    };
    return {
      error: get("google_error") ?? get("error") ?? null,
      connected: get("google") === "connected",
      step: get("oauth_step") ?? null,
      consent: get("oauth_consent") ?? null,
      token: get("oauth_token") ?? null,
      configured: get("oauth_configured") ?? null,
      client: get("oauth_client") ?? null,
      redirect: get("oauth_redirect") ?? null,
      clientMatch: get("oauth_client_match") ?? null,
    };
  }, [search, urlSearch]);

  if (
    !fromUrl.error &&
    !fromUrl.connected &&
    !fromUrl.step &&
    status === null
  ) {
    return null;
  }

  return (
    <details
      open={Boolean(fromUrl.error)}
      className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
    >
      <summary className="cursor-pointer select-none font-medium">
        Google connection details
      </summary>
      {fromUrl.error ? (
        <p role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive">
          {fromUrl.error}
        </p>
      ) : fromUrl.connected ? (
        <p className="mt-2 text-success">Google connected. Choose Search Console and Analytics properties below.</p>
      ) : null}
      <dl className="mt-2 divide-y divide-border/60">
        <Row
          label="Environment configured"
          value={
            status
              ? status.environmentConfigured
                ? "yes"
                : "no"
              : fromUrl.configured ?? "—"
          }
          ok={status?.environmentConfigured ?? fromUrl.configured === "yes"}
        />
        <Row
          label="OAuth client"
          value={
            status?.clientIdSuffix
              ? `…${status.clientIdSuffix}`
              : fromUrl.client
                ? `…${fromUrl.client}`
                : "not set"
          }
          ok={status?.clientIdMatchesProduction ?? (fromUrl.clientMatch === "yes" ? true : fromUrl.clientMatch === "no" ? false : null)}
        />
        {status?.clientIdMatchesProduction === false && (
          <Row
            label="Production client match"
            value="Runtime client ID does not match the configured production OAuth client"
            ok={false}
          />
        )}
        <Row
          label="Redirect URI"
          value={status?.redirectUri ?? fromUrl.redirect ?? "—"}
          ok={status?.redirectUriMatchesProduction}
        />
        <Row label="Consent" value={fromUrl.consent ?? "not yet"} />
        <Row
          label="Callback / token exchange"
          value={
            fromUrl.token === "ok"
              ? "ok"
              : fromUrl.token === "fail"
                ? "failed"
                : fromUrl.step ?? "not yet"
          }
          ok={fromUrl.token === "ok" ? true : fromUrl.token === "fail" ? false : null}
        />
      </dl>
      <p className="mt-2 text-[11px] text-muted-foreground">
        If Google shows “Access blocked”, add this Google account as a test user
        on the OAuth consent screen (Testing mode), or publish the app. Search
        Console API, Analytics Admin API and Analytics Data API must be enabled
        on the same Cloud project as the OAuth client.
      </p>
    </details>
  );
}
