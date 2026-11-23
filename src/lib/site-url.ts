// ============================================================
// Where this instance is reachable from outside
// ============================================================
//
// Open Graph tags, robots.txt and the sitemap all have to give absolute
// URLs — a relative path is meaningless to a crawler or to a chat app
// unfurling a link — so they all resolve against this one value.
//
// In development that is the tunnel the dev supervisor registered, or
// localhost. In production set APP_URL to the real domain: until it is set,
// every shared link points at a machine nobody else can reach.
// ============================================================

export function siteUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    process.env.WEBHOOK_BASE_URL?.trim() ||
    `http://localhost:${process.env.PORT ?? 3000}`
  ).replace(/\/$/, "");
}
