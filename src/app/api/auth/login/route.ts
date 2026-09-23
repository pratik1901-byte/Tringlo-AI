// ============================================================
// POST /api/auth/login
// ============================================================
//
// Exchanges an email and password for a session.
//
// The response carries the token two ways, because Dialo has two kinds of
// client: an httpOnly cookie that a browser sends automatically and JavaScript
// cannot read, and a `token` field that Android and iOS put in platform secure
// storage and send as a bearer header. A browser should ignore the field and
// rely on the cookie.
// ============================================================

import { NextResponse } from "next/server";

import { toPublicUser } from "@/lib/auth/guard";
import { verifyPassword, hashPassword, needsRehash } from "@/lib/auth/passwords";
import {
  generateSessionToken,
  hashSessionToken,
  isSecureRequest,
  sessionCookie,
  sessionExpiry,
} from "@/lib/auth/sessions";
import { findUserByEmail, saveSession, updateUser } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

/** Enough for a person who mistypes; far too few to search a password space. */
const MAX_ATTEMPTS_PER_IP = 10;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/** Per-account lockout, so distributing an attack over many IPs does not help. */
const MAX_FAILED_PER_ACCOUNT = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function fail(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code, message, ...extra } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "auth:login"), MAX_ATTEMPTS_PER_IP, ATTEMPT_WINDOW_MS);
  if (!limit.allowed) {
    return fail(429, "rate_limited", "Too many sign-in attempts. Try again shortly.", {
      retryAfter: limit.retryAfter,
    });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return fail(400, "missing_credentials", "Email and password are both required.");
  }

  const user = findUserByEmail(email);

  // The same message and a comparable amount of work either way: a different
  // reply for a real address would let anyone enumerate who has an account.
  const invalid = () => fail(401, "invalid_credentials", "That email or password is not correct.");

  if (!user) {
    // Burn roughly the time a real verification costs, so the absence of an
    // account is not detectable by how fast the rejection comes back.
    await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    return invalid();
  }

  const now = Date.now();
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > now) {
    const seconds = Math.ceil((new Date(user.lockedUntil).getTime() - now) / 1000);
    return fail(423, "account_locked", "Too many failed attempts. This account is locked briefly.", {
      retryAfter: seconds,
    });
  }

  const correct = await verifyPassword(password, user.passwordHash);

  if (!correct) {
    const failedAttempts = (user.failedAttempts ?? 0) + 1;
    updateUser(user.id, {
      failedAttempts,
      lockedUntil:
        failedAttempts >= MAX_FAILED_PER_ACCOUNT
          ? new Date(now + LOCKOUT_MS).toISOString()
          : user.lockedUntil ?? null,
    });
    console.log(`AUTH_LOGIN_FAILED user=${user.id} attempts=${failedAttempts}`);
    return invalid();
  }

  // Parameters may have been raised since this password was last hashed; the
  // only moment the plaintext is available to upgrade it is right here.
  const updates: Parameters<typeof updateUser>[1] = {
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date(now).toISOString(),
  };
  if (needsRehash(user.passwordHash)) {
    updates.passwordHash = await hashPassword(password);
  }
  updateUser(user.id, updates);

  const token = generateSessionToken();
  saveSession({
    id: `sess_${now}_${Math.random().toString(36).slice(2, 10)}`,
    tokenHash: hashSessionToken(token),
    userId: user.id,
    tenantId: user.tenantId,
    createdAt: new Date(now).toISOString(),
    expiresAt: sessionExpiry(now),
    lastSeenAt: new Date(now).toISOString(),
    client: request.headers.get("x-dialo-client") === "mobile" ? "mobile" : "web",
  });

  console.log(`AUTH_LOGIN_OK user=${user.id} tenant=${user.tenantId}`);

  return NextResponse.json(
    {
      user: toPublicUser(user),
      token,
      expiresAt: sessionExpiry(now),
    },
    {
      status: 200,
      headers: {
        "Set-Cookie": sessionCookie(token, { secure: isSecureRequest(request) }),
        "Cache-Control": "no-store",
      },
    }
  );
}
