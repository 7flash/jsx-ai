---
name: security
description: Security-aware development — prepared statements, crypto UUIDs, input validation
---
## Security Methodology
- NEVER interpolate user input into SQL — use parameterized queries with db.prepare()
- NEVER use Math.random() for IDs — use crypto.randomUUID()
- Validate and sanitize ALL user input at the API boundary
- Validate Content-Type headers before parsing request bodies
- Never expose internal error details or stack traces in responses
- Use proper HTTP status codes: 400 bad input, 404 not found, 500 server error
