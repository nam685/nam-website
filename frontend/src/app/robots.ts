import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Admin login, the JSON API, and private (capability-URL) badminton uploads.
      disallow: ["/sudo", "/api/", "/media/badminton/raw/"],
    },
    sitemap: "https://nam685.de/sitemap.xml",
  };
}
