"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Every query-string key the dialog owns, so Clear can remove them all. */
const FIELDS = [
  "contains",
  "excludes",
  "words",
  "wordsMax",
  "volMin",
  "volMax",
  "cpcMin",
  "cpcMax",
  "kdMin",
  "kdMax",
] as const;

function Range({
  label,
  minName,
  maxName,
  minPlaceholder,
  maxPlaceholder,
  step,
  params,
}: {
  label: string;
  minName: string;
  maxName: string;
  minPlaceholder: string;
  maxPlaceholder: string;
  step?: string;
  params: URLSearchParams;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[13px] font-medium">{label}</legend>
      <div className="flex items-center gap-2">
        <Input
          name={minName}
          type="number"
          min={0}
          step={step}
          aria-label={`${label} minimum`}
          defaultValue={params.get(minName) ?? ""}
          placeholder={minPlaceholder}
          className="h-9"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          name={maxName}
          type="number"
          min={0}
          step={step}
          aria-label={`${label} maximum`}
          defaultValue={params.get(maxName) ?? ""}
          placeholder={maxPlaceholder}
          className="h-9"
        />
      </div>
    </fieldset>
  );
}

/**
 * KeySearch's "Filter Results" dialog — the same fields and the same include /
 * exclude syntax, where `+` means AND and `,` means OR.
 */
export function FilterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function apply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams(params.toString());

    for (const field of FIELDS) {
      const value = String(form.get(field) ?? "").trim();
      if (value === "") next.delete(field);
      else next.set(field, value);
    }
    next.delete("page"); // filtering resets pagination

    router.push(`${pathname}?${next.toString()}`);
    onOpenChange(false);
  }

  function clear() {
    const next = new URLSearchParams(params.toString());
    for (const field of FIELDS) next.delete(field);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Filter Results</DialogTitle>
        </DialogHeader>

        <form onSubmit={apply} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="contains" className="text-[13px]">
                Words to include
              </Label>
              <Input
                id="contains"
                name="contains"
                defaultValue={params.get("contains") ?? ""}
                placeholder="blog + free, tutorial"
                className="mt-1.5 h-9"
              />
            </div>

            <div className="min-w-0">
              <Label htmlFor="excludes" className="text-[13px]">
                Negative words to exclude
              </Label>
              <Input
                id="excludes"
                name="excludes"
                defaultValue={params.get("excludes") ?? ""}
                placeholder="reddit, forum"
                className="mt-1.5 h-9"
              />
            </div>
          </div>

          <p className="rounded border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Use <strong className="text-foreground">(+)</strong> for AND and{" "}
            <strong className="text-foreground">(,)</strong> for OR. So{" "}
            <code className="rounded bg-background px-1">blog + free</code>{" "}
            needs both words, and{" "}
            <code className="rounded bg-background px-1">blog, vlog</code>{" "}
            matches either.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Range
              label="Number of words in keyword"
              minName="words"
              maxName="wordsMax"
              minPlaceholder="1"
              maxPlaceholder="Any"
              params={params}
            />
            <Range
              label="Search volume"
              minName="volMin"
              maxName="volMax"
              minPlaceholder="0"
              maxPlaceholder="Any"
              params={params}
            />
            <Range
              label="CPC ($)"
              minName="cpcMin"
              maxName="cpcMax"
              minPlaceholder="0.00"
              maxPlaceholder="Any"
              step="0.01"
              params={params}
            />
            <Range
              label="Difficulty score"
              minName="kdMin"
              maxName="kdMax"
              minPlaceholder="0"
              maxPlaceholder="100"
              params={params}
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={clear}>
              Clear all
            </Button>
            <Button type="submit">Apply filters</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
