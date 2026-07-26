# Homepage Rotating Profile Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage orbit-center random content with a circular profile photo (randomly chosen per load from 5), whose rim and outer edge are tinted live with the mouse-driven dot hue.

**Architecture:** A one-off local ImageMagick conversion produces 5 webp photos that are scp'd to the server's media root (never committed). `page.tsx` renders a single circular photo wrapper as the orbit center; a `--hue` CSS custom property — set by the existing `mousemove` handler — drives a `mix-blend-mode: overlay` radial-gradient edge tint plus a glowing rim. Dead random-content code is removed from `homepageContent.ts`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 + inline styles, vitest, ImageMagick (`convert`), Caddy `file_server` for `/media/*`.

## Global Constraints

- Photos MUST NOT enter git. `media/` is gitignored; the only committed change is frontend code + a one-line doc note.
- Frontend media references use the existing pattern: `` `${API}/media/profile/profile-${n}.webp` `` with `API` imported from `@/lib/api`.
- Circle diameter = 75% of the orbit container (= 75% of center→dot distance).
- Random-per-load selection: `1 + Math.floor(Math.random() * 5)`. No auto-rotation.
- Edge tint is CSS-only (compositor), no per-pixel canvas. Default hue before first mouse move = `lerpDotColor(0)` (orange).
- Frontend conventions: Prettier (semi, double quotes, 2-space, trailing commas) + ESLint flat config. All work in the `.claude/worktrees/profile-photo` worktree on branch `feat/homepage-profile-photo`.

---

### Task 1: Convert and upload the 5 photos (one-off, not committed)

**Files:**
- Create (local, gitignored): `media/profile/profile-1.webp` … `profile-5.webp`
- Create (remote): `hetzner:/home/nam/nam-website-deploy/media/profile/profile-1.webp` … `-5.webp`

**Interfaces:**
- Produces: 5 files reachable at `/media/profile/profile-<n>.webp` (n = 1..5), both locally (Django DEBUG static serve) and in production (Caddy).

- [ ] **Step 1: Create local output dir and convert all 5 sources**

Run from repo root (`.claude/worktrees/profile-photo`):

```bash
mkdir -p media/profile
i=1
for src in \
  "/mnt/c/Users/lehai/Downloads/20260621_132121.jpg" \
  "/mnt/c/Users/lehai/Downloads/20260621_132132.jpg" \
  "/mnt/c/Users/lehai/Downloads/20260621_132202.jpg" \
  "/mnt/c/Users/lehai/Downloads/20260621_132318.jpg" \
  "/mnt/c/Users/lehai/Downloads/20260621_134722.heic"; do
  convert "$src" -auto-orient -gravity center -resize 700x700^ -extent 700x700 \
    -quality 82 "media/profile/profile-$i.webp"
  i=$((i+1))
done
```

- [ ] **Step 2: Verify local output**

Run: `ls -la media/profile/ && identify media/profile/profile-1.webp`
Expected: 5 `.webp` files, each `700x700`, roughly 30–120 KB.

- [ ] **Step 3: Upload to server**

```bash
ssh hetzner 'mkdir -p ~/nam-website-deploy/media/profile'
scp media/profile/profile-*.webp hetzner:/home/nam/nam-website-deploy/media/profile/
```

- [ ] **Step 4: Verify server + production serve**

Run: `ssh hetzner 'ls -la ~/nam-website-deploy/media/profile/' && curl -s -o /dev/null -w "%{http_code}\n" https://nam685.de/media/profile/profile-1.webp`
Expected: 5 files listed; HTTP `200`.

- [ ] **Step 5: Confirm nothing is staged for commit**

Run: `git status --porcelain media/`
Expected: empty output (media/ is gitignored).

---

### Task 2: Remove dead random-content code from `homepageContent.ts`

**Files:**
- Modify: `frontend/src/lib/homepageContent.ts`
- Test: `frontend/src/lib/__tests__/homepageContent.test.ts` (unchanged — confirms kept exports still work)

**Interfaces:**
- Consumes: nothing.
- Produces: `homepageContent.ts` exporting only `Dot`, `DOTS`, `angleFromCenter`, `lerpDotColor` (+ new `dotHueCss` from Task 3). `GREETINGS`, `ContentItem`, `fetchRandomContent` removed.

- [ ] **Step 1: Run the existing tests to establish a green baseline**

Run (from `frontend/`): `pnpm test -- homepageContent`
Expected: PASS (kept tests cover `angleFromCenter`, `lerpDotColor`, `DOTS`).

- [ ] **Step 2: Delete the random-content section**

In `frontend/src/lib/homepageContent.ts`, delete from the `/* ── Random center content ── */` comment to end of file — i.e. remove `GREETINGS`, the `ContentItem` type, and `fetchRandomContent`. Also remove the now-unused import on line 1 (`import { API, type Thought } from "@/lib/api";`) — it becomes dead once `fetchRandomContent` is gone. Keep everything from the top through the end of `lerpDotColor`.

- [ ] **Step 3: Run tests + lint to confirm nothing broke**

