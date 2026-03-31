---
status: todo
priority: low
labels: [frontend]
---

# Use existing .tag and .corner-* CSS classes

`globals.css` defines `.tag` (lines 225-241) and `.corner-tl`/`.corner-tr`/`.corner-bl`/`.corner-br` (lines 78-114) but no component uses them — they all reinvent the same styles inline.

## Files to update

- `CodesClient.tsx`, `grinds/page.tsx` (x2), `ReadsClient.tsx` — tag pill styles
- `CodesClient.tsx`, `ReadsClient.tsx`, `grinds/page.tsx` — corner bracket styles
- `CodesClient.tsx`, `grinds/page.tsx`, `ReadsClient.tsx` — separator line styles

Replace inline styles with the existing CSS classes, using `var(--accent)` for colors.
