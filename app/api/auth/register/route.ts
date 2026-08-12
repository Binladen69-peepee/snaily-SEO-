import { NextResponse } from "next/server";

import { createSession, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { needsBootstrap } from "@/lib/users";
import { registerSchema } from "@/lib/validation";

/**
 * One-time setup only.
 *
 * This tool is private, so there is no open sign-up. This route works exactly
 * once — to create the owner account. Every account after that is created by
 * the owner from Settings → Users.
 */
export async function POST(req: Request) {
  if (!(await needsBootstrap())) {
    return NextResponse.json(
      { error: "Sign-up is closed. Ask the owner to create your account." },
      { status: 403 },
    );
  }

  const body: unknown = await req.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, email, password } = parsed.data;

  const user = await prisma.user.create({
    data: {
      name,
      email,
      role: "owner",
      passwordHash: await hashPassword(password),
    },
  });

  await createSession({
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  return NextResponse.json({ ok: true });
}
