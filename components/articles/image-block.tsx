"use client";

import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

const SIZES = [
  { id: "small", label: "S", width: 320 },
  { id: "medium", label: "M", width: 480 },
  { id: "large", label: "L", width: 720 },
  { id: "full", label: "Full", width: null },
] as const;

export function ImageBlockView({
  node,
  updateAttributes,
  selected,
  deleteNode,
}: NodeViewProps) {
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const caption = String(node.attrs.title ?? "");
  const size = (node.attrs["data-size"] as string) || "large";
  const align = (node.attrs["data-align"] as string) || "center";
  const widthAttr = Number(node.attrs.width) || 0;
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const [draftAlt, setDraftAlt] = useState(alt);

  const widthCss =
    size === "full"
      ? "100%"
      : widthAttr > 0
        ? `${String(widthAttr)}px`
        : SIZES.find((s) => s.id === size)?.width
          ? `${String(SIZES.find((s) => s.id === size)!.width)}px`
          : "720px";

  function onHandleDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = widthAttr > 0 ? widthAttr : e.currentTarget.parentElement?.querySelector("img")?.clientWidth ?? 720;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHandleMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    const dir = align === "right" ? -1 : 1;
    const next = Math.max(160, Math.min(1200, Math.round(startW.current + delta * dir)));
    updateAttributes({
      width: next,
      "data-size": next <= 320 ? "small" : next <= 560 ? "medium" : next >= 1000 ? "full" : "large",
    });
  }

  function onHandleUp() {
    dragging.current = false;
  }

  return (
    <NodeViewWrapper
      as="figure"
      className={cn(
        "cs-image my-6",
        align === "left" && "cs-image-left",
        align === "right" && "cs-image-right",
        align === "center" && "cs-image-center",
        selected && "cs-image-selected",
      )}
      data-size={size}
    >
      <div className="relative inline-block max-w-full" style={{ width: widthCss }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="block h-auto w-full"
          draggable={false}
        />
        {selected && (
          <button
            type="button"
            aria-label="Resize image"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            className="absolute top-1/2 right-0 z-10 size-4 -translate-y-1/2 translate-x-1/2 cursor-ew-resize rounded-full border border-white bg-primary shadow"
          />
        )}
      </div>
      {selected && (
        <div
          className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm"
          contentEditable={false}
        >
          {SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                updateAttributes({
                  "data-size": s.id,
                  width: s.width,
                });
              }}
              className={cn(
                "rounded px-1.5 py-0.5",
                size === s.id ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {s.label}
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <button
            type="button"
            aria-label="Align left"
            onClick={() => {
              updateAttributes({ "data-align": "left" });
            }}
            className={cn("rounded p-1", align === "left" && "bg-accent")}
          >
            <AlignLeft className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Align centre"
            onClick={() => {
              updateAttributes({ "data-align": "center" });
            }}
            className={cn("rounded p-1", align === "center" && "bg-accent")}
          >
            <AlignCenter className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Align right"
            onClick={() => {
              updateAttributes({ "data-align": "right" });
            }}
            className={cn("rounded p-1", align === "right" && "bg-accent")}
          >
            <AlignRight className="size-3.5" />
          </button>
          <input
            value={draftAlt}
            onChange={(e) => {
              setDraftAlt(e.target.value);
            }}
            onBlur={() => {
              updateAttributes({ alt: draftAlt });
            }}
            placeholder="Alt text"
            aria-label="Image alt text"
            className="min-w-[8rem] flex-1 rounded border border-input bg-background px-1.5 py-0.5"
          />
          <input
            defaultValue={caption}
            onBlur={(e) => {
              updateAttributes({ title: e.target.value });
            }}
            placeholder="Caption"
            aria-label="Image caption"
            className="min-w-[8rem] flex-1 rounded border border-input bg-background px-1.5 py-0.5"
          />
          <button
            type="button"
            aria-label="Delete image"
            onClick={() => {
              deleteNode();
            }}
            className="rounded p-1 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
      {caption !== "" && !selected && (
        <figcaption className="cs-caption">{caption}</figcaption>
      )}
    </NodeViewWrapper>
  );
}
