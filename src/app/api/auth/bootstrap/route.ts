// ============================================================
// POST /api/auth/bootstrap
// ============================================================
//
// Creates a workspace: a tenant and its owner account.
//
// There are no hardcoded demo credentials anywhere in Dialo, so this is how
// the first account comes to exist, and how further ones are added. Each call
// creates a SEPARATE tenant, so two accounts made here see entirely different
// leads, calls, follow-ups and customer memory.
//
// It is not a public sign-up route: it is reachable only from a browser on the
// server machine, or with DIALO_INTERNAL_SECRET. A publicly tunnelled dev
// server therefore cannot have accounts created by whoever finds the URL.
//
// Everything already in the database — the real leads, calls and follow-ups —
// predates tenancy and is adopted by this first tenant, which is recorded as
// the legacy tenant so those rows stay visible to their owner and to nobody
// else.
// ============================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import { isLocalRequest } from "@/lib/auth/local-request";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/passwords";
import { countUsers, findUserByEmail, saveTenant, saveUser, setLegacyTenantId } from "@/lib/db";
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

  // Two ways in, and exactly two.
  //
  //   - From a browser on the server machine, while no account exists. Someone
  //     with local access to the machine could read the database anyway, so
  //     requiring a secret here protects nothing and only makes first run
  //     impossible until one is invented.
  //   - From anywhere, with DIALO_INTERNAL_SECRET. This is the path for a
  //     deployed server, where nobody is sitting at the machine.
  //
  // A request forwarded by the Cloudflare tunnel is never treated as local.
  const expected = (process.env.DIALO_INTERNAL_SECRET || "").trim();
  const provided = (request.headers.get("x-dialo-internal-secret") || "").trim();
  const hasSecret = Boolean(expected) && Boolean(provided) && secretMatches(provided, expected);

  if (!hasSecret && !isLocalRequest(request)) {
    return fail(
      401,
      "unauthorized",
      "Accounts can only be created from the server machine, or with the internal secret."
    );
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

  // Two accounts cannot share a login.
  if (findUserByEmail(email)) {
    return fail(409, "email_taken", "An account with that email already exists.");
  }

  // Whether this is the very first account decides one thing only: who adopts
  // the data that predates tenancy.
  const isFirstAccount = countUsers() === 0;

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

  // The first account adopts the data that predates tenancy rather than
  // orphaning it. Later accounts must not: handing a second business the
  // first one's customers is precisely what tenant isolation exists to stop.
  if (isFirstAccount) setLegacyTenantId(tenant.id);

  console.log(
    `AUTH_ACCOUNT_CREATED tenant=${tenant.id} user=${user.id} first=${isFirstAccount}`
  );

  return NextResponse.json(
    {
      tenant: { id: tenant.id, name: tenant.name },
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
