// ============================================================
// POST /api/auth/bootstrap
// ============================================================
//
// Creates the first tenant and its owner account.
//
// This exists because the brief forbids hardcoded demo credentials, and an
// application with real authentication and no way to make the first account is
// not usable. It is not a public sign-up route:
//
//   - It refuses once any user exists, so it cannot be used twice.
//   - It requires DIALO_INTERNAL_SECRET, so a publicly tunnelled dev server
//     cannot have its first account claimed by whoever finds the URL first.
//
// Everything already in the database — the real leads, calls and follow-ups —
// predates tenancy and is adopted by this first tenant, which is recorded as
// the legacy tenant so those rows stay visible to their owner and to nobody
// else.
// ============================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import { checkPasswordPolicy, hashPassword } from "@/lib/auth/passwords";
import { countUsers, saveTenant, saveUser, setLegacyTenantId } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import type { Tenant, User } from "@/lib/types";

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** Constant-time compare, so the secret cannot be recovered byte by byte. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "auth:bootstrap"), 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.");
  }

  const expected = (process.env.DIALO_INTERNAL_SECRET || "").trim();
  if (!expected) {
    return fail(
      503,
      "not_configured",
      "Set DIALO_INTERNAL_SECRET in the server environment before creating the first account."
    );
  }

  const provided = (request.headers.get("x-dialo-internal-secret") || "").trim();
  if (!provided || !secretMatches(provided, expected)) {
    return fail(401, "unauthorized", "Invalid internal secret.");
  }

  if (countUsers() > 0) {
    return fail(409, "already_bootstrapped", "An account already exists. Use the login endpoint.");
  }

  let body: { email?: unknown; password?: unknown; name?: unknown; businessName?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const businessName = typeof body.businessName === "string" ? body.businessName.trim() : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(400, "invalid_email", "Provide a valid email address.");
  }
  if (!businessName) {
    return fail(400, "missing_business", "A business name is required.");
  }

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    return fail(400, "weak_password", policy.reason ?? "That password is not acceptable.");
  }

  const now = new Date().toISOString();
  const tenant: Tenant = {
    id: `tenant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: businessName,
    createdAt: now,
  };
  saveTenant(tenant);

  const user: User = {
    id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: tenant.id,
    email,
    name: name || email.split("@")[0],
    passwordHash: await hashPassword(password),
    role: "owner",
    createdAt: now,
    lastLoginAt: null,
    lockedUntil: null,
    failedAttempts: 0,
  };
  saveUser(user);

  // Adopt the pre-tenancy data rather than orphaning it.
  setLegacyTenantId(tenant.id);

  console.log(`AUTH_BOOTSTRAP tenant=${tenant.id} user=${user.id}`);

  return NextResponse.json(
    {
      tenant: { id: tenant.id, name: tenant.name },
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
