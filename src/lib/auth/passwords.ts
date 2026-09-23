// ============================================================
// Dialo AI — Password Hashing
// ============================================================
//
// scrypt from Node's own crypto, so adding real authentication costs no new
// dependency. scrypt is memory-hard, which is what makes a stolen hash
// expensive to attack on GPUs in a way that a bare SHA-256 is not.
//
// Nothing here ever sees or stores a plaintext password beyond the moment it is
// verified, and nothing here is ever logged.
// ============================================================

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

// OWASP's floor for scrypt. N is the memory/CPU cost; raising it later is safe
// because the parameters travel inside each stored hash, so old hashes keep
// verifying and are upgraded on next login.
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// Node's default maxmem (32MB) is below what N=16384,r=8 needs, so it is raised
// explicitly rather than left to fail at runtime.
const MAX_MEM = 64 * 1024 * 1024;

/** Minimum that is worth enforcing without pretending complexity rules help. */
export const MIN_PASSWORD_LENGTH = 10;

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: string;
}

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > 512) {
    // A bound on work, not on the person: scrypt on a megabyte of input is a
    // denial-of-service vector.
    return { ok: false, reason: "Password must be 512 characters or fewer." };
  }
  return { ok: true };
}

/**
 * Hashes a password into a self-describing string.
 *
 * Format: `scrypt$N$r$p$<salt base64>$<hash base64>`. The parameters are stored
 * alongside so they can be raised in future without invalidating every account.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verifies a password against a stored hash in constant time.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt record must
 * fail the login, not crash the endpoint and leak a stack trace.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (typeof stored !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    // Refuse absurd parameters from a tampered record rather than letting them
    // allocate gigabytes inside scrypt.
    if (N < 1024 || N > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parts = typeof stored === "string" ? stored.split("$") : [];
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < PARAMS.N;
}
