import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SECRET = process.env.AUTH_SECRET;
if (!SECRET) throw new Error("AUTH_SECRET is not set in .env.local");

const key = new TextEncoder().encode(SECRET);
const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

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

  const token = await new SignJWT(session)
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

    return {
      userId: payload.userId as string,
      email: payload.email as string,
      name: payload.name as string,
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
