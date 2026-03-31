import type { Metadata } from "next";

import { API_INTERNAL } from "@/lib/api";

import CodesClient from "./CodesClient";

export const metadata: Metadata = { title: "codes" };

async function fetchContributions() {
  try {
    const res = await fetch(`${API_INTERNAL}/api/github/contributions/`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { calendar: null, repositoryDates: null };
    const data = await res.json();
    const contributions = data.contributions ?? null;
    const repositoryDates: Record<string, string> | null =
      contributions?.repositoryDates ?? null;
    return { calendar: contributions, repositoryDates };
  } catch {
    return { calendar: null, repositoryDates: null };
  }
}

export default async function CodesPage() {
  const { calendar, repositoryDates } = await fetchContributions();
  return (
    <CodesClient calendar={calendar} repositoryDates={repositoryDates} />
  );
}
