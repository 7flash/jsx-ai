---
name: test-driven
description: Test-driven methodology — bun:test, describe blocks, 6+ cases, error paths
---
## Testing Methodology
- Test files named {module}.test.ts, co-located with the module
- Each test is independent — no shared mutable state between tests
- Test structure: describe blocks grouping related scenarios
- Coverage: happy path + error cases + edge cases
- For HTTP: test status codes AND response body shapes
- Minimum 6 test cases per module
