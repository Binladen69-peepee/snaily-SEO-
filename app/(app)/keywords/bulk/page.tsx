import { BulkAnalyzer } from "@/components/keywords/bulk-analyzer";
import { KeywordTabs } from "@/components/keywords/tabs";
import { getActiveProject } from "@/lib/projects";
import { getKeywordProvider } from "@/lib/keywords/provider";

export const metadata = { title: "Bulk Analysis · Snaily SEO" };

export default async function BulkPage() {
  const project = await getActiveProject();
  const provider = getKeywordProvider();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Bulk Keyword Analysis
        </h1>
        <p className="text-sm text-muted-foreground">
          Analyze many keywords at once and compare their opportunity.
        </p>
      </div>

      <KeywordTabs />

      <BulkAnalyzer
        projectId={project?.id ?? null}
        isMock={provider.isMock}
      />
    </div>
  );
}
