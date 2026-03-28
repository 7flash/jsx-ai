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
- [x] ~~**Add dedicated anchors/TOC hints for maintainer docs**~~ — ✅ DONE. Added top-of-README quick links pointing to Development, Maintainer release guide, and feature overview sections.
- [x] ~~**Add release workflow links inside the maintainer section**~~ — ✅ DONE. Added direct links to the main test workflow and registry smoke workflow inside the maintainer guide.
- [x] ~~**Tighten README section ordering**~~ — ✅ DONE. Moved the maintainer release guide near the end of the README so end-user usage and API docs stay prominent.
- [x] ~~**Add end-of-README maintainer note near License**~~ — ✅ DONE. Added a small footer note pointing maintainers back to the release guide.
- [x] ~~**Consider splitting maintainer guidance into separate docs**~~ — ✅ DONE. Moved release operations into `docs/maintainer-release.md` and turned README into a lighter pointer to that guide.
- [x] ~~**Add dedicated docs index/reference links**~~ — ✅ DONE. Added `docs/README.md` and linked it from the top of the main README for discoverability.
- [x] ~~**Expand docs index as more guides appear**~~ — ✅ DONE. Added `docs/contributor-ci.md` and updated the docs index plus README quick links.
- [x] ~~**Add architecture/dev internals guide**~~ — ✅ DONE. Added `docs/architecture.md` covering package structure, call flow, and core responsibility boundaries.
- [x] ~~**Document extension/customization architecture**~~ — ✅ DONE. Added `docs/extensibility.md` covering custom providers, strategies, hooks, and extension-point selection.
- [x] ~~**Add examples doc/index**~~ — ✅ DONE. Added `docs/examples.md` and linked it from both the docs index and README quick links.
- [x] ~~**Add more example files**~~ — ✅ DONE. Added `examples/render-prompt.tsx` and `examples/customizations.tsx` to complement the coding-agent example.
- [x] ~~**Add skills/examples coverage**~~ — ✅ DONE. Added `examples/skills.tsx` plus sample skill markdown files to demonstrate discovery and resolution.
- [x] ~~**Add streaming/text examples**~~ — ✅ DONE. Added self-contained runnable demos for `callText()` and `streamLLM()` using mock/local transport behavior.
- [x] ~~**Add provider-specific examples**~~ — ✅ DONE. Added `examples/providers.tsx` showing Gemini, OpenAI-compatible, Anthropic, and explicit provider override flows.
- [x] ~~**Add strategy-specific examples**~~ — ✅ DONE. Added `examples/strategies.tsx` covering how `native`, `xml`, `nlt`, and `hybrid` prepare prompts and parse responses.
- [x] ~~**Add natural-strategy coverage**~~ — ✅ DONE. Added `examples/natural-strategy.tsx` showing the standalone plain-language `TOOL_CALL` protocol and parser behavior.
- [x] ~~**Add docs/readme discoverability for examples**~~ — ✅ DONE. Added a runnable examples map to `README.md` and `docs/README.md` so the expanded example set is visible without digging into the examples guide.
- [x] ~~**Add API reference docs**~~ — ✅ DONE. Added `docs/api-reference.md` and linked it from the README plus docs index for core exports, skills, hooks, strategies, providers, and types.
- [x] ~~**Add compatibility/config docs**~~ — ✅ DONE. Added `docs/configuration.md` covering env vars, provider detection, `.config.toml`, explorer telemetry, and OpenAI-compatible base URL overrides.
- [x] ~~**Add troubleshooting guide**~~ — ✅ DONE. Added `docs/troubleshooting.md` and linked it from the README/docs index for API key, provider routing, skills, streaming, and smoke-test debugging.
- [x] ~~**Add docs landing-page polish**~~ — ✅ DONE. Reworked `README.md` and `docs/README.md` into clearer “start here / build and extend / contribute and maintain” entry flows.
- [x] ~~**Add docs cross-links between guides**~~ — ✅ DONE. Added or expanded “Related guides” sections across the main docs so readers can move laterally without returning to the docs index.
- [x] ~~**Add top-level quickstart guide**~~ — ✅ DONE. Added `docs/quickstart.md` and linked it from the README plus docs index for a minimal install → config → first `callLLM()` path.
- [x] ~~**Add copy-paste code snippets for provider choices**~~ — ✅ DONE. Added `docs/provider-snippets.md` with minimal Gemini, OpenAI-compatible, Anthropic, text-only, and streaming starter snippets.
- [x] ~~**Add README/API consistency pass**~~ — ✅ DONE. Reconciled README/docs with the typed API by documenting `<prompt provider="...">`, broadening provider override docs, correcting strategy descriptions, and aligning extraction/tests around the public `provider` field.
- [x] ~~**Add export surface smoke coverage for docs examples**~~ — ✅ DONE. Expanded `src/consumer-smoke.test.ts` to validate the documented consumer-facing exports and JSX prompt props used across the guides.
- [x] ~~**Add guide-snippet verification strategy**~~ — ✅ DONE. Added `src/docs-snippets.test.ts` plus `bun run test:docs` to keep important quickstart/provider/API snippets runnable in a clean consumer project.
- [x] ~~**Add packed-tarball docs-snippet coverage**~~ — ✅ DONE. Extended `src/docs-snippets.test.ts` so the same guide snippets are verified against both `file:` installs and the packed publish artifact.
- [x] ~~**Add docs verification to CI**~~ — ✅ DONE. Added a dedicated `Docs snippet smoke test` job to `.github/workflows/test.yml` so guide-snippet drift gets its own visible status check.
- [x] ~~**Consider path-filtering or job-scope tuning for docs smoke**~~ — ✅ DONE. Added a small change-detection job in `.github/workflows/test.yml` so docs smoke runs only for docs/package/export-related changes.
- [x] ~~**Consider path-filtering for consumer smoke too**~~ — ✅ DONE. Extended the same change-detection job so consumer smoke runs only for packaging/export-relevant changes.
- [x] ~~**Consider path-filtering for unit tests**~~ — ✅ DONE. Chose to keep unit tests always-on and documented that decision in the workflow plus contributor CI guide because unit regressions are not safely scope-reducible.
- [x] ~~**Consider consolidating CI change detection docs**~~ — ✅ DONE. Added a dedicated CI change-detection section to `docs/contributor-ci.md` covering exact path filters, rationale, and update rules.
- [x] ~~**Consider workflow comments for path filters**~~ — ✅ DONE. Added brief inline comments near the workflow filter blocks so YAML editors can see the consumer/docs smoke scope rationale immediately.
- [x] ~~**Consider workflow comments for registry smoke rationale**~~ — ✅ DONE. Added inline comments in `.github/workflows/registry-smoke.yml` explaining why the workflow is manual/release-only and how release tags resolve to npm package specs.
- [x] ~~**Consider CI docs cross-link from maintainer release guide**~~ — ✅ DONE. Added direct contributor-CI/doc-index pointers inside `docs/maintainer-release.md` so workflow sections link back to CI job behavior docs.
- [x] ~~**Consider top-level docs index link from README release note**~~ — ✅ DONE. Updated the README release/maintainer note text so both pointers route readers through the docs index before the release guide.
- [ ] **Consider README quick links grouping polish** — The next useful docs pass is checking whether the top-level README groups should surface the docs index more prominently alongside quickstart and maintainer links.

