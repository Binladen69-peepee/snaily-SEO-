import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";

const SECRET = process.env.AUTH_SECRET;
if (!SECRET) throw new Error("AUTH_SECRET is not set in .env.local");

const key = new TextEncoder().encode(SECRET);
const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Impersonated sessions expire far sooner than a login.
 *
 * Signing in as someone else is a support action, not a way to work. An hour is
 * enough to reproduce a problem and short enough that a forgotten tab stops
 * being someone else's open account by the end of the day.
 */
const IMPERSONATION_MAX_AGE = 60 * 60;

export type Session = {
  userId: string;
  email: string;
  name: string;
  /**
   * Set only while an owner is signed in as somebody else.
   *
   * The real operator is carried in the token rather than looked up, so every
   * request knows who is actually acting and can return them to their own
   * account without a second store to keep in sync.
   */
  impersonatorId?: string;
  impersonatorName?: string;
  impersonatorEmail?: string;
  sessionVersion?: number;
};

/** True when this session is an owner acting as another account. */
export function isImpersonating(session: Session | null): boolean {
  return session?.impersonatorId != null && session.impersonatorId !== "";
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(session: Session) {
  // An impersonated token must not outlive the support task it was made for.
  const maxAge = isImpersonating(session) ? IMPERSONATION_MAX_AGE : MAX_AGE;

  let sessionVersion = session.sessionVersion;
  if (sessionVersion === undefined) {
    try {
      const row = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { sessionVersion: true },
      });
      sessionVersion = row?.sessionVersion ?? 1;
    } catch {
      sessionVersion = 1;
    }
  }

  const token = await new SignJWT({ ...session, sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(key);

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path: "/",
  });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key);
    const impersonatorId =
      typeof payload.impersonatorId === "string" ? payload.impersonatorId : undefined;

    const sessionVersion =
      typeof payload.sessionVersion === "number" ? payload.sessionVersion : 1;
    const userId = payload.userId as string;

    try {
      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { sessionVersion: true },
      });
      if (row && row.sessionVersion !== sessionVersion) return null;
    } catch {
      /* sessionVersion column missing until migrate — accept the token */
    }

    return {
      userId,
      email: payload.email as string,
      name: payload.name as string,
      sessionVersion,
      impersonatorId,
      impersonatorName:
        typeof payload.impersonatorName === "string" ? payload.impersonatorName : undefined,
      impersonatorEmail:
        typeof payload.impersonatorEmail === "string" ? payload.impersonatorEmail : undefined,
    };
  } catch {
    return null;
  }
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** Invalidates every JWT issued before this call. */
export async function bumpSessionVersion(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
    });
  } catch {
    /* ignore until migrate */
  }
}
