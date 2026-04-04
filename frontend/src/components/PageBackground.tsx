"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const BG_MAP: Record<string, string> = {
  "/thinks": "/images/bg/thinks.jpg",
  "/draws": "/images/bg/draws.jpg",
  "/codes": "/images/bg/codes.jpg",
  "/grinds": "/images/bg/grinds.jpg",
  "/plays": "/images/bg/plays.jpg",
  "/listens": "/images/bg/listens.jpg",
  "/watches": "/images/bg/watches.jpg",
  "/reads": "/images/bg/reads.jpg",
  "/bets": "/images/bg/bets.jpg",
};

export default function PageBackground() {
  const pathname = usePathname();
  const bg = BG_MAP[pathname] ?? BG_MAP["/" + pathname.split("/")[1]];
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    if (!bg) {
      setLoaded(null);
      return;
    }
    const img = new Image();
    img.onload = () => setLoaded(bg);
    img.src = bg;
  }, [bg]);

  if (!loaded) return null;

  return (
    <div
      className="z-0 pointer-events-none animate-[fadeIn_0.4s_ease-out]"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100lvh",
        transform: "translateZ(0)",
        backgroundImage: `url(${loaded})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
