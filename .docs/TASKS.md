# Project Tasks & Ideas

## 🔴 Priority: Fix
- [x] ~~**Add install-state test guidance**~~ — ✅ DONE. Added README development instructions that call out `bun install` before `bun test` on a fresh clone.

## 🟡 Priority: Improve
- [x] ~~**Unblock test suite from missing dependency install**~~ — ✅ DONE. Installed repo dependencies and verified `bun test` passes locally (46 passing).
- [x] ~~**Add CI test workflow**~~ — ✅ DONE. Added GitHub Actions workflow to run `bun install --frozen-lockfile` and `bun test` on pushes and pull requests.
- [x] ~~**Audit dependency usage**~~ — ✅ DONE. Replaced the hard runtime import of `measure-fn` with a safe dynamic fallback in `src/llm.ts` and removed it from direct package dependencies.
- [x] ~~**Add explicit fallback test for optional telemetry import**~~ — ✅ DONE. Added a regression test that forces the telemetry loader to fail and verifies `callLLM` still succeeds.
- [x] ~~**Add branch coverage for release branches**~~ — ✅ DONE. Expanded CI triggers to run on `release/**` branches and `v*` version tags in addition to main/master and pull requests.
- [x] ~~**Hide test-only telemetry loader hook from public API docs**~~ — ✅ DONE. Renamed the helper to an explicitly internal test-only symbol and marked it `@internal` in `src/llm.ts`; it remains absent from root exports/docs.
- [x] ~~**Add CI status coverage for consumer smoke tests**~~ — ✅ DONE. Split consumer smoke coverage into its own test file and GitHub Actions job so CI reports a dedicated status check.
- [x] ~~**Add a package-consumer smoke test**~~ — ✅ DONE. Added a temp-project smoke test that installs the package via `file:` and validates `jsx-ai`, `jsx-runtime`, `jsx-dev-runtime`, and provider exports.

## 🟢 Priority: Features
- [x] ~~**Add smoke tests for package consumer import paths**~~ — ✅ DONE. Verified published-style consumer imports in a clean temp project using Bun.
- [x] ~~**Split smoke tests into a dedicated test file/script**~~ — ✅ DONE. Moved consumer smoke coverage into `src/consumer-smoke.test.ts` and added `test:smoke`.
- [x] ~~**Add publish-mode smoke coverage**~~ — ✅ DONE. Added packed-tarball smoke coverage using `bun pm pack` to verify the publish artifact behaves like the local install.
- [x] ~~**Add registry-install smoke coverage**~~ — ✅ DONE. Added `src/registry-smoke.test.ts`, `test:smoke:registry`, and a dedicated `registry-smoke.yml` workflow for manual or release-triggered registry validation.
- [x] ~~**Harden release smoke workflow error reporting**~~ — ✅ DONE. Added npm-registry preflight checks, explicit target logging, and failure hints for delayed publication in the registry smoke path.
- [x] ~~**Add retry/backoff to release registry smoke**~~ — ✅ DONE. Added configurable retry/backoff to registry availability checks and enabled a 6-attempt / 10s-delay policy in the release workflow.
- [x] ~~**Add workflow summary output for smoke jobs**~~ — ✅ DONE. Added GitHub Actions step summaries for unit, consumer smoke, and registry smoke jobs with command/result/target details.
- [x] ~~**Add duration metrics to workflow summaries**~~ — ✅ DONE. Added per-job elapsed duration output to unit, consumer smoke, and registry smoke summaries.
- [x] ~~**Add artifact/log links to workflow summaries**~~ — ✅ DONE. Added direct workflow run, attempt, and Actions overview links to CI and registry smoke summaries.
- [x] ~~**Add release-doc note for manual registry smoke runs**~~ — ✅ DONE. Documented manual `registry-smoke.yml` usage and package-spec guidance in the README release smoke section.
- [x] ~~**Document release checklist**~~ — ✅ DONE. Added a concise README release checklist covering local tests, packed-artifact verification, publish, and registry smoke validation.
- [x] ~~**Add release badge/docs link for registry smoke workflow**~~ — ✅ DONE. Added a top-level README badge and quick link pointing to the registry smoke workflow and release checklist.
- [x] ~~**Document release trigger expectations**~~ — ✅ DONE. Clarified in the README that registry smoke auto-runs on GitHub Release `published` events, while plain tag pushes still need manual dispatch.
- [x] ~~**Document workflow badge semantics**~~ — ✅ DONE. Added a small README badge guide explaining the top-level `test` and `registry smoke` links.
- [x] ~~**Add contributor-facing CI map**~~ — ✅ DONE. Added a short README CI map showing which workflows/jobs own unit, consumer smoke, and registry smoke coverage.
- [x] ~~**Document local-vs-CI test ownership**~~ — ✅ DONE. Added a README section describing when to use `bun test`, focused scripts, and manual workflow dispatches.
- [x] ~~**Document bench-vs-test expectations**~~ — ✅ DONE. Added README guidance explaining benchmarks vs correctness checks and when maintainers should run each.
- [x] ~~**Add quick contributor release flow**~~ — ✅ DONE. Added a compact maintainer-oriented merge-to-publish flow in the README.
- [x] ~~**Document version bump expectations**~~ — ✅ DONE. Added README guidance aligning `package.json`, release tags, published npm versions, and registry smoke targets.
- [x] ~~**Document post-release verification expectations**~~ — ✅ DONE. Added a README post-release verification checklist covering npm visibility, badges, release/tag alignment, and example freshness.
- [x] ~~**Consolidate release guidance into a dedicated maintainer section**~~ — ✅ DONE. Grouped release smoke, checklist, version alignment, and post-release verification under a dedicated `Maintainer release guide` section in the README.
- [ ] **Add dedicated anchors/TOC hints for maintainer docs** — Make the new maintainer section easier to jump to from the top of the README.

