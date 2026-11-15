"use client";

import type { Camera, Scene, Vec3 } from "@/lib/schema";
import {
  addCamera,
  cameraDirection,
  cameraIssues,
  deleteCamera,
  moveCamera,
  nextId,
  setCameraDirection,
  updateCamera,
} from "@/lib/edit";
import { worldPose } from "@/lib/resolve";
import NumberField from "./NumberField";
import { btn, field, fmtTime, labelText, type EditFn, type ViewPose } from "./ui";

const SHOTS: Camera["shot"][] = ["wide", "medium", "close_up", "over_shoulder", "overhead", "pov", "tracking"];
const MOVES: Camera["movement"][] = ["static", "pan", "dolly", "crane", "handheld", "zoom"];
export const STEPS = [0.01, 0.1, 0.25, 0.5, 1];
const AXES = ["x", "y", "z"] as const;

/**
 * Cameras: add, delete, duplicate and edit with exact numeric 3D values. In the viewer, the selected
 * camera also has drag handles (position, and a look-at point) that write to the same fields.
 */
export default function CameraPanel({
  scene,
  t,
  selectedId,
  onSelect,
  onLookThrough,
  step,
  onStepChange,
  edit,
  handlesNotice,
  keepDirection,
  onKeepDirectionChange,
  captureView,
  focusView,
}: {
  scene: Scene;
  t: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLookThrough: (c: Camera) => void;
  step: number;
  onStepChange: (n: number) => void;
  edit: EditFn;
  /** Set when the viewer cannot show drag handles right now, with a way to fix it. */
  handlesNotice?: { text: string; action: string; run: () => void } | null;
  /** Moving a camera (numbers or drag handle) also moves its look-at point, so it keeps facing the same way. */
  keepDirection: boolean;
  onKeepDirectionChange: (keep: boolean) => void;
  /** Where the 3D viewer is looking right now, or null if it is not available. */
  captureView: () => (ViewPose & { fov: number }) | null;
  /** Move the 3D viewer to a position and direction. */
  focusView: (pose: ViewPose) => void;
}) {
  const cam = scene.cameras.find((c) => c.id === selectedId) ?? null;

  /** New cameras record where the viewer is looking, so the direction you framed is what gets saved. */
  function addFromView() {
    const view = captureView();
    add(view ? { position: view.position, lookAt: view.lookAt } : {});
  }

  function setFromView(c: Camera) {
    const view = captureView();
    if (view) edit((s) => updateCamera(s, c.id, { position: view.position, lookAt: view.lookAt }));
  }

  function add(init: Partial<Camera> = {}, at = t) {
    const id = nextId("c", scene.cameras.map((c) => c.id));
    edit((s) => addCamera(s, at, { id, ...init }));
    onSelect(id);
  }

  function aimAtTarget(c: Camera) {
    const target = scene.entities.find((e) => e.id === c.targetEntityId);
    const pose = target && (worldPose(scene, target, c.t) ?? worldPose(scene, target, t));
    if (!target || !pose) return;
    edit((s) => updateCamera(s, c.id, { lookAt: { x: pose.position.x, y: pose.position.y + target.size.y * 0.6, z: pose.position.z } }));
  }

  const vec = (c: Camera, which: "position" | "lookAt", label: string) => (
    <div className="flex flex-col gap-1">
      <span className={labelText}>{label}</span>
      <div className="flex gap-1.5">
        {AXES.map((axis) => (
          <label key={axis} className="flex items-center gap-1 text-xs text-white/50">
            {axis.toUpperCase()}
            <NumberField
              label={`${c.label} ${label} ${axis}`}
              value={c[which][axis]}
              step={step}
              className="w-[4.5rem]"
              onCommit={(n) =>
                edit(
                  (s) =>
                    which === "position"
                      ? moveCamera(s, c.id, { ...c.position, [axis]: n } as Vec3, keepDirection)
                      : updateCamera(s, c.id, { lookAt: { ...c.lookAt, [axis]: n } as Vec3 }),
                  `cam:${c.id}:${which}`,
                )
              }
            />
          </label>
        ))}
      </div>
    </div>
  );

  const direction = cam ? cameraDirection(cam) : { yaw: 0, pitch: 0, distance: 0 };

  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]">
      <div className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1">
          {scene.cameras.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  onSelect(c.id);
                }}
                className={`w-full rounded border px-2 py-1 text-left ${c.id === selectedId ? "border-amber-400" : "border-white/10 hover:bg-white/5"}`}
              >
                <span className="flex justify-between gap-2">
                  <b className="truncate">{c.label || c.id}</b>
                  <span className="tabular-nums text-white/50">{fmtTime(c.t)}</span>
                </span>
                <span className="text-xs text-white/40">
                  {c.shot.replaceAll("_", " ")} · {c.movement}
                </span>
              </button>
            </li>
          ))}
          {scene.cameras.length === 0 && <li className="text-xs text-white/40">No cameras yet.</li>}
        </ul>
        <button
          className={btn}
          onClick={addFromView}
          title="New camera at the playhead, placed where the 3D view is now and facing the way it faces"
        >
          + Add camera from view at {fmtTime(t)}
        </button>
        <label className="flex items-center gap-2 text-xs text-white/60" title="Step for the arrow keys in number fields, and snapping for the drag handles">
          Step / snap
          <select className={field} value={step} onChange={(e) => onStepChange(Number(e.target.value))}>
            {STEPS.map((s) => (
              <option key={s} value={s}>
                {s} m
              </option>
            ))}
          </select>
        </label>
      </div>

      {cam ? (
        // Keyed so switching cameras starts every field fresh (no typed text carried over).
        <div key={cam.id} className="flex flex-col gap-3">
          {handlesNotice && (
            <p className="flex flex-wrap items-center gap-2 rounded bg-sky-500/15 p-2 text-xs text-sky-200">
              {handlesNotice.text}
              <button className={btn} onClick={handlesNotice.run}>
                {handlesNotice.action}
              </button>
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className={labelText}>Name</span>
              <input className={field} value={cam.label} onChange={(e) => edit((s) => updateCamera(s, cam.id, { label: e.target.value }), `cam:${cam.id}:label`)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelText}>Shot</span>
              <select className={field} value={cam.shot} onChange={(e) => edit((s) => updateCamera(s, cam.id, { shot: e.target.value as Camera["shot"] }))}>
                {SHOTS.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelText}>Movement</span>
              <select className={field} value={cam.movement} onChange={(e) => edit((s) => updateCamera(s, cam.id, { movement: e.target.value as Camera["movement"] }))}>
                {MOVES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className={labelText}>Starts at (s)</span>
              <NumberField label="Camera start time" value={cam.t} step={0.5} onCommit={(n) => edit((s) => updateCamera(s, cam.id, { t: n }), `cam:${cam.id}:t`)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelText}>Field of view (°)</span>
              <NumberField label="Camera field of view" value={cam.fov} step={1} onCommit={(n) => edit((s) => updateCamera(s, cam.id, { fov: n }), `cam:${cam.id}:fov`)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelText}>Beat</span>
              <select className={field} value={cam.beatId} onChange={(e) => edit((s) => updateCamera(s, cam.id, { beatId: e.target.value }))}>
                {!scene.timeline.some((b) => b.id === cam.beatId) && <option value={cam.beatId}>(none)</option>}
                {scene.timeline.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title || b.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelText}>Frames</span>
              <select className={field} value={cam.targetEntityId} onChange={(e) => edit((s) => updateCamera(s, cam.id, { targetEntityId: e.target.value }))}>
                <option value="">(nothing)</option>
                {scene.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-6">
            {vec(cam, "position", "Position (m)")}
            {vec(cam, "lookAt", "Looks at (m)")}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <span className={labelText}>Direction</span>
              <div className="flex gap-1.5">
                <label className="flex items-center gap-1 text-xs text-white/50">
                  Yaw °
                  <NumberField
                    label={`${cam.label} yaw`}
                    value={direction.yaw}
                    step={1}
                    className="w-[4.5rem]"
                    onCommit={(n) => edit((s) => setCameraDirection(s, cam.id, { yaw: n }), `cam:${cam.id}:dir`)}
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-white/50">
                  Pitch °
                  <NumberField
                    label={`${cam.label} pitch`}
                    value={direction.pitch}
                    step={1}
                    className="w-[4.5rem]"
                    onCommit={(n) => edit((s) => setCameraDirection(s, cam.id, { pitch: n }), `cam:${cam.id}:dir`)}
                  />
                </label>
              </div>
            </div>
            <label className="flex items-center gap-1.5 pb-1 text-xs text-white/70" title="Moving the camera also moves the point it looks at, so it keeps facing the same way">
              <input type="checkbox" checked={keepDirection} onChange={(e) => onKeepDirectionChange(e.target.checked)} />
              Moving keeps direction
            </label>
          </div>
          <p className="text-xs text-white/40">
            The direction is saved as the look-at point, {direction.distance.toFixed(2)} m from the camera. Yaw 0° faces +z, 90° faces +x; pitch up is
            positive. +x is right, +y is up, +z is toward the default camera. Arrow keys in a field nudge by the step (Shift ×10, Alt ×0.1).
          </p>

          <label className="flex flex-col gap-1">
            <span className={labelText}>Note</span>
            <textarea className={`${field} min-h-12`} value={cam.note} onChange={(e) => edit((s) => updateCamera(s, cam.id, { note: e.target.value }), `cam:${cam.id}:note`)} />
          </label>

          {cameraIssues(cam).map((issue) => (
            <p key={issue} className="rounded bg-amber-500/15 p-2 text-xs text-amber-200">
              {issue}
            </p>
          ))}

          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={() => onLookThrough(cam)} title="Show the scene through exactly this camera">
              Look through
            </button>
            <button className={btn} onClick={() => focusView({ position: cam.position, lookAt: cam.lookAt })} title="Move the free 3D view to this camera's position and direction">
              Move view here
            </button>
            <button className={btn} onClick={() => setFromView(cam)} title="Record the 3D view's current position and direction into this camera">
              Set from current view
            </button>
            <button className={btn} disabled={!cam.targetEntityId} onClick={() => aimAtTarget(cam)} title="Point the look-at at the chest of the framed entity">
              Aim at framed entity
            </button>
            <button
              className={btn}
              onClick={() =>
                add(
                  { ...cam, label: `${cam.label} copy`, position: { ...cam.position, x: cam.position.x + 1 } },
                  cam.t,
                )
              }
            >
              Duplicate
            </button>
            <button
              className={btn}
              onClick={() => {
                edit((s) => deleteCamera(s, cam.id));
                onSelect(null);
              }}
              title="Delete (undo with the Undo button or Ctrl/Cmd+Z)"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <p className="text-white/40">Select a camera to edit it, or add one.</p>
      )}
    </div>
  );
}
