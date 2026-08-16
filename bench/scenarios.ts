import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative } from "path";
import { pathToFileURL } from "url";
import { md } from "../src/index";

export interface EvaluationCheck {
  name: string;
  passed: boolean;
  weight: number;
  detail?: string;
}

export interface EvaluationResult {
  score: number;
  success: boolean;
  checks: EvaluationCheck[];
}

export interface BenchmarkScenario {
  name: string;
  task: string;
  setup(workspace: string): Promise<void> | void;
  evaluate(workspace: string, runIndex: number): Promise<EvaluationResult>;
}

function scoreChecks(checks: EvaluationCheck[]): EvaluationResult {
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce(
    (sum, check) => sum + (check.passed ? check.weight : 0),
    0,
  );
  return {
    score: total ? Math.round((earned / total) * 100) : 0,
    success: checks.length > 0 && checks.every((check) => check.passed),
    checks,
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function baseSetup(workspace: string): void {
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeJson(join(workspace, "package.json"), {
    name: "jsx-ai-benchmark-workspace",
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: { test: "bun test" },
  });
  writeJson(join(workspace, "tsconfig.json"), {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      types: ["bun"],
    },
    include: ["src/**/*.ts", "src/**/*.tsx"],
  });
}

function filesRecursively(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else out.push(path);
    }
  };
  visit(root);
  return out;
}

