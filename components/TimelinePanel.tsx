"use client";

import { useState } from "react";
import type { Scene } from "@/lib/schema";
import { addBeat, beatDependents, deleteBeat, moveBeat, nextId, updateBeat } from "@/lib/edit";
import NumberField from "./NumberField";
import { btn, field, fmtTime, labelText, type EditFn } from "./ui";

/** Beats: edit, add, delete, reorder. Reordering swaps time slots and carries each beat's content along. */
export default function TimelinePanel({
  scene,
  t,
  onSeek,
  edit,
}: {
  scene: Scene;
  t: number;
  onSeek: (n: number) => void;
  edit: EditFn;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const beats = scene.timeline;
  const currentId = (beats.find((b) => t >= b.startSec && t < b.endSec) ?? beats.at(-1))?.id;

  function add(afterId: string | null) {
    const id = nextId("b", beats.map((b) => b.id));
    edit((s) => addBeat(s, afterId, { id }));
    setOpenId(id);
  }

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {beats.map((b, i) => {
          const open = openId === b.id;
          const deps = beatDependents(scene, b.id);
          return (
            <li key={b.id} className={`rounded border p-2 ${currentId === b.id ? "border-indigo-400" : "border-white/10"}`}>
              <div className="flex items-start gap-2">
                <button onClick={() => onSeek(b.startSec)} className="min-w-0 flex-1 text-left">
                  <div className="flex justify-between gap-2">
                    <b className="truncate">{b.title || "Untitled beat"}</b>
                    <span className="shrink-0 tabular-nums text-white/50">
                      {fmtTime(b.startSec)}–{fmtTime(b.endSec)}
                    </span>
                  </div>
                  <div className="text-xs text-white/50">
                    {b.location} · {b.mood}
                  </div>
                  {!open && <p className="mt-1 text-white/80">{b.summary}</p>}
                </button>
                <div className="flex shrink-0 gap-1">
                  <button className={btn} aria-label={`Move ${b.title} earlier`} disabled={i === 0} onClick={() => edit((s) => moveBeat(s, b.id, -1))}>
                    ↑
                  </button>
                  <button className={btn} aria-label={`Move ${b.title} later`} disabled={i === beats.length - 1} onClick={() => edit((s) => moveBeat(s, b.id, 1))}>
                    ↓
                  </button>
                  <button className={btn} aria-expanded={open} onClick={() => setOpenId(open ? null : b.id)}>
                    {open ? "Close" : "Edit"}
                  </button>
                  <button className={btn} aria-label={`Delete ${b.title}`} onClick={() => setConfirmId(b.id)}>
                    ✕
                  </button>
                </div>
              </div>

              {confirmId === b.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-red-500/15 p-2 text-xs text-red-200">
                  Delete this beat and its {deps.lines} transcript line{deps.lines === 1 ? "" : "s"}, {deps.cameras} camera
                  {deps.cameras === 1 ? "" : "s"} and {deps.keyframes} keyframe{deps.keyframes === 1 ? "" : "s"}? You can undo this.
                  <button
                    className={btn}
                    onClick={() => {
                      edit((s) => deleteBeat(s, b.id));
                      setConfirmId(null);
                      if (openId === b.id) setOpenId(null);
                    }}
                  >
                    Delete
                  </button>
                  <button className={btn} onClick={() => setConfirmId(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {open && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className={labelText}>Title</span>
                    <input className={field} value={b.title} onChange={(e) => edit((s) => updateBeat(s, b.id, { title: e.target.value }), `beat:${b.id}:title`)} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelText}>Location</span>
                    <input className={field} value={b.location} onChange={(e) => edit((s) => updateBeat(s, b.id, { location: e.target.value }), `beat:${b.id}:location`)} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelText}>Mood</span>
                    <input className={field} value={b.mood} onChange={(e) => edit((s) => updateBeat(s, b.id, { mood: e.target.value }), `beat:${b.id}:mood`)} />
                  </label>
                  <div className="flex items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className={labelText}>Start (s)</span>
                      <NumberField label={`${b.title} start`} value={b.startSec} step={0.5} onCommit={(n) => edit((s) => updateBeat(s, b.id, { startSec: n }), `beat:${b.id}:start`)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelText}>End (s)</span>
                      <NumberField label={`${b.title} end`} value={b.endSec} step={0.5} onCommit={(n) => edit((s) => updateBeat(s, b.id, { endSec: n }), `beat:${b.id}:end`)} />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className={labelText}>Summary</span>
                    <textarea
                      className={`${field} min-h-16`}
                      value={b.summary}
                      onChange={(e) => edit((s) => updateBeat(s, b.id, { summary: e.target.value }), `beat:${b.id}:summary`)}
                    />
                  </label>
                  <div className="flex gap-2 sm:col-span-2">
                    <button className={btn} onClick={() => add(b.id)}>
                      Insert beat after
                    </button>
                    <span className="self-center text-xs text-white/40">
                      Changing start or end does not move the beat&apos;s content. Use ↑ ↓ to reorder (content moves with it).
                    </span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div>
        <button className={btn} onClick={() => add(null)}>
          + Add beat at end
        </button>
      </div>
    </div>
  );
}
