# Contributor CI & Test Guide

## CI map

For contributors/maintainers:
- `.github/workflows/test.yml`
  - **Unit tests** job → `bun run test:unit` (always runs; intentionally not path-filtered)
  - **Consumer smoke test** job → `bun run test:smoke` (runs only when packaging/export-related files change)
  - **Docs snippet smoke test** job → `bun run test:docs` (runs only when docs/package/export-related files change)
- `.github/workflows/registry-smoke.yml`
  - **Registry install smoke test** → `bun run test:smoke:registry`
  - used for manual registry validation and release-triggered publish verification

## Which test path to use

- Use `bun test` when you want the full local confidence pass before merging or publishing.
- Use `bun run test:unit` when you are iterating on library internals and want the fast unit/provider/strategy suite.
- In CI, the unit test job intentionally always runs; unlike smoke jobs, it is not path-filtered because core correctness can be affected by changes that are hard to scope safely.
- Use `bun run test:smoke` when you changed packaging, exports, README install guidance, or consumer-facing entrypoints.
- Use `bun run test:docs` when you changed quickstart/provider/docs snippets and want to verify the guide code still runs in a clean consumer project.
- Use the **Registry smoke** workflow / `bun run test:smoke:registry` when you need to validate an actually published npm package version.
- Use CI/workflow dispatch when you want the same environment GitHub sees, especially for release validation and post-publish checks.

## CI change-detection rules

The main test workflow uses a small change-detection job to scope smoke coverage.

### Unit tests

- **Always run**
- Rationale: unit coverage protects core correctness across runtime, extraction, strategies, providers, skills, and streaming.
- Policy: do **not** path-filter this job unless the project intentionally accepts weaker regression protection.

### Consumer smoke test

Runs only when these paths change:

- `package.json`
- `src/**`
- `tsconfig.json`
- `README.md`

Rationale:
- validates packaging/export surface
- validates consumer-facing entrypoints
- README install guidance can affect how consumers use the package

### Docs snippet smoke test

Runs only when these paths change:

- `README.md`
- `docs/**`
- `examples/**`
- `package.json`
- `src/**`
- `tsconfig.json`

Rationale:
- verifies important quickstart/provider/API snippets in a clean consumer project
- docs/examples changes can invalidate snippets directly
- package/export/runtime changes can invalidate guide code indirectly

### Registry smoke test

- Separate workflow: `.github/workflows/registry-smoke.yml`
- Not part of normal PR CI
- Use for manual or release-triggered verification of an actually published npm package

### When updating path filters

If you change workflow scoping in `.github/workflows/test.yml`:

1. update this document at the same time
2. keep unit tests as the safety net unless there is a very strong reason not to
3. prefer adding paths to smoke filters over removing them when unsure
4. treat `package.json`, `src/**`, and docs/examples changes as high-risk for consumer/docs drift

## Benchmarks vs tests

- Use tests (`bun test`, `bun run test:unit`, `bun run test:smoke`) for correctness, regressions, packaging safety, and release confidence.
- Use `bun run bench/strategies.ts` when you are comparing strategy behavior, prompt formats, or agentic quality/performance tradeoffs.
- Do **not** treat benchmark output as a substitute for passing tests — benchmarks explain behavior and performance, tests enforce correctness.
- Run benchmarks when changing strategy logic, evaluation scenarios, or benchmark methodology; skip them for ordinary docs/config changes unless you are validating a performance claim.

## Related guides

- [Troubleshooting guide](./troubleshooting.md)
- [Configuration & compatibility guide](./configuration.md)
- [Architecture guide](./architecture.md)
- [Examples guide](./examples.md)
- [Maintainer release guide](./maintainer-release.md)
