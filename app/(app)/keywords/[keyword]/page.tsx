import { KeywordDetailView } from "@/components/keywords/keyword-detail";
import { ErrorState } from "@/components/keywords/states";
import { getKeywordProvider } from "@/lib/keywords/provider";
import { ProviderError } from "@/lib/keywords/types";

type Props = {
  params: Promise<{ keyword: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props) {
  const { keyword } = await params;
  return { title: `${decodeURIComponent(keyword)} · Snaily SEO` };
}

export default async function KeywordDetailPage({
  params,
  searchParams,
}: Props) {
  const { keyword } = await params;
  const raw = await searchParams;

  const decoded = decodeURIComponent(keyword).trim();
  const country = typeof raw.country === "string" ? raw.country : "us";
  const language = typeof raw.lang === "string" ? raw.lang : "en";

  const provider = getKeywordProvider();

  try {
    const detail = await provider.detail(decoded, country, language);
    return <KeywordDetailView detail={detail} country={country} />;
  } catch (err) {
    const message =
      err instanceof ProviderError
        ? err.message
        : "The keyword data source is unavailable. Please try again.";
    return (
      <div className="mx-auto max-w-2xl py-10">
        <ErrorState message={message} />
      </div>
    );
  }
}
