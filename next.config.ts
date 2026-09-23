import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
