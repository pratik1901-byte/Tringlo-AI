// ============================================================
// POST /api/webhooks/sarvam/campaign
// ============================================================
//
// Campaign call results, handled by exactly the same code as single calls.
//
// This route used to parse the body and hand it straight to the call-result
// reducer, skipping everything the outbound webhook checks: the token, the
// size limit, payload validation and the idempotency ledger. Anyone who found
// the URL could have posted invented results — a lead marked interested, a
// fabricated transcript, a customer put on do-not-call.
//
// Re-exporting the outbound handler means the two cannot drift apart again.
// ============================================================

export { POST } from "../outbound/route";
