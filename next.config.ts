import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * This machine's private LAN addresses, read when the server starts.
 *
 * Next's dev server refuses dev-only requests (hot reload, the dev overlay)
 * from any origin other than the one it started on. Opening the app from a
 * phone at http://192.168.x.x:3000 is such an origin, and without this the
 * page loads but never hydrates properly.
 *
 * Read from the interfaces rather than written down, because the router
 * hands the address out and it changes. Private ranges only: this widens
 * access to the local network, not to anything public.
 */
function lanAddresses(): string[] {
  const privateRange = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry!.address)
    .filter((address) => privateRange.test(address));
}

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses(),

  async rewrites() {
    return {
      // Runs only after Next has failed to match a page, an API route and a
      // file in public/. That ordering is what lets the Flutter app's own
      // assets (main.dart.js, canvaskit, fonts) serve normally while unmatched
      // paths fall through to the rule below.
      fallback: [
        {
          // The Flutter web client is a single-page app: it owns every path
          // under /app and resolves them in the browser. Without this, a
          // reload on /app/results — or a shared deep link — would 404,
          // because no such file exists on disk.
          source: "/app/:path*",
          destination: "/app/index.html",
        },
        {
          // The bare /app, which would otherwise need a directory index.
          source: "/app",
          destination: "/app/index.html",
        },
      ],
    };
  },
};

export default nextConfig;
