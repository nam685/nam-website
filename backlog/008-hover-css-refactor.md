---
status: todo
priority: low
labels: [frontend]
---

# Replace inline onMouseEnter/Leave with CSS hover

Nearly every component uses `e.currentTarget.style.*` mutations for hover effects instead of CSS `:hover` or Tailwind `hover:` classes.

Problems: no keyboard focus support, no touch support, breaks on re-render while hovered.

## Affected files

- `sudo/page.tsx`, `thinks/page.tsx`, `draws/page.tsx`, `listens/page.tsx`
- `codes/CodesClient.tsx`, `grinds/page.tsx`, `reads/ReadsClient.tsx`
- `components/Navbar.tsx`, `components/FeedbackButton.tsx`

## Fix

Replace with CSS `:hover` selectors in `<style>` blocks or Tailwind `hover:` classes. The project already uses both patterns elsewhere.
