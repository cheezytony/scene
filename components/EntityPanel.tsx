"use client";

import { useState } from "react";
import type { Control, Entity, Keyframe, Scene, Vec3 } from "@/lib/schema";
import {
  addControl,
  addEntity,
  addKeyframe,
  deleteControl,
  deleteEntity,
  deleteKeyframe,
  entityDependents,
  nextId,
  setVariation,
  updateControl,
  updateEntity,
  updateKeyframe,
} from "@/lib/edit";
import { activeKeyframe, keyframesFor, variationsAt, worldPose } from "@/lib/resolve";
import NumberField from "./NumberField";
import { btn, field, fmtTime, labelText, type EditFn } from "./ui";

const IMPORTANCE: Entity["importance"][] = ["lead", "supporting", "minor", "plot_critical_prop", "set_dressing"];
const PROXIES: Entity["proxy"][] = ["humanoid", "box", "sphere", "cylinder", "cone"];
const RELATIONS: Keyframe["relation"][] = ["none", "attached", "in", "on"];
const AXES = ["x", "y", "z"] as const;
const words = (s: string) => s.replaceAll("_", " ");

/**
 * Characters and objects: add, edit and delete them, edit their controls (and the values those
 * controls take at the playhead), and edit their keyframes (where they are, which way they face,
 * their state, whether they are in the scene, and what they are attached to).
 */
export default function EntityPanel({
  scene,
  t,
  selectedId,
  onSelect,
  onSeek,
  edit,
}: {
  scene: Scene;
  t: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSeek: (n: number) => void;
  edit: EditFn;
}) {
  const entity = scene.entities.find((e) => e.id === selectedId) ?? null;

  function add(kind: Entity["kind"]) {
    const id = nextId("e", scene.entities.map((e) => e.id));
    edit((s) => addEntity(s, kind, t, { id }));
    onSelect(id);
  }

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <div className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1">
          {scene.entities.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => onSelect(e.id)}
                className={`w-full rounded px-2 py-1 text-left ${e.id === selectedId ? "bg-white/15" : "hover:bg-white/5"}`}
              >
                {e.name || e.id}
                <span className="ml-2 text-xs text-white/40">
                  {e.kind} · {words(e.importance)}
                </span>
              </button>
            </li>
          ))}
          {scene.entities.length === 0 && <li className="text-xs text-white/40">Nothing here yet.</li>}
        </ul>
        <div className="flex gap-2">
          <button className={btn} onClick={() => add("character")} title="Added at the playhead">
            + Character
          </button>
          <button className={btn} onClick={() => add("object")} title="Added at the playhead">
            + Object
          </button>
        </div>
      </div>

      {entity ? (
        <EntityEditor key={entity.id} scene={scene} entity={entity} t={t} onSeek={onSeek} onDeleted={() => onSelect(null)} edit={edit} />
      ) : (
        <p className="text-white/40">Select a character or object to edit it, or add one.</p>
      )}
    </div>
  );
}

