"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AnchorPage } from "@/lib/geo/config";
import { factsCompleteness } from "@/lib/geo/facts";
import { cn } from "@/lib/utils";

export type Facts = {
  serviceArea: string;
  travelPolicy: string;
  eventTypes: string;
  guestMin: number | null;
  guestMax: number | null;
  dietaryHandling: string;
  pricingLogic: string;
  leadTime: string;
  consultingScope: string;
  pastEvents: string[];
  neverClaim: string[];
  anchorPages: AnchorPage[];
};

type FieldDef = {
  key: keyof Facts;
  label: string;
  hint: string;
  rows?: number;
};

const SECTIONS: {
  id: string;
  title: string;
  description: string;
  fields?: FieldDef[];
  extra?: "guests" | "past" | "never" | "anchors";
}[] = [
  {
    id: "identity",
    title: "Business Identity",
    description: "Who you are and what you offer — used to ground every draft.",
    fields: [
      {
        key: "eventTypes",
        label: "Event types / business focus",
        hint: "Weddings, corporate, private parties, pop-up/cart bookings…",
        rows: 2,
      },
      {
        key: "consultingScope",
        label: "Consulting scope",
        hint: "What the engagement includes and who it is for.",
        rows: 2,
      },
    ],
  },
  {
    id: "area",
    title: "Service Area",
    description: "Counties, cities, and travel rules. Never invent locations.",
    fields: [
      {
        key: "serviceArea",
        label: "Service area (required)",
        hint: "Counties and regions actually served. Be specific.",
        rows: 2,
      },
      {
        key: "travelPolicy",
        label: "Travel policy",
        hint: "What actually happens for an event outside that area.",
        rows: 2,
      },
    ],
  },
  {
    id: "ops",
    title: "Operations",
    description: "Guest limits, lead time, and pricing logic — no invented numbers.",
    fields: [
      {
        key: "pricingLogic",
        label: "Pricing logic",
        hint: "What moves an estimate up or down. Logic only — no fabricated quotes.",
        rows: 3,
      },
      {
        key: "leadTime",
        label: "Booking / lead time",
        hint: "How far ahead you realistically need for different event sizes.",
        rows: 2,
      },
    ],
    extra: "guests",
  },
  {
    id: "dietary",
    title: "Dietary / Special Handling",
    description: "Dietary options, restrictions, and policies.",
    fields: [
      {
        key: "dietaryHandling",
        label: "Dietary handling",
        hint: "Fully vegan events, mixed groups, common allergen accommodations.",
        rows: 2,
      },
    ],
  },
  {
    id: "experience",
    title: "Experience",
    description: "Safe-to-reference past events only — no private client details.",
    extra: "past",
  },
  {
    id: "safety",
    title: "Safety / Accuracy",
    description: "Hard never-claim rules the generator is forbidden to break.",
    extra: "never",
  },
];

/**
 * Grounding record for every GEO Lab draft.
 * Anything not recorded here cannot be stated as fact.
 */
