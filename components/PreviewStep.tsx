"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Camera, Scene } from "@/lib/schema";
import { moveCamera, updateCamera } from "@/lib/edit";
import { sceneJson } from "@/lib/export";
import { cameraAt } from "@/lib/resolve";
import { computeBounds } from "@/lib/space";
import { NAV_HINTS, loadViewerSettings, saveViewerSettings, type ViewerSettings } from "@/lib/viewer-settings";
import CameraPanel from "./CameraPanel";
import EntityPanel from "./EntityPanel";
import TimelinePanel from "./TimelinePanel";
import TranscriptPanel from "./TranscriptPanel";
import ViewerStage from "./ViewerStage";
import ViewSettingsPanel from "./ViewSettingsPanel";
import { card, ghostBtn, primaryBtn, type EditFn, type ViewApi, type ViewPose } from "./ui";

const SceneViewer = dynamic(() => import("./SceneViewer"), { ssr: false });

type Tab = "timeline" | "transcript" | "entities" | "cameras" | "json";
const TABS: [Tab, string][] = [
  ["timeline", "Beats"],
  ["transcript", "Transcript"],
  ["entities", "Cast & props"],
  ["cameras", "Cameras"],
  ["json", "Raw data"],
];

/**
 * Step three: look around the scene, scrub through it, and nudge anything that isn't quite right.
 * Everything you change here can be undone.
 */
export default function PreviewStep({
  scene,
  edit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  violations,
  notice,
  onContinue,
}: {
  scene: Scene;
  edit: EditFn;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  violations: string[];
  notice: string | null;
  onContinue: () => void;
}) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(scene.entities[0]?.id ?? null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("timeline");
  const [viewMode, setViewMode] = useState<"orbit" | "shot">("orbit");
  const [cameraStep, setCameraStep] = useState(0.1);
  const [keepDirection, setKeepDirection] = useState(true);
  // The camera chosen to look through, valid only at the time it was chosen: moving the playhead
  // (or playing) goes back to the scripted cameras.
  const [pinned, setPinned] = useState<{ id: string; t: number } | null>(null);
  // Nothing rendered before a scene exists depends on this, so reading storage here is hydration-safe.
  const [viewer, setViewer] = useState<ViewerSettings>(loadViewerSettings);
  const tRef = useRef(0);

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

  const seek = useCallback((n: number) => {
    tRef.current = n;
    setT(n);
  }, []);
  const duration = scene.durationSec;

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

  const bounds = useMemo(() => computeBounds(scene, viewer.space), [scene, viewer.space]);
  // Functional update so quick successive changes compose; persistence follows state, not events.
  const updateViewer = (patch: Partial<ViewerSettings>) => setViewer((v) => ({ ...v, ...patch }));
  useEffect(() => saveViewerSettings(viewer), [viewer]);

  // Camera drag handles only work in the free orbit view (walk and fly use the mouse to look around).
  const handlesNotice =
    viewMode === "shot"
      ? { text: "The drag handles appear while you're exploring.", action: "Explore", run: () => setViewMode("orbit") }
      : viewer.movement !== "orbit"
        ? { text: "The drag handles need Orbit movement, and you're walking or flying.", action: "Use Orbit", run: () => updateViewer({ movement: "orbit" }) }
        : null;

  const pinnedCamera =
    pinned && Math.abs(t - pinned.t) < 1e-6 ? (scene.cameras.find((c) => c.id === pinned.id) ?? null) : null;

  /** Show the scene through exactly this camera (until the playhead moves). */
  function lookThrough(cam: Camera) {
    seek(cam.t);
    setPinned({ id: cam.id, t: cam.t });
    setViewMode("shot");
  }

  /** Choosing a camera views it: exploring moves the view to its position and direction; camera view looks through it. */
  function selectCamera(id: string | null) {
    setSelectedCameraId(id);
    const cam = id ? scene.cameras.find((c) => c.id === id) : undefined;
    if (!cam) return;
    if (viewMode === "shot") lookThrough(cam);
    else focusView({ position: cam.position, lookAt: cam.lookAt });
  }

  const currentCam = pinnedCamera ? { camera: pinnedCamera } : cameraAt(scene, t);
  const currentBeat = scene.timeline.find((b) => t >= b.startSec && t < b.endSec) ?? scene.timeline.at(-1);
  // Only stringify when the raw-data tab is open, and not on every playback frame.
  const jsonText = useMemo(() => (tab === "json" ? sceneJson(scene) : ""), [scene, tab]);

  return (
    <section className="rise flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-heading text-4xl tracking-tight sm:text-5xl">{scene.title || "Your scene"}</h1>
          <p className="mt-2 max-w-3xl text-white/55">
            {scene.logline || "Look around, scrub through, and nudge anything that isn't quite right."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)" className={`${ghostBtn} !px-4 !py-2`}>
            Undo
          </button>
          <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)" className={`${ghostBtn} !px-4 !py-2`}>
            Redo
          </button>
          <button onClick={onContinue} className={primaryBtn}>
            Looks good <span aria-hidden>→</span>
          </button>
        </div>
      </header>

      {notice && <p className="-mt-3 text-sm text-white/40">{notice}</p>}

      <ViewerStage
        controls={{
          playing,
          onTogglePlay: () => {
            if (!playing && t >= duration) seek(0);
            setPlaying((p) => !p);
          },
          t,
          duration,
          onSeek: seek,
          viewMode,
          onToggleView: () => setViewMode((m) => (m === "orbit" ? "shot" : "orbit")),
          canUseCameraView: scene.cameras.length > 0,
        }}
        hint={viewMode === "orbit" ? NAV_HINTS[viewer.movement] : "You're seeing through the scripted camera. Switch to Exploring to move around."}
      >
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
      </ViewerStage>

      {currentBeat && (
        <p className="-mt-2 text-center text-sm text-white/45">
          <span className="text-white/75">{currentBeat.title}</span>
          {currentBeat.location && ` · ${currentBeat.location}`}
          {currentBeat.mood && ` · ${currentBeat.mood}`}
          {currentCam && ` · ${currentCam.camera.label} (${currentCam.camera.shot.replaceAll("_", " ")})`}
        </p>
      )}

      {violations.length > 0 && (
        <div className="rounded-2xl bg-amber-400/10 px-5 py-4 text-sm text-amber-100/90">
          A couple of your limits couldn&apos;t quite be met, even after a second try:
          <ul className="mt-1 list-disc pl-5 text-amber-100/70">
            {violations.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      )}

      <ViewSettingsPanel viewer={viewer} onChange={updateViewer} />

      <div className={card}>
        <nav className="flex flex-wrap gap-1 border-b border-white/8 p-2 text-sm" aria-label="Edit the scene">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`rounded-full px-4 py-1.5 transition-colors ${tab === id ? "bg-white/12 text-white" : "text-white/55 hover:bg-white/6 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="max-h-[34rem] overflow-auto p-5 text-sm">
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
          {tab === "json" && <pre className="whitespace-pre-wrap break-all text-xs text-white/70">{jsonText}</pre>}
        </div>
      </div>

      <div className="flex justify-center pt-2">
        <button onClick={onContinue} className={primaryBtn}>
          Looks good, let&apos;s export <span aria-hidden>→</span>
        </button>
      </div>
    </section>
  );
}