function sourceSnapshot(
  workspace: string,
): Array<{ path: string; source: string }> {
  return filesRecursively(workspace)
    .filter((path) => /\.(?:ts|tsx|js|mjs|cjs)$/.test(path))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

async function waitForServer(port: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/kv`, {
        signal: AbortSignal.timeout(400),
      });
      return true;
    } catch {
      // Connection failures are expected while the server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

interface ManagedProcess {
  kill(): void;
  exited: Promise<number>;
}

async function stopProcess(proc: ManagedProcess | undefined): Promise<void> {
  if (!proc) return;
  try {
    proc.kill();
  } catch {
    /* process may already have exited */
  }
  try {
    await Promise.race([
      proc.exited,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  } catch {
    // Cleanup is best-effort; evaluation results capture whether the server behaved correctly.
  }
}

function startBunFile(
  workspace: string,
  file: string,
  port: number,
): ManagedProcess {
  return Bun.spawn(["bun", "run", relative(workspace, file)], {
    cwd: workspace,
    env: { ...process.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function request(
  port: number,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      signal: AbortSignal.timeout(3000),
    });
    return { status: res.status, text: await res.text() };
  } catch (error) {
    return {
      status: 0,
      text: error instanceof Error ? error.message : String(error),
    };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withFailureDetail(
  passed: boolean,
  detail: string | undefined,
): Pick<EvaluationCheck, "passed" | "detail"> {
  return passed ? { passed } : { passed, ...(detail ? { detail } : {}) };
}

const kvStore: BenchmarkScenario = {
  name: "kv-store",
  task: md`
    Build a persistent key-value HTTP API in this isolated workspace.

    Contract:

    - Use Bun + bun:sqlite. Data must survive a server restart.
    - Serve with Bun.serve and bind to process.env.PORT when it is provided.
    - POST /kv/:key — JSON body { value, ttl_seconds? }. Store the value.
    - GET /kv/:key — return the stored value; return 404 when missing or expired.
    - DELETE /kv/:key — delete the key.
    - GET /kv — list all non-expired keys. Expired keys must not appear.
    - Expiration must be enforced automatically/lazily without returning stale values.
    - TypeScript strict mode; avoid explicit any.
    - Add meaningful bun:test coverage.

    You may inspect files, activate useful skills, write files, and run diagnostics/tests.
    Keep iterating until the implementation is complete. Call done only when you believe the
    independent evaluator should pass. Do not rely on a particular source filename; the evaluator
    finds the Bun.serve entrypoint by its contents.
  `,
  setup(workspace) {
    baseSetup(workspace);
  },
  async evaluate(workspace, runIndex) {
    const sources = sourceSnapshot(workspace);
    const all = sources.map((item) => item.source).join("\n");
    const serverFile = sources.find((item) =>
      /Bun\.serve\s*\(/.test(item.source),
    )?.path;
    const tests = sources.filter((item) =>
      /bun:test|\b(?:test|it)\s*\(/.test(item.source),
    );
    const checks: EvaluationCheck[] = [
      { name: "uses_bun_sqlite", passed: /bun:sqlite/.test(all), weight: 8 },
      { name: "uses_bun_serve", passed: !!serverFile, weight: 5 },
      { name: "has_tests", passed: tests.length > 0, weight: 5 },
      {
        name: "avoids_explicit_any",
        passed: all.length > 0 && !/:\s*any\b/.test(all),
        weight: 2,
      },
    ];

    const dynamic = {
      server_starts: false,
      missing_404: false,
      set_get: false,
      list_nonexpired: false,
      ttl_expiration: false,
      ttl_cleanup_list: false,
      delete: false,
      persistence_restart: false,
    };

    let first: ManagedProcess | undefined;
    let second: ManagedProcess | undefined;
    let runtimeFailure: string | undefined;
    if (serverFile) {
      const port = 24000 + (runIndex % 10000);
      try {
        first = startBunFile(workspace, serverFile, port);
        dynamic.server_starts = await waitForServer(port);
        if (dynamic.server_starts) {
          const missing = await request(port, "/kv/does-not-exist");
          dynamic.missing_404 = missing.status === 404;

          const persistSet = await request(port, "/kv/persist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value: "persist-me" }),
          });
          const persistGet = await request(port, "/kv/persist");
          dynamic.set_get =
            persistSet.status >= 200 &&
            persistSet.status < 300 &&
            persistGet.status === 200 &&
            persistGet.text.includes("persist-me");

          await request(port, "/kv/temp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value: "temporary", ttl_seconds: 1 }),
          });
          const listBefore = await request(port, "/kv");
          dynamic.list_nonexpired =
            listBefore.status === 200 &&
            listBefore.text.includes("persist") &&
            listBefore.text.includes("temp");

          await new Promise((resolve) => setTimeout(resolve, 1200));
          const expired = await request(port, "/kv/temp");
          dynamic.ttl_expiration = expired.status === 404;
          const listAfter = await request(port, "/kv");
          dynamic.ttl_cleanup_list =
            listAfter.status === 200 &&
            listAfter.text.includes("persist") &&
            !listAfter.text.includes("temp");

          await request(port, "/kv/delete-me", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value: "bye" }),
          });
          const deleted = await request(port, "/kv/delete-me", {
            method: "DELETE",
          });
          const afterDelete = await request(port, "/kv/delete-me");
          dynamic.delete =
            deleted.status >= 200 &&
            deleted.status < 300 &&
            afterDelete.status === 404;

          await stopProcess(first);
          first = undefined;
          second = startBunFile(workspace, serverFile, port);
          if (await waitForServer(port)) {
            const persisted = await request(port, "/kv/persist");
            dynamic.persistence_restart =
              persisted.status === 200 && persisted.text.includes("persist-me");
          }
        }
      } catch (error) {
        runtimeFailure = describeError(error);
      } finally {
        await stopProcess(first);
        await stopProcess(second);
      }
    }

    checks.push(
      {
        name: "server_starts_on_requested_port",
        weight: 10,
        ...withFailureDetail(dynamic.server_starts, runtimeFailure),
      },
      {
        name: "missing_returns_404",
        weight: 5,
        ...withFailureDetail(dynamic.missing_404, runtimeFailure),
      },
      {
        name: "set_then_get",
        weight: 15,
        ...withFailureDetail(dynamic.set_get, runtimeFailure),
      },
      {
        name: "lists_nonexpired_keys",
        weight: 10,
        ...withFailureDetail(dynamic.list_nonexpired, runtimeFailure),
      },
      {
        name: "ttl_returns_404",
        weight: 15,
        ...withFailureDetail(dynamic.ttl_expiration, runtimeFailure),
      },
      {
        name: "expired_removed_from_list",
        weight: 5,
        ...withFailureDetail(dynamic.ttl_cleanup_list, runtimeFailure),
      },
      {
        name: "delete_removes_key",
        weight: 10,
        ...withFailureDetail(dynamic.delete, runtimeFailure),
      },
      {
        name: "sqlite_survives_restart",
        weight: 10,
        ...withFailureDetail(dynamic.persistence_restart, runtimeFailure),
      },
    );
    return scoreChecks(checks);
  },
};

const ttlCache: BenchmarkScenario = {
  name: "ttl-cache",
  task: md`
    Implement a reusable in-memory TTL cache in src/cache.ts.

    Required public API:

    - export class TTLCache<V>
    - set(key: string, value: V, ttlMs?: number): void
    - get(key: string): V | undefined
    - delete(key: string): boolean
    - keys(): string[]

    Semantics:

    - Entries with ttlMs expire after that many milliseconds.
    - get() must never return an expired value.
    - keys() must omit expired entries and clean them up lazily.
    - Setting an existing key replaces its value and expiration.
    - Entries without ttlMs do not expire.
    - TypeScript strict mode, no explicit any, and meaningful bun:test coverage.

    Use the tools to implement and test it. Keep iterating until it is correct, then call done.
  `,
  setup(workspace) {
    baseSetup(workspace);
  },
  async evaluate(workspace) {
    const target = join(workspace, "src/cache.ts");
    const source = existsSync(target) ? readFileSync(target, "utf8") : "";
    const all = sourceSnapshot(workspace)
      .map((item) => item.source)
      .join("\n");
    const checks: EvaluationCheck[] = [
      {
        name: "exports_ttl_cache",
        passed: /export\s+class\s+TTLCache/.test(source),
        weight: 5,
      },
      {
        name: "generic_value_type",
        passed: /class\s+TTLCache\s*<\s*V\s*>/.test(source),
        weight: 5,
      },
      {
        name: "has_tests",
        passed: /bun:test|\b(?:test|it)\s*\(/.test(all),
        weight: 5,
      },
      {
        name: "avoids_explicit_any",
        passed: source.length > 0 && !/:\s*any\b/.test(source),
        weight: 5,
      },
    ];

    const dynamic: Record<string, boolean> = {
      set_get: false,
      missing: false,
      delete: false,
      keys: false,
      ttl_expiration: false,
      cleanup_keys: false,
      overwrite_refreshes_ttl: false,
    };

    let runtimeFailure: string | undefined;
    if (source) {
      const moduleUrl = pathToFileURL(target).href + `?bench=${Date.now()}`;
      const script = `
                const { TTLCache } = await import(${JSON.stringify(moduleUrl)});
                const out = {};
                const c = new TTLCache();
                c.set("a", "one");
                out.set_get = c.get("a") === "one";
                out.missing = c.get("missing") === undefined;
                c.set("b", "two");
                out.keys = JSON.stringify(c.keys().sort()) === JSON.stringify(["a","b"]);
                out.delete = c.delete("b") === true && c.get("b") === undefined && c.delete("b") === false;
                c.set("temp", "x", 40);
                await Bun.sleep(70);
                out.ttl_expiration = c.get("temp") === undefined;
                out.cleanup_keys = !c.keys().includes("temp");
                c.set("refresh", "old", 40);
                await Bun.sleep(25);
                c.set("refresh", "new", 80);
                await Bun.sleep(35);
                out.overwrite_refreshes_ttl = c.get("refresh") === "new";
                console.log(JSON.stringify(out));
            `;
      try {
        const proc = Bun.spawn(["bun", "-e", script], {
          cwd: workspace,
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdoutPromise = new Response(proc.stdout).text();
        const stderrPromise = new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        const [stdout, stderr] = await Promise.all([
          stdoutPromise,
          stderrPromise,
        ]);
        if (exitCode === 0) {
          const line = stdout.trim().split("\n").pop() || "{}";
          Object.assign(dynamic, JSON.parse(line));
        } else {
          runtimeFailure = `TTL cache evaluator exited ${exitCode}: ${stderr.slice(0, 1000)}`;
        }
      } catch (error) {
        runtimeFailure = describeError(error);
      }
    }

    checks.push(
      {
        name: "set_then_get",
        weight: 15,
        ...withFailureDetail(dynamic.set_get, runtimeFailure),
      },
      {
        name: "missing_is_undefined",
        weight: 5,
        ...withFailureDetail(dynamic.missing, runtimeFailure),
      },
      {
        name: "delete_semantics",
        weight: 10,
        ...withFailureDetail(dynamic.delete, runtimeFailure),
      },
      {
        name: "keys_lists_live_entries",
        weight: 10,
        ...withFailureDetail(dynamic.keys, runtimeFailure),
      },
      {
        name: "ttl_expires",
        weight: 20,
        ...withFailureDetail(dynamic.ttl_expiration, runtimeFailure),
      },
      {
        name: "keys_cleans_expired",
        weight: 10,
        ...withFailureDetail(dynamic.cleanup_keys, runtimeFailure),
      },
      {
        name: "overwrite_refreshes_ttl",
        weight: 10,
        ...withFailureDetail(dynamic.overwrite_refreshes_ttl, runtimeFailure),
      },
    );
    return scoreChecks(checks);
  },
};

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [kvStore, ttlCache];
