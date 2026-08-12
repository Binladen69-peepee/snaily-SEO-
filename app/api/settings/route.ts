import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import {
  clearSetting,
  listSettings,
  saveSetting,
  SETTINGS,
  type SettingKey,
} from "@/lib/settings";
import { isOwner } from "@/lib/users";

const KEYS = SETTINGS.map((s) => s.key) as [SettingKey, ...SettingKey[]];

const schema = z.object({
  key: z.enum(KEYS),
  /** Empty string clears the override and falls back to the environment. */
  value: z.string().max(4000),
});

/** Only the owner may read or change deployment keys. */
async function requireOwner() {
  const session = await getSession();
  if (!session) return null;
  return (await isOwner(session.userId)) ? session : null;
}

export async function GET() {
  const session = await requireOwner();
  if (!session) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }
  return NextResponse.json({ settings: await listSettings() });
}

export async function POST(req: Request) {
  const session = await requireOwner();
  if (!session) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { key, value } = parsed.data;

  if (value.trim() === "") {
    await clearSetting(key);
  } else {
    await saveSetting(key, value.trim(), session.email);
  }

  return NextResponse.json({ ok: true, settings: await listSettings() });
}
