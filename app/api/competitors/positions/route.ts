import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { lookupPositions } from "@/lib/competitors";

export const maxDuration = 60;

const schema = z.object({
  domain: z.string().min(3).max(255),
  country: z.string().min(2).max(5),
  /**
   * Capped deliberately. Each uncached keyword is one SerpApi credit against a
   * 250/month allowance, so a runaway request could burn a month in one click.
   */
  keywords: z.array(z.string().min(1).max(200)).min(1).max(10),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { domain, country, keywords } = parsed.data;

  try {
    const positions = await lookupPositions(domain, keywords, country);
    return NextResponse.json({ positions });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not check positions right now.",
      },
      { status: 502 },
    );
  }
}
