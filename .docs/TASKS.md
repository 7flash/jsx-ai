# Project Tasks & Ideas

## 🔴 Priority: Fix
- [x] ~~**Add install-state test guidance**~~ — ✅ DONE. Added README development instructions that call out `bun install` before `bun test` on a fresh clone.

## 🟡 Priority: Improve
- [x] ~~**Unblock test suite from missing dependency install**~~ — ✅ DONE. Installed repo dependencies and verified `bun test` passes locally (46 passing).
- [x] ~~**Add CI test workflow**~~ — ✅ DONE. Added GitHub Actions workflow to run `bun install --frozen-lockfile` and `bun test` on pushes and pull requests.
- [x] ~~**Audit dependency usage**~~ — ✅ DONE. Replaced the hard runtime import of `measure-fn` with a safe dynamic fallback in `src/llm.ts` and removed it from direct package dependencies.
- [x] ~~**Add explicit fallback test for optional telemetry import**~~ — ✅ DONE. Added a regression test that forces the telemetry loader to fail and verifies `callLLM` still succeeds.
- [x] ~~**Add branch coverage for release branches**~~ — ✅ DONE. Expanded CI triggers to run on `release/**` branches and `v*` version tags in addition to main/master and pull requests.
- [ ] **Hide test-only telemetry loader hook from public API docs** — Keep the fallback test seam internal-facing and avoid accidental consumer use.
- [ ] **Add CI status coverage for consumer smoke tests** — Extend the workflow once smoke-test coverage exists so published import paths are validated too.

## 🟢 Priority: Features
- [ ] **Add smoke tests for package consumer import paths** — Verify `jsx-ai`, `jsx-runtime`, and provider exports work from a clean consumer project.

## 📝 Architecture Notes
- Package manager/runtime: Bun
- Test command: `bun test`
- Bench command: `bun run bench/strategies.ts`
- Main test file currently discovered: `src/index.test.ts`
- LLM entrypoints exported from `src/index.ts`, implementation in `src/llm.ts`
- `src/llm.ts` now treats `measure-fn` as optional telemetry by using a dynamic import fallback around fetch measurement.
- `src/llm.ts` includes a test-only telemetry loader override used by `src/index.test.ts` to simulate missing optional instrumentation.
- CI workflow: `.github/workflows/test.yml` runs Bun install + tests on push, pull_request, `release/**` branches, and `v*` tags.

## ⚠️ Security Reminders
- Do not commit API keys or `.config.toml` secrets.
- Prefer env vars for provider credentials during local testing.
