---
status: todo
priority: medium
labels: [backend, security]
---

# Move in-memory rate limits to Redis

GitHub/Listen sync cooldowns use module-level `_last_refresh` / `_last_sync` floats. These are per-process (bypass under gunicorn) and reset on restart.

## Files

- `website/views/github.py` — `_last_refresh`
- `website/views/listen.py` — `_last_sync`

## Fix

Use `django.core.cache` (already configured with django-redis) to store cooldown timestamps. Key pattern: `sync_cooldown:{service}`, TTL matching the cooldown period.
