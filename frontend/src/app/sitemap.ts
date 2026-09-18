import type { MetadataRoute } from "next";

const SITE = "https://nam685.de";

// Public pages only (no /sudo, no admin-only views).
const ROUTES = [
  "",
  "/yaps",
  "/codes",
  "/grinds",
  "/listens",
  "/reads",
  "/plays/chess",
  "/plays/aoe2",
  "/plays/aoe2/builds",
  "/plays/badminton",
  "/watches",
  "/bets",
  "/slops",
  "/blog",
  "/now",
  "/uses",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((path) => ({ url: `${SITE}${path}` }));
}