export function BusinessFactsPanel({
  projectId,
  initial,
  onSaved,
}: {
  projectId: string;
  initial: Facts;
  onSaved: (facts: Facts) => void;
}) {
  const [facts, setFacts] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFacts(initial);
  }, [initial]);

  function set<K extends keyof Facts>(key: K, value: Facts[K]) {
    setFacts((f) => ({ ...f, [key]: value }));
  }

  const { filled, total } = factsCompleteness(facts);
  const pct = Math.round((filled / total) * 100);
  const missing = total - filled;
  const verified =
    (facts.serviceArea.trim() !== "" ? 1 : 0) +
    (facts.neverClaim.length > 0 ? 1 : 0) +
    (facts.pastEvents.length > 0 ? 1 : 0);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/geo/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...facts }),
      });
      const data = (await res.json()) as { facts?: Facts; error?: string };
      if (!res.ok || !data.facts) {
        toast.error(data.error ?? "Could not save facts");
        return;
      }
      setFacts(data.facts);
      onSaved(data.facts);
      toast.success("Business Facts saved");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Business Knowledge Base</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Single source of truth for AI generation. Prices, cities, policies,
              and stats must come from here — never invented.
            </p>
          </div>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Save facts
          </Button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatChip label="Completeness" value={`${String(pct)}%`} tone={pct >= 70 ? "good" : "warn"} />
          <StatChip label="Fields filled" value={`${String(filled)}/${String(total)}`} />
          <StatChip label="Missing" value={String(missing)} tone={missing > 0 ? "warn" : "good"} />
          <StatChip
            label="Safety signals"
            value={`${String(verified)} set`}
            hint="Service area · never-claim · past events"
          />
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              pct >= 70 ? "bg-success" : pct >= 40 ? "bg-warning" : "bg-destructive",
            )}
            style={{ width: `${String(pct)}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Provenance: User provided · Source of truth for drafting
        </p>
      </div>

      {SECTIONS.map((section) => (
        <div
          key={section.id}
          className="rounded-xl border border-border bg-card p-4"
        >
          <h3 className="text-sm font-semibold">{section.title}</h3>
          <p className="text-xs text-muted-foreground">{section.description}</p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {section.fields?.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`bf-${f.key}`}>{f.label}</Label>
                <Textarea
                  id={`bf-${f.key}`}
                  rows={f.rows ?? 2}
                  value={(facts[f.key] as string) ?? ""}
                  onChange={(e) => {
                    set(f.key, e.target.value as Facts[typeof f.key]);
                  }}
                  placeholder={f.hint}
                />
                <p className="text-[11px] text-muted-foreground">{f.hint}</p>
              </div>
            ))}

            {section.extra === "guests" && (
              <div className="space-y-1.5">
                <Label htmlFor="bf-guest-min">Guest counts</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="bf-guest-min"
                    type="number"
                    min={0}
                    value={facts.guestMin ?? ""}
                    onChange={(e) => {
                      set(
                        "guestMin",
                        e.target.value === "" ? null : Number(e.target.value),
                      );
                    }}
                    placeholder="min"
                    className="h-9"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="number"
                    min={0}
                    value={facts.guestMax ?? ""}
                    onChange={(e) => {
                      set(
                        "guestMax",
                        e.target.value === "" ? null : Number(e.target.value),
                      );
                    }}
                    placeholder="max"
                    aria-label="Maximum guest count"
                    className="h-9"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Leave blank if there is no real limit.
                </p>
              </div>
            )}

            {section.extra === "past" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="bf-past">Past events worth referencing</Label>
                <Textarea
                  id="bf-past"
                  rows={3}
                  value={(facts.pastEvents ?? []).join("\n")}
                  onChange={(e) => {
                    set(
                      "pastEvents",
                      e.target.value.split("\n").filter((l) => l.trim() !== ""),
                    );
                  }}
                  placeholder="One per line — no client names or private details"
                />
                <p className="text-[11px] text-muted-foreground">
                  Three to five, one per line. Specific texture beats generic claims.
                </p>
              </div>
            )}

            {section.extra === "never" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="bf-never">Never claim</Label>
                <Textarea
                  id="bf-never"
                  rows={2}
                  value={(facts.neverClaim ?? []).join("\n")}
                  onChange={(e) => {
                    set(
                      "neverClaim",
                      e.target.value.split("\n").filter((l) => l.trim() !== ""),
                    );
                  }}
                  placeholder={
                    "No health claims\nNo guaranteed pricing\nNo availability promises"
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Hard rules. One per line. Enforced in prompts and self-QA.
                </p>
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Anchor pages</h3>
        <p className="text-xs text-muted-foreground">
          Pages supporting articles should link to. URLs are optional until ready.
        </p>
        <div className="mt-3 space-y-2">
          {facts.anchorPages.map((a, idx) => (
            <div key={a.id} className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
              <Input
                value={a.label}
                onChange={(e) => {
                  const next = [...facts.anchorPages];
                  next[idx] = { ...a, label: e.target.value };
                  set("anchorPages", next);
                }}
                aria-label={`Anchor label ${a.id}`}
              />
              <Input
                value={a.url}
                onChange={(e) => {
                  const next = [...facts.anchorPages];
                  next[idx] = { ...a, url: e.target.value };
                  set("anchorPages", next);
                }}
                placeholder="https://…"
                aria-label={`Anchor URL ${a.id}`}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatChip({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular mt-0.5 text-lg font-semibold",
          tone === "good" && "text-success",
          tone === "warn" && "text-warning",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
