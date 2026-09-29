import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

import { rateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";

const COOKIE = "session";

const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const PAID_LIMIT = 90;
const PAID_WINDOW_MS = 60 * 1000;

function isPublicPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/login" || pathname === "/register") {
    return true;
  }
  if (pathname === "/robots.txt") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/api/google/callback") return true;
  if (pathname === "/api/health") return true;
  if (pathname === "/api/cron/draft-jobs") return true;
  if (pathname === "/api/cron/rank-check") return true;
  if (/^\/api\/draft-jobs\/[^/]+\/run$/.test(pathname)) return true;
  return false;
}

function isPaidApi(pathname: string): boolean {
  return (
    pathname.startsWith("/api/keywords/") ||
    pathname === "/api/on-page" ||
    pathname.startsWith("/api/audits") ||
    pathname.startsWith("/api/competitors/") ||
    pathname.startsWith("/api/tracking")
  );
}

function requestIdOf(request: NextRequest): string {
  const existing = request.headers.get("x-request-id")?.trim() ?? "";
  if (existing !== "" && existing.length <= 64) return existing;
  return crypto.randomUUID();
}

function stamp(response: NextResponse, requestId: string): NextResponse {
  response.headers.set("x-request-id", requestId);
  return response;
}

function nextWithId(request: NextRequest, requestId: string): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  return stamp(NextResponse.next({ request: { headers } }), requestId);
}

function unauthorized(request: NextRequest, requestId: string) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return stamp(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      requestId,
    );
  }
  return stamp(
    NextResponse.redirect(new URL("/login", request.url)),
    requestId,
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = requestIdOf(request);

  if (pathname === "/api/auth/login" || pathname === "/api/auth/register") {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const limited = rateLimit(`auth:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!limited.ok) {
      return stamp(
        NextResponse.json(
          { error: "Too many attempts. Try again in a few minutes." },
          {
            status: 429,
            headers: rateLimitHeaders(limited, LOGIN_LIMIT),
          },
        ),
        requestId,
      );
    }
  }

  if (isPublicPath(pathname)) {
    return nextWithId(request, requestId);
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return unauthorized(request, requestId);
  }

  const token = request.cookies.get(COOKIE)?.value;
  if (!token) {
    return unauthorized(request, requestId);
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const userId = typeof payload.userId === "string" ? payload.userId : "";
    if (userId === "") return unauthorized(request, requestId);

    if (isPaidApi(pathname)) {
      const limited = rateLimit(`paid:${userId}`, PAID_LIMIT, PAID_WINDOW_MS);
      if (!limited.ok) {
        return stamp(
          NextResponse.json(
            { error: "Too many requests. Slow down and try again." },
            {
              status: 429,
              headers: rateLimitHeaders(limited, PAID_LIMIT),
            },
          ),
          requestId,
        );
      }
    }
  } catch {
    return unauthorized(request, requestId);
  }

  return nextWithId(request, requestId);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
