# Project Tasks & Ideas

## 🔴 Priority: Fix
- [ ] **Add install-state test guidance** — Document that a fresh clone needs `bun install` before `bun test`, and verify the first-run developer experience.

## 🟡 Priority: Improve
- [x] ~~**Unblock test suite from missing dependency install**~~ — ✅ DONE. Installed repo dependencies and verified `bun test` passes locally (46 passing).
- [ ] **Add CI test workflow** — Run `bun install` and `bun test` automatically in GitHub Actions so dependency/setup issues surface immediately.
- [ ] **Audit dependency usage** — Confirm whether `measure-fn` should remain a runtime dependency or be wrapped/optional for library consumers.

## 🟢 Priority: Features
- [ ] **Add smoke tests for package consumer import paths** — Verify `jsx-ai`, `jsx-runtime`, and provider exports work from a clean consumer project.

## 📝 Architecture Notes
- Package manager/runtime: Bun
- Test command: `bun test`
- Bench command: `bun run bench/strategies.ts`
- Main test file currently discovered: `src/index.test.ts`
- LLM entrypoints exported from `src/index.ts`, implementation in `src/llm.ts`

## ⚠️ Security Reminders
- Do not commit API keys or `.config.toml` secrets.
- Prefer env vars for provider credentials during local testing.
