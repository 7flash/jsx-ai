# Contributor CI & Test Guide

## CI map

For contributors/maintainers:
- `.github/workflows/test.yml`
  - **Unit tests** job → `bun run test:unit`
  - **Consumer smoke test** job → `bun run test:smoke`
  - **Docs snippet smoke test** job → `bun run test:docs` (runs only when docs/package/export-related files change)
- `.github/workflows/registry-smoke.yml`
  - **Registry install smoke test** → `bun run test:smoke:registry`
  - used for manual registry validation and release-triggered publish verification

## Which test path to use

- Use `bun test` when you want the full local confidence pass before merging or publishing.
- Use `bun run test:unit` when you are iterating on library internals and want the fast unit/provider/strategy suite.
- Use `bun run test:smoke` when you changed packaging, exports, README install guidance, or consumer-facing entrypoints.
- Use `bun run test:docs` when you changed quickstart/provider/docs snippets and want to verify the guide code still runs in a clean consumer project.
- Use the **Registry smoke** workflow / `bun run test:smoke:registry` when you need to validate an actually published npm package version.
- Use CI/workflow dispatch when you want the same environment GitHub sees, especially for release validation and post-publish checks.

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
