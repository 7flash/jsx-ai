# Agent benchmark methodology

This benchmark compares tool-call representation strategies by running the same autonomous coding agent to a final task outcome. It intentionally does **not** assign a fixed number of conversational turns.

Each strategy receives the same scenario, tool executor, model, temperature, randomized run order, and hard budgets for model steps, tool calls, total input/output tokens, per-response tokens, and wall-clock time. The agent runs until it calls `done`, produces no recoverable tool calls, or exhausts a budget.

## What is scored

The headline score comes from an independent evaluator over the final workspace. Intermediate behavior such as filenames, number of writes, planning style, or whether tools were batched does not directly earn points unless the task contract explicitly requires it.

The `kv-store` scenario starts the generated Bun server and tests HTTP behavior, TTL expiration, deletion, listing, and SQLite persistence across a restart. The `ttl-cache` scenario imports the required public module and executes hidden behavioral checks. Both also include small static contract checks such as required technology/tests.

## Error accounting

Infrastructure/API failures are **not converted into 0% model scores**. They are reported as `infrastructure_error` and excluded from capability estimates. Budget exhaustion, parser truncation, no-tool stopping, tool failures, token use, latency, and tool count are model/protocol outcomes and remain visible in the report.

## Statistics

For every scenario/strategy, the summary reports attempted vs. valid runs, infrastructure errors, success rate with a Wilson 95% confidence interval, mean score and sample standard deviation, p50/p95 tokens and latency, p50 tool calls, token cost per successful run, truncations, and stop-reason counts. Strategy order is deterministically shuffled on each iteration to reduce order/rate-limit bias.

The default iteration count is 10. For publishable claims, increase `BENCH_ITERATIONS` substantially and run across multiple models/providers; this benchmark deliberately does not claim that a small local run establishes universal strategy superiority.

## Run

```bash
bun run bench
```

Useful environment variables:

```bash
BENCH_MODEL=gemini-2.5-flash
BENCH_ITERATIONS=20
BENCH_MAX_STEPS=12
BENCH_MAX_TOOL_CALLS=64
BENCH_MAX_INPUT_TOKENS=120000
BENCH_MAX_OUTPUT_TOKENS=48000
BENCH_RESPONSE_MAX_TOKENS=16000
BENCH_MAX_DURATION_MS=180000
```

Generated artifacts go to `bench/logs/<run-id>/`, `bench/work/<run-id>/`, `bench/results.json`, and `bench/summary.txt`.
