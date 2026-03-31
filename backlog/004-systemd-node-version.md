---
status: todo
priority: medium
labels: [infra]
---

# Fix hardcoded Node.js version in systemd service

`infra/nextjs.service` hardcodes `/home/nam/.nvm/versions/node/v20.20.2/bin`. Breaks on nvm upgrade.

## Fix

Either use nvm alias symlink (`v20` instead of `v20.20.2`) or switch to system Node.js install. Requires SSH to server to verify current version.
