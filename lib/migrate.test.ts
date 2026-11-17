import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { SCHEMA_VERSION, SceneFormatError, migrateScene, serializeScene } from "./migrate";
import { SceneSchema } from "./schema";

const v3 = (x: number, y: number, z: number) => ({ x, y, z });

const entity = {
  id: "e1",
  kind: "character",
  name: "Mara",
  importance: "lead",
  description: "",
  proxy: "humanoid",
  color: "#c0392b",
  size: v3(0.5, 1.7, 0.4),
  controls: [],
};
const beat = { id: "b1", startSec: 0, endSec: 10, title: "B", location: "L", summary: "", mood: "" };
const camera = {
  id: "c1", t: 0, beatId: "b1", label: "Wide", shot: "wide", movement: "static",
  position: v3(0, 3, 9), lookAt: v3(0, 1, 0), fov: 50, targetEntityId: "", note: "",
};
const keyframeV1 = {
  id: "k1", t: 0, beatId: "b1", entityId: "e1", position: v3(1, 0, 1), rotationY: 0,
  state: "standing", variations: [], note: "",
};
const base = { title: "T", logline: "", durationSec: 10, timeline: [beat], transcript: [], entities: [entity] };

// Fixtures: the document shape produced by each historical version.
const docV1 = { ...base, keyframes: [keyframeV1] };
const docV2 = {
  ...base,
  entities: [entity, { ...entity, id: "e2", kind: "object", name: "Car", proxy: "box" }],
  keyframes: [{ ...keyframeV1, relation: "in", parentId: "e2" }],
  cameras: [camera],
};

test("v1 (no schemaVersion) gains cameras, relations and presence", () => {
  const { scene, fromVersion } = migrateScene(docV1);
  assert.equal(fromVersion, 1);
  assert.deepEqual(scene.cameras, []);
  assert.equal(scene.keyframes[0].relation, "none");
  assert.equal(scene.keyframes[0].parentId, "");
  assert.equal(scene.keyframes[0].present, true);
});

test("v2 keeps its cameras and relations and gains presence", () => {
  const { scene, fromVersion } = migrateScene({ schemaVersion: 2, ...docV2 });
  assert.equal(fromVersion, 2);
  assert.equal(scene.cameras.length, 1);
  assert.equal(scene.keyframes[0].present, true);
});

test("unversioned file that already has v2 fields keeps them (tolerant steps)", () => {
  const { scene } = migrateScene(docV2);
  assert.equal(scene.cameras.length, 1);
  assert.equal(scene.keyframes[0].relation, "in");
  assert.equal(scene.keyframes[0].parentId, "e2");
});

test("explicit present=false is not overwritten by migration", () => {
  const { scene } = migrateScene({
    schemaVersion: 2,
    ...docV2,
    keyframes: [{ ...docV2.keyframes[0], present: false }],
  });
  assert.equal(scene.keyframes[0].present, false);
});

test("current version round-trips through serialize and migrate", () => {
  const { scene } = migrateScene(docV1);
  const again = migrateScene(JSON.parse(JSON.stringify(serializeScene(scene))));
  assert.equal(again.fromVersion, SCHEMA_VERSION);
  assert.deepEqual(again.scene, scene);
});

test("unknown extra fields are ignored", () => {
  const { scene } = migrateScene({ ...docV1, somethingNew: { a: 1 } });
  assert.equal("somethingNew" in scene, false);
});

test("files from a newer format are rejected with a clear message", () => {
  assert.throws(
    () => migrateScene({ schemaVersion: SCHEMA_VERSION + 1, ...docV1 }),
    (e) => e instanceof SceneFormatError && /Update the app/.test(e.message),
  );
});

test("invalid input is rejected, not crashed on", () => {
  assert.throws(() => migrateScene(null), SceneFormatError);
  assert.throws(() => migrateScene([]), SceneFormatError);
  assert.throws(() => migrateScene({ schemaVersion: "x", ...docV1 }), SceneFormatError);
  assert.throws(() => migrateScene({ ...docV1, entities: "nope" }), /entities/);
});

/**
 * Structural fingerprint of the scene format (field names, types, enums; descriptions ignored).
 * If this test fails you changed SceneSchema: bump SCHEMA_VERSION, add a MIGRATIONS step for the
 * previous version, add a fixture above, then record the new fingerprint here.
 */
const FINGERPRINTS: Record<number, string> = {
  3: "d444161916e468ad",
};

test("schema changes require a version bump", () => {
  const json = JSON.stringify(z.toJSONSchema(SceneSchema), (key, value) => (key === "description" ? undefined : value));
  const fingerprint = createHash("sha256").update(json).digest("hex").slice(0, 16);
  assert.equal(
    fingerprint,
    FINGERPRINTS[SCHEMA_VERSION],
    `SceneSchema changed (fingerprint ${fingerprint}). Bump SCHEMA_VERSION and add a migration, then record it.`,
  );
});
