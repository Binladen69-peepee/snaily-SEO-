import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { revealSetting, SETTINGS, type SettingKey } from "@/lib/settings";
import { isOwner } from "@/lib/users";

const KEYS = SETTINGS.map((s) => s.key) as [SettingKey, ...SettingKey[]];
const schema = z.object({ key: z.enum(KEYS) });

/**
 * Returns one key in full, for the owner only.
 *
 * A POST rather than a GET so the key never lands in a URL, a browser history
 * entry, a referrer header or a server access log. The page requests this only
 * when the owner clicks Reveal, so secrets are never part of the rendered HTML
 * — which also keeps them out of screenshots taken of a page at rest.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(await isOwner(session.userId))) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown key" }, { status: 400 });
  }

  const value = await revealSetting(parsed.data.key);
  return NextResponse.json(
    { key: parsed.data.key, value },
    // Never cached anywhere between here and the browser.
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
