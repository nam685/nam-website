"use client";

import { useEffect, useRef } from "react";

const ACCENT = "#39ff14";
const CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}[]()<>=/+*&|!?;:._-~#@$%^";
const FONT_SIZE = 14;
const FADE = "rgba(0,0,0,0.05)";

export default function MatrixBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    let w: number, h: number, cols: number;
    let drops: number[];
    let speeds: number[];

    function init() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(w / FONT_SIZE);
      drops = Array.from({ length: cols }, () => Math.random() * -(h / FONT_SIZE));
      speeds = Array.from({ length: cols }, () => 0.2 + Math.random() * 0.4);
    }

    init();

    let last = 0;
    let raf: number;

    function draw(now: number) {
      raf = requestAnimationFrame(draw);
      if (now - last < 45) return; // ~22 fps — intentionally choppy
      last = now;

      ctx!.fillStyle = FADE;
      ctx!.fillRect(0, 0, w, h);
      ctx!.font = `${FONT_SIZE}px monospace`;

      for (let i = 0; i < cols; i++) {
        if (drops[i] < 0) {
          drops[i] += speeds[i];
          continue;
        }
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;

        // Head character — brighter with subtle glow
        ctx!.shadowBlur = 6;
        ctx!.shadowColor = ACCENT;
        ctx!.fillStyle = `${ACCENT}30`;
        ctx!.fillText(char, x, y);
        ctx!.shadowBlur = 0;

        if (y > h && Math.random() > 0.975) {
          drops[i] = Math.random() * -20;
          speeds[i] = 0.2 + Math.random() * 0.4;
        }
        drops[i] += speeds[i];
      }
    }

    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", init);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", init);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: -1,
        pointerEvents: "none",
      }}
    />
  );
}
