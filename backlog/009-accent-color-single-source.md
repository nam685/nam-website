---
status: todo
priority: medium
labels: [frontend]
---

# Consolidate accent color map to single source of truth

Route-to-accent mapping is defined in 3+ places: `navWheel.ts` NAV_ITEMS, `layout.tsx` inline script, and per-page local constants.

## Fix

1. Export `ROUTE_ACCENTS` record from `navWheel.ts` derived from `NAV_ITEMS`
2. Generate the `layout.tsx` inline script map from `ROUTE_ACCENTS` at build time
3. Each page imports its accent from the shared source
4. Remove all hardcoded per-page accent constants
