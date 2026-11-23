import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

/**
 * Serves /robots.txt.
 *
 * The public website is open to crawlers. Everything behind the sign-in is
 * not: the product's own pages carry `robots: { index: false }` in their
 * metadata as well, because a disallow here only asks a crawler not to fetch
 * a page — it does not stop one that already has the URL from listing it.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/agent",
        "/analytics",
        "/campaigns",
        "/dashboard",
        "/follow-ups",
        "/hospital",
        "/inbound",
        "/leads",
        "/login",
        "/results",
        "/settings",
        "/upload",
        "/workspaces",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
