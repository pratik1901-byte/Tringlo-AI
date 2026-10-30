// ============================================================
// Every suite imports this FIRST, before anything touches the database
// ============================================================
//
// A suite writes freely: it creates workspaces, launches campaigns and deletes
// things. The database layer resolves its file from process.cwd(), so a suite
// run from the project root writes to the real data/database.json — and if a
// development server is running, the two fight over the same file.
//
// That happened on 9 October 2026. No business record was lost, but the suite
// results were nonsense and the risk was real. This module makes the mistake
// impossible rather than relying on remembering to cd first: it moves the
// process into a fresh temporary directory, so data/database.json can only
// ever mean a throwaway file.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_MARKERS = ["package.json", "next.config.ts", "next.config.mjs"];

/**
 * Moves the process into a fresh temporary directory and returns it. Call this
 * before importing anything that reads the database.
 */
export function isolateDatabase(label = "suite"): string {
  const start = process.cwd();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dialo-${label}-`));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  process.chdir(dir);

  // If the directory we came from looks like the project, say so loudly: it
  // means the suite was launched from the wrong place, and anything that read
  // the database before this call has already touched the live file.
  const looksLikeProject = PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(start, marker)));
  if (looksLikeProject) {
    console.log(`[isolated-db] launched from the project root; writing to ${dir} instead of the live database.`);
  }

  const live = path.join(start, "data", "database.json");
  if (fs.existsSync(live)) {
    const before = fs.statSync(live).mtimeMs;
    process.on("exit", () => {
      // A suite must leave the real file alone. If its timestamp moved, the
      // isolation failed and whoever ran the suite needs to know at once.
      try {
        if (fs.existsSync(live) && fs.statSync(live).mtimeMs !== before) {
          console.error(`\n[isolated-db] WARNING: ${live} changed while the suite ran. Check it against a backup.`);
        }
      } catch {
        // Nothing useful to do while exiting.
      }
    });
  }

  return dir;
}
