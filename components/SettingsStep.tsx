"use client";

import { DEFAULT_LIMITS, LIMIT_FIELDS, limitConflicts, type Limits } from "@/lib/limits";
import { card, field, ghostBtn, primaryBtn } from "./ui";

/** Step two: a few optional guardrails, then make the scene. */
export default function SettingsStep({
  limits,
  onLimits,
  accessCode,
  onAccessCode,
  error,
  hasScene,
  onBack,
  onBackToScene,
  onCreate,
}: {
  limits: Limits;
  onLimits: (l: Limits) => void;
  accessCode: string;
  onAccessCode: (s: string) => void;
  error: { title: string; detail: string } | null;
  hasScene: boolean;
  onBack: () => void;
  onBackToScene: () => void;
  onCreate: () => void;
}) {
  const conflicts = limitConflicts(limits);

  return (
    <section className="rise mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="font-heading text-5xl tracking-tight sm:text-6xl">A few gentle tweaks.</h1>
        <p className="mx-auto max-w-xl text-lg text-white/55">
          Everything here is optional, and the defaults work nicely. Leave a box empty for no limit.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-2xl bg-amber-400/10 px-5 py-4 text-amber-50/90">
          <p className="font-heading text-2xl">{error.title}</p>
          <p className="mt-1 text-sm text-amber-100/70">{error.detail} Nothing is lost; try again whenever you like.</p>
        </div>
      )}

      {hasScene && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 px-5 py-3 text-sm text-white/60">
          <span>You have a scene open. Creating a new one will replace it.</span>
          <button onClick={onBackToScene} className="text-white/80 underline underline-offset-4 hover:text-white">
            Go back to it
          </button>
        </div>
      )}

      <div className={`${card} divide-y divide-white/8`}>
        {LIMIT_FIELDS.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-6 px-5 py-4">
            <span>
              <span className="block text-[15px]">{f.label}</span>
              <span className="block text-sm text-white/40">{f.hint}</span>
            </span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="any"
              value={limits[f.key] ?? ""}
              onChange={(e) =>
                onLimits({ ...limits, [f.key]: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })
              }
              className={`${field} w-20 text-right text-sm`}
            />
          </label>
        ))}
      </div>
      {conflicts.map((c) => (
        <p key={c} className="-mt-4 rounded-xl bg-amber-400/10 px-4 py-3 text-sm text-amber-100/90">
          {c} Loosen one of them and we&apos;re good.
        </p>
      ))}
      <div className="-mt-4 flex justify-end">
        <button onClick={() => onLimits(DEFAULT_LIMITS)} className="text-sm text-white/40 underline-offset-4 hover:text-white/70 hover:underline">
          Back to the defaults
        </button>
      </div>

      <label className={`${card} flex items-center justify-between gap-6 px-5 py-4`}>
        <span>
          <span className="block text-[15px]">Access code</span>
          <span className="block text-sm text-white/40">Only if this site asked you for one.</span>
        </span>
        <input
          type="password"
          value={accessCode}
          onChange={(e) => onAccessCode(e.target.value)}
          autoComplete="off"
          placeholder="optional"
          className={`${field} w-44 text-sm`}
        />
      </label>

      <div className="flex items-center justify-between">
        <button onClick={onBack} className={ghostBtn}>
          <span aria-hidden>←</span> Back
        </button>
        <button onClick={onCreate} disabled={conflicts.length > 0} className={primaryBtn}>
          Create my scene
        </button>
      </div>
    </section>
  );
}
