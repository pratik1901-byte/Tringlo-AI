#!/usr/bin/env node
// ============================================================
// Tringlo AI — Development Launcher
// ============================================================
//
// Starts the app and a public tunnel together, and keeps them agreeing about
// which URL Sarvam should post call results to.
//
// This exists because a free quick tunnel is handed a new hostname on every
// restart and is revoked after a few hours — and when it is, `cloudflared`
// stays alive retrying a tunnel that no longer exists. It looks healthy while
// every call is being refused. That has happened three times.
//
// So the tunnel is supervised rather than trusted: the launcher polls the app's
// own health probe *through* the public URL, and when that stops answering it
// replaces the tunnel and registers the new hostname with the running app. The
// URL lives in the database, not in an env var, so nothing has to restart.
//
//   npm run dev            app + tunnel, supervised
//   npm run dev -- --no-tunnel   app only
// ============================================================

import os from "node:os";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const PORT = Number(process.env.PORT || 3000);
const APP_ORIGIN = `http://localhost:${PORT}`;
const USE_TUNNEL = !process.argv.includes("--no-tunnel");

const HEALTH_INTERVAL_MS = 20_000;
const HEALTH_TIMEOUT_MS = 12_000;
/** Consecutive failures before the tunnel is considered dead and replaced. */
const FAILURES_BEFORE_REPLACE = 2;
/** Backoff between replacement attempts, so a broken setup cannot spin. */
const BACKOFF_MS = [0, 15_000, 60_000, 300_000];
/** After this many consecutive replacements, stop and wait for a human. */
const MAX_REPLACEMENTS = 6;

/**
 * A stable hostname configured in the environment means a named tunnel is in
 * use. The supervisor then leaves the tunnel alone: `cloudflared` reconnects a
 * named tunnel by itself, and replacing it would be both unnecessary and wrong.
 */
const CONFIGURED_URL = (process.env.WEBHOOK_BASE_URL || process.env.PUBLIC_APP_URL || "").trim();
const HAS_NAMED_TUNNEL =
  CONFIGURED_URL.startsWith("https://") && !CONFIGURED_URL.includes("trycloudflare.com");

const CLOUDFLARED_CANDIDATES = [
  "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
  "C:\\Program Files\\cloudflared\\cloudflared.exe",
  "cloudflared",
];

const log = (message) => console.log(`\x1b[36m[dialo]\x1b[0m ${message}`);
const warn = (message) => console.log(`\x1b[33m[dialo]\x1b[0m ${message}`);
const fail = (message) => console.log(`\x1b[31m[dialo]\x1b[0m ${message}`);

/** This machine's private IPv4 addresses — the same list next.config.ts allows. */
function lanAddresses() {
  const privateRange = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => privateRange.test(address));
}

let tunnelProcess = null;
let tunnelUrl = null;
let failures = 0;
let replacements = 0;
let shuttingDown = false;

function cloudflaredPath() {
  return CLOUDFLARED_CANDIDATES.find((candidate) =>
    candidate === "cloudflared" ? true : existsSync(candidate)
  );
}

// ------------------------------------------------------------
// The app
// ------------------------------------------------------------

const nextProcess = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "-p", String(PORT)],
  { stdio: "inherit", shell: process.platform === "win32" }
);

nextProcess.on("exit", (code) => {
  if (!shuttingDown) {
    fail(`next dev exited with code ${code}.`);
    shutdown(code ?? 1);
  }
});

