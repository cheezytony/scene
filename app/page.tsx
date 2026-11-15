"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Camera, Scene } from "@/lib/schema";
import { createHistory, historyReducer } from "@/lib/history";
import { moveCamera, updateCamera } from "@/lib/edit";
import CameraPanel from "@/components/CameraPanel";
import EntityPanel from "@/components/EntityPanel";
import TimelinePanel from "@/components/TimelinePanel";
import TranscriptPanel from "@/components/TranscriptPanel";
import type { EditFn, ViewApi, ViewPose } from "@/components/ui";
import { cameraAt } from "@/lib/resolve";
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
  // The scene lives in an undo history: every edit is undoable, and loading a scene starts fresh.
  const [history, dispatch] = useReducer(historyReducer<Scene | null>, createHistory<Scene | null>(null));
  const scene = history.present;
  const loadScene = useCallback((s: Scene) => dispatch({ type: "reset", present: s }), []);
  const edit = useCallback<EditFn>(
    (fn, key) => dispatch({ type: "edit", next: (s) => (s ? fn(s) : s), key, now: Date.now() }),
    [],
  );
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [cameraStep, setCameraStep] = useState(0.1);
  const [keepDirection, setKeepDirection] = useState(true);
  // The camera the user chose to look through, valid only at the time it was chosen: moving the
  // playhead (or playing) goes back to the scripted cameras.
  const [pinned, setPinned] = useState<{ id: string; t: number } | null>(null);
  const viewApi = useRef<ViewApi | null>(null);
  // A move requested before the 3D view finished loading, applied as soon as it is ready.
  const pendingFocus = useRef<ViewPose | null>(null);
  const focusView = useCallback((pose: ViewPose) => {
    if (viewApi.current) viewApi.current.focus(pose);
    else pendingFocus.current = pose;
  }, []);
  const registerView = useCallback((api: ViewApi | null) => {
    viewApi.current = api;
    if (api && pendingFocus.current) {
      api.focus(pendingFocus.current);
      pendingFocus.current = null;
    }
  }, []);
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
      loadScene(imported);
      setSelectedCameraId(null);
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
      let data: { scene?: Scene; violations?: string[]; error?: string; stats?: { totalMs?: number } } | null = null;
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
      loadScene(data.scene);
      setSelectedCameraId(null);
      setViolations(data.violations ?? []);
      if (data.stats?.totalMs) setNotice(`Generated in ${Math.round(data.stats.totalMs / 1000)} s.`);
      setViewMode("orbit");
      setSelectedId(data.scene.entities[0]?.id ?? null);
      seek(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      // Inside a text field, leave undo to the field itself.
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (k === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function download() {
    if (!scene) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(serializeScene(scene), null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scene.title.replace(/\W+/g, "_").toLowerCase() || "scene"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const bounds = useMemo(() => (scene ? computeBounds(scene, viewer.space) : null), [scene, viewer.space]);
  // Functional update so quick successive changes compose; persistence follows state, not events.
  const updateViewer = (patch: Partial<ViewerSettings>) => setViewer((v) => ({ ...v, ...patch }));
  useEffect(() => saveViewerSettings(viewer), [viewer]);
  // Camera drag handles only work in the free orbit view (walk/fly use the mouse to look around).
  const handlesNotice =
    viewMode === "shot"
      ? { text: "Drag handles are shown in the free view.", action: "Free view", run: () => setViewMode("orbit") }
      : viewer.movement !== "orbit"
        ? { text: "Drag handles need Orbit movement (you are in walk or fly).", action: "Use Orbit", run: () => updateViewer({ movement: "orbit" }) }
        : null;
  const pinnedCamera =
    scene && pinned && Math.abs(t - pinned.t) < 1e-6 ? (scene.cameras.find((c) => c.id === pinned.id) ?? null) : null;

  /** Show the scene through exactly this camera (until the playhead moves). */
  function lookThrough(cam: Camera) {
    seek(cam.t);
    setPinned({ id: cam.id, t: cam.t });
    setViewMode("shot");
  }

  /** Choosing a camera views it: in the free view the 3D view moves to its position and direction; in camera view it is looked through. */
  function selectCamera(id: string | null) {
    setSelectedCameraId(id);
    const cam = id && scene ? scene.cameras.find((c) => c.id === id) : undefined;
    if (!cam) return;
    if (viewMode === "shot") lookThrough(cam);
    else focusView({ position: cam.position, lookAt: cam.lookAt });
  }

  const currentCam = scene ? (pinnedCamera ? { camera: pinnedCamera } : cameraAt(scene, t)) : null;
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
            <>
              <button
                onClick={() => dispatch({ type: "undo" })}
                disabled={!history.past.length}
                title="Undo (Ctrl/Cmd+Z)"
                className="rounded border border-white/15 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-40"
              >
                Undo
              </button>
              <button
                onClick={() => dispatch({ type: "redo" })}
                disabled={!history.future.length}
                title="Redo (Ctrl/Cmd+Shift+Z)"
                className="rounded border border-white/15 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-40"
              >
                Redo
              </button>
              <button onClick={download} className="rounded border border-white/15 px-3 py-1 text-sm hover:bg-white/10">
                Export JSON
              </button>
            </>
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
                selectedCameraId={selectedCameraId}
                onSelectCamera={(id) => {
                  setSelectedCameraId(id);
                  setTab("cameras");
                }}
                onCameraChange={(id, patch: Partial<Camera>) =>
                  edit(
                    // Dragging the camera itself moves its look-at along (when "keeps direction" is on).
                    (s) => (patch.position && !patch.lookAt ? moveCamera(s, id, patch.position, keepDirection) : updateCamera(s, id, patch)),
                    `cam:${id}:${Object.keys(patch).join(",")}`,
                  )
                }
                pinnedCamera={pinnedCamera}
                onViewApi={registerView}
                editCameras={tab === "cameras"}
                snap={cameraStep}
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
            {tab === "timeline" && <TimelinePanel scene={scene} t={t} onSeek={seek} edit={edit} />}

            {tab === "transcript" && <TranscriptPanel scene={scene} t={t} onSeek={seek} edit={edit} />}

            {tab === "entities" && (
              <EntityPanel scene={scene} t={t} selectedId={selectedId} onSelect={setSelectedId} onSeek={seek} edit={edit} />
            )}

            {tab === "cameras" && (
              <CameraPanel
                scene={scene}
                t={t}
                selectedId={selectedCameraId}
                onSelect={selectCamera}
                onLookThrough={lookThrough}
                step={cameraStep}
                onStepChange={setCameraStep}
                edit={edit}
                handlesNotice={handlesNotice}
                keepDirection={keepDirection}
                onKeepDirectionChange={setKeepDirection}
                captureView={() => viewApi.current?.capture() ?? null}
                focusView={focusView}
              />
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
