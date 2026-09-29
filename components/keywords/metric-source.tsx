import { cn } from "@/lib/utils";

/** Tiny marker so a modelled number is never mistaken for DataForSEO. */
export function MetricSourceMark({
  source,
  className,
}: {
  source?: "live" | "estimated";
  className?: string;
}) {
  const live = source === "live";
  return (
    <span
      className={cn(
        "ml-1 inline-flex align-middle text-[9px] font-semibold uppercase tracking-wide",
        live ? "text-success" : "text-muted-foreground",
        className,
      )}
      title={
        live
          ? "Measured by DataForSEO Keywords Data / Labs"
          : "Modelled fallback — DataForSEO had no row for this phrase"
      }
    >
      {live ? "live" : "est."}
    </span>
  );
}