function EntityEditor({
  scene,
  entity,
  t,
  onSeek,
  onDeleted,
  edit,
}: {
  scene: Scene;
  entity: Entity;
  t: number;
  onSeek: (n: number) => void;
  onDeleted: () => void;
  edit: EditFn;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openControl, setOpenControl] = useState<string | null>(null);
  const id = entity.id;
  const key = (part: string) => `ent:${id}:${part}`;
  const patch = (p: Partial<Omit<Entity, "id">>, part: string) => edit((s) => updateEntity(s, id, p), key(part));

  const kfs = keyframesFor(scene, id);
  const kf = activeKeyframe(kfs, t);
  const pose = worldPose(scene, entity, t);
  const vars = variationsAt(scene, entity, t);
  const hasKeyframeNow = kfs.some((k) => Math.abs(k.t - t) < 1e-6);
  const deps = entityDependents(scene, id);
  const others = scene.entities.filter((e) => e.id !== id);

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={labelText}>Name</span>
          <input className={field} value={entity.name} onChange={(e) => patch({ name: e.target.value }, "name")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelText}>Kind</span>
          <select className={field} value={entity.kind} onChange={(e) => patch({ kind: e.target.value as Entity["kind"] }, "kind")}>
            <option value="character">character</option>
            <option value="object">object</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelText}>Importance</span>
          <select className={field} value={entity.importance} onChange={(e) => patch({ importance: e.target.value as Entity["importance"] }, "importance")}>
            {IMPORTANCE.map((i) => (
              <option key={i} value={i}>
                {words(i)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelText}>Shape in the 3D view</span>
          <select className={field} value={entity.proxy} onChange={(e) => patch({ proxy: e.target.value as Entity["proxy"] }, "proxy")}>
            {PROXIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1">
          <span className={labelText}>Colour</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`${entity.name} colour`}
              value={entity.color}
              onChange={(e) => patch({ color: e.target.value }, "color")}
              className="h-7 w-9 cursor-pointer rounded border border-white/15 bg-neutral-900"
            />
            <span className="text-xs tabular-nums text-white/50">{entity.color}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className={labelText}>Size (m): width, height, depth</span>
          <div className="flex gap-1.5">
            {AXES.map((axis) => (
              <NumberField
                key={axis}
                label={`${entity.name} size ${axis}`}
                value={entity.size[axis]}
                step={0.1}
                className="w-16"
                onCommit={(n) => patch({ size: { ...entity.size, [axis]: n } as Vec3 }, "size")}
              />
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 sm:col-span-3">
          <span className={labelText}>Description</span>
          <textarea className={`${field} min-h-14`} value={entity.description} onChange={(e) => patch({ description: e.target.value }, "description")} />
        </label>
      </section>

      <section>
        <h3 className={`${labelText} mb-1`}>
          Controls <span className="normal-case">(values shown are in effect at {fmtTime(t)}; changing one applies from the current keyframe on)</span>
        </h3>
        <ul className="flex flex-col gap-2">
          {entity.controls.map((c) => {
            const open = openControl === c.key;
            return (
              <li key={c.key} className="rounded border border-white/10 p-2">
                <div className="flex items-center gap-2">
                  <ControlInput
                    control={c}
                    value={vars[c.key] ?? c.defaultValue}
                    onChange={(v) => edit((s) => setVariation(s, id, c.key, v, t), `var:${id}:${c.key}`)}
                  />
                  <button className={btn} aria-expanded={open} onClick={() => setOpenControl(open ? null : c.key)}>
                    {open ? "Close" : "Edit"}
                  </button>
                </div>
                {open && (
                  <ControlDefinition
                    control={c}
                    onChange={(p) => edit((s) => updateControl(s, id, c.key, p), `ctl:${id}:${c.key}`)}
                    onDelete={() => {
                      edit((s) => deleteControl(s, id, c.key));
                      setOpenControl(null);
                    }}
                  />
                )}
              </li>
            );
          })}
          {entity.controls.length === 0 && <li className="text-xs text-white/40">No controls.</li>}
        </ul>
        <button className={`${btn} mt-2`} onClick={() => edit((s) => addControl(s, id))}>
          + Add control
        </button>
      </section>

      <section>
        <h3 className={`${labelText} mb-1`}>Keyframes</h3>
        <ul className="mb-2 flex flex-wrap gap-1">
          {kfs.map((k) => (
            <li key={k.id}>
              <button
                onClick={() => onSeek(k.t)}
                title={k.note}
                className={`rounded border px-2 py-0.5 text-xs ${kf?.id === k.id ? "border-indigo-400" : "border-white/15 hover:bg-white/10"} ${k.present ? "" : "opacity-60"}`}
              >
                {fmtTime(k.t)} · {k.present ? words(k.state) : "not in scene"}
              </button>
            </li>
          ))}
          {kfs.length === 0 && <li className="text-xs text-white/40">No keyframes, so it does not appear in the scene.</li>}
        </ul>

        {kf && (
          <div className="flex flex-col gap-3 rounded border border-white/10 p-2">
            <p className="text-xs text-white/50">
              Editing the keyframe at <b className="text-white/80">{fmtTime(kf.t)}</b>
              {kf.t <= t ? " (in effect now)" : " (the first one; not reached yet)"}.
              {!pose && " The entity is not in the scene at the playhead."}
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1">
                <span className={labelText}>Time (s)</span>
                <NumberField label="Keyframe time" value={kf.t} step={0.5} onCommit={(n) => edit((s) => updateKeyframe(s, kf.id, { t: n }), `kf:${kf.id}:t`)} />
              </label>
              <div className="flex flex-col gap-1">
                <span className={labelText}>Position (m)</span>
                <div className="flex gap-1.5">
                  {AXES.map((axis) => (
                    <label key={axis} className="flex items-center gap-1 text-xs text-white/50">
                      {axis.toUpperCase()}
                      <NumberField
                        label={`${entity.name} position ${axis}`}
                        value={kf.position[axis]}
                        step={0.1}
                        className="w-[4.5rem]"
                        onCommit={(n) => edit((s) => updateKeyframe(s, kf.id, { position: { ...kf.position, [axis]: n } as Vec3 }), `kf:${kf.id}:pos`)}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <span className={labelText}>Facing (° about y)</span>
                <NumberField label="Keyframe rotation" value={kf.rotationY} step={5} onCommit={(n) => edit((s) => updateKeyframe(s, kf.id, { rotationY: n }), `kf:${kf.id}:rot`)} />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1">
                <span className={labelText}>State</span>
                <input className={field} value={kf.state} onChange={(e) => edit((s) => updateKeyframe(s, kf.id, { state: e.target.value }), `kf:${kf.id}:state`)} />
              </label>
              <label className="flex items-center gap-1.5 pb-1 text-xs text-white/70">
                <input type="checkbox" checked={kf.present} onChange={(e) => edit((s) => updateKeyframe(s, kf.id, { present: e.target.checked }))} />
                In the scene
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelText}>Relation</span>
                <select
                  className={field}
                  value={kf.relation}
                  onChange={(e) => {
                    const relation = e.target.value as Keyframe["relation"];
                    edit((s) => updateKeyframe(s, kf.id, { relation, parentId: relation === "none" ? "" : kf.parentId || (others[0]?.id ?? "") }));
                  }}
                >
                  {RELATIONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              {kf.relation !== "none" && (
                <label className="flex flex-col gap-1">
                  <span className={labelText}>{kf.relation === "attached" ? "Attached to" : kf.relation === "in" ? "Inside" : "On"}</span>
                  <select className={field} value={kf.parentId} onChange={(e) => edit((s) => updateKeyframe(s, kf.id, { parentId: e.target.value }))}>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name || o.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {kf.relation !== "none" && (
              <p className="text-xs text-white/40">While attached, it follows its parent, keeping the offset it has at this keyframe.</p>
            )}
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <button
            className={btn}
            disabled={hasKeyframeNow}
            onClick={() => edit((s) => addKeyframe(s, id, t))}
            title={hasKeyframeNow ? "There is already a keyframe at the playhead" : "Starts from where it is now, so nothing jumps"}
          >
            + Add keyframe at {fmtTime(t)}
          </button>
          {kf && (
            <button className={btn} onClick={() => edit((s) => deleteKeyframe(s, kf.id))} title="Delete the keyframe being edited (undoable)">
              Delete keyframe
            </button>
          )}
        </div>
      </section>

      <section>
        {!confirmDelete ? (
          <button className={btn} onClick={() => setConfirmDelete(true)}>
            Delete {entity.kind}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded bg-red-500/15 p-2 text-xs text-red-200">
            Delete {entity.name || "this"} and its {deps.keyframes} keyframe{deps.keyframes === 1 ? "" : "s"}?
            {deps.cameras > 0 && ` ${deps.cameras} camera${deps.cameras === 1 ? "" : "s"} will stop framing it.`}
            {deps.children > 0 && ` ${deps.children} other ${deps.children === 1 ? "entity is" : "entities are"} attached to it and will be detached.`} You can undo this.
            <button
              className={btn}
              onClick={() => {
                edit((s) => deleteEntity(s, id));
                onDeleted();
              }}
            >
              Delete
            </button>
            <button className={btn} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/** Edits what a control is (name, type, range or options, default). Its key never changes. */
function ControlDefinition({
  control: c,
  onChange,
  onDelete,
}: {
  control: Control;
  onChange: (p: Partial<Omit<Control, "key">>) => void;
  onDelete: () => void;
}) {
  const [optionsDraft, setOptionsDraft] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-white/10 pt-2">
      <label className="flex flex-col gap-1">
        <span className={labelText}>Name</span>
        <input className={field} value={c.label} onChange={(e) => onChange({ label: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelText}>Type</span>
        <select className={field} value={c.type} onChange={(e) => onChange({ type: e.target.value as Control["type"] })}>
          <option value="slider">slider</option>
          <option value="choice">choice</option>
          <option value="toggle">toggle</option>
        </select>
      </label>
      {c.type === "choice" && (
        <label className="flex flex-col gap-1">
          <span className={labelText}>Options (comma separated)</span>
          <input
            className={`${field} w-56`}
            value={optionsDraft ?? c.options.join(", ")}
            onChange={(e) => {
              setOptionsDraft(e.target.value);
              onChange({ options: e.target.value.split(",") });
            }}
            onBlur={() => setOptionsDraft(null)}
          />
        </label>
      )}
      {c.type === "slider" && (
        <>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Min</span>
            <NumberField label={`${c.label} min`} value={c.min} step={1} onCommit={(n) => onChange({ min: n })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Max</span>
            <NumberField label={`${c.label} max`} value={c.max} step={1} onCommit={(n) => onChange({ max: n })} />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1">
        <span className={labelText}>Default</span>
        {c.type === "choice" ? (
          <select className={field} value={c.defaultValue} onChange={(e) => onChange({ defaultValue: e.target.value })}>
            {c.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : c.type === "toggle" ? (
          <input type="checkbox" checked={c.defaultValue === "true"} onChange={(e) => onChange({ defaultValue: String(e.target.checked) })} />
        ) : (
          <NumberField label={`${c.label} default`} value={Number(c.defaultValue) || 0} step={1} onCommit={(n) => onChange({ defaultValue: String(n) })} />
        )}
      </label>
      <button className={btn} onClick={onDelete} title="Also removes the values it had at keyframes (undoable)">
        Delete control
      </button>
    </div>
  );
}

function ControlInput({ control: c, value, onChange }: { control: Control; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-1 items-center gap-3 text-xs">
      <span className="w-36 shrink-0 text-white/70">{c.label}</span>
      {c.type === "choice" && (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={field}>
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
      {c.type === "toggle" && <input type="checkbox" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />}
    </label>
  );
}
