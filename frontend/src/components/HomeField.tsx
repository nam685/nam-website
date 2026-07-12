"use client";

import { useEffect, useRef } from "react";
import { angleFromCenter, lerpDotColor } from "@/lib/homepageContent";
import {
  DEFAULT_FIELD_PARAMS as P,
  COMET_TAIL,
  circleRadius,
  beamAspect,
  polarToXY,
  xyToPolar,
  makeGaussian,
} from "@/lib/homeField";

// One Monte-Carlo suite: a comet walking the staircase out from the photo edge.
// It keeps only its current + previous point (for the incremental trace segment)
// and a short bounded tail buffer (for the comet head) — never a full history.
interface Particle {
  i: number;
  r: number;
  th: number;
  thNext: number;
  phase: "radial" | "arc";
  done: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  tail: [number, number][];
}

/**
 * Animated background behind the home orbit: comets launch from the photo edge,
 * walk outward past the nav dots leaving faint traces, and a cursor "spotlight"
 * brightens the traces near the pointer. Traces + spotlight follow the same hue
 * as the photo rim; the nav dots keep their own colours. Purely decorative.
 *
 * The trace layer is a *persistent* bitmap: each frame it fades a touch and only
 * the newest segment of each live comet is drawn onto it — so per-frame work is
 * O(live comets), not O(all points ever drawn).
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
    const light = document.createElement("canvas");
    const buf = document.createElement("canvas");
    const tctx = trace.getContext("2d");
    const lctx = light.getContext("2d");
    const bctx = buf.getContext("2d");
    if (!tctx || !lctx || !bctx) return;

    let W = 0;
    let H = 0;
    let DPR = 1;
    let cx = 0;
    let cy = 0;
    let R = 0; // pixels per r-unit (= photo radius)
    // Offscreen buffers (dim traces + spotlight) render at half res and upscale —
    // they're soft anyway, so this quarters their fill cost. Comet heads stay full-res.
    const Q = 0.5;

    function resize() {
      // Decorative layer — cap DPR so hi-dpi screens don't quadruple fill cost.
      DPR = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = canvas!.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas!.width = W * DPR;
      canvas!.height = H * DPR;
      for (const cn of [trace, light, buf]) {
        cn.width = Math.max(1, Math.round(W * DPR * Q));
        cn.height = Math.max(1, Math.round(H * DPR * Q));
      }
      cx = W / 2;
      cy = H / 2;
      const container = Math.min(0.75 * window.innerWidth, 0.75 * window.innerHeight, 420);
      R = 0.375 * container;
      // The trace layer persists across frames, so give it a standing transform
      // (resizing a canvas clears it — traces simply rebuild from here).
      tctx!.setTransform(DPR * Q, 0, 0, DPR * Q, 0, 0);
      tctx!.clearRect(0, 0, W, H);
    }
    resize();
    window.addEventListener("resize", resize);

    const randn = makeGaussian();
    let particles: Particle[] = [];
    const mouse = { x: 0, y: 0, has: false };

    function onMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.has = true;
    }
    window.addEventListener("mousemove", onMove);

    function makeParticle(): Particle {
      const th0 = Math.random() * 2 * Math.PI;
      const r0 = circleRadius(0, P.k1, P.k2);
      const [x, y] = polarToXY(r0, th0, cx, cy, R);
      return { i: 0, r: r0, th: th0, thNext: th0, phase: "radial", done: false, x, y, px: x, py: y, tail: [[x, y]] };
    }

    function stepParticle(p: Particle, dt: number) {
      p.px = p.x;
      p.py = p.y;
      const step = P.s * dt;
      if (p.phase === "radial") {
        const target = circleRadius(p.i + 1, P.k1, P.k2);
        p.r += step; // constant spatial speed outward
        if (p.r >= target) {
          p.r = target;
          p.phase = "arc";
          p.thNext = p.th + randn() * P.eps; // θ_{i+1} ~ N(θ_i, ε)
        }
      } else {
        // arc at constant *spatial* speed → dθ/dt = s / r
        const astep = step / Math.max(p.r, 1e-3);
        const dir = Math.sign(p.thNext - p.th) || 1;
        p.th += dir * astep;
        if ((dir > 0 && p.th >= p.thNext) || (dir < 0 && p.th <= p.thNext)) {
          p.th = p.thNext;
          p.i += 1;
          p.phase = "radial";
          if (circleRadius(p.i, P.k1, P.k2) > P.rmax) p.done = true;
        }
      }
      const [x, y] = polarToXY(p.r, p.th, cx, cy, R);
      p.x = x;
      p.y = y;
      p.tail.push([x, y]);
      if (p.tail.length > COMET_TAIL) p.tail.shift();
    }

    function hueRGB(): [number, number, number] {
      const ang = mouse.has ? angleFromCenter(mouse.x - cx, mouse.y - cy) : 0;
      const [r, g, b] = lerpDotColor(ang);
      return [r | 0, g | 0, b | 0];
    }

    function buildSpotlight(hue: [number, number, number]) {
      lctx!.setTransform(DPR * Q, 0, 0, DPR * Q, 0, 0);
      lctx!.clearRect(0, 0, W, H);
      if (!mouse.has) return;
      const { r: rc, theta: thc } = xyToPolar(mouse.x - cx, mouse.y - cy, R);
      const e0px = P.e0 * R;
      let a = e0px;
      let b = e0px;
      let ccx = mouse.x;
      let ccy = mouse.y;
      if (rc > P.rdot) {
        const elong = beamAspect(rc, P.rdot, P.rmax);
        b = e0px;
        a = e0px * elong;
        const centerR = rc - 0.5 * (a - b) / R; // gentle inward trail; → rc as elong → 1
        [ccx, ccy] = polarToXY(centerR, thc, cx, cy, R);
      }
      lctx!.save();
      lctx!.translate(ccx, ccy);
      lctx!.rotate(thc); // local +y points radially outward
      lctx!.scale(b, a);
      const g = lctx!.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(255,255,255,0.5)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      lctx!.fillStyle = g;
      lctx!.beginPath();
      lctx!.arc(0, 0, 1, 0, 2 * Math.PI);
      lctx!.fill();
      lctx!.restore();
      // reveal only where traces exist, then recolour to the field hue
      lctx!.globalCompositeOperation = "destination-in";
      lctx!.drawImage(trace, 0, 0, W, H);
      lctx!.globalCompositeOperation = "source-in";
      lctx!.fillStyle = `rgb(${hue[0]},${hue[1]},${hue[2]})`;
      lctx!.fillRect(0, 0, W, H);
      lctx!.globalCompositeOperation = "source-over";
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
      tctx!.strokeStyle = "rgba(255,255,255,0.9)";
      tctx!.lineWidth = 1.3;
      tctx!.lineCap = "round";
      tctx!.lineJoin = "round";
      tctx!.beginPath();
      for (const p of particles) {
        tctx!.moveTo(p.px, p.py);
        tctx!.lineTo(p.x, p.y);
      }
      tctx!.stroke();

      const hue = hueRGB();
      const [hr, hg, hb] = hue;
      const hcss = `rgb(${hr},${hg},${hb})`;

      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx!.clearRect(0, 0, W, H);

      // 1. faint baseline — tint the white bitmap to the hue, draw dim
      bctx!.setTransform(DPR * Q, 0, 0, DPR * Q, 0, 0);
      bctx!.globalCompositeOperation = "source-over";
      bctx!.clearRect(0, 0, W, H);
      bctx!.drawImage(trace, 0, 0, W, H);
      bctx!.globalCompositeOperation = "source-in";
      bctx!.fillStyle = hcss;
      bctx!.fillRect(0, 0, W, H);
      bctx!.globalCompositeOperation = "source-over";
      ctx!.globalAlpha = P.dim;
      ctx!.drawImage(buf, 0, 0, W, H);
      ctx!.globalAlpha = 1;

      // 2. spotlight reveal (hued, additive; gain controls punch)
      buildSpotlight(hue);
      ctx!.globalCompositeOperation = "lighter";
      ctx!.globalAlpha = Math.min(P.gain, 1);
      ctx!.drawImage(light, 0, 0, W, H);
      if (P.gain > 1) {
        ctx!.globalAlpha = P.gain - 1;
        ctx!.drawImage(light, 0, 0, W, H);
      }
      ctx!.globalAlpha = 1;

      // 3. live heads — one smooth tapered tail stroke + a glowing head.
      // Single pass (per-segment alpha/width ramp) keeps it a comet without the
      // ~600 stroke calls/frame a second glow pass would cost.
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      for (const p of particles) {
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
      ctx!.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
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
