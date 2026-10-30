// ============================================================
// Tringlo AI — Server Startup
// ============================================================
// Next runs this once when the server boots. It is where the follow-up
// scheduler starts, so agreed callbacks are placed by the server itself rather
// than by whichever browser happens to have a tab open.
// ============================================================

export async function register() {
  // Only the Node.js runtime can hold a timer and reach the database; the edge
  // runtime imports this file too.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Only the platform. The Wellness Hospital panel is a separate application
  // sharing this repository; it pins its own Turbopack root so this file is
  // not normally compiled into it at all. This is the second lock on the same
  // door: a second scheduler in a second process would place the same callback
  // twice, and both processes cache the database in memory, so they would
  // overwrite each other's writes.
  //
  // The panel says so for itself, in its own next.config.
  if (process.env.TRINGLO_ROLE === "panel") return;

  // Load the database from the external store (when one is configured) before
  // anything reads or writes it. On a disk-less free host this is the only
  // durable copy; with no store configured it is a no-op and the local file is
  // used. Awaited here so the cache is populated before the first request.
  const { initDatabase } = await import("./lib/db");
  await initDatabase();

  // Moves the original single-workspace configuration onto its workspace.
  // Guarded, so running it again changes nothing.
  const { runStartupMigrations } = await import("./lib/db/migrations");
  runStartupMigrations();

  const { startScheduler } = await import("./lib/scheduling/scheduler");
  startScheduler();
}
