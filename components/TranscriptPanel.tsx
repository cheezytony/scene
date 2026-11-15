"use client";

import { useState } from "react";
import type { Scene, TranscriptLine } from "@/lib/schema";
import { addLine, deleteLine, moveLine, nextId, updateLine } from "@/lib/edit";
import NumberField from "./NumberField";
import { btn, field, fmtTime, labelText, type EditFn } from "./ui";

const KINDS: TranscriptLine["kind"][] = ["dialogue", "action", "narration", "sfx"];

/** Transcript lines grouped by beat: edit, add, delete, reorder within a beat, move to another beat. */
export default function TranscriptPanel({
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

  const known = new Set(scene.timeline.map((b) => b.id));
  const groups = [
    ...scene.timeline.map((b) => ({ id: b.id, title: b.title, beat: b, lines: scene.transcript.filter((l) => l.beatId === b.id) })),
    { id: "", title: "Not in any beat", beat: null, lines: scene.transcript.filter((l) => !known.has(l.beatId)) },
  ].filter((g) => g.beat || g.lines.length);

  function add(beatId: string, startSec: number | undefined) {
    const id = nextId("l", scene.transcript.map((l) => l.id));
    edit((s) => addLine(s, beatId, { id }, startSec));
    setOpenId(id);
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.id || "orphans"}>
          <div className="mb-1 flex items-center justify-between">
            <h3 className={labelText}>{g.title || "Untitled beat"}</h3>
            {g.beat && (
              <button
                className={btn}
                onClick={() => add(g.beat.id, t >= g.beat.startSec && t < g.beat.endSec ? t : undefined)}
                title="Adds a line at the playhead if it is inside this beat, otherwise at the beat's start"
              >
                + Add line
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-1">
            {g.lines.map((l, i) => {
              const open = openId === l.id;
              const active = t >= l.startSec && t < l.endSec;
              return (
                <li key={l.id} className={`rounded p-1.5 ${active ? "bg-indigo-500/25" : "hover:bg-white/5"}`}>
                  <div className="flex items-start gap-2">
                    <button onClick={() => onSeek(l.startSec)} className="flex min-w-0 flex-1 gap-3 text-left">
                      <span className="w-10 shrink-0 tabular-nums text-white/40">{fmtTime(l.startSec)}</span>
                      <span className="w-20 shrink-0 truncate text-xs uppercase text-white/50">
                        {l.kind === "dialogue" ? l.speaker || "—" : l.kind}
                      </span>
                      <span className={l.kind === "dialogue" ? "" : "italic text-white/70"}>{l.text || <em className="text-white/30">empty</em>}</span>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <button className={btn} aria-label="Move line earlier" disabled={i === 0 || !g.beat} onClick={() => edit((s) => moveLine(s, l.id, -1))}>
                        ↑
                      </button>
                      <button className={btn} aria-label="Move line later" disabled={i === g.lines.length - 1 || !g.beat} onClick={() => edit((s) => moveLine(s, l.id, 1))}>
                        ↓
                      </button>
                      <button className={btn} aria-expanded={open} onClick={() => setOpenId(open ? null : l.id)}>
                        {open ? "Close" : "Edit"}
                      </button>
                      <button
                        className={btn}
                        aria-label="Delete line"
                        onClick={() => {
                          edit((s) => deleteLine(s, l.id));
                          if (openId === l.id) setOpenId(null);
                        }}
                        title="Delete (undo with the Undo button or Ctrl/Cmd+Z)"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {open && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className={labelText}>Type</span>
                        <select className={field} value={l.kind} onChange={(e) => edit((s) => updateLine(s, l.id, { kind: e.target.value as TranscriptLine["kind"] }))}>
                          {KINDS.map((k) => (
                            <option key={k}>{k}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={labelText}>Speaker</span>
                        <input
                          className={field}
                          value={l.speaker}
                          disabled={l.kind !== "dialogue"}
                          onChange={(e) => edit((s) => updateLine(s, l.id, { speaker: e.target.value }), `line:${l.id}:speaker`)}
                        />
                      </label>
                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className={labelText}>Text</span>
                        <textarea
                          className={`${field} min-h-16`}
                          value={l.text}
                          onChange={(e) => edit((s) => updateLine(s, l.id, { text: e.target.value }), `line:${l.id}:text`)}
                        />
                      </label>
                      <div className="flex items-end gap-3">
                        <label className="flex flex-col gap-1">
                          <span className={labelText}>Start (s)</span>
                          <NumberField label="Line start" value={l.startSec} step={0.5} onCommit={(n) => edit((s) => updateLine(s, l.id, { startSec: n }), `line:${l.id}:start`)} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className={labelText}>End (s)</span>
                          <NumberField label="Line end" value={l.endSec} step={0.5} onCommit={(n) => edit((s) => updateLine(s, l.id, { endSec: n }), `line:${l.id}:end`)} />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className={labelText}>Beat</span>
                        <select className={field} value={l.beatId} onChange={(e) => edit((s) => updateLine(s, l.id, { beatId: e.target.value }))}>
                          {!known.has(l.beatId) && <option value={l.beatId}>(unknown beat)</option>}
                          {scene.timeline.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.title || b.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
            {g.lines.length === 0 && <li className="text-xs text-white/30">No lines in this beat.</li>}
          </ul>
        </section>
      ))}
      {groups.length === 0 && <p className="text-white/40">Add a beat in the Timeline tab first.</p>}
    </div>
  );
}
