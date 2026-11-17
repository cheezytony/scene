import { SceneSchema, normalizeScene, type Scene } from "./schema";

/**
 * Version of the stored/exported scene file format.
 *
 * Policy: any change to the shape of SceneSchema (or what its fields mean) bumps this number and
 * adds a migration step below that upgrades the previous version, so files exported by older
 * releases always still load. Steps must be tolerant (fill in only what is missing) because files
 * without a schemaVersion are treated as version 1 and may already contain newer fields.
 * `lib/migrate.test.ts` fails if the schema changes without a matching bump.
 *
 * History:
 *   1  timeline, transcript, entities, keyframes
 *   2  + cameras[]; keyframe.relation and keyframe.parentId
 *   3  + keyframe.present
 */
export const SCHEMA_VERSION = 3;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function withKeyframeDefaults(data: Raw, defaults: Raw): Raw {
  if (!Array.isArray(data.keyframes)) return data;
  return { ...data, keyframes: data.keyframes.map((k) => (isObject(k) ? { ...defaults, ...k } : k)) };
}

/** MIGRATIONS[n] upgrades a version-n document to version n + 1. */
const MIGRATIONS: Record<number, (data: Raw) => Raw> = {
  1: (data) => ({
    ...withKeyframeDefaults(data, { relation: "none", parentId: "" }),
    cameras: Array.isArray(data.cameras) ? data.cameras : [],
  }),
  2: (data) => withKeyframeDefaults(data, { present: true }),
};

export class SceneFormatError extends Error {}

/**
 * Turns any supported scene document (current or older) into the current Scene shape.
 * Unknown extra fields are ignored, so files from slightly newer minor builds still open.
 */
export function migrateScene(input: unknown): { scene: Scene; fromVersion: number } {
  if (!isObject(input)) throw new SceneFormatError("Not a scene file (expected a JSON object).");

  const declared = input.schemaVersion;
  const fromVersion = declared === undefined ? 1 : declared;
  if (typeof fromVersion !== "number" || !Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new SceneFormatError("Invalid schemaVersion in scene file.");
  }
  if (fromVersion > SCHEMA_VERSION) {
    throw new SceneFormatError(
      `This file uses scene format v${fromVersion}, but this app supports up to v${SCHEMA_VERSION}. Update the app to open it.`,
    );
  }

  let data: Raw = input;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) data = MIGRATIONS[v](data);

  const parsed = SceneSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SceneFormatError(`Not a valid scene: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  return { scene: normalizeScene(parsed.data), fromVersion };
}

/** The on-disk form of a scene: the current shape plus its format version. */
export function serializeScene(scene: Scene) {
  return { schemaVersion: SCHEMA_VERSION, ...scene };
}
