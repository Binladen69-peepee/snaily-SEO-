import { BarChart3, CheckCircle2, XCircle } from "lucide-react";
import { Suspense } from "react";

import { CASearchBar } from "@/components/competitors/ca-search-bar";
import { ExplorerLoading } from "@/components/competitors/explorer-loading";
import {
  PageHeader,
  SourceNote,
  StatTile,
  ToolPrompt,
} from "@/components/tool-shell";
import { Badge } from "@/components/ui/badge";
import { getUrlMetrics } from "@/lib/competitors";
import { formatNumber } from "@/lib/keywords/format";

export const metadata = { title: "URL Metrics · Snaily SEO" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(v: string | string[] | undefined, fallback: string): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() || fallback;
}

function normalizeUrl(input: string): string {
  if (input.trim() === "") return "";
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return "";
  }
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      {ok ? (
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
      ) : (
        <XCircle className="size-4 shrink-0 text-destructive" aria-hidden />
      )}
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

async function Metrics({ url }: { url: string }) {
  let m;
  try {
    m = await getUrlMetrics(url);
  } catch (err) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-4"
      >
        <p className="font-medium text-destructive">Could not read that URL</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {err instanceof Error ? err.message : "Please try again."}
        </p>
      </div>
    );
  }

  const { page } = m;

  if (!page.ok) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="font-medium">Nothing readable at that URL</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          The page returned no HTML content, timed out, or blocked the request.
          Sites behind bot protection commonly do this.
        </p>
      </div>
    );
  }

  const titleLength = page.title.length;
  const metaLength = page.metaDescription.length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <a
          href={page.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary hover:underline"
        >
          {page.title || page.url}
        </a>
        <p className="truncate text-sm text-muted-foreground">{page.url}</p>
      </div>

      {/* ---------- Measured ---------- */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">Measured</h2>
          <Badge variant="success">Read from the page just now</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Word count" value={formatNumber(page.words)} />
          <StatTile
            label="Response time"
            value={`${formatNumber(m.responseMs)}ms`}
          />
          <StatTile label="H2/H3 headings" value={String(page.headings.length)} />
          <StatTile label="Images" value={String(page.images)} />
          <StatTile label="Links" value={String(page.links)} />
          <StatTile
            label="Title length"
            value={String(titleLength)}
            hint="50–60 ideal"
          />
        </div>

        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Check ok={m.https} label="Served over HTTPS" />
          <Check ok={titleLength > 0} label="Has a title tag" />
          <Check
            ok={titleLength >= 30 && titleLength <= 65}
            label={`Title length is reasonable (${String(titleLength)} chars)`}
          />
          <Check ok={page.h1 !== ""} label="Has an H1" />
          <Check
            ok={metaLength >= 70 && metaLength <= 165}
            label={`Meta description is a usable length (${String(metaLength)} chars)`}
          />
          <Check
            ok={page.headings.filter((h) => h.level === 2).length >= 2}
            label="Broken into H2 sections"
          />
          <Check ok={page.words >= 300} label="More than 300 words" />
          <Check ok={page.images >= 1} label="Contains at least one image" />
        </ul>
      </section>

      {/* ---------- Estimated ---------- */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">Authority</h2>
          <Badge variant="secondary">Derived from Common Crawl</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Snaily Page Authority"
            value={m.pageAuthority === null ? "N/A" : String(m.pageAuthority)}
          />
          <StatTile
            label="Snaily Domain Authority"
            value={m.domainAuthority === null ? "N/A" : String(m.domainAuthority)}
          />
          <StatTile
            label="Linking domains"
            value={
              m.pageLinkingDomains === null
                ? "N/A"
                : formatNumber(m.pageLinkingDomains)
            }
          />
          <StatTile
            label="Backlinks"
            value={m.backlinks === null ? "N/A" : formatNumber(m.backlinks)}
          />
        </div>
      </section>

      {/* ---------- Structure ---------- */}
      {page.headings.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 className="text-base font-semibold">Page structure</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every heading on the page, in order.
          </p>
          <ol className="mt-3 space-y-1">
            {page.h1 !== "" && (
              <li className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-medium">
                <span className="mr-2 text-xs text-primary">H1</span>
                {page.h1}
              </li>
            )}
            {page.headings.map((h, i) => (
              <li
                key={`${String(i)}-${h.text}`}
                className={`rounded-md border border-border px-3 py-1.5 text-sm ${
                  h.level === 3 ? "ml-4 text-muted-foreground" : ""
                }`}
              >
                <span className="mr-2 text-xs text-muted-foreground">
                  H{h.level}
                </span>
                {h.text}
              </li>
            ))}
          </ol>
        </section>
      )}

      <SourceNote>
        Word count, response time, headings, images, links, title and meta
        lengths were measured by fetching this page. Page and Domain Authority
        are estimates — those come from a backlink index, which is a paid
        subscription this tool does not have.
      </SourceNote>
    </div>
  );
}

export default async function UrlMetricsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const url = normalizeUrl(first(raw.url, ""));

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <PageHeader
        title="URL Metrics"
        description="Everything one page is made of, read live, plus the authority behind it."
      />

      <CASearchBar target="/url-metrics" />

      {url === "" ? (
        <ToolPrompt icon={BarChart3} title="Enter a URL to inspect it">
          Paste a full URL into the box above. Word count, load time, heading
          structure, image and link counts are all read live from the page.
        </ToolPrompt>
      ) : (
        <Suspense key={url} fallback={<ExplorerLoading />}>
          <Metrics url={url} />
        </Suspense>
      )}
    </div>
  );
}
