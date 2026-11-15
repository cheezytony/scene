import test from "node:test";
import assert from "node:assert/strict";
import { baseName, sceneJson, sceneSummary, shotListCsv, transcriptMarkdown } from "./export";
import { migrateScene, SCHEMA_VERSION } from "./migrate";
import type { Scene } from "./schema";

const v3 = (x: number, y: number, z: number) => ({ x, y, z });
const scene = (): Scene => ({
  title: "The Last Train!",
  logline: "A key changes hands.",
  durationSec: 75,
  timeline: [
    { id: "b1", startSec: 0, endSec: 30, title: "Platform", location: "Station", summary: "", mood: "tense" },
    { id: "b2", startSec: 30, endSec: 75, title: "Car", location: "", summary: "", mood: "" },
  ],
  transcript: [
    { id: "l1", beatId: "b1", startSec: 1, endSec: 3, kind: "dialogue", speaker: "MARA", text: "Open it." },
    { id: "l2", beatId: "b1", startSec: 4, endSec: 6, kind: "action", speaker: "", text: "The train arrives." },
    { id: "l3", beatId: "b1", startSec: 7, endSec: 8, kind: "sfx", speaker: "", text: "Brakes." },
    { id: "l4", beatId: "gone", startSec: 9, endSec: 10, kind: "narration", speaker: "", text: "Later." },
  ],
  entities: [
    { id: "e1", kind: "character", name: "Mara", importance: "lead", description: "", proxy: "humanoid", color: "#ffffff", size: v3(1, 1, 1), controls: [] },
    { id: "e2", kind: "object", name: "Key", importance: "minor", description: "", proxy: "box", color: "#ffffff", size: v3(1, 1, 1), controls: [] },
  ],
  keyframes: [],
  cameras: [
    { id: "c2", t: 30, beatId: "b2", label: 'Close, "tight"', shot: "close_up", movement: "static", position: v3(0, 1.5, 2), lookAt: v3(0, 1.5, 0), fov: 35, targetEntityId: "e1", note: "Her face, then\nthe key" },
    { id: "c1", t: 0, beatId: "b1", label: "Wide", shot: "wide", movement: "dolly", position: v3(0, 3, 9), lookAt: v3(0, 1, 0), fov: 50, targetEntityId: "", note: "" },
  ],
});

test("file names are safe", () => {
  assert.equal(baseName(scene()), "the-last-train");
  assert.equal(baseName({ ...scene(), title: "  ?!  " }), "scene");
});

test("the scene file round-trips through import", () => {
  const { scene: back, fromVersion } = migrateScene(JSON.parse(sceneJson(scene())));
  assert.equal(fromVersion, SCHEMA_VERSION);
  assert.equal(back.title, "The Last Train!");
  assert.equal(back.cameras.length, 2);
});

test("the transcript reads in order, by beat, with each kind of line", () => {
  const md = transcriptMarkdown(scene());
  assert.match(md, /^# The Last Train!/);
  assert.match(md, /_A key changes hands\._/);
  assert.match(md, /## Platform {2}· {2}0:00–0:30/);
  assert.match(md, /\*Station · tense\*/);
  assert.match(md, /`0:01` \*\*MARA\*\*: Open it\./);
  assert.match(md, /`0:04` \*The train arrives\.\*/);
  assert.match(md, /`0:07` _\(sound\)_ Brakes\./);
  assert.match(md, /_Nothing said or done here yet\._/, "an empty beat says so kindly");
  assert.match(md, /## Elsewhere[\s\S]*`0:09` > Later\./, "lines whose beat is gone are kept, not dropped");
  assert.ok(md.indexOf("## Platform") < md.indexOf("## Car"));
});

test("the shot list is sorted, numbered, and safely quoted", () => {
  const csv = shotListCsv(scene());
  const rows = csv.trim().split("\n");
  assert.equal(rows[0].split(",")[0], "shot");
  assert.match(rows[1], /^1,Wide,Platform,0,wide,dolly,0,3,9,0,1,0,/);
  assert.match(rows[2], /^2,"Close, ""tight""",Car,30,close up,static,/);
  // A quoted cell may legitimately contain a newline, so check the raw text rather than split rows.
  assert.match(csv, /,Mara,"Her face, then\nthe key"\n$/, "commas, quotes and newlines are escaped");
  const yaw = Number(rows[1].split(",")[12]);
  assert.ok(Math.abs(Math.abs(yaw) - 180) < 0.01, "looking from +z toward the origin faces -z");
});

test("the summary counts what is there", () => {
  assert.deepEqual(sceneSummary(scene()), { beats: 2, lines: 4, characters: 1, objects: 1, cameras: 2, duration: "1:15" });
});
