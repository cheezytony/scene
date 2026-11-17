"use client";

import { DEFAULT_LIMITS, LIMIT_FIELDS, limitConflicts, type Limits } from "@/lib/limits";
import { estimatePreview } from "@/lib/cost";
import { OUTPUT_INFO, normalizeOutputs, type OutputId } from "@/lib/outputs";
import { pricesFor } from "@/lib/catalog";
import type { Prefs } from "@/lib/prefs";
import CostPanel, { Money } from "./CostPanel";
import { PreviewModelPicker, type Ready } from "./ModelPicker";
import { card, field, ghostBtn, primaryBtn } from "./ui";

/** Step two: a few optional guardrails, then make the scene. */
export default function SettingsStep({
  script,
  prefs,
  onPrefs,
  ready,
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
  script: string;
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
  ready: Ready;
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
  const est = estimatePreview({ scriptChars: script.length, outputs: prefs.outputs, limits, model: prefs.preview });
  const price = pricesFor(prefs.preview);
  const rate = prefs.usdToNgn;

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

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-2xl">What should we make?</h2>
        <ul className={`${card} divide-y divide-white/8`}>
          {OUTPUT_INFO.map((o) => (
            <li key={o.id}>
              <label className={`flex items-start gap-4 px-5 py-4 ${o.locked ? "" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={prefs.outputs[o.id]}
                  disabled={o.locked}
                  onChange={(e) => onPrefs({ ...prefs, outputs: normalizeOutputs({ ...prefs.outputs, [o.id as OutputId]: e.target.checked }) })}
                  className="mt-1 h-4 w-4 accent-[#ece7df]"
                />
                <span>
                  <span className="block text-[15px]">{o.label}</span>
                  <span className="block text-sm text-white/40">{o.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-2xl">Who should make it?</h2>
        <div className={card}>
          <PreviewModelPicker value={prefs.preview} onChange={(preview) => onPrefs({ ...prefs, preview })} ready={ready} />
        </div>
      </div>

      <CostPanel
        title="Estimated cost of this scene"
        usd={est.usd}
        tokens={est.tokens}
        rate={rate}
        onRate={(usdToNgn) => onPrefs({ ...prefs, usdToNgn })}
        rows={[
          { label: "Your script", value: `about ${est.beats} beat${est.beats === 1 ? "" : "s"}` },
          { label: "Model calls", value: `~${est.calls}` },
          { label: "Likely", value: <Money usd={est.usd ? est.usd.expected : null} rate={rate} /> },
          ...(price.known ? [] : [{ label: "Tip", value: "enter the model's prices above to count it" }]),
        ]}
      />

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-2xl">Guardrails</h2>
        <p className="-mt-1 text-sm text-white/40">These apply to characters &amp; props{prefs.outputs.cast ? "." : ", which you haven't chosen above."}</p>
      <div className={`${card} divide-y divide-white/8 ${prefs.outputs.cast ? "" : "opacity-50"}`}>
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
