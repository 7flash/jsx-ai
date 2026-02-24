---
name: strict-typescript
description: TypeScript strict mode — interfaces in types.ts, no any, JSDoc on public functions
---
## TypeScript Standards
- Define interfaces for ALL data shapes in a dedicated types.ts file
- Import shared types — NEVER duplicate type definitions
- NEVER use : any — use proper types, generics, or unknown
- All public functions MUST have JSDoc comments
- Prefer const over let, never use var
- Use named exports over default exports
