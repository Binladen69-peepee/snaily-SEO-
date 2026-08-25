"use client";

import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";

export type SiteTermOption = {
  name: string;
  count: number;
};

/**
 * Files a draft against the site's real WordPress terms, using the same
 * searchable dropdown that is the face of the product.
 */
export function TermSelect({
  id,
  label,
  value,
  terms,
  onChange,
  max = 4,
  emptyHint,
}: {
  id: string;
  label: string;
  value: string[];
  terms: SiteTermOption[];
  onChange: (next: string[]) => void;
  max?: number;
  emptyHint: string;
}) {
  const options: SearchableOption[] = [
    ...terms.map((t) => ({ value: t.name, label: t.name })),
    ...value
      .filter((name) => !terms.some((t) => t.name === name))
      .map((name) => ({ value: name, label: name })),
  ];

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <SearchableSelect
        id={id}
        multiple
        max={max}
        size="sm"
        className="mt-1"
        value={value}
        options={options}
        placeholder={terms.length === 0 ? emptyHint : `Search ${label.toLowerCase()}`}
        emptyMessage={
          terms.length === 0 ? emptyHint : "No matching term on the site"
        }
        onChange={onChange}
        aria-label={label}
      />
      {value.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {value[0]} is primary
          {value.length > 1 ? ` · ${value.length} selected` : ""}
        </p>
      )}
    </div>
  );
}
