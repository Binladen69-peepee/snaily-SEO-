import { NextResponse } from "next/server";

import { checkRanks, domainOf, pickKeywordsDueForCheck } from "@/lib/rank-tracker";

export const maxDuration = 60;

/**
 * Nightly rank sample. Caps keywords per run so a Hobby 60s function and the
 * DataForSEO wallet both survive. Manual Check on /tracking still covers the
 * rest.
 */
export async function GET(req: Request) {
  const configured = (process.env.CRON_SECRET ?? "").trim();

  if (configured === "") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  if (req.headers.get("authorization") !== `Bearer ${configured}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batches = await pickKeywordsDueForCheck();
  let checked = 0;
  let ranked = 0;

  for (const batch of batches) {
    const result = await checkRanks(batch.ids, domainOf(batch.url));
    checked += result.checked;
    ranked += result.ranked;
  }

  return NextResponse.json({
    batches: batches.length,
    checked,
    ranked,
  });
}
