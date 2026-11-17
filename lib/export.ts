import type { Scene, TranscriptLine } from "./schema";
import { cameraDirection } from "./edit";
import { serializeScene } from "./migrate";

/** Pure builders for everything the export step can hand you. Nothing here touches the browser. */

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const num = (n: number) => String(Number(n.toFixed(3)));

/** A safe file name stem from the scene title. */
export function baseName(scene: Scene): string {
  return (
    scene.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scene"
  );
}

/** The scene file: everything, versioned, so it can be reopened and edited later. */
export function sceneJson(scene: Scene): string {
  return JSON.stringify(serializeScene(scene), null, 2);
}

function lineMarkdown(l: TranscriptLine): string {
  const at = `\`${mmss(l.startSec)}\``;
  switch (l.kind) {
    case "dialogue":
      return `${at} **${l.speaker || "—"}**: ${l.text}`;
    case "action":
      return `${at} *${l.text}*`;
    case "narration":
      return `${at} > ${l.text}`;
    case "sfx":
      return `${at} _(sound)_ ${l.text}`;
  }
}

/** The story in reading order, beat by beat, as Markdown. */
export function transcriptMarkdown(scene: Scene): string {
  const out: string[] = [`# ${scene.title || "Untitled scene"}`];
  if (scene.logline) out.push(`_${scene.logline}_`);

  const known = new Set(scene.timeline.map((b) => b.id));
  for (const beat of scene.timeline) {
    out.push(`## ${beat.title || "Untitled beat"}  ·  ${mmss(beat.startSec)}–${mmss(beat.endSec)}`);
    const details = [beat.location, beat.mood].filter(Boolean).join(" · ");
    if (details) out.push(`*${details}*`);
    const lines = scene.transcript.filter((l) => l.beatId === beat.id);
    out.push(lines.length ? lines.map(lineMarkdown).join("\n\n") : "_Nothing said or done here yet._");
  }
  const stray = scene.transcript.filter((l) => !known.has(l.beatId));
  if (stray.length) out.push(`## Elsewhere`, stray.map(lineMarkdown).join("\n\n"));
  return out.join("\n\n") + "\n";
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/**
 * Every camera as a row: when it starts, what kind of shot, where it stands, where it looks, and
 * which way that is in degrees (yaw 0 faces +z, 90 faces +x; pitch up is positive). Meters.
 */
export function shotListCsv(scene: Scene): string {
  const header = [
    "shot", "name", "beat", "start_s", "type", "movement",
    "pos_x", "pos_y", "pos_z", "look_x", "look_y", "look_z",
    "yaw_deg", "pitch_deg", "fov_deg", "frames", "note",
  ];
  const beats = new Map(scene.timeline.map((b) => [b.id, b.title]));
  const names = new Map(scene.entities.map((e) => [e.id, e.name]));
  const rows = [...scene.cameras]
    .sort((a, b) => a.t - b.t)
    .map((c, i) => {
      const d = cameraDirection(c);
      return [
        i + 1, c.label, beats.get(c.beatId) ?? "", num(c.t), c.shot.replaceAll("_", " "), c.movement,
        num(c.position.x), num(c.position.y), num(c.position.z),
        num(c.lookAt.x), num(c.lookAt.y), num(c.lookAt.z),
        num(d.yaw), num(d.pitch), num(c.fov), names.get(c.targetEntityId) ?? "", c.note,
      ];
    });
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** The numbers shown on the export screen. */
export function sceneSummary(scene: Scene) {
  const characters = scene.entities.filter((e) => e.kind === "character").length;
  return {
    beats: scene.timeline.length,
    lines: scene.transcript.length,
    characters,
    objects: scene.entities.length - characters,
    cameras: scene.cameras.length,
    duration: mmss(scene.durationSec),
  };
}
