// ============================================================
// POST /api/webhooks/sarvam/inbound
// ============================================================
//
// Inbound call completions from a Sarvam deployment, handled by exactly the
// same code as outbound and campaign results: the token check, the size
// limit, payload validation, the idempotency ledger and the call reducer
// (which recognises an inbound completion by its deployment_id).
// ============================================================

export { POST } from "../outbound/route";
