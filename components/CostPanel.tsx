"use client";

import { formatMoney, formatTokens } from "@/lib/cost";
import { field } from "./ui";

/** A figure in dollars and naira, as one number or a range. */
export function Money({ usd, rate }: { usd: number | { low: number; high: number } | null; rate: number }) {
  if (usd === null) return <span className="text-white/45">not counted</span>;
  const range = typeof usd === "object";
  const both = (v: number) => `${formatMoney(v, "USD", rate)} · ${formatMoney(v, "NGN", rate)}`;
  return <span>{range ? `${both(usd.low)} to ${both(usd.high)}` : both(usd)}</span>;
}

/** The estimate, kept honest: a range, the tokens behind it, and the exchange rate you can change. */
export default function CostPanel({
  title,
  rows,
  usd,
  tokens,
  rate,
  onRate,
  footnote,
}: {
  title: string;
  rows: { label: string; value: React.ReactNode }[];
  usd: { low: number; high: number } | null;
  tokens?: { input: number; output: number };
  rate: number;
  onRate: (n: number) => void;
  footnote?: string;
}) {
  return (
    <aside aria-label={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">{title}</p>
      <p className="mt-2 font-heading text-3xl leading-tight sm:text-4xl">
        <Money usd={usd} rate={rate} />
      </p>
      {tokens && (
        <p className="mt-1 text-sm text-white/50">
          about {formatTokens(tokens.input)} tokens in, {formatTokens(tokens.output)} out
        </p>
      )}
      {rows.length > 0 && (
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-white/50">{r.label}</dt>
              <dd className="text-right text-white/80">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-white/40">
        <span>{footnote ?? "An estimate, not a quote. Real runs vary with the script."}</span>
        <label className="flex items-center gap-2">
          ₦ per $1
          <input
            type="number"
            min={1}
            value={rate}
            onChange={(e) => onRate(Math.max(1, Number(e.target.value) || 1))}
            className={`${field} w-24 !py-1 text-right text-sm`}
          />
        </label>
      </div>
    </aside>
  );
}
