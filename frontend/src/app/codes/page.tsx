import type { Metadata } from "next";

import { API_INTERNAL } from "@/lib/api";

import CodesClient from "./CodesClient";

export const metadata: Metadata = { title: "codes" };

async function fetchContributions() {
  try {
    const res = await fetch(`${API_INTERNAL}/api/github/contributions/`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.contributions ?? null;
  } catch {
    return null;
  }
}

export default async function CodesPage() {
  const calendar = await fetchContributions();
  return <CodesClient calendar={calendar} />;
}
