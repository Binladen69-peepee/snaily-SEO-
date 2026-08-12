import { EqualizerLoader } from "@/components/ui/equalizer-loader";

export default function AppLoading() {
  return (
    <div className="flex min-h-[50svh] items-center justify-center">
      <EqualizerLoader label="Loading page" size="lg" />
    </div>
  );
}