Run (from `frontend/`): `pnpm test -- homepageContent && pnpm lint`
Expected: tests PASS; lint reports no errors (note: `page.tsx` will still reference the removed exports until Task 4 — if lint/typecheck runs across the project here and fails on `page.tsx`, that is expected and resolved in Task 4; run `pnpm lint` again at the end of Task 4).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/homepageContent.ts
git commit -m "refactor(home): drop unused random-content helpers from homepageContent"
```

---

### Task 3: Add `dotHueCss` helper (test-first)

**Files:**
- Modify: `frontend/src/lib/homepageContent.ts`
- Test: `frontend/src/lib/__tests__/homepageContent.test.ts`

**Interfaces:**
- Consumes: `lerpDotColor(angle: number): [number, number, number]`.
- Produces: `dotHueCss(angle: number): string` — returns `` `rgb(${r},${g},${b})` `` for the interpolated dot color at `angle`. Used by `page.tsx` for the photo rim hue.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/__tests__/homepageContent.test.ts`:

```typescript
import { dotHueCss } from "../homepageContent";

describe("dotHueCss", () => {
  it("formats the first dot color as an rgb() string", () => {
    // lerpDotColor(0) === [249, 115, 22]
    expect(dotHueCss(0)).toBe("rgb(249,115,22)");
  });

  it("returns a valid rgb() string for an interpolated angle", () => {
    expect(dotHueCss(18)).toMatch(/^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/);
  });
});
```

Add `dotHueCss` to the existing import line at the top of the test file:
`import { angleFromCenter, lerpDotColor, DOTS, dotHueCss } from "../homepageContent";`
(and remove the standalone import added above so there is a single import line).

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `pnpm test -- homepageContent`
Expected: FAIL — `dotHueCss is not a function` / not exported.

- [ ] **Step 3: Implement `dotHueCss`**

Append to `frontend/src/lib/homepageContent.ts` (after `lerpDotColor`):

```typescript
/** Interpolated dot color at `angle` as a CSS `rgb(...)` string. */
export function dotHueCss(angle: number): string {
  const [r, g, b] = lerpDotColor(angle);
  return `rgb(${r},${g},${b})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `pnpm test -- homepageContent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/homepageContent.ts frontend/src/lib/__tests__/homepageContent.test.ts
git commit -m "feat(home): add dotHueCss helper for rim tint"
```

---

### Task 4: Replace orbit center with circular profile photo + live edge tint

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `DOTS`, `angleFromCenter`, `lerpDotColor`, `dotHueCss` from `@/lib/homepageContent`; `API` from `@/lib/api`.
- Produces: the final homepage UI. No exports consumed by other tasks.

- [ ] **Step 1: Rewrite `page.tsx`**