async function waitForApp() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${APP_ORIGIN}/api/integrations/webhook-url`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

// ------------------------------------------------------------
// The tunnel
// ------------------------------------------------------------

function startTunnel() {
  return new Promise((resolve) => {
    const binary = cloudflaredPath();
    if (!binary) {
      fail("cloudflared is not installed. Run: winget install --id Cloudflare.cloudflared");
      resolve(null);
      return;
    }

    const child = spawn(binary, ["tunnel", "--url", APP_ORIGIN], { shell: false });
    tunnelProcess = child;

    let settled = false;
    const onData = (buffer) => {
      const text = buffer.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !settled) {
        settled = true;
        resolve(match[0]);
      }
      // Surface the specific failure that used to go unnoticed.
      if (/Unauthorized: Tunnel not found/.test(text)) {
        warn("Tunnel was revoked by Cloudflare — replacing it.");
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("exit", () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 30_000);
  });
}

function stopTunnel() {
  if (!tunnelProcess) return;
  try {
    tunnelProcess.kill();
  } catch {
    // already gone
  }
  tunnelProcess = null;
}

/** Tells the running app where results should be delivered. No restart needed. */
async function registerUrl(url) {
  try {
    const headers = { "Content-Type": "application/json" };
    // Presented when configured; otherwise the endpoint falls back to accepting
    // only unproxied local requests.
    if (process.env.DIALO_INTERNAL_SECRET) {
      headers["x-dialo-internal"] = process.env.DIALO_INTERNAL_SECRET;
    }

    const response = await fetch(`${APP_ORIGIN}/api/integrations/webhook-url`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ webhookBaseUrl: url }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Confirms the tunnel reaches *this* app, not merely that something answered.
 * A Cloudflare error page returns 200 quite happily.
 */
async function isTunnelHealthy(url) {
  try {
    const response = await fetch(`${url}/api/webhooks/sarvam/outbound`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.service === "dialo-sarvam-webhook";
  } catch {
    return false;
  }
}

async function bringUpTunnel() {
  stopTunnel();
  const url = await startTunnel();

  if (!url) {
    fail("Could not start a tunnel. Calls will be refused until one is running.");
    return false;
  }

  tunnelUrl = url;
  const registered = await registerUrl(url);

  if (registered) {
    log(`Tunnel ready: \x1b[1m${url}\x1b[0m`);
    log("Registered with the app — no restart needed.");
  } else {
    warn(`Tunnel is up at ${url} but the app did not accept it. Retrying shortly.`);
  }

  failures = 0;
  return registered;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function superviseTunnel() {
  if (shuttingDown || !tunnelUrl) return;

  if (await isTunnelHealthy(tunnelUrl)) {
    failures = 0;
    return;
  }

  failures++;
  warn(`Tunnel health check failed (${failures}/${FAILURES_BEFORE_REPLACE}).`);

  if (failures < FAILURES_BEFORE_REPLACE) return;

  if (replacements >= MAX_REPLACEMENTS) {
    fail(
      `Gave up after ${replacements} replacement attempts. Something else is wrong — ` +
        "check that the app is serving on the expected port, then restart. " +
        "A named tunnel (scripts/setup-named-tunnel.ps1) avoids this entirely."
    );
    failures = 0;
    return;
  }

  // Backoff, so a genuinely broken setup is not hammered in a tight loop.
  const delay = BACKOFF_MS[Math.min(replacements, BACKOFF_MS.length - 1)];
  if (delay > 0) {
    warn(`Waiting ${delay / 1000}s before replacing the tunnel (attempt ${replacements + 1}).`);
    await wait(delay);
  }

  replacements++;
  warn("Replacing the tunnel.");
  const ok = await bringUpTunnel();
  if (ok) replacements = 0;
}

// ------------------------------------------------------------
// Lifecycle
// ------------------------------------------------------------

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Shutting down.");
  stopTunnel();
  try {
    nextProcess.kill();
  } catch {
    // already gone
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

(async () => {
  log(`Starting the app on port ${PORT}.`);

  if (!(await waitForApp())) {
    fail("The app did not come up in time.");
    shutdown(1);
    return;
  }
  log("App is up.");
  // The address to type on a phone on the same Wi-Fi. Printed rather than
  // remembered, because the router can hand this machine a new one.
  for (const address of lanAddresses()) {
    log(`On your phone (same Wi-Fi): http://${address}:${PORT}`);
  }

  if (!USE_TUNNEL) {
    warn("Running without a tunnel (--no-tunnel). Calls will be refused.");
    return;
  }

  if (HAS_NAMED_TUNNEL) {
    // A named tunnel is stable and self-reconnecting; the supervisor only
    // registers the hostname and reports on it.
    log(`Using the configured hostname: [1m${CONFIGURED_URL}[0m`);
    log("Named tunnel detected — not starting a quick tunnel.");
    await registerUrl(CONFIGURED_URL);
    tunnelUrl = CONFIGURED_URL;
    setInterval(async () => {
      if (!(await isTunnelHealthy(CONFIGURED_URL))) {
        warn("The configured hostname is not answering. Is `cloudflared tunnel run` up?");
      }
    }, HEALTH_INTERVAL_MS);
    return;
  }

  warn("No stable hostname configured — falling back to a temporary quick tunnel.");
  warn("Quick tunnels change hostname and get revoked. Run scripts/setup-named-tunnel.ps1 to fix this properly.");
  await bringUpTunnel();
  setInterval(superviseTunnel, HEALTH_INTERVAL_MS);
})();
