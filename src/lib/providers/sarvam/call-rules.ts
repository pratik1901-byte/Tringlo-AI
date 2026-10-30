// ============================================================
// Sarvam — how every call should be run
// ============================================================
//
// Sent with every call, appended to the call's goal (the agent variable that
// carries it). The agent's own prompt lives in Sarvam's dashboard and was set
// up for discovery — it asked up to 17 questions in one call until the
// customer complained. These rules are Tringlo's side of keeping calls short:
// few questions, only the ones that matter, never re-asking what is known,
// and no promises Tringlo does not keep.
// ============================================================

export const MAX_QUESTIONS_PER_CALL = 3;

/**
 * Whose name to use, and whose to ignore.
 *
 * Sent on every call because the agent's prompt lives in Sarvam's dashboard
 * and can read a variable Tringlo does not set. On 9 October 2026 an agent
 * addressed a customer as "Manan" — a demo default on its own `user_name`
 * variable — while Tringlo had sent `customer_name: "Pratik"`. These rules make
 * the person in front of the agent outrank any stored or default value.
 */
export const NAME_RULES = [
  "THE CUSTOMER'S NAME (follow strictly):",
  "- The person you are speaking to is customer_name. Use that name and no other.",
  "- If customer_name is empty, you do not know their name. Do not guess one, do not read one from any other variable, and never infer one from the phone number. Speak without a name, or ask once.",
  "- Never address the customer by a name that came from an example, a template or a variable's default value. If a name appears in your instructions that customer_name does not confirm, ignore it.",
  "- If the person tells you their name during this call, use exactly that name from then on, even if it differs from customer_name, and record it in stated_customer_name.",
  "- If they correct you (\"my name is X, not Y\"), apologise in one short clause, use X immediately, and record X in stated_customer_name.",
  "- Never use your own name for the customer. You are the caller; they are customer_name.",
  "- Do not ask someone to confirm a name they have already given you, and do not ask for a name more than once.",
].join("\n") as string;

export const CALL_RULES = [
  "HOW TO RUN THIS CALL (follow strictly):",
  `- Ask at most ${MAX_QUESTIONS_PER_CALL} questions in the whole call, one per turn, and only these if still unknown: is now a good time; is the product relevant to them; what next step or callback time they want.`,
  "- Do not ask about budget, timeline, who else decides, current solutions, goals or success measures unless the customer brings them up first.",
  "- Never ask about anything already known from earlier calls.",
  "- Prefer short statements over questions. Answer what the customer asks, briefly.",
  "- If the customer is busy, wants to end, or says you are asking too much, stop asking at once: confirm a callback time or next step and close politely.",
  "- Leave any output field you could not fill as NA. Never ask a question just to fill a field.",
  "- Do not promise an SMS, email, calendar invite or confirmation message. Say the team will follow up.",
  NAME_RULES,
].join("\n");

/**
 * Inbound: the customer called us. Sent in place of the outbound goal and
 * rules on the same variable, so an agent written for outbound calls stops
 * pitching and starts helping.
 */
export function inboundCallRules(facts: {
  callerName: string | null;
  companyName: string;
  businessHours: string;
  handoffAvailable: boolean;
  afterHoursMessage: string | null;
}): string {
  return [
    "THIS IS AN INBOUND CALL — THE CUSTOMER CALLED US. Follow strictly:",
    facts.callerName
      ? `- The caller is ${facts.callerName}, a registered customer. You have already greeted them by name; do not ask who they are or confirm their name again.`
      : "- The caller is not in our records. Right after your greeting, ask once for their name (\"May I know your name, please?\") and record it in caller_name. If they would rather not say, continue without it.",
    "- Do NOT run an outbound sales script: do not ask \"is now a good time\" or pitch unprompted. Ask what they are calling about and help with that.",
    "- Use what we already know about them (previous interaction) to help faster. Never ask for anything already known.",
    "- Answer only from the company and product information you have. If you do not know, say a colleague will confirm — never guess or invent.",
    `- ${facts.companyName || "The company"} is available ${facts.businessHours}.${facts.afterHoursMessage ? ` Outside these hours, tell the caller: ${facts.afterHoursMessage}` : ""}`,
    facts.handoffAvailable
      ? "- If they ask for a person, use the call transfer. Never say you have transferred them unless the transfer is actually happening."
      : "- No one is available to take a transfer. If they ask for a person, offer a callback instead; never claim to transfer them.",
    "- Ask at most 2 questions in the whole call. Keep answers short.",
    "- Do not promise an SMS, email, calendar invite or confirmation message. Say the team will follow up.",
    "- Leave any output field you could not fill as NA.",
    // The same precedence rule as outbound, in the words of a caller: the
    // person on the line decides what they are called.
    facts.callerName
      ? `- If they give a different name from ${facts.callerName}, or correct you, use the name they give from then on and record it in caller_name.`
      : "- Never address the caller by a name that came from an example or from a variable's default, and never infer one from their number.",
  ].join("\n");
}

/** The call's goal with the rules after it. The rules are sent even with no goal. */
export function withCallRules(goal: string | null | undefined): string {
  const text = (goal ?? "").trim();
  return text ? `${text}\n\n${CALL_RULES}` : CALL_RULES;
}
