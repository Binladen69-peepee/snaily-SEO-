"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  totalPages,
  total,
  perPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function goTo(next: number) {
    const p = new URLSearchParams(params.toString());
    if (next <= 1) p.delete("page");
    else p.set("page", String(next));
    router.push(`/keywords?${p.toString()}`);
  }

  if (totalPages <= 1) {
    return (
      <p className="text-sm text-muted-foreground">
        {total} {total === 1 ? "keyword" : "keywords"}
      </p>
    );
  }

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Showing <span className="tabular font-medium text-foreground">{from}</span>
        –<span className="tabular font-medium text-foreground">{to}</span> of{" "}
        <span className="tabular font-medium text-foreground">{total}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => {
            goTo(page - 1);
          }}
        >
          <ChevronLeft />
          Previous
        </Button>

        <span className="tabular px-1 text-sm text-muted-foreground">
          {page} / {totalPages}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => {
            goTo(page + 1);
          }}
        >
          Next
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
