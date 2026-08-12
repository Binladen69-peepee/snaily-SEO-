import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { ProviderError } from "@/lib/keywords/types";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const keyword = url.searchParams.get("q")?.trim() ?? "";
  const country = url.searchParams.get("country") ?? "us";
  const language = url.searchParams.get("lang") ?? "en";

  if (keyword === "") {
    return NextResponse.json({ error: "Enter a keyword" }, { status: 400 });
  }

  const provider = getKeywordProvider();

  try {
    const detail = await provider.detail(keyword, country, language);
    return NextResponse.json({ ...detail, provider: provider.name });
  } catch (err) {
    const message =
      err instanceof ProviderError
        ? err.message
        : "Could not fetch keyword data. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