## 📝 Architecture Notes
- Package manager/runtime: Bun
- Test command: `bun test`
- Focused scripts: `bun run test:unit`, `bun run test:smoke`, `bun run test:smoke:registry`
- Current local suite status: 50 passing tests across unit + smoke coverage.
- Bench command: `bun run bench/strategies.ts`
- Main test file currently discovered: `src/index.test.ts`
- LLM entrypoints exported from `src/index.ts`, implementation in `src/llm.ts`
- `src/llm.ts` now treats `measure-fn` as optional telemetry by using a dynamic import fallback around fetch measurement.
- `src/llm.ts` includes an explicitly internal test-only telemetry loader override used by `src/index.test.ts` to simulate missing optional instrumentation.
- CI workflow: `.github/workflows/test.yml` runs separate Unit and Consumer smoke jobs on push, pull_request, `release/**` branches, and `v*` tags, and writes per-job summaries with durations and run links.
- Registry workflow: `.github/workflows/registry-smoke.yml` runs registry-install validation on manual dispatch or published releases, with retry/backoff for npm propagation delays and a duration-aware summary with run links.
- README now includes a dedicated `Maintainer release guide` section covering when to run the manual registry workflow, how to choose the package spec, which release events auto-trigger registry smoke, a short release checklist, a top-level registry smoke link, a badge guide, a contributor-facing CI map, guidance on choosing local vs CI test paths, benchmark-vs-test expectations, a quick maintainer release flow, version bump expectations, and post-release verification.
- Consumer smoke coverage lives in `src/consumer-smoke.test.ts` and verifies both `file:` installs and packed publish artifacts via `bun pm pack` + temp-project `bun run --install=fallback`.
- Registry smoke coverage lives in `src/registry-smoke.test.ts`, uses `REGISTRY_SMOKE_SPEC`, and now performs an npm metadata preflight so missing versions fail with actionable diagnostics.

## ⚠️ Security Reminders
- Do not commit API keys or `.config.toml` secrets.
- Prefer env vars for provider credentials during local testing.
