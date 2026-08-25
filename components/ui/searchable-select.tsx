"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type SearchableOption = {
  value: string;
  label: string;
  /** Trailing glyph, shown after the label the way the brand dropdown does. */
  emoji?: string;
};

type Shared = {
  id?: string;
  options: SearchableOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  emptyMessage?: string;
  /** Hidden input name so a parent GET form still submits the value. */
  name?: string;
  "aria-label"?: string;
};

type SingleProps = Shared & {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
};

type MultipleProps = Shared & {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
  max?: number;
};

export type SearchableSelectProps = SingleProps | MultipleProps;

function optionText(option: SearchableOption): string {
  return option.emoji ? `${option.label} ${option.emoji}` : option.label;
}

function selectedLabel(
  options: SearchableOption[],
  value: string | string[],
  placeholder: string,
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return placeholder;
    const labels = value
      .map((v) => options.find((o) => o.value === v)?.label ?? v)
      .filter(Boolean);
    return labels.join(", ");
  }
  if (value === "") return placeholder;
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * The searchable dropdown that is this product's face: type to filter, a
 * check on the current row, chevron that flips when the list is open.
 */
export function SearchableSelect(props: SearchableSelectProps) {
  const {
    id,
    options,
    placeholder = "Select…",
    disabled = false,
    className,
    size = "md",
    emptyMessage = "Nothing matches",
    name,
  } = props;
  const multiple = props.multiple === true;
  const values = multiple ? props.value : props.value === "" ? [] : [props.value];

  const listId = useId();
  const inputId = id ?? `${listId}-input`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.emoji ?? ""} ${o.value}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setQuery("");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  function pick(option: SearchableOption) {
    if (props.multiple) {
      const current = props.value;
      const next = current.includes(option.value)
        ? current.filter((v) => v !== option.value)
        : props.max !== undefined && current.length >= props.max
          ? current
          : [...current, option.value];
      props.onChange(next);
      setQuery("");
      inputRef.current?.focus();
      return;
    }
    props.onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  const display = open
    ? query
    : selectedLabel(options, props.value, placeholder);
  const compact = size === "sm";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {name !== undefined &&
        (multiple ? (
          values.map((v) => (
            <input key={v} type="hidden" name={name} value={v} />
          ))
        ) : (
          <input type="hidden" name={name} value={props.value} />
        ))}

      <div
        className={cn(
          "flex w-full items-center rounded-xl border bg-background shadow-sm",
          compact ? "h-8" : "h-11",
          open
            ? "border-primary ring-2 ring-primary/20"
            : "border-input",
          disabled && "opacity-50",
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && filtered[active] ? `${listId}-${filtered[active].value}` : undefined
          }
          aria-label={props["aria-label"]}
          disabled={disabled}
          value={display}
          placeholder={placeholder}
          autoComplete="off"
          readOnly={!open}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onClick={() => {
            setOpen(true);
          }}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && open && filtered[active]) {
              e.preventDefault();
              pick(filtered[active]);
            }
          }}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
            compact ? "px-2.5" : "px-3.5",
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={open ? "Close list" : "Open list"}
          onClick={() => {
            setOpen((was) => !was);
            setQuery("");
            inputRef.current?.focus();
          }}
          className={cn(
            "shrink-0 text-muted-foreground",
            compact ? "px-2" : "px-3",
          )}
        >
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable={multiple || undefined}
          className="absolute z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-popover py-1.5 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</li>
          ) : (
            filtered.map((option, index) => {
              const chosen = values.includes(option.value);
              const highlighted = index === active;
              return (
                <li
                  key={option.value}
                  id={`${listId}-${option.value}`}
                  role="option"
                  aria-selected={chosen}
                  onMouseEnter={() => {
                    setActive(index);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(option);
                  }}
                  className={cn(
                    "mx-1 flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm",
                    chosen && "bg-primary/10 font-medium text-primary",
                    highlighted && !chosen && "bg-accent",
                  )}
                >
                  <span className="min-w-0 truncate">
                    {optionText(option)}
                  </span>
                  {chosen && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
