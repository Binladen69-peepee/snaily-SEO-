import { EqualizerLoader } from "@/components/ui/equalizer-loader";

/**
 * Loading state for the Competitive Analysis panel only.
 *
 * It sits inside the layout, so the heading, tab row and domain box stay on
 * screen and stay clickable while the next tool loads — the reason switching
 * tabs no longer looks like a page change.
 */
export default function CompetitorsLoading() {
  return (
    <div className="flex min-h-[40svh] items-center justify-center">
      <EqualizerLoader label="Loading" />
    </div>
  );
}
