// Shared by server code and the browser (Leads shows "Add name" for these),
// so it lives apart from identity.ts, which uses Node's crypto.

/** A generic placeholder rather than a name someone actually gave. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const value = (name ?? "").trim().toLowerCase();
  if (!value) return true;
  return ["customer", "unknown", "unknown caller", "lead", "test", "n/a", "na", "-"].includes(value);
}
