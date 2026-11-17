"use client";

import { PREVIEW_PROVIDERS, VIDEO_PROVIDERS, previewProvider, videoProvider, type ModelChoice, type VideoChoice } from "@/lib/catalog";
import { field } from "./ui";

export type Ready = Partial<Record<"anthropic" | "openai" | "google" | "replicate", boolean>> | null;

function Status({ env, ready }: { env: string; ready: boolean | undefined }) {
  if (ready === undefined) return null;
  return ready ? (
    <span className="text-emerald-200/60">ready</span>
  ) : (
    <span className="text-amber-200/70">needs {env} on the server</span>
  );
}

const num = (v: string) => (v === "" ? null : Math.max(0, Number(v)));

/** Pick the AI service and model that writes the previews (and the movie's shot prompts). */
export function PreviewModelPicker({ value, onChange, ready }: { value: ModelChoice; onChange: (v: ModelChoice) => void; ready: Ready }) {
  const prov = previewProvider(value.provider)!;
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="text-white/45">Service</span>
          <select
            value={value.provider}
            onChange={(e) => {
              const p = previewProvider(e.target.value)!;
              onChange({ provider: p.id, model: p.models[0]?.id ?? "" });
            }}
            className={field}
          >
            {PREVIEW_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-[2] flex-col gap-1 text-sm">
          <span className="text-white/45">Model</span>
          {prov.custom ? (
            <input value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} placeholder="model id" className={field} />
          ) : (
            <select value={value.model} onChange={(e) => onChange({ provider: value.provider, model: e.target.value })} className={field}>
              {prov.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · ${m.inPerM} in / ${m.outPerM} out per million
                </option>
              ))}
            </select>
          )}
        </label>
      </div>
      {prov.custom && (
        <div className="flex flex-wrap gap-3 text-sm">
          {(["inPerM", "outPerM"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-white/45">{k === "inPerM" ? "Input" : "Output"} price, $ per million tokens</span>
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={value[k] ?? ""}
                onChange={(e) => onChange({ ...value, [k]: num(e.target.value) })}
                placeholder="from their pricing page"
                className={`${field} w-56`}
              />
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-white/40">
        {prov.blurb} <Status env={prov.env} ready={ready?.[prov.id]} />
      </p>
    </div>
  );
}

/** Pick the AI service and model that renders the movie, and what it charges. */
export function VideoModelPicker({ value, onChange, ready }: { value: VideoChoice; onChange: (v: VideoChoice) => void; ready: Ready }) {
  const prov = videoProvider(value.provider)!;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="text-white/45">Service</span>
          <select
            value={value.provider}
            onChange={(e) => {
              const p = videoProvider(e.target.value)!;
              onChange({ ...value, provider: p.id, model: p.defaultModel, maxClipSec: p.maxClipSec });
            }}
            className={field}
          >
            {VIDEO_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-[2] flex-col gap-1 text-sm">
          <span className="text-white/45">Model</span>
          <input value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} placeholder={prov.modelHint} className={field} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-white/45">Price, $ per second of video</span>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={value.perSecond ?? ""}
            onChange={(e) => onChange({ ...value, perSecond: num(e.target.value) })}
            placeholder="from their pricing page"
            className={`${field} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-white/45">Longest clip, seconds</span>
          <input
            type="number"
            min={1}
            max={60}
            value={value.maxClipSec}
            onChange={(e) => onChange({ ...value, maxClipSec: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })}
            className={`${field} w-32`}
          />
        </label>
      </div>
      <p className="text-xs text-white/40">
        {prov.blurb} <Status env={prov.env} ready={ready?.[prov.id]} />
      </p>
    </div>
  );
}
