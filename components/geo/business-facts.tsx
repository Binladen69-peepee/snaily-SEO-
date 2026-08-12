"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AnchorPage } from "@/lib/geo/config";

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

const FIELDS: {
  key: keyof Facts;
  label: string;
  hint: string;
  rows?: number;
}[] = [
  {
    key: "serviceArea",
    label: "Service area",
    hint: "Counties and regions actually served. Be specific — vague areas produce vague articles.",
    rows: 2,
  },
  {
    key: "travelPolicy",
    label: "Travel policy",
    hint: "What actually happens for an event outside that area.",
    rows: 2,
  },
  {
    key: "eventTypes",
    label: "Event types handled",
    hint: "Weddings, corporate, private parties, pop-up/cart bookings…",
    rows: 2,
  },
  {
    key: "dietaryHandling",
    label: "Dietary handling",
    hint: "Fully vegan events, mixed vegan/omnivore groups, common allergen accommodations.",
    rows: 2,
  },
  {
    key: "pricingLogic",
    label: "Pricing logic",
    hint: "What moves an estimate up or down. No hard numbers needed — the logic is what gets written.",
    rows: 3,
  },
  {
    key: "leadTime",
    label: "Booking / lead time",
    hint: "How far ahead you realistically need for different event sizes.",
    rows: 2,
  },
  {
    key: "consultingScope",
    label: "Consulting scope",
    hint: "What the engagement includes and who it is for.",
    rows: 2,
  },
];

/**
 * The grounding record for every GEO Lab draft.
 *
 * The spec calls hallucinated specifics the biggest risk in the feature, so
 * this is built first and the generator refuses to run until at least the
 * service area is filled in. Anything not recorded here cannot be stated as
 * fact in a draft.
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

  function set<K extends keyof Facts>(key: K, value: Facts[K]) {
    setFacts((f) => ({ ...f, [key]: value }));
  }

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
        toast.error(data.error ?? "Could not save");
        return;
      }
      onSaved(data.facts);
      toast.success("Business facts saved");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Business Facts</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The only facts drafts may rely on. Anything not recorded here is written
        qualitatively or left out — never invented. Service area is required;
        the rest makes drafts more specific and more citable.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
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

        <div className="space-y-1.5">
          <Label htmlFor="bf-guest-min">Guest counts</Label>
          <div className="flex items-center gap-2">
            <Input
              id="bf-guest-min"
              type="number"
              min={0}
              value={facts.guestMin ?? ""}
              onChange={(e) => {
                set("guestMin", e.target.value === "" ? null : Number(e.target.value));
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
                set("guestMax", e.target.value === "" ? null : Number(e.target.value));
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

        <div className="space-y-1.5">
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
            placeholder={"One per line — no client names or private details"}
          />
          <p className="text-[11px] text-muted-foreground">
            Three to five, one per line. Specific texture beats generic claims.
          </p>
        </div>

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
            placeholder={"No health claims\nNo guaranteed pricing\nNo availability promises"}
          />
          <p className="text-[11px] text-muted-foreground">
            Hard rules the generator is forbidden to break. One per line.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
          Save facts
        </Button>
      </div>
    </section>
  );
}
