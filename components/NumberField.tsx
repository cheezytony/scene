"use client";

import { useState } from "react";
import { field } from "./ui";

const show = (n: number) => String(Number(n.toFixed(3)));

/**
 * Numeric input for precise values. Type any number (edits apply as soon as the text is a valid
 * number), or use ArrowUp/ArrowDown to nudge by `step` (Shift = x10, Alt = x0.1). While you are
 * typing, the text you typed is shown as-is; when you leave the field it shows the stored value,
 * which may differ if the editor clamped it.
 */
export default function NumberField({
  value,
  onCommit,
  step = 0.1,
  label,
  className = "w-20",
}: {
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? show(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const scale = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        setDraft(null);
        onCommit(Number((value + (e.key === "ArrowUp" ? 1 : -1) * step * scale).toFixed(6)));
      }}
      className={`${field} text-right tabular-nums ${className}`}
    />
  );
}
