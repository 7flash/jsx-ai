# Maintainer Release Guide

Workflow links:
- [Main test workflow (`.github/workflows/test.yml`)](https://github.com/7flash/jsx-ai/actions/workflows/test.yml)
- [Registry smoke workflow (`.github/workflows/registry-smoke.yml`)](https://github.com/7flash/jsx-ai/actions/workflows/registry-smoke.yml)

## Release smoke checks

Normal CI covers unit tests plus local-consumer and packed-artifact smoke tests.

For a published npm install check, use `.github/workflows/registry-smoke.yml`:
- Trigger it manually from **Actions → Registry smoke → Run workflow** when you want to verify a registry version on demand.
- Use `jsx-ai@latest` to validate the current latest publish.
- Use an exact version like `jsx-ai@0.1.5` right after a release if you want to confirm that specific npm version is visible.
- Automatic trigger expectation: the workflow runs on **GitHub Release → published** events, not on every tag push by itself.
- In the release path, the workflow resolves the package spec automatically from the release tag (for example `v0.1.5` → `jsx-ai@0.1.5`).
- If you only pushed a tag but did not publish a GitHub Release, run the workflow manually instead.
- If npm propagation is delayed, the workflow already retries automatically before failing.

## Quick maintainer release flow

Minimal merge-to-publish path:
1. `bun install`
2. `bun test`
3. publish the package
4. confirm the release-triggered or manually dispatched **Registry smoke** workflow passes for the published version

## Release checklist

Before or during a release:
1. Run local verification:
   - `bun install`
   - `bun test`
   - or the focused scripts: `bun run test:unit` and `bun run test:smoke`
2. Confirm the packed artifact still works via the smoke coverage backed by `bun pm pack`.
3. Publish the package/version.
4. Verify the published registry install:
   - rely on the release-triggered `registry-smoke.yml`, or
   - manually run **Registry smoke** with `jsx-ai@latest` or the exact version you just published.
5. If the registry smoke check fails immediately after publish, wait for npm propagation and rerun the workflow.

## Version bump expectations

- Bump `package.json` to the exact version you intend to publish before creating the release.
- Keep the npm version, git tag, and registry smoke target aligned:
  - `package.json` version `0.1.5`
  - release tag `v0.1.5`
  - registry smoke target `jsx-ai@0.1.5`
- Treat registry smoke as validation of the version you actually published, not just the branch state you tested locally.
- If you publish a different version than the current tag or README examples imply, update those references before or immediately after release.

## Post-release verification

After registry smoke passes, quickly confirm:
- the npm package page shows the expected version
- the npm badge at the top of the README reflects that version
- the GitHub release/tag matches the published version
- README install/release examples do not reference an older version accidentally
- the main CI and registry smoke links both point to healthy recent runs
