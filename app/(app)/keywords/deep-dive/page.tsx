import { redirect } from "next/navigation";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Deep Dive is the full analysis panel, which the main Keyword Research page
 * already renders. Keep the KeySearch menu entry but send it there rather than
 * maintaining a second copy of the same screen.
 */
export default async function DeepDivePage({ searchParams }: Props) {
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q : "";
  redirect(q === "" ? "/keywords" : `/keywords?q=${encodeURIComponent(q)}`);
}