Replace the entire contents of `frontend/src/app/page.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  DOTS,
  angleFromCenter,
  lerpDotColor,
  dotHueCss,
} from "@/lib/homepageContent";
import { API } from "@/lib/api";

export default function Home() {
  // Pick one photo per page load (1..5), stable for the session.
  const [photo] = useState(() => 1 + Math.floor(Math.random() * 5));
  const ambientRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const orbit = orbitRef.current;
    const ambient = ambientRef.current;
    const photoWrap = photoRef.current;
    if (!orbit || !ambient) return;

    function onMove(e: MouseEvent) {
      const rect = orbit!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const angle = angleFromCenter(dx, dy);
      const [r, g, b] = lerpDotColor(angle);
      ambient!.style.background = `radial-gradient(circle, rgba(${r},${g},${b},0.12) 0%, transparent 70%)`;
      photoWrap?.style.setProperty("--hue", `rgb(${r},${g},${b})`);
    }

    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <main
      style={{
        position: "fixed",
        top: "3.5rem",
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Ambient glow */}
      <div
        ref={ambientRef}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(75vw, 75vh, 420px)",
          height: "min(75vw, 75vh, 420px)",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,255,255,0.02) 0%, transparent 70%)",
          pointerEvents: "none",
          transition: "background 0.2s",
          zIndex: 0,
        }}
      />

      {/* Orbit */}
      <div
        ref={orbitRef}
        className="orbit-container"
        style={{
          position: "relative",
          width: "min(75vw, 75vh, 420px)",
          height: "min(75vw, 75vh, 420px)",
        }}
      >
        {/* Faint ring */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px solid rgba(255,255,255,0.025)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />

        {/* Center profile photo — diameter = 75% of center→dot distance */}
        <div
          ref={photoRef}
          style={
            {
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "75%",
              height: "75%",
              borderRadius: "50%",
              zIndex: 2,
              "--hue": dotHueCss(0),
              boxShadow: "0 0 24px var(--hue)",
              border: "2px solid var(--hue)",
              transition: "box-shadow 0.2s, border-color 0.2s",
              animation: "fadeIn 0.8s ease-out",
            } as React.CSSProperties
          }
        >
          <img
            src={`${API}/media/profile/profile-${photo}.webp`}
            alt="Nam"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              borderRadius: "50%",
              display: "block",
            }}
          />
          {/* Edge tint — recolors the photo's outer ring toward the hue */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, transparent 58%, var(--hue) 100%)",
              mixBlendMode: "overlay",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* Dots */}
        {DOTS.map((dot) => {
          const rad = (dot.angle * Math.PI) / 180;
          const x = Math.sin(rad) * 50;
          const y = -Math.cos(rad) * 50;

          return (
            <Link
              key={dot.href}
              href={dot.href}
              className="constellation-dot"
              style={
                {
                  position: "absolute",
                  top: `calc(50% + ${y}%)`,
                  left: `calc(50% + ${x}%)`,
                  transform: "translate(-50%, -50%)",
                  zIndex: 10,
                  "--pill-color": dot.color,
                } as React.CSSProperties
              }
            >
              <span
                className="constellation-dot-circle"
                style={{
                  display: "block",
                  width: dot.size,
                  height: dot.size,
                  borderRadius: "50%",
                  background: dot.color,
                  boxShadow: `0 0 ${dot.size * 1.5}px ${dot.color}`,
                  animation: `breathe ${dot.breatheDur}s ${dot.breatheDelay}s ease-in-out infinite`,
                }}
              />
              {/* Pill tooltip */}
              <span className="constellation-pill">
                <span
                  style={{
                    fontFamily: "var(--font-headline)",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: dot.color,
                  }}
                >
                  {dot.label}
                </span>
                <span style={{ fontSize: "0.55rem", color: "#666" }}>
                  {dot.desc}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <style>{`
        @keyframes breathe {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .constellation-dot-circle { animation: none !important; opacity: 1; }
        }
        .constellation-dot {
          text-decoration: none;
        }
        .constellation-dot:hover .constellation-dot-circle {
          transform: scale(1.6);
          transition: transform 0.2s;
        }
        .constellation-pill {
          position: absolute;
          left: 50%;
          bottom: calc(100% + 8px);
          transform: translateX(-50%);
          background: #131313;
          border: 1px solid color-mix(in srgb, var(--pill-color, #1a1a1a) 30%, #1a1a1a);
          border-radius: 6px;
          padding: 0.3rem 0.6rem;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.25s;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.1rem;
        }
        .constellation-dot:hover .constellation-pill {
          opacity: 1;
        }
        @media (max-width: 480px) {
          .orbit-container {
            width: 85vw !important;
            height: 85vw !important;
          }
          .constellation-pill { display: none !important; }
        }
      `}</style>
    </main>
  );
}
```

- [ ] **Step 2: Lint + typecheck + unit tests**

Run (from `frontend/`): `pnpm lint && pnpm test`
Expected: no lint errors, all tests PASS (the `page.tsx` references to removed exports from Task 2 are now resolved).

- [ ] **Step 3: Visual verification with Playwright**

Populate `media/profile/` locally (done in Task 1). Start backend + frontend:

```bash
# from repo root
uv run python manage.py runserver   # serves /media/ in DEBUG, port 8000
# from frontend/, separate shell:
NEXT_PUBLIC_API_URL=http://localhost:8000 pnpm dev   # port 3001
```

Use Playwright to:
1. Navigate to `http://localhost:3001/` — screenshot. Confirm: circular photo centered, diameter ≈ 75% of the dot ring, orange rim (default hue), edge softly tinted.
2. Move the mouse near the `plays` dot (cyan, bottom-left area) and near `thinks` (red) — screenshot each. Confirm the rim + edge tint shift toward those hues and the ambient glow matches.
3. Resize to 400px width — screenshot. Confirm orbit goes 85vw and layout holds.

Save screenshots to the scratchpad dir; do not commit them.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat(home): circular profile photo with live hue edge tint"
```

---

### Task 5: Documentation note

**Files:**
- Modify: `docs/README.md` (homepage description)

**Interfaces:** none.

- [ ] **Step 1: Locate the homepage description**

Run: `grep -n -i "home\|orbit\|greeting\|constellation\|landing" docs/README.md`
Expected: a line/section describing the homepage center content.

- [ ] **Step 2: Update the description**

Edit the homepage section of `docs/README.md` so it reflects that the orbit center shows a randomly-chosen circular profile photo (tinted live with the hovered dot's hue) instead of a random greeting/thought/drawing. Keep it to the surrounding style and length — one or two sentences. (No `QA-CHECKLIST.md` row is required; the homepage already has a "loads correctly" item — extend that item's wording to mention the profile photo if such an item exists, otherwise skip.)

- [ ] **Step 3: Commit**

```bash
git add docs/README.md
git commit -m "docs: note homepage profile photo on README"
```

---

## Notes for execution

- After all tasks: run `pnpm lint && pnpm test` (frontend) and `uvx ruff check .` (no backend change, sanity only) once more before finishing the branch.
- The `media/profile/` photos exist only locally + on the server — confirm `git status` shows no photo files before opening a PR.
- Finishing the branch (PR vs merge) is handled separately via the finishing-a-development-branch / ship flow once verification passes.
