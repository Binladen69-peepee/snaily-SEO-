import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isValidId } from "@/lib/db";
import { compareToActual, deleteForecast } from "@/lib/foresight/store";

export const maxDuration = 30;

/**
 * Scores a saved forecast against what actually happened.
 *
 * A POST rather than a GET because it writes: the comparison is recorded so the
 * model's track record accumulates instead of being recomputed and forgotten
 * every time somebody opens the page.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Forecast not found" }, { status: 404 });
  }

  const result = await compareToActual(session.userId, id);
  return NextResponse.json(result);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Forecast not found" }, { status: 404 });
  }

  const deleted = await deleteForecast(session.userId, id);
  if (!deleted) {
    return NextResponse.json({ error: "Forecast not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
