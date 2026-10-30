import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Flutter's generated web bundle and tool cache, not source.
    "flutter_app/build/**",
    "flutter_app/.dart_tool/**",
    // The compiled Flutter web client served at /app.
    "public/app/**",
  ]),
]);

export default eslintConfig;
