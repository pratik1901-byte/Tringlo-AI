// ============================================================
// POST /api/auth/bootstrap
// ============================================================
//
// Creates a workspace: a tenant and its owner account.
//
// There are no hardcoded demo credentials anywhere in Tringlo, so this is how
// the first account comes to exist, and how further ones are added. Each call
// creates a SEPARATE tenant, so two accounts made here see entirely different
// leads, calls, follow-ups and customer memory.
//
// It is not a public sign-up route: it is reachable only from a browser on the
// server machine, or with TRINGLO_INTERNAL_SECRET. A publicly tunnelled dev
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
import {
  countUsers,
  deleteTenant,
  findUserByEmail,
  saveAgentConfig,
  saveInboundSettings,
  saveTenant,
  saveUser,
  setLegacyTenantId,
  grantMembership,} from "@/lib/db";
import { defaultInboundSettings } from "@/lib/inbound/types";
import { validateInboundInput, type InboundSettingsInput } from "@/lib/inbound/service";
import { batchProblems, outboundProblems, inboundProblems, saveWorkspaceProvider } from "@/lib/providers/config";
import type { AgentConfig } from "@/lib/types";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import type { Tenant, User } from "@/lib/types";

function fail(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code, message, ...(extra ?? {}) } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** Constant-time compare, so the secret cannot be recovered byte by byte. */
/** A comma-separated string or a list; either way, the names as written. */
function variableNames(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw.map((name) => String(name).trim()).filter(Boolean);
}

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
  //   - From anywhere, with TRINGLO_INTERNAL_SECRET. This is the path for a
  //     deployed server, where nobody is sitting at the machine.
  //
  // A request forwarded by the Cloudflare tunnel is never treated as local.
  const expected = (process.env.TRINGLO_INTERNAL_SECRET || "").trim();
  const provided = (request.headers.get("x-tringlo-internal-secret") || "").trim();
  const hasSecret = Boolean(expected) && Boolean(provided) && secretMatches(provided, expected);

  // Unchanged, and deliberately so: this endpoint creates the *first* account,
  // which is a privileged operation. An account that already exists adds
  // further workspaces through POST /api/workspaces, which is authenticated
  // by session like the rest of the application.
  if (!hasSecret && !isLocalRequest(request)) {
    return fail(
      401,
      "unauthorized",
      "Accounts can only be created from the server machine, or with the internal secret."
    );
  }

  let body: {
    email?: unknown;
    password?: unknown;
    name?: unknown;
    businessName?: unknown;
    company?: unknown;
    outbound?: unknown;
    batch?: unknown;
    inbound?: unknown;
  };
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

  // --- the rest of the form, read before anything is created ---
  const rawCompany = (body.company ?? {}) as Record<string, unknown>;
  const text = (source: Record<string, unknown>, key: string) =>
    typeof source[key] === "string" ? (source[key] as string).trim() : "";

  const company: Partial<AgentConfig> = {
    companyName: text(rawCompany, "companyName"),
    industry: text(rawCompany, "industry"),
    companyDescription: text(rawCompany, "companyDescription"),
    productName: text(rawCompany, "productName"),
    productDescription: text(rawCompany, "productDescription"),
    salesObjective: text(rawCompany, "salesObjective"),
    faqs: text(rawCompany, "faqs"),
    agentName: text(rawCompany, "agentName"),
  };

  const rawOutbound = (body.outbound ?? {}) as Record<string, unknown>;
  const outbound = {
    appId: text(rawOutbound, "appId"),
    appVersion: Number(rawOutbound.appVersion),
    connectionId: text(rawOutbound, "connectionId"),
    phoneNumber: text(rawOutbound, "phoneNumber"),
    agentName: text(rawOutbound, "agentName") || text(rawCompany, "agentName") || null,
    agentVariables: variableNames(rawOutbound.agentVariables),
  };

  // Campaign settings. The form offers to copy the single-call values across;
  // what arrives here is whatever the administrator confirmed.
  const rawBatch = (body.batch ?? {}) as Record<string, unknown>;
  const rawRetry = (rawBatch.retry ?? {}) as Record<string, unknown>;
  const rawSchedule = (rawBatch.schedule ?? {}) as Record<string, unknown>;
  const batch = {
    appId: text(rawBatch, "appId") || outbound.appId,
    appVersion: Number(rawBatch.appVersion) || outbound.appVersion,
    appType: text(rawBatch, "appType") || "agent",
    connectionId: text(rawBatch, "connectionId") || outbound.connectionId,
    phoneNumbers: Array.isArray(rawBatch.phoneNumbers)
      ? (rawBatch.phoneNumbers as unknown[]).map((v) => String(v).trim()).filter(Boolean)
      : outbound.phoneNumber
        ? [outbound.phoneNumber]
        : [],
    attemptsPerSecond: Number(rawBatch.attemptsPerSecond) || 1,
    cohortMode: rawBatch.cohortMode === "upload" ? ("upload" as const) : ("stream" as const),
    retry: {
      maxRetries: Number(rawRetry.maxRetries ?? 2),
      intervalMinutes: Number(rawRetry.intervalMinutes ?? 30),
      onBusy: rawRetry.onBusy !== false,
      onNoAnswer: rawRetry.onNoAnswer !== false,
      onFailed: Boolean(rawRetry.onFailed),
      onShortDuration: Boolean(rawRetry.onShortDuration),
      shortDurationSeconds: Number(rawRetry.shortDurationSeconds ?? 25),
    },
    schedule: {
      timezone: text(rawSchedule, "timezone") || "Asia/Kolkata",
      startTime: text(rawSchedule, "startTime") || "09:00",
      endTime: text(rawSchedule, "endTime") || "19:00",
      days: Array.isArray(rawSchedule.days) ? (rawSchedule.days as string[]) : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
  };

  const rawInbound = body.inbound ? ((body.inbound ?? {}) as Record<string, unknown>) : null;
  const inboundAgent = rawInbound
    ? {
        appId: text(rawInbound, "appId") || outbound.appId,
        appVersion: Number(rawInbound.appVersion) || outbound.appVersion,
        connectionId: text(rawInbound, "connectionId") || outbound.connectionId,
        agentVariables: [] as string[],
      }
    : null;
  const inboundLine: InboundSettingsInput | null = rawInbound
    ? {
        phoneNumber: text(rawInbound, "phoneNumber"),
        startTime: text(rawInbound, "startTime") || "09:00",
        endTime: text(rawInbound, "endTime") || "18:00",
        days: Array.isArray(rawInbound.days) ? (rawInbound.days as InboundSettingsInput["days"]) : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        timezone: text(rawInbound, "timezone") || "Asia/Kolkata",
        handoffNumber: text(rawInbound, "handoffNumber") || null,
        afterHoursMessage: text(rawInbound, "afterHoursMessage") || null,
        deploymentId: text(rawInbound, "deploymentId") || null,
      }
    : null;

  // Nothing is created until every part of the form is acceptable. A workspace
  // that exists but cannot call is worse than one the form refused to make.
  const problems: string[] = [];
  if (!company.companyName) problems.push("Enter the company name — the agent introduces itself with it on every call.");
  problems.push(...outboundProblems(outbound));
  problems.push(...batchProblems(batch));
  if (inboundAgent) problems.push(...inboundProblems(inboundAgent));
  if (inboundLine) {
    // A tenant id that cannot collide, only so the number can be checked
    // against the lines that already exist.
    problems.push(...validateInboundInput(`pending_${Date.now()}`, inboundLine).problems);
  }
  if (problems.length) {
    return fail(400, "incomplete_setup", problems[0], { problems });
  }

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    return fail(400, "weak_password", policy.reason ?? "That password is not acceptable.");
  }

  // Two *different* accounts cannot share a login. The signed-in account
  // adding another workspace is not a second account, so its own email is not
  // a conflict with itself.
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

  // Whoever creates a workspace owns it.
  grantMembership({ userId: user.id, tenantId: tenant.id, role: "owner", createdBy: null });

  try {
    saveAgentConfig(tenant.id, company);
    saveWorkspaceProvider(tenant.id, { outbound, batch, inbound: inboundAgent }, user.email);

    if (inboundLine) {
      // Stored, switched off. A deployment answers calls the moment it exists,
      // so going live stays an explicit act in Settings.
      const base = defaultInboundSettings(tenant.id, inboundLine.timezone);
      saveInboundSettings({
        ...base,
        enabled: false,
        phoneNumber: inboundLine.phoneNumber,
        startTime: inboundLine.startTime,
        endTime: inboundLine.endTime,
        days: inboundLine.days,
        timezone: inboundLine.timezone,
        handoffNumber: inboundLine.handoffNumber,
        afterHoursMessage: inboundLine.afterHoursMessage,
        deploymentId: inboundLine.deploymentId ?? null,
      });
    }
  } catch (error) {
    // Half a workspace is not a workspace: undo it and say so.
    deleteTenant(tenant.id);
    console.error("AUTH_WORKSPACE_SETUP_FAILED", error instanceof Error ? error.message : error);
    return fail(500, "setup_failed", "The workspace could not be set up, so nothing was created. Try again.");
  }

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
      inboundConfigured: Boolean(inboundLine),
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
