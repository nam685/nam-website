"use client";

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
  const bg = BG_MAP[pathname];
  if (!bg) return null;

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none"
      style={{
        backgroundImage: `url(${bg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
