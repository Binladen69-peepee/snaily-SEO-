/**
 * DataForSEO credentials and base URL.
 *
 * Login + password come from the environment (or the encrypted AppSetting
 * overrides hydrated into process.env). They are never logged, returned to
 * the browser, or written into DomainMetric rows.
 */

const BASE_URL = "https://api.dataforseo.com";

export type DataForSeoCredentials = {
  login: string;
  password: string;
};

/** True when both halves of the Basic-auth pair are present. */
export function dataForSeoConfigured(): boolean {
  return readCredentials() !== null;
}

/**
 * Read credentials without throwing.
 *
 * Accepts the canonical pair and a few aliases so a pasted env name does not
 * leave the provider silently disabled.
 */
export function readCredentials(): DataForSeoCredentials | null {
  const login = firstEnv(
    "DATAFORSEO_LOGIN",
    "DATAFORSEO_API_LOGIN",
    "DFS_LOGIN",
  );
  const password = firstEnv(
    "DATAFORSEO_PASSWORD",
    "DATAFORSEO_API_PASSWORD",
    "DFS_PASSWORD",
  );
  if (login === "" || password === "") return null;
  return { login, password };
}

/** Throws a typed configuration error when credentials are missing. */
export function requireCredentials(): DataForSeoCredentials {
  const creds = readCredentials();
  if (creds === null) {
    throw new DataForSeoConfigError(
      "DataForSEO is not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in the server environment.",
    );
  }
  return creds;
}

export function dataForSeoBaseUrl(): string {
  return BASE_URL;
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] ?? "").trim();
    if (value !== "") return value;
  }
  return "";
}

export class DataForSeoConfigError extends Error {
  readonly code = "dataforseo_not_configured";
  constructor(message: string) {
    super(message);
    this.name = "DataForSeoConfigError";
  }
}
