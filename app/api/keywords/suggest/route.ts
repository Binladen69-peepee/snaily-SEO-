import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { ProviderError } from "@/lib/keywords/types";

/** GET /api/keywords/suggest?q=&country= — autocomplete phrases per engine. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const keyword = (url.searchParams.get("q") ?? "").trim();
  const country = url.searchParams.get("country") ?? "us";

  if (keyword === "") {
    return NextResponse.json({ error: "Enter a keyword" }, { status: 400 });
  }
  if (keyword.length > 200) {
    return NextResponse.json({ error: "Keyword is too long" }, { status: 400 });
  }

  const provider = getKeywordProvider();

  try {
    const suggestions = await provider.suggest(keyword, country);
    return NextResponse.json(
      { keyword, suggestions },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (err) {
    const message =
      err instanceof ProviderError
        ? err.message
        : "Could not fetch suggestions. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
