// ============================================================
// Tringlo AI — The hospital's voice agent, by name
// ============================================================
//
// One place for the name, so the panel, the agent's own page and the prose
// that explains it cannot drift apart — and so renaming her is one edit
// rather than a search across a dozen files.
//
// The name here is only a DISPLAY name. It is not an identifier: the Sarvam
// application this hospital actually calls through is identified by its own
// app id (for Wellness Hospital, an id beginning "Amrita---We-"), and that id
// is a provider resource whose name was fixed when it was created. Renaming
// the agent on screen must not, and does not, touch it — changing a provider
// id to match a label would break every call the hospital places.
//
// A workspace that has configured its own agent name overrides this. This is
// what is shown when none has been configured.
// ============================================================

/** What the hospital's agent is called, where nothing else says otherwise. */
export const DEFAULT_AGENT_NAME = "Maya";
