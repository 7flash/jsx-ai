---
name: bun-expert
description: Bun runtime expertise — Bun.serve(), bun:sqlite, bun:test, Bun.file()
---
## Bun Runtime
- HTTP: Bun.serve() with export default { port, fetch } pattern
- Database: import { Database } from "bun:sqlite", use db.prepare()
- Testing: import { describe, it, expect } from "bun:test"
- File I/O: Bun.file() / Bun.write()
- Run: bun run {file}, bun test
- TypeScript works out of the box — no tsconfig needed
