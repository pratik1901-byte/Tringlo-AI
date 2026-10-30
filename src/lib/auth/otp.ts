// ============================================================
// Tringlo AI — One-Time Codes
// ============================================================
//
// Six-digit codes for password reset. A million possibilities is only safe
// because of what surrounds it: a code lives ten minutes, allows five tries,
// and is replaced whenever a new one is requested. Together that makes a
// guess succeed about once in 200,000 attempts per code, not once in a
// million guesses the attacker can make at leisure.
//
// Only a salted HMAC of the code is stored. A leaked database therefore
// yields no usable codes.
// ============================================================

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

/** A uniformly random six-digit code, including ones with leading zeros. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(code: string, salt: string): string {
  return createHmac("sha256", salt).update(code, "utf-8").digest("hex");
}

export function newOtpSalt(): string {
  return randomBytes(16).toString("hex");
}

/** Constant-time comparison, so timing reveals nothing about a near miss. */
export function otpMatches(code: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOtp(code, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Accepts "123 456" or "123-456" as typed, but only ever six digits. */
export function normaliseOtp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}
