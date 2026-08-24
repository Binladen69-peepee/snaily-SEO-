import { EqualizerLoader } from "@/components/ui/equalizer-loader";

/** Shared pending state for the Competitive Analysis tools. */
export function ExplorerLoading() {
  return (
    <div className="flex min-h-[40svh] items-center justify-center rounded-xl border border-border bg-card">
      <EqualizerLoader label="Analysing domain" size="lg" />
    </div>
  );
}
