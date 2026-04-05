"use client";

import { useEffect, useRef } from "react";

const ACCENT = "#39ff14";
const CHARS = "01{}[]()<>=/+*&|!?;:._-~#@$%^";
const FONT_SIZE = 14;
const FADE = "rgba(0,0,0,0.06)";

export default function MatrixBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    let cols = Math.floor(w / FONT_SIZE);
    let drops = Array.from({ length: cols }, () =>
      Math.random() * -cols,
    );

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
      const newCols = Math.floor(w / FONT_SIZE);
      if (newCols > drops.length) {
        drops = drops.concat(
          Array.from({ length: newCols - drops.length }, () =>
            Math.random() * -newCols,
          ),
        );
      } else {
        drops.length = newCols;
      }
      cols = newCols;
    }

    function draw() {
      ctx!.fillStyle = FADE;
      ctx!.fillRect(0, 0, w, h);
      ctx!.font = `${FONT_SIZE}px monospace`;

      for (let i = 0; i < cols; i++) {
        if (drops[i] < 0) {
          drops[i] += 0.2;
          continue;
        }
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;

        ctx!.fillStyle = `${ACCENT}18`;
        ctx!.fillText(char, x, y);

        if (y > h && Math.random() > 0.98) {
          drops[i] = Math.random() * -20;
        }
        drops[i] += 0.4;
      }
    }

    window.addEventListener("resize", resize);
    const id = setInterval(draw, 60);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", resize);
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
