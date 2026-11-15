# Scene

Paste a movie script and get a timeline, transcript, 3D-positioned characters and objects with controllable variations, and camera setups. Claude (`claude-opus-5-5`) does the analysis in `app/api/analyze/route.ts`; the schema is in `lib/schema.ts`.

## Run locally

```bash
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm install
npm run dev
```

## How generation works

`lib/pipeline.ts` builds the scene from model calls that are each constrained to their own small schema: **outline** (title, timing, beats) and **cast** (entities and the fixed layout of each place) run in parallel; then **motion** (keyframes and cameras) runs with both as context, while the **transcript** is written alongside it. The API compiles each structured-output schema into a grammar with a size limit, and the whole scene in one schema is over it (`The compiled grammar is too large`). The scene file format and the `/api/analyze` response are the same as a single call would give.

**Speed.** Motion (keyframes and cameras) is the longest stage and grows with the script, so it is split into chunks cut at place changes (long stays in one place are split every 3 beats) and the chunks run in parallel, at most 4 calls at once. Wall time follows the longest chunk instead of the whole film: the one-page sample went from 240 s to about 125 s. A short or single-place script is one chunk, as before. Parallel chunks cannot see each other, so the cast stage also decides a fixed **layout** (where each stationary entity stands in each place) that every chunk is given; each chunk also starts with a keyframe for every entity so the cuts join cleanly. The layout is a pipeline input only and is not part of the scene file.

The `/api/analyze` response includes `stats` (total and per-stage time, calls and tokens). The UI shows "Generated in N s".

Optional environment variables (restart after changing):

- `SCENE_CHUNK_BEATS` (default 3): most beats planned in one call. Lower is faster but gives the model less continuity inside one place.
- `SCENE_MAX_PARALLEL` (default 6, the chunk cap): most motion calls at once. Lower it if you hit rate limits; with fewer slots than chunks they run in waves and the time multiplies.
- `SCENE_MOTION_EFFORT` (`low`, `medium` or `high`; default `high`): thinking depth for motion. Lower is faster and cheaper, at some cost to spatial care.
- `SCENE_FAST_MODE=1`: Opus fast mode, up to 2.5x faster output at twice the token price. Off by default; not verified end to end here.

**Script length.** A request must finish within the function time limit (300 s). The one-page sample takes about 125 s. A five-page, nine-location script took 384 s before the transcript was moved off the critical path and all six chunks were allowed to run at once (it ran in two waves of four then two); the improved setup has not been measured because the API account ran out of credits. Total time is roughly the outline and cast, plus the longest chunk, plus the slowest of the remaining stages, so very long scripts still need splitting by act or a background job.

Parallel chunks read the shared context separately, so a run uses more input tokens (about 20% more cost for the sample) in exchange for the speedup.

Scene limits are enforced where they are decided, each with one repair pass that regenerates only that stage: counts at the cast stage, attached/in/on limits at the motion stage.

When you add or change scene fields (`lib/schema.ts`), put them in the stage they belong to, then run `npm run check:schemas`. It asks the API to compile every stage schema (16 output tokens each, so it costs next to nothing) and fails if one is too large; split that stage if so.

## Viewer

Rendering uses three.js (MIT) through react-three-fiber. Orbit and camera views only draw when something changes; walk and fly draw every frame.

**View settings** (saved in your browser, safe defaults if missing or from another version):

- **Movement:** Orbit (default), Walk (first person at eye height), Fly (free first person). Click the view, drag to look, WASD or arrows to move, Shift to sprint, Space / C to rise and sink while flying.
- **Speed:** Slow, Normal, Fast. Scaled a little for large scenes.
- **Space around the scene:** Tight, Auto (default), Wide. The space is computed from everything the scene uses (entities, their sizes, every camera setup) plus room around it, with a minimum so tiny scenes still have space.
- **Boundaries** (on by default): keeps the camera and its focus point inside that space and above the floor so you can't drift away. Turn off for unrestricted movement. **Grid** toggles the floor grid.

## Editing a scene

After generating (or importing) a scene you can edit it by hand; every edit is undoable (Undo / Redo buttons, or Ctrl/Cmd+Z when no text field is focused), and a burst of edits to one field (typing, dragging a handle) is one undo step.

- **Timeline:** add, edit, delete and reorder beats. Order is always derived from time, so ↑ ↓ swaps two beats' time slots and carries everything tied to each beat (its transcript lines, keyframes and cameras) with it. Inserting a beat in the middle pushes later beats, and their content, later. Deleting a beat removes its lines, keyframes and cameras (it tells you how many first). Editing a beat's start or end does not move its content.
- **Transcript:** add, edit and delete lines, reorder them within a beat, or move a line to another beat.
- **Cameras:** add, duplicate, delete and edit cameras with exact numbers (position, look-at point, field of view, start time), or drag the handles on the selected camera in the free orbit view. The step field sets both the arrow-key step in number fields (Shift ×10, Alt ×0.1) and the drag snapping. Numbers are kept valid (finite, field of view 10–120°, time inside the scene).

The edit logic is in `lib/edit.ts` and `lib/history.ts` (pure and unit-tested). None of this changes the scene file format.

## Scene file format and versioning

**Export JSON** writes the scene with a `schemaVersion`; **Import JSON** loads it, upgrading older files automatically (files with no `schemaVersion` are treated as v1). Files from a newer format than the app supports are rejected with a message instead of being misread.

Changing the scene shape (`lib/schema.ts`):

1. Prefer additive changes (new optional-in-practice fields with a default).
2. Bump `SCHEMA_VERSION` in `lib/migrate.ts` and add a `MIGRATIONS` step that upgrades the previous version. Steps must fill in only what is missing.
3. Add a fixture and test for the old shape in `lib/migrate.test.ts`, and record the new schema fingerprint there. `npm test` fails if the schema changed without a version bump.

## Deploy (GitHub Actions to Vercel)

`.github/workflows/deploy.yml` lints, typechecks and builds every push and PR. Pushes to `main` deploy to production; same-repo PRs get a preview deployment.

One-time setup:

1. Create the Vercel project: run `npx vercel link` locally, then read `orgId` and `projectId` from `.vercel/project.json`.
2. Add GitHub repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
3. In the Vercel project settings, add `ANTHROPIC_API_KEY` and `APP_ACCESS_CODE` (Production and Preview). They live in Vercel, not GitHub. In production the API refuses all requests unless `APP_ACCESS_CODE` is set, and callers must send it (the UI has an access code field), because each analysis is an expensive Opus call. There is also a best-effort per-IP limit (6 requests per 10 minutes per server instance); add a platform-level rate limit such as the Vercel Firewall for a hard cap.
4. Function duration: `maxDuration` in `app/api/analyze/route.ts` is 300 s because a full breakdown can take minutes. Check your Vercel plan allows that, or lower it and use shorter excerpts.

## TODO: move to AWS

- Replace the Vercel deploy job with an AWS target (service not chosen yet: App Runner, ECS Fargate or Amplify).
- Authenticate the workflow to AWS with GitHub OIDC (no long-lived AWS keys).
- Keep `ANTHROPIC_API_KEY` (and `APP_ACCESS_CODE`) in AWS Secrets Manager or SSM Parameter Store and inject them into the service. Anthropic auth stays an API key.
