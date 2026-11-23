import type { MetadataRoute } from "next";

import { SITE } from "@/lib/site";
import { siteUrl } from "@/lib/site-url";

/**
 * Serves /sitemap.xml.
 *
 * Only the public website is listed. The product's pages are behind a
 * sign-in, so a crawler could not read them and a visitor arriving from a
 * search result would land on the login screen.
 *
 * The legal pages carry the date they were last reviewed, which is a real
 * date rather than today's, so a crawler is not told they changed when they
 * did not.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const reviewed = new Date(SITE.legalUpdated);

  return [
    { url: base, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.7 },
    { url: `${base}/terms`, lastModified: reviewed, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, lastModified: reviewed, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/refunds`, lastModified: reviewed, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/cookies`, lastModified: reviewed, changeFrequency: "yearly", priority: 0.3 },
  ];
}
