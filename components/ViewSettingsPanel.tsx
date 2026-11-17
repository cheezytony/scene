"use client";

import { DEFAULT_VIEWER_SETTINGS, type ViewerSettings } from "@/lib/viewer-settings";

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-white/45">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex self-start overflow-hidden rounded-full border border-white/12 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`rounded-full px-3.5 py-1 text-xs transition-colors ${value === v ? "bg-white/15 text-white" : "text-white/60 hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** How you move around the scene: a quiet drawer under the stage. */
export default function ViewSettingsPanel({
  viewer,
  onChange,
}: {
  viewer: ViewerSettings;
  onChange: (patch: Partial<ViewerSettings>) => void;
}) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between text-white/80">
        <span>How you look around</span>
        <span className="text-xs text-white/40">
          {viewer.movement} · {viewer.boundaries ? "kept inside" : "free to roam"}
        </span>
      </summary>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Setting label="Movement">
          <Segmented
            value={viewer.movement}
            onChange={(movement) => onChange({ movement })}
            options={[
              ["orbit", "Orbit"],
              ["walk", "Walk"],
              ["fly", "Fly"],
            ]}
          />
        </Setting>
        <Setting label="Speed (walk and fly)">
          <Segmented
            value={viewer.speed}
            onChange={(speed) => onChange({ speed })}
            options={[
              ["slow", "Slow"],
              ["normal", "Normal"],
              ["fast", "Fast"],
            ]}
          />
        </Setting>
        <Setting label="Room around the scene">
          <Segmented
            value={viewer.space}
            onChange={(space) => onChange({ space })}
            options={[
              ["tight", "Snug"],
              ["auto", "Auto"],
              ["wide", "Roomy"],
            ]}
          />
        </Setting>
        <div className="flex flex-col justify-end gap-2 text-xs text-white/70">
          <label className="flex items-center gap-2" title="Keeps the view inside the space around the scene">
            <input type="checkbox" checked={viewer.boundaries} onChange={(e) => onChange({ boundaries: e.target.checked })} />
            Keep me inside the set
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={viewer.grid} onChange={(e) => onChange({ grid: e.target.checked })} />
            Show the floor grid
          </label>
          <button onClick={() => onChange(DEFAULT_VIEWER_SETTINGS)} className="self-start text-white/40 underline-offset-2 hover:text-white/70 hover:underline">
            Back to the defaults
          </button>
        </div>
      </div>
    </details>
  );
}
