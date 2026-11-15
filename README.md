# Scene

Paste a movie script and get a timeline, transcript, 3D-positioned characters and objects with controllable variations, and camera setups. Claude (`claude-opus-5-5`) does the analysis in `app/api/analyze/route.ts`; the schema is in `lib/schema.ts`.

## Run locally

```bash
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm install
npm run dev
```

## Deploy (GitHub Actions to Vercel)

`.github/workflows/deploy.yml` lints, typechecks and builds every push and PR. Pushes to `main` deploy to production; same-repo PRs get a preview deployment.

One-time setup:

1. Create the Vercel project: run `npx vercel link` locally, then read `orgId` and `projectId` from `.vercel/project.json`.
2. Add GitHub repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
3. In the Vercel project settings, add `ANTHROPIC_API_KEY` (Production and Preview). The key lives in Vercel, not GitHub.
4. Function duration: `maxDuration` in `app/api/analyze/route.ts` is 300 s because a full breakdown can take minutes. Check your Vercel plan allows that, or lower it and use shorter excerpts.

## TODO: move to AWS

- Replace the Vercel deploy job with an AWS target (service not chosen yet: App Runner, ECS Fargate or Amplify).
- Authenticate the workflow to AWS with GitHub OIDC (no long-lived AWS keys).
- Decide how the running app authenticates to Anthropic: an API key in a secret store, or Workload Identity Federation. Both work with the unchanged `new Anthropic()` client.
