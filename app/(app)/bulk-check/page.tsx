import { BulkAnalyzer } from "@/components/keywords/bulk-analyzer";
import { PageHeader } from "@/components/tool-shell";
import { getActiveProject } from "@/lib/projects";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { MAX_BULK_KEYWORDS } from "@/lib/keywords/opportunity";

export const metadata = { title: "Bulk Check · Snaily SEO" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BulkCheckPage({ searchParams }: Props) {
  const raw = await searchParams;
  const project = await getActiveProject();
  const provider = getKeywordProvider();

  /*
   * Deep Dive hands its selected rows over in the URL. Capped and de-duplicated
   * here rather than trusted: the box has a limit, and a link is the one input
   * anybody can edit by hand.
   */
  const passed = typeof raw.keywords === "string" ? raw.keywords : "";
  const keywords = [
    ...new Set(
      passed
        .split(/[\n,]/)
        .map((k) => k.trim())
        .filter((k) => k !== ""),
    ),
  ]
    .slice(0, MAX_BULK_KEYWORDS)
    .join("\n");

  const country = typeof raw.country === "string" ? raw.country.slice(0, 5) : "us";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Bulk Check"
        description="Analyse many keywords at once and compare their opportunity."
      />

      <BulkAnalyzer
        projectId={project?.id ?? null}
        isMock={provider.isMock}
        initialKeywords={keywords}
        initialCountry={country}
      />
    </div>
  );
}
