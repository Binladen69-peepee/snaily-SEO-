import { prisma } from "@/lib/db";

/**
 * Access control.
 *
 * This is a private, single-tenant tool. There is no public sign-up: the first
 * account ever created becomes the owner, and after that only the owner can
 * create further accounts (e.g. a VA).
 */

export const ROLES = ["owner", "member"] as const;
export type Role = (typeof ROLES)[number];

export type UserDTO = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
};

/** True only before the very first account exists — enables one-time setup. */
export async function needsBootstrap(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

export async function isOwner(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === "owner";
}

export async function listUsers(): Promise<UserDTO[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: (u.role === "owner" ? "owner" : "member") as Role,
    createdAt: u.createdAt.toISOString(),
  }));
}
