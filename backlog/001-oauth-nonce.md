---
status: todo
priority: critical
labels: [security, backend]
---

# Replace OAuth token-in-URL with nonce system

Admin JWT is passed as `?token=` in OAuth redirect URLs (GitHub + Google flows). Token appears in server logs, browser history, Referer headers, and external provider logs.

## What to do

1. When initiating OAuth, generate a short-lived random nonce
2. Store nonce → admin_token mapping in Redis with 5-min TTL
3. Pass nonce as OAuth `state` parameter instead of the real token
4. In callback, look up nonce in Redis, verify the associated token
5. Delete nonce after use (single-use)

## Files to change

- `website/views/github.py` (github_auth, github_callback)
- `website/views/listen.py` (listen_auth, listen_callback)
- `frontend/src/app/codes/CodesClient.tsx` (OAuth initiation URL)
- `frontend/src/app/listens/page.tsx` (OAuth initiation URL)