## 📝 Architecture Notes
- Package manager/runtime: Bun
- Test command: `bun test`
- Focused scripts: `bun run test:unit`, `bun run test:smoke`, `bun run test:docs`, `bun run test:smoke:registry`
- Current local suite status: 52 passing tests across unit + smoke coverage.
- Bench command: `bun run bench/strategies.ts`
- Main test file currently discovered: `src/index.test.ts`
- LLM entrypoints exported from `src/index.ts`, implementation in `src/llm.ts`; provider overrides are supported via both `CallOptions.provider` and `<prompt provider="...">`.
- `src/llm.ts` now treats `measure-fn` as optional telemetry by using a dynamic import fallback around fetch measurement.
- `src/llm.ts` includes an explicitly internal test-only telemetry loader override used by `src/index.test.ts` to simulate missing optional instrumentation.
- CI workflow: `.github/workflows/test.yml` runs separate Unit and Consumer smoke jobs on push, pull_request, `release/**` branches, and `v*` tags, and writes per-job summaries with durations and run links.
- Registry workflow: `.github/workflows/registry-smoke.yml` runs registry-install validation on manual dispatch or published releases, with retry/backoff for npm propagation delays and a duration-aware summary with run links.
- Contributor/testing guidance now lives in `docs/contributor-ci.md`; maintainer/release operations live in `docs/maintainer-release.md`; architecture details live in `docs/architecture.md`; runnable example references live in `docs/examples.md`; API/export reference now lives in `docs/api-reference.md`; compatibility/configuration guidance now lives in `docs/configuration.md`; troubleshooting guidance now lives in `docs/troubleshooting.md`; quickstart guidance now lives in `docs/quickstart.md`; provider starter snippets now live in `docs/provider-snippets.md`; extension/customization guidance lives in `docs/extensibility.md`; example entrypoints now include `examples/coding-agent.tsx`, `examples/render-prompt.tsx`, `examples/customizations.tsx`, `examples/skills.tsx`, `examples/call-text.ts`, `examples/stream-text.ts`, `examples/providers.tsx`, `examples/strategies.tsx`, and `examples/natural-strategy.tsx`; `docs/README.md` acts as a lightweight docs index and README keeps top-level quick links for discoverability.
- Consumer smoke coverage lives in `src/consumer-smoke.test.ts` and verifies both `file:` installs and packed publish artifacts via `bun pm pack` + temp-project `bun run --install=fallback`.
- Registry smoke coverage lives in `src/registry-smoke.test.ts`, uses `REGISTRY_SMOKE_SPEC`, and now performs an npm metadata preflight so missing versions fail with actionable diagnostics.

## ⚠️ Security Reminders
- Do not commit API keys or `.config.toml` secrets.
- Prefer env vars for provider credentials during local testing.
