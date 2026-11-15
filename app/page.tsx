"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Control, Scene } from "@/lib/schema";
import { activeKeyframe, cameraAt, keyframesFor, variationsAt, worldPose } from "@/lib/resolve";
import { DEFAULT_LIMITS, LIMIT_FIELDS, limitConflicts, type Limits } from "@/lib/limits";
import { SCHEMA_VERSION, SceneFormatError, migrateScene, serializeScene } from "@/lib/migrate";
import { computeBounds } from "@/lib/space";
import {
  DEFAULT_VIEWER_SETTINGS,
  NAV_HINTS,
  loadViewerSettings,
  saveViewerSettings,
  type ViewerSettings,
} from "@/lib/viewer-settings";
import { SAMPLE_SCRIPT } from "@/lib/sample";

const SceneViewer = dynamic(() => import("@/components/SceneViewer"), { ssr: false });

type Tab = "timeline" | "transcript" | "entities" | "cameras" | "json";

const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

export default function Home() {
  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [scene, setScene] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("timeline");
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [violations, setViolations] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"orbit" | "shot">("orbit");
  const [accessCode, setAccessCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Nothing rendered before a scene exists depends on these, so reading storage here is hydration-safe.
  const [viewer, setViewer] = useState<ViewerSettings>(loadViewerSettings);
  const fileInput = useRef<HTMLInputElement>(null);
  const tRef = useRef(0);

  const seek = useCallback((n: number) => {
    tRef.current = n;
    setT(n);
  }, []);

  const duration = scene?.durationSec ?? 0;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const n = Math.min(tRef.current + (now - last) / 1000, duration);
      last = now;
      tRef.current = n;
      setT(n);
      if (n >= duration) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  /** Load a previously exported scene file, upgrading older formats. */
  async function importFile(file: File) {
    try {
      const { scene: imported, fromVersion } = migrateScene(JSON.parse(await file.text()));
      setScene(imported);
      setViolations([]);
      setViewMode("orbit");
      setSelectedId(imported.entities[0]?.id ?? null);
      setPlaying(false);
      seek(0);
      setError(null);
      setNotice(
        fromVersion < SCHEMA_VERSION
          ? `Imported "${file.name}", upgraded from scene format v${fromVersion} to v${SCHEMA_VERSION}.`
          : `Imported "${file.name}".`,
      );
    } catch (e) {
      setNotice(null);
      setError(
        e instanceof SceneFormatError
          ? e.message
          : e instanceof SyntaxError
            ? "That file is not valid JSON."
            : "Could not import that file.",
      );
    }
  }

  async function analyze() {
    setLoading(true);
    setError(null);
    setNotice(null);
    setPlaying(false);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) },
        body: JSON.stringify({ script, limits }),
      });
      // Platform errors (timeouts, body limits) are not JSON, so parse defensively.
      let data: { scene?: Scene; violations?: string[]; error?: string } | null = null;
      try {
        data = JSON.parse(await res.text());
      } catch {}
      if (!res.ok) {
        throw new Error(
          data?.error ??
            (res.status === 504 || res.status === 408
              ? "The request timed out. Try a shorter excerpt."
              : res.status === 413
                ? "The script is too large for the server."
                : `Server error (${res.status}).`),
        );
      }
      if (!data?.scene) throw new Error("Unexpected response from the server.");
      setScene(data.scene);
      setViolations(data.violations ?? []);
      setViewMode("orbit");
      setSelectedId(data.scene.entities[0]?.id ?? null);
      seek(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  /** Edit a variation on the keyframe currently in effect for an entity. */
  function setVariation(entityId: string, key: string, value: string) {
    setScene((s) => {
      if (!s) return s;
      const kf = activeKeyframe(keyframesFor(s, entityId), tRef.current);
      if (!kf) return s;
      return {
        ...s,
        keyframes: s.keyframes.map((k) =>
          k.id !== kf.id
            ? k
            : {
                ...k,
                variations: k.variations.some((v) => v.key === key)
                  ? k.variations.map((v) => (v.key === key ? { ...v, value } : v))
                  : [...k.variations, { key, value }],
              },
        ),
      };
    });
  }

  function download() {
    if (!scene) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(serializeScene(scene), null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scene.title.replace(/\W+/g, "_").toLowerCase() || "scene"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selected = scene?.entities.find((e) => e.id === selectedId) ?? null;
  const bounds = useMemo(() => (scene ? computeBounds(scene, viewer.space) : null), [scene, viewer.space]);
  // Functional update so quick successive changes compose; persistence follows state, not events.
  const updateViewer = (patch: Partial<ViewerSettings>) => setViewer((v) => ({ ...v, ...patch }));
  useEffect(() => saveViewerSettings(viewer), [viewer]);
  const currentCam = scene ? cameraAt(scene, t) : null;
  const conflicts = limitConflicts(limits);
  // Only stringify when the JSON tab is open, and not on every playback frame.
  const jsonText = useMemo(() => (scene && tab === "json" ? JSON.stringify(serializeScene(scene), null, 2) : ""), [scene, tab]);
  const currentBeat =scene?.timeline.find((b) => t >= b.startSec && t < b.endSec) ?? scene?.timeline.at(-1);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Scene · script to 3D breakdown</h1>
        <div className="flex gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = ""; // allow re-importing the same file
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="rounded border border-white/15 px-3 py-1 text-sm hover:bg-white/10"
          >
            Import JSON
          </button>
          {scene && (
            <button onClick={download} className="rounded border border-white/15 px-3 py-1 text-sm hover:bg-white/10">
              Export JSON
            </button>
          )}
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-2">
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            spellCheck={false}
            className="h-72 w-full resize-y rounded border border-white/15 bg-white/5 p-3 font-mono text-xs lg:h-[28rem]"
            placeholder="Paste a movie script…"
          />
          <details className="rounded border border-white/15 p-2 text-xs">
            <summary className="cursor-pointer text-white/80">Scene limits (blank = no limit)</summary>
            <div className="mt-2 flex flex-col gap-2">
              {LIMIT_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-2" title={f.hint}>
                  <span className="text-white/70">{f.label}</span>
                  <input
                    type="number"
                    min={0}
                    value={limits[f.key] ?? ""}
                    onChange={(e) =>
                      setLimits((l) => ({ ...l, [f.key]: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) }))
                    }
                    className="w-16 rounded border border-white/15 bg-neutral-900 px-2 py-1 text-right"
                  />
                </label>
              ))}
              {conflicts.map((c) => (
                <p key={c} className="text-amber-300">
                  {c}
                </p>
              ))}
              <button onClick={() => setLimits(DEFAULT_LIMITS)} className="self-start text-white/50 underline">
                Reset to defaults
              </button>
            </div>
          </details>
          <input
            type="password"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            placeholder="Access code (if the server requires one)"
            autoComplete="off"
            className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-xs"
          />
          <button
            onClick={analyze}
            disabled={loading || script.trim().length < 20 || conflicts.length > 0}
            className="rounded bg-indigo-500 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Analyzing script… (can take a minute or two)" : "Generate scene breakdown"}
          </button>
          {error && <p className="rounded bg-red-500/15 p-2 text-sm text-red-300">{error}</p>}
          {notice && <p className="rounded bg-emerald-500/15 p-2 text-sm text-emerald-300">{notice}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <div className="h-72 overflow-hidden rounded border border-white/15 lg:h-[28rem]">
            {scene && bounds ? (
              <SceneViewer
                scene={scene}
                t={t}
                selectedId={selectedId}
                onSelect={setSelectedId}
                viewMode={viewMode}
                settings={viewer}
                bounds={bounds}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/50">
                Your 3D scene appears here
              </div>
            )}
          </div>
          {scene && (
            <div className="flex items-center gap-3 text-sm">
              <button
                onClick={() => {
                  if (!playing && t >= duration) seek(0);
                  setPlaying((p) => !p);
                }}
                className="w-16 rounded border border-white/15 py-1 hover:bg-white/10"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={t}
                onChange={(e) => seek(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-24 text-right tabular-nums">
                {fmt(t)} / {fmt(duration)}
              </span>
              <button
                onClick={() => setViewMode((m) => (m === "orbit" ? "shot" : "orbit"))}
                disabled={!scene.cameras.length}
                className="rounded border border-white/15 px-2 py-1 hover:bg-white/10 disabled:opacity-40"
              >
                {viewMode === "orbit" ? "View: free" : "View: camera"}
              </button>
            </div>
          )}
          {scene && (
            <details className="rounded border border-white/15 p-2 text-xs">
              <summary className="cursor-pointer text-white/80">
                View settings
                <span className="ml-2 text-white/40">
                  {viewer.movement} · {viewer.boundaries ? "bounded" : "unbounded"}
                </span>
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Setting label="Movement">
                  <Segmented
                    value={viewer.movement}
                    onChange={(movement) => updateViewer({ movement })}
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
                    onChange={(speed) => updateViewer({ speed })}
                    options={[
                      ["slow", "Slow"],
                      ["normal", "Normal"],
                      ["fast", "Fast"],
                    ]}
                  />
                </Setting>
                <Setting label="Space around the scene">
                  <Segmented
                    value={viewer.space}
                    onChange={(space) => updateViewer({ space })}
                    options={[
                      ["tight", "Tight"],
                      ["auto", "Auto"],
                      ["wide", "Wide"],
                    ]}
                  />
                </Setting>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5" title="Keep the camera inside the scene's space">
                    <input
                      type="checkbox"
                      checked={viewer.boundaries}
                      onChange={(e) => updateViewer({ boundaries: e.target.checked })}
                    />
                    Boundaries
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={viewer.grid} onChange={(e) => updateViewer({ grid: e.target.checked })} />
                    Grid
                  </label>
                  <button
                    onClick={() => updateViewer(DEFAULT_VIEWER_SETTINGS)}
                    className="ml-auto text-white/50 underline"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </details>
          )}
          {scene && (
            <p className="text-xs text-white/40">
              {viewMode === "orbit" ? NAV_HINTS[viewer.movement] : "Camera view follows the scripted camera. Switch to free view to move around."}
            </p>
          )}
          {scene && currentBeat && (
            <p className="text-xs text-white/60">
              <b className="text-white/80">{currentBeat.title}</b> · {currentBeat.location} · {currentBeat.mood}
              {currentCam && (
                <>
                  {" "}
                  · camera: {currentCam.camera.label} ({currentCam.camera.shot.replaceAll("_", " ")})
                </>
              )}
            </p>
          )}
          {violations.length > 0 && (
            <div className="rounded bg-amber-500/15 p-2 text-xs text-amber-200">
              Some limits could not be met after a retry:
              <ul className="list-disc pl-5">
                {violations.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {scene && (
        <section className="rounded border border-white/15">
          <nav className="flex gap-1 border-b border-white/15 p-1 text-sm">
            {(["timeline", "transcript", "entities", "cameras", "json"] as Tab[]).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded px-3 py-1 capitalize ${tab === k ? "bg-white/15" : "hover:bg-white/10"}`}
              >
                {k}
              </button>
            ))}
          </nav>

          <div className="max-h-[28rem] overflow-auto p-3 text-sm">
            {tab === "timeline" && (
              <ol className="flex flex-col gap-2">
                {scene.timeline.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => seek(b.startSec)}
                      className={`w-full rounded border p-2 text-left ${
                        currentBeat?.id === b.id ? "border-indigo-400" : "border-white/10 hover:bg-white/5"
                      }`}
                    >
                      <div className="flex justify-between">
                        <b>{b.title}</b>
                        <span className="tabular-nums text-white/50">
                          {fmt(b.startSec)}–{fmt(b.endSec)}
                        </span>
                      </div>
                      <div className="text-xs text-white/50">
                        {b.location} · {b.mood}
                      </div>
                      <p className="mt-1 text-white/80">{b.summary}</p>
                    </button>
                  </li>
                ))}
              </ol>
            )}

            {tab === "transcript" && (
              <ul className="flex flex-col gap-1">
                {scene.transcript.map((l) => {
                  const active = t >= l.startSec && t < l.endSec;
                  return (
                    <li key={l.id}>
                      <button
                        onClick={() => seek(l.startSec)}
                        className={`flex w-full gap-3 rounded p-1.5 text-left ${active ? "bg-indigo-500/25" : "hover:bg-white/5"}`}
                      >
                        <span className="w-10 shrink-0 tabular-nums text-white/40">{fmt(l.startSec)}</span>
                        <span className="w-20 shrink-0 text-xs uppercase text-white/50">
                          {l.kind === "dialogue" ? l.speaker : l.kind}
                        </span>
                        <span className={l.kind === "dialogue" ? "" : "italic text-white/70"}>{l.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {tab === "entities" && (
              <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                <ul className="flex flex-col gap-1">
                  {scene.entities.map((e) => (
                    <li key={e.id}>
                      <button
                        onClick={() => setSelectedId(e.id)}
                        className={`w-full rounded px-2 py-1 text-left ${
                          e.id === selectedId ? "bg-white/15" : "hover:bg-white/5"
                        }`}
                      >
                        {e.name}
                        <span className="ml-2 text-xs text-white/40">
                          {e.kind} · {e.importance.replaceAll("_", " ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {selected && <Inspector scene={scene} entityId={selected.id} t={t} onSeek={seek} onChange={setVariation} />}
              </div>
            )}

            {tab === "cameras" && (
              <ul className="flex flex-col gap-1">
                {scene.cameras.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        seek(c.t);
                        setViewMode("shot");
                      }}
                      className={`w-full rounded border p-2 text-left ${
                        currentCam?.camera.id === c.id ? "border-amber-400" : "border-white/10 hover:bg-white/5"
                      }`}
                    >
                      <div className="flex justify-between">
                        <b>{c.label}</b>
                        <span className="tabular-nums text-white/50">{fmt(c.t)}</span>
                      </div>
                      <div className="text-xs text-white/50">
                        {c.shot.replaceAll("_", " ")} · {c.movement} · fov {Math.round(c.fov)}° · at ({c.position.x.toFixed(1)},{" "}
                        {c.position.y.toFixed(1)}, {c.position.z.toFixed(1)}) → ({c.lookAt.x.toFixed(1)}, {c.lookAt.y.toFixed(1)},{" "}
                        {c.lookAt.z.toFixed(1)})
                      </div>
                      {c.note && <p className="mt-1 text-white/70">{c.note}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {tab === "json" && (
              <pre className="whitespace-pre-wrap break-all text-xs text-white/80">{jsonText}</pre>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-white/50">{label}</span>
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
    <div className="inline-flex self-start overflow-hidden rounded border border-white/15">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`px-3 py-1 ${value === v ? "bg-white/20" : "hover:bg-white/10"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Inspector({
  scene,
  entityId,
  t,
  onSeek,
  onChange,
}: {
  scene: Scene;
  entityId: string;
  t: number;
  onSeek: (n: number) => void;
  onChange: (entityId: string, key: string, value: string) => void;
}) {
  const entity = scene.entities.find((e) => e.id === entityId)!;
  const pose = useMemo(() => worldPose(scene, entity, t), [scene, entity, t]);
  const vars = useMemo(() => variationsAt(scene, entity, t), [scene, entity, t]);
  const kfs = keyframesFor(scene, entityId);
  const r = (n: number) => n.toFixed(2);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-white/80">{entity.description}</p>
      {!pose && <p className="text-xs text-white/50">Not in the scene at {fmt(t)}.</p>}
      {pose && (
        <div className="grid grid-cols-2 gap-2 text-xs text-white/70 sm:grid-cols-4">
          <div>state: <b className="text-white">{pose.state.replaceAll("_", " ")}</b></div>
          {pose.relation !== "none" && (
            <div className="sm:col-span-4">
              {pose.relation} <b className="text-white">{scene.entities.find((e) => e.id === pose.parentId)?.name ?? pose.parentId}</b>
            </div>
          )}
          <div>x {r(pose.position.x)}</div>
          <div>y {r(pose.position.y)}</div>
          <div>z {r(pose.position.z)}</div>
        </div>
      )}
      <div>
        <h3 className="mb-1 text-xs uppercase text-white/50">
          Controls <span className="normal-case">(edits apply to the keyframe in effect at {fmt(t)})</span>
        </h3>
        <div className="flex flex-col gap-2">
          {entity.controls.map((c) => (
            <ControlInput
              key={c.key}
              control={c}
              value={vars[c.key] ?? c.defaultValue}
              onChange={(v) => onChange(entityId, c.key, v)}
            />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-xs uppercase text-white/50">Keyframes</h3>
        <ul className="flex flex-wrap gap-1">
          {kfs.map((k) => (
            <li key={k.id}>
              <button
                onClick={() => onSeek(k.t)}
                title={k.note}
                className={`rounded border px-2 py-0.5 text-xs ${
                  pose?.keyframeId === k.id ? "border-indigo-400" : "border-white/15 hover:bg-white/10"
                }`}
              >
                {fmt(k.t)} · {k.state.replaceAll("_", " ")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ControlInput({
  control: c,
  value,
  onChange,
}: {
  control: Control;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-xs">
      <span className="w-36 shrink-0 text-white/70">{c.label}</span>
      {c.type === "choice" && (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded border border-white/15 bg-neutral-900 px-2 py-1">
          {[...new Set([...c.options, value])].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )}
      {c.type === "slider" && (
        <>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={(c.max - c.min) / 100 || 0.1}
            value={Number(value) || 0}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1"
          />
          <span className="w-10 text-right tabular-nums">{Number(value).toFixed(1)}</span>
        </>
      )}
      {c.type === "toggle" && (
        <input type="checkbox" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />
      )}
    </label>
  );
}
