---
status: todo
priority: medium
labels: [security, infra]
---

# Replace CSP unsafe-inline with script hash

`infra/Caddyfile` uses `script-src 'unsafe-inline'` which nullifies XSS protection.

## What to do

1. Compute SHA-256 hash of the inline script in `frontend/src/app/layout.tsx`
2. Replace `'unsafe-inline'` with `'sha256-<base64hash>'` in Caddyfile
3. Update Caddyfile on server
4. Test that accent color script still runs

Note: script content changes require re-hashing. Consider using Next.js nonce-based CSP middleware instead.
