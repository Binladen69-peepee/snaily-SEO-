import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { recordSearch } from "@/lib/keywords/history";
import { parseSearchParams } from "@/lib/keywords/params";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { ProviderError } from "@/lib/keywords/types";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const params = parseSearchParams(raw);

  if (params.keyword.trim() === "") {
    return NextResponse.json({ error: "Enter a keyword" }, { status: 400 });
  }

  const provider = getKeywordProvider();

  try {
    const result = await provider.search(params);
    await recordSearch(params.keyword, params.country, result.total);
    return NextResponse.json({ ...result, provider: provider.name });
  } catch (err) {
    const message =
      err instanceof ProviderError
        ? err.message
        : "Could not fetch keyword data. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
