import type { Metadata } from "next";

import CodesClient from "./CodesClient";

export const metadata: Metadata = { title: "codes" };

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const GITHUB_USERNAME = "nam685";

async function fetchContributions() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  const query = `{
    user(login: "${GITHUB_USERNAME}") {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              date
            }
          }
        }
      }
    }
  }`;

  try {
    const res = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      cache: "force-cache", // baked at build time, refreshes on deploy
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data.user.contributionsCollection.contributionCalendar;
  } catch {
    return null;
  }
}

export default async function CodesPage() {
  const calendar = await fetchContributions();
  return <CodesClient calendar={calendar} />;
}
