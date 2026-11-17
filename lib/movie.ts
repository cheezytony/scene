import { z } from "zod";
import { pricesFor, type ModelChoice, type VideoChoice } from "./catalog";
import { formatMoney, tokensForText, type CostEstimate } from "./cost";
import type { Outputs } from "./outputs";
import type { Scene } from "./schema";

/**
 * Turning a scene into a film. A "director" model reads the chosen outputs and writes one prompt
 * per shot; a video model renders each shot; the shots play back to back. The more outputs the
 * director is given, the more precisely each prompt can pin down who is where and what the camera
 * does, and the more tokens it reads. That is the dial this file prices.
 */

/** The parts of the scene given to the director. Beats are always part of it. */
export type MovieInputs = Outputs;

/** A scene reduced to just the chosen inputs, in a compact form for the director to read. */
export function movieContext(scene: Scene, inputs: MovieInputs) {
  const ent = new Map(scene.entities.map((e) => [e.id, e]));
  return {
    title: scene.title,
    logline: scene.logline,
    durationSec: scene.durationSec,
    beats: scene.timeline.map((b) => ({ id: b.id, start: b.startSec, end: b.endSec, title: b.title, location: b.location, summary: b.summary, mood: b.mood })),
    ...(inputs.transcript
      ? { transcript: scene.transcript.map((l) => ({ beat: l.beatId, start: l.startSec, kind: l.kind, speaker: l.speaker, text: l.text })) }
      : {}),
    ...(inputs.cast
      ? {
          cast: scene.entities.map((e) => ({ id: e.id, kind: e.kind, name: e.name, description: e.description, color: e.color, size: e.size })),
          moments: scene.keyframes
            .filter((k) => k.present)
            .map((k) => ({ t: k.t, who: ent.get(k.entityId)?.name ?? k.entityId, state: k.state, at: k.position, facing: k.rotationY, note: k.note })),
        }
      : {}),
    ...(inputs.cameras
      ? { cameras: scene.cameras.map((c) => ({ id: c.id, t: c.t, beat: c.beatId, label: c.label, shot: c.shot, movement: c.movement, position: c.position, lookAt: c.lookAt, fov: c.fov, target: ent.get(c.targetEntityId)?.name ?? "" })) }
      : {}),
  };
}

/** One shot to render. */
export const ClipSchema = z.object({
  id: z.string(),
  beatId: z.string(),
  startSec: z.number(),
  seconds: z.number(),
  prompt: z.string(),
});
export type Clip = z.infer<typeof ClipSchema>;

export const ShotListSchema = z.object({ clips: z.array(ClipSchema) });

/**
 * Where the shots fall. With cameras, each camera setup is a shot (until the next one or the end of
 * its beat); without, each beat is. Shots longer than a clip can be are split, so the film covers the
 * whole running time.
 */
export function planShots(scene: Scene, inputs: MovieInputs, maxClipSec: number): { id: string; beatId: string; startSec: number; seconds: number }[] {
  const out: { id: string; beatId: string; startSec: number; seconds: number }[] = [];
  const cut = Math.max(1, maxClipSec);
  const push = (beatId: string, from: number, to: number) => {
    const n = Math.max(1, Math.ceil((to - from) / cut - 1e-9));
    const len = (to - from) / n;
    for (let i = 0; i < n; i++) out.push({ id: `s${out.length + 1}`, beatId, startSec: from + i * len, seconds: Math.max(1, Math.round(len * 10) / 10) });
  };
  for (const b of scene.timeline) {
    if (b.endSec <= b.startSec) continue;
    const cams = inputs.cameras ? scene.cameras.filter((c) => c.t >= b.startSec && c.t < b.endSec).sort((x, y) => x.t - y.t) : [];
    if (!cams.length) {
      push(b.id, b.startSec, b.endSec);
      continue;
    }
    const starts = [b.startSec, ...cams.map((c) => c.t).filter((t) => t > b.startSec)];
    starts.forEach((s, i) => push(b.id, s, starts[i + 1] ?? b.endSec));
  }
  return out;
}

export interface MovieEstimate {
  clips: number;
  seconds: number;
  director: CostEstimate["tokens"];
  directorUsd: number | null;
  videoUsd: number | null;
  totalUsd: number | null;
}

/** Director tokens grow with the inputs; video cost grows with running time. Either may be unknown. */
export function estimateMovie(scene: Scene, inputs: MovieInputs, director: ModelChoice, video: VideoChoice): MovieEstimate {
  const shots = planShots(scene, inputs, video.maxClipSec);
  const seconds = shots.reduce((a, s) => a + s.seconds, 0);
  const contextTokens = tokensForText(JSON.stringify(movieContext(scene, inputs)).length);
  const t = { input: 700 + contextTokens, output: 1200 + shots.length * 170 };
  const p = pricesFor(director);
  const directorUsd = p.inPerM !== null && p.outPerM !== null ? (t.input * p.inPerM + t.output * p.outPerM) / 1e6 : null;
  const videoUsd = video.perSecond === null ? null : video.perSecond * seconds;
  return { clips: shots.length, seconds, director: t, directorUsd, videoUsd, totalUsd: directorUsd !== null && videoUsd !== null ? directorUsd + videoUsd : null };
}

export const describeMoney = (usd: number | null, rate: number) => (usd === null ? "not counted" : `${formatMoney(usd, "USD", rate)} · ${formatMoney(usd, "NGN", rate)}`);
