// ============================================================
// Dialo AI — Server Startup
// ============================================================
// Next runs this once when the server boots. It is where the follow-up
// scheduler starts, so agreed callbacks are placed by the server itself rather
// than by whichever browser happens to have a tab open.
// ============================================================

export async function register() {
  // Only the Node.js runtime can hold a timer and reach the database; the edge
  // runtime imports this file too.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startScheduler } = await import("@/lib/scheduling/scheduler");
  startScheduler();
}
