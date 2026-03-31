---
status: todo
priority: low
labels: [frontend]
---

# Fix 20 pre-existing ESLint warnings

Now that `eslint-config-next` (core-web-vitals) is enabled, 20 warnings surface:

- `react-hooks/set-state-in-effect` — setState calls inside useEffect (PageBackground, several pages)
- `react-hooks/refs` — ref access during render (Navbar)
- `react/no-danger` — unsafe innerHTML usage (layout.tsx inline script — currently safe but flagged)
- `no-unused-vars` — unused imports in test files

These are downgraded to warnings via `eslint.config.mjs` overrides. Fix them properly and remove the overrides.
