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
- [ ] **Add CI status coverage for consumer smoke tests** — Extend the workflow once smoke-test coverage exists so published import paths are validated too.
- [x] ~~**Add a package-consumer smoke test**~~ — ✅ DONE. Added a temp-project smoke test that installs the package via `file:` and validates `jsx-ai`, `jsx-runtime`, `jsx-dev-runtime`, and provider exports.

## 🟢 Priority: Features
- [x] ~~**Add smoke tests for package consumer import paths**~~ — ✅ DONE. Verified published-style consumer imports in a clean temp project using Bun.
- [ ] **Split smoke tests into a dedicated test file/script** — Keep the main unit suite focused while preserving clean-consumer coverage.

## 📝 Architecture Notes
- Package manager/runtime: Bun
- Test command: `bun test`
- Current local suite status: 48 passing tests, including a temp-project consumer smoke test.
- Bench command: `bun run bench/strategies.ts`
- Main test file currently discovered: `src/index.test.ts`
- LLM entrypoints exported from `src/index.ts`, implementation in `src/llm.ts`
- `src/llm.ts` now treats `measure-fn` as optional telemetry by using a dynamic import fallback around fetch measurement.
- `src/llm.ts` includes an explicitly internal test-only telemetry loader override used by `src/index.test.ts` to simulate missing optional instrumentation.
- CI workflow: `.github/workflows/test.yml` runs Bun install + tests on push, pull_request, `release/**` branches, and `v*` tags.
- Consumer smoke coverage currently lives in `src/index.test.ts` and uses `bun run --install=fallback` inside a temp project to verify published-style imports.

## ⚠️ Security Reminders
- Do not commit API keys or `.config.toml` secrets.
- Prefer env vars for provider credentials during local testing.
