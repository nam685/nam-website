"use client";

import { useEffect, useRef } from "react";
import { lerpDotColor } from "@/lib/homepageContent";
import { DEFAULT_FIELD_PARAMS as P, COMET_TAIL, polarToXY } from "@/lib/homeField";

// One comet per suite: launches from the photo edge along a fixed ray and
// travels straight outward at constant speed until it clears r_max. No arc,
// no spotlight — the ray's color is fixed at spawn from the dot it's heading
// toward, so per-frame work never depends on the cursor.
interface Particle {
  r: number;
  th: number;
  color: [number, number, number];
  done: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  tail: [number, number][];
}

/**
 * Animated background behind the home orbit: comets launch from the photo
 * edge and travel straight outward past the nav dots, leaving a fading trace.
 * Each ray's color matches the dot in that direction. Purely decorative.
 *
 * The trace layer is a *persistent* bitmap: each frame it fades a touch and
 * only the newest segment of each live comet is drawn onto it — so per-frame
 * work is O(live comets), not O(all points ever drawn).
 */
export default function HomeField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const trace = document.createElement("canvas");
    const tctx = trace.getContext("2d");
    if (!tctx) return;

    let W = 0;
    let H = 0;
    let DPR = 1;
    let cx = 0;
    let cy = 0;
    let R = 0; // pixels per r-unit (= photo radius)

    function resize() {
      // Decorative layer — cap DPR so hi-dpi screens don't quadruple fill cost.
      DPR = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = canvas!.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas!.width = W * DPR;
      canvas!.height = H * DPR;
      trace.width = Math.max(1, Math.round(W * DPR));
      trace.height = Math.max(1, Math.round(H * DPR));
      cx = W / 2;
      cy = H / 2;
      const container = Math.min(0.75 * window.innerWidth, 0.75 * window.innerHeight, 420);
      R = 0.375 * container;
      // The trace layer persists across frames, so give it a standing transform
      // (resizing a canvas clears it — traces simply rebuild from here).
      tctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      tctx!.clearRect(0, 0, W, H);
    }
    resize();
    window.addEventListener("resize", resize);

    let particles: Particle[] = [];

    function makeParticle(): Particle {
      const th0 = Math.random() * 2 * Math.PI;
      const deg = ((th0 * 180) / Math.PI + 360) % 360;
      const [r, g, b] = lerpDotColor(deg);
      const [x, y] = polarToXY(P.k1, th0, cx, cy, R);
      return { r: P.k1, th: th0, color: [r, g, b], done: false, x, y, px: x, py: y, tail: [[x, y]] };
    }

    function stepParticle(p: Particle, dt: number) {
      p.px = p.x;
      p.py = p.y;
      p.r += P.s * dt;
      if (p.r >= P.rmax) p.done = true;
      const [x, y] = polarToXY(p.r, p.th, cx, cy, R);
      p.x = x;
      p.y = y;
      p.tail.push([x, y]);
      if (p.tail.length > COMET_TAIL) p.tail.shift();
    }

    let raf = 0;
    let last = 0;
    let spawnAcc = 0;

    function frame(ts: number) {
      const dt = Math.min((ts - last) / 1000 || 0, 0.05);
      last = ts;

      // spawn on schedule — never wait: at N live, drop the oldest (its trace is
      // already baked into the fading bitmap, so it just keeps fading).
      spawnAcc += dt;
      while (spawnAcc >= P.t) {
        spawnAcc -= P.t;
        if (particles.length >= P.N) particles.shift();
        particles.push(makeParticle());
      }
      if (spawnAcc > P.t) spawnAcc = P.t;

      for (const p of particles) stepParticle(p, dt);
      particles = particles.filter((p) => !p.done);

      // ── trace layer: fade a touch, then stamp only the NEW segments ──
      tctx!.globalCompositeOperation = "destination-out";
      tctx!.fillStyle = `rgba(0,0,0,${(1 - Math.exp((-dt * 4) / P.hold)).toFixed(4)})`;
      tctx!.fillRect(0, 0, W, H);
      tctx!.globalCompositeOperation = "source-over";
      tctx!.lineWidth = 1.4;
      tctx!.lineCap = "round";
      tctx!.lineJoin = "round";
      for (const p of particles) {
        tctx!.strokeStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
        tctx!.beginPath();
        tctx!.moveTo(p.px, p.py);
        tctx!.lineTo(p.x, p.y);
        tctx!.stroke();
      }

      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx!.clearRect(0, 0, W, H);

      // 1. faint baseline — the persistent, already-colored trace, drawn dim.
      ctx!.globalAlpha = P.dim;
      ctx!.drawImage(trace, 0, 0, W, H);
      ctx!.globalAlpha = 1;

      // 2. live heads — one smooth tapered tail stroke + a glowing head.
      // Single pass (per-segment alpha/width ramp) keeps it a comet without the
      // ~600 stroke calls/frame a second glow pass would cost.
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      for (const p of particles) {
        const [hr, hg, hb] = p.color;
        const pts = p.tail;
        const n = pts.length;
        if (n >= 2) {
          for (let i = 1; i < n; i++) {
            const f = i / (n - 1); // 0 (tail end) → 1 (head)
            const p0 = pts[i - 1];
            const p1 = pts[i];
            const pm1 = pts[Math.max(0, i - 2)];
            const m0: [number, number] = [(pm1[0] + p0[0]) / 2, (pm1[1] + p0[1]) / 2];
            const m1: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
            ctx!.strokeStyle = `rgba(${hr},${hg},${hb},${(0.85 * f).toFixed(3)})`;
            ctx!.lineWidth = 0.8 + 2.6 * f;
            ctx!.beginPath();
            ctx!.moveTo(m0[0], m0[1]);
            ctx!.quadraticCurveTo(p0[0], p0[1], m1[0], m1[1]);
            ctx!.stroke();
          }
        }
        const [hx, hy] = pts[n - 1];
        const g = ctx!.createRadialGradient(hx, hy, 0, hx, hy, 10);
        g.addColorStop(0, "rgba(255,255,255,0.95)");
        g.addColorStop(0.35, `rgba(${hr},${hg},${hb},0.75)`);
        g.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(hx, hy, 10, 0, 2 * Math.PI);
        ctx!.fill();
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
