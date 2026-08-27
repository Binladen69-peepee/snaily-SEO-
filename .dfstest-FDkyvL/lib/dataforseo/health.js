/**
 * DataForSEO health / authentication probe.
 *
 * Uses GET /v3/appendix/user_data — a lightweight account call that confirms
 * Basic auth without fetching paid backlink rows.
 */
import { dataForSeoGet } from "../../lib/dataforseo/client.js";
import { dataForSeoConfigured, readCredentials } from "../../lib/dataforseo/config.js";
import { DataForSeoError } from "../../lib/dataforseo/errors.js";
export async function checkDataForSeoHealth(opts = {}) {
    const checkedAt = new Date().toISOString();
    const creds = readCredentials();
    if (!dataForSeoConfigured() || creds === null) {
        return {
            provider: "dataforseo",
            status: "not_configured",
            configured: false,
            authenticated: false,
            message: "DataForSEO is not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.",
            checkedAt,
            loginHint: null,
        };
    }
    const loginHint = redactLogin(creds.login);
    try {
        const envelope = await dataForSeoGet("/v3/appendix/user_data", {
            credentials: creds,
            fetchImpl: opts.fetchImpl,
            timeoutMs: 15_000,
        });
        const topCode = Number(envelope.status_code ?? 0);
        if (topCode !== 20000) {
            // 40101/40102 are search-engine errors, not bad credentials.
            if (topCode === 40100) {
                return {
                    provider: "dataforseo",
                    status: "unauthorized",
                    configured: true,
                    authenticated: false,
                    message: "DataForSEO rejected the login or password.",
                    checkedAt,
                    loginHint,
                };
            }
            if (topCode === 40200 || topCode === 40201 || topCode === 40202) {
                return {
                    provider: "dataforseo",
                    status: "insufficient_balance",
                    configured: true,
                    authenticated: false,
                    message: "DataForSEO reports insufficient account balance.",
                    checkedAt,
                    loginHint,
                };
            }
            return {
                provider: "dataforseo",
                status: "unavailable",
                configured: true,
                authenticated: false,
                message: "DataForSEO health check failed.",
                checkedAt,
                loginHint,
            };
        }
        return {
            provider: "dataforseo",
            status: "authenticated",
            configured: true,
            authenticated: true,
            message: "DataForSEO CONNECTED · AUTHENTICATED",
            checkedAt,
            loginHint,
        };
    }
    catch (err) {
        if (err instanceof DataForSeoError) {
            if (err.code === "unauthorized") {
                return {
                    provider: "dataforseo",
                    status: "unauthorized",
                    configured: true,
                    authenticated: false,
                    message: err.message,
                    checkedAt,
                    loginHint,
                };
            }
            if (err.code === "insufficient_balance") {
                return {
                    provider: "dataforseo",
                    status: "insufficient_balance",
                    configured: true,
                    authenticated: false,
                    message: err.message,
                    checkedAt,
                    loginHint,
                };
            }
            return {
                provider: "dataforseo",
                status: "unavailable",
                configured: true,
                authenticated: false,
                message: err.message,
                checkedAt,
                loginHint,
            };
        }
        return {
            provider: "dataforseo",
            status: "unavailable",
            configured: true,
            authenticated: false,
            message: "DataForSEO health check failed.",
            checkedAt,
            loginHint,
        };
    }
}
/** Show only the domain half of an email-like login, else a short mask. */
function redactLogin(login) {
    const at = login.indexOf("@");
    if (at > 0 && at < login.length - 1) {
        return `***@${login.slice(at + 1)}`;
    }
    if (login.length <= 4)
        return "***";
    return `${login.slice(0, 2)}***`;
}
