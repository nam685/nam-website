"use client";

import { useState } from "react";
import Image from "next/image";

const tabs = [
  { label: "Underwater", src: "/images/underwater.jpg" },
  { label: "House", src: "/images/house.jpg" },
];

export default function Home() {
  const [active, setActive] = useState(0);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "1rem",
      }}
    >
      <h1
        style={{
          fontSize: "clamp(1.5rem, 5vw, 2rem)",
          fontWeight: "bold",
          marginBottom: "1.5rem",
        }}
      >
        Nam Le
      </h1>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActive(i)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "0.95rem",
              background: active === i ? "#111" : "#e5e7eb",
              color: active === i ? "#fff" : "#374151",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        style={{
          borderRadius: "0.75rem",
          overflow: "hidden",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          width: "100%",
          maxWidth: "600px",
        }}
      >
        <Image
          src={tabs[active].src}
          alt={tabs[active].label}
          width={600}
          height={450}
          style={{ width: "100%", height: "auto" }}
          priority
        />
      </div>
    </main>
  );
}
