import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COUNTRIES } from "@/lib/keywords/types";
import { cn } from "@/lib/utils";

/** Page title block, consistent across every tool. */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  /** Badges or actions shown on the right. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h1>
        {description !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children !== undefined && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

/**
 * The search bar every KeySearch tool opens with: one field, an optional
 * country selector, and a coloured action button.
 *
 * A plain GET form on purpose — results are server-rendered from the URL, so
 * every search is shareable, bookmarkable and needs no client-side state.
 */
export function ToolForm({
  name,
  placeholder,
  defaultValue = "",
  country,
  action = "Search",
  hint,
  hidden,
  className,
}: {
  /** Query-string key for the main input. */
  name: string;
  placeholder: string;
  defaultValue?: string;
  /** Current country code; omit to hide the selector. */
  country?: string;
  action?: string;
  hint?: string;
  /** Extra values carried through the form so they survive the submit. */
  hidden?: Record<string, string>;
  className?: string;
}) {
  return (
    <form
      method="get"
      className={cn(
        "rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4",
        className,
      )}
    >
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name={name}
            defaultValue={defaultValue}
            placeholder={placeholder}
            aria-label={placeholder}
            autoComplete="off"
            className="h-11 pl-9"
          />
        </div>

        {country !== undefined && (
          <select
            name="country"
            defaultValue={country}
            aria-label="Country"
            className="h-11 shrink-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-48"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        )}

        <Button type="submit" className="h-11 shrink-0 px-6 sm:w-auto">
          {action}
        </Button>
      </div>

      {hint !== undefined && (
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      )}
    </form>
  );
}

/** Headline number in a bordered tile — KeySearch's stat strip. */
export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 text-xl font-semibold">{value}</p>
      {hint !== undefined && (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Empty state used before a tool has been given anything to work on. */
export function ToolPrompt({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
      <Icon className="mx-auto size-9 text-muted-foreground/60" aria-hidden />
      <p className="mt-3 font-medium">{title}</p>
      {children !== undefined && (
        <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Explains where a number came from when it is derived rather than measured.
 *
 * The app is explicit about this everywhere: live rankings are labelled live,
 * estimates are labelled estimates.
 */
export function SourceNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
