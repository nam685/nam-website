"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { API, type GraphPatch, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import GraphCanvas from "@/components/GraphCanvas";
import { toForceData, type ForceNode } from "@/lib/graph";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";

export default function ListensFullGraphPage() {
  const player = usePlayer();
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");
  // The full-graph endpoint returns {nodes, edges} (no seed) — GraphPatch shape with seed:null.
  const [graph, setGraph] = useState<GraphPatch | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/listens/graph/`)
      .then((r) => r.json())
      .then((d) =>
        setGraph({ seed: null, nodes: d.nodes ?? [], edges: d.edges ?? [] }),
      )
      .catch(() => setGraph({ seed: null, nodes: [], edges: [] }));
  }, []);

  const data = useMemo(
    () => (graph ? toForceData(graph) : { nodes: [], links: [] }),
    [graph],
  );

  const playNode = (node: ForceNode) => {
    if (!isAdmin || !node.video_id) return;
    const track: ListenTrack = {
      id: 0,
      video_id: node.video_id,
      title: node.title,
      artist: node.subtitle || node.title,
      album: "",
      thumbnail_url: node.thumbnail_url,
      duration: "",
      played_at: "",
    };
    player.play(track, [track]);
  };

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "12px 4px",
        }}
      >
        <Link
          href="/listens"
          style={{
            background: "none",
            border: `1px solid rgba(249,115,22,0.3)`,
            borderRadius: 6,
            padding: "8px 14px",
            color: ACCENT,
            fontSize: 10,
            fontFamily: "monospace",
            letterSpacing: 1,
            textDecoration: "none",
          }}
        >
          ← BACK
        </Link>
        <span
          style={{
            color: "#666",
            fontSize: 11,
            fontFamily: "monospace",
            letterSpacing: 1,
          }}
        >
          FULL GRAPH · {data.nodes.length.toLocaleString()} NODES
        </span>
      </div>
      <GraphCanvas
        data={data}
        hovered={hovered}
        onNodeHover={(node) => setHovered(node ? node.key : null)}
        onNodeClick={(node) => playNode(node)}
        minimalThreshold={1.5}
      />
    </div>
  );
}
