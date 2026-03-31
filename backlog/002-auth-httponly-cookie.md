---
status: todo
priority: high
labels: [security, backend, frontend]
---

# Move auth token from localStorage to HttpOnly cookie

Admin token in localStorage is stealable via XSS. 7-day TTL compounds the risk.

## Options

1. **HttpOnly cookie** — most secure, but needs CSRF handling for API calls
2. **Reduce TTL** — keep localStorage but reduce from 7d to 8h, add refresh endpoint
3. **Both** — cookie for browser, keep Bearer header for programmatic API use

## Considerations

- All `fetch()` calls need `credentials: "include"` if using cookies
- CSRF protection needed since cookies auto-send
- `/sudo` login page needs rework
- `getAdminToken()` / `store()` helpers need updating
