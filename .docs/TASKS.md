# Project Tasks & Ideas

## 🔴 Priority: Fix
- [x] ~~**Add install-state test guidance**~~ — ✅ DONE. Added README development instructions that call out `bun install` before `bun test` on a fresh clone.

## 🟡 Priority: Improve
- [x] ~~**Unblock test suite from missing dependency install**~~ — ✅ DONE. Installed repo dependencies and verified `bun test` passes locally (46 passing).
- [x] ~~**Add CI test workflow**~~ — ✅ DONE. Added GitHub Actions workflow to run `bun install --frozen-lockfile` and `bun test` on pushes and pull requests.
- [x] ~~**Audit dependency usage**~~ — ✅ DONE. Replaced the hard runtime import of `measure-fn` with a safe dynamic fallback in `src/llm.ts` and removed it from direct package dependencies.
- [ ] **Add branch coverage for release branches** — Decide whether the test workflow should also run on version tags or release branches.
- [ ] **Add explicit fallback test for optional telemetry import** — Verify `callLLM` still works when `measure-fn` is unavailable in a clean consumer install.

## 🟢 Priority: Features
- [ ] **Add smoke tests for package consumer import paths** — Verify `jsx-ai`, `jsx-runtime`, and provider exports work from a clean consumer project.

## 📝 Architecture Notes
- Package manager/runtime: Bun
- Test command: `bun test`
- Bench command: `bun run bench/strategies.ts`
- Main test file currently discovered: `src/index.test.ts`
- LLM entrypoints exported from `src/index.ts`, implementation in `src/llm.ts`
- `src/llm.ts` now treats `measure-fn` as optional telemetry by using a dynamic import fallback around fetch measurement.
- CI workflow: `.github/workflows/test.yml` runs Bun install + tests on push and pull_request

## ⚠️ Security Reminders
- Do not commit API keys or `.config.toml` secrets.
- Prefer env vars for provider credentials during local testing.
