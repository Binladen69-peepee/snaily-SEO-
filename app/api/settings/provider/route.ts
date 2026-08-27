import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { isOwner } from "@/lib/users";
import { providerById } from "@/lib/integrations/providers";
import { verifyProvider } from "@/lib/integrations/verify";
import {
  listSettings,
  revealSetting,
  saveSetting,
  SETTINGS,
  type SettingKey,
} from "@/lib/settings";

/**
 * Save one provider's credentials, together, only if they work.
 *
 * Two things this route exists to guarantee.
 *
 * A credential pair is saved as a pair. Writing a login and a password through
 * separate requests leaves a window where the stored pair is one half old and
 * one half new, which authenticates as neither.
 *
 * And a replacement that does not work never destroys one that does. The
 * candidate values are checked against the provider *before* anything is
 * written, so a typo costs a red message rather than a working integration.
 * `force` exists for the case where the owner has looked at that message and
 * wants to save anyway.
 *
 * Secrets travel in, never out: the response carries masked previews from
 * `listSettings`, exactly like every other settings response.
 */

const KEYS = SETTINGS.map((s) => s.key) as [SettingKey, ...SettingKey[]];

const schema = z.object({
  provider: z.string().min(1),
  /**
   * Only the fields the owner actually edited. A field left untouched is
   * absent, and keeps whatever is stored.
   */
  values: z.record(z.enum(KEYS), z.string().max(4000)),
  /** Save even though verification failed. */
  force: z.boolean().optional(),
  /** Check without saving anything. */
  verifyOnly: z.boolean().optional(),
});

async function requireOwner() {
  const session = await getSession();
  if (!session) return null;
  return (await isOwner(session.userId)) ? session : null;
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

  const { provider: providerId, values, force, verifyOnly } = parsed.data;
  const provider = providerById(providerId);
  if (provider === null) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const submitted = Object.keys(values) as SettingKey[];
  const foreign = submitted.filter((k) => !provider.keys.includes(k));
  if (foreign.length > 0) {
    return NextResponse.json(
      { error: "Those fields do not belong to this provider" },
      { status: 400 },
    );
  }

  /*
   * Verification needs the whole credential, not just the edited half. An
   * untouched field is read back from the store so a password-only change is
   * still checked against the existing login.
   */
  const candidate: Partial<Record<SettingKey, string>> = {};
  for (const key of provider.keys) {
    const edited = values[key];
    candidate[key] =
      edited !== undefined && edited.trim() !== ""
        ? edited.trim()
        : await revealSetting(key);
  }

  const result = provider.verifiable
    ? await verifyProvider(provider.id, candidate)
    : { ok: true, message: "Saved. This provider has no verification probe." };

  if (verifyOnly === true) {
    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      detail: result.detail,
      verifiedAt: result.ok ? new Date().toISOString() : null,
    });
  }

  if (!result.ok && force !== true) {
    /*
     * Nothing was written. Saying so explicitly matters: the owner needs to
     * know the integration they had is still the integration they have.
     */
    return NextResponse.json(
      {
        ok: false,
        message: result.message,
        keptExisting: true,
        settings: await listSettings(),
      },
      { status: 422 },
    );
  }

  for (const key of submitted) {
    const value = (values[key] ?? "").trim();
    // A blank submitted field means "leave what is stored alone", not "clear".
    // Clearing is a separate, deliberate act through the per-key route.
    if (value === "") continue;
    await saveSetting(key, value, session.email);
  }

  /*
   * An audit line with no secret in it. Which provider, by whom, and whether
   * the check passed is exactly what an owner needs to reconstruct a change;
   * the value itself is never useful in a log and always dangerous in one.
   */
  console.info(
    `[settings] ${provider.name} credentials updated by ${session.email} — verification ${result.ok ? "passed" : "overridden"}`,
  );

  return NextResponse.json({
    ok: true,
    message: result.message,
    detail: result.detail,
    verifiedAt: result.ok ? new Date().toISOString() : null,
    settings: await listSettings(),
  });
}
