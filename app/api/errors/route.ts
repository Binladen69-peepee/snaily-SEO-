import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { reportError } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  message: z.string().min(1).max(500),
  digest: z.string().max(64).optional(),
  route: z.string().max(200).optional(),
});

/**
 * Client error boundary reports. Authenticated so a stranger cannot fill the
 * log. No stacks, no request bodies.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimit(`errors:${session.userId}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many reports" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const requestId = req.headers.get("x-request-id")?.slice(0, 64) ?? "";
  await reportError({
    message: parsed.data.message,
    route: parsed.data.route ?? "client",
    requestId: parsed.data.digest ?? requestId,
  });

  return NextResponse.json({ ok: true });
}
