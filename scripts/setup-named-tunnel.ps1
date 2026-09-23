# ============================================================
# Dialo AI — Cloudflare Named Tunnel Setup
# ============================================================
#
# Gives Dialo a webhook hostname that does not change.
#
# A quick tunnel (trycloudflare.com) mints a random hostname per run and
# Cloudflare revokes it after a few hours, while cloudflared stays alive
# retrying a tunnel that no longer exists. Sarvam then delivers call results to
# an address nothing is listening on, and those results are gone. A named tunnel
# is bound to a hostname you own and keeps it across restarts.
#
# You need: a domain on Cloudflare (free plan is fine) and one browser login.
#
#   .\scripts\setup-named-tunnel.ps1 -Hostname api.yourdomain.com
#
# ============================================================

[CmdletBinding()]
param(
    # The public hostname Sarvam will post to, e.g. api.yourdomain.com
    [Parameter(Mandatory = $true)]
    [string]$Hostname,

    # Tunnel name as it appears in your Cloudflare dashboard.
    [string]$TunnelName = "dialo",

    # Local port the Dialo app listens on.
    [int]$Port = 3000,

    # Install cloudflared as a Windows service so the tunnel survives a reboot.
    [switch]$InstallService
)

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host "[dialo] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[dialo] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[dialo] $m" -ForegroundColor Red; exit 1 }

# --- cloudflared ---
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
    foreach ($candidate in @(
        "C:\Program Files (x86)\cloudflared\cloudflared.exe",
        "C:\Program Files\cloudflared\cloudflared.exe"
    )) { if (Test-Path $candidate) { $cf = $candidate; break } }
}
if (-not $cf) { Die "cloudflared not found. Install it: winget install --id Cloudflare.cloudflared" }
Info "Using $cf"

# --- Authenticate ---
# Writes a certificate to %USERPROFILE%\.cloudflared\cert.pem. That file is a
# credential: it is not part of the repository and must never be committed.
$certPath = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"
if (-not (Test-Path $certPath)) {
    Info "Opening a browser to authorise this machine against your Cloudflare account."
    Info "Pick the domain that will host $Hostname."
    & $cf tunnel login
    if (-not (Test-Path $certPath)) { Die "Login did not complete; no certificate was written." }
}
Info "Cloudflare credentials present."

# --- Create the tunnel (idempotent) ---
$existing = (& $cf tunnel list 2>&1 | Select-String -SimpleMatch $TunnelName)
if ($existing) {
    Info "Tunnel '$TunnelName' already exists; reusing it."
} else {
    Info "Creating tunnel '$TunnelName'."
    & $cf tunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) { Die "Could not create the tunnel." }
}

# --- Route the hostname ---
Info "Routing $Hostname to '$TunnelName'."
& $cf tunnel route dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) {
    Warn "DNS route was not created. It usually already exists — check your Cloudflare DNS for a CNAME on $Hostname."
}

# --- Config file ---
# Only the Dialo app is exposed. Everything else returns 404, so the tunnel is
# not a general proxy onto this machine: no .env.local, no database file, no
# other local service is reachable through it.
$cfgDir = Join-Path $env:USERPROFILE ".cloudflared"
$cfgPath = Join-Path $cfgDir "config.yml"
$tunnelId = (& $cf tunnel list --output json | ConvertFrom-Json | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1).id
if (-not $tunnelId) { Die "Could not determine the tunnel id." }

$config = @"
# Written by scripts/setup-named-tunnel.ps1
tunnel: $tunnelId
credentials-file: $cfgDir\$tunnelId.json

ingress:
  # Only the Dialo application is published.
  - hostname: $Hostname
    service: http://localhost:$Port
  # Anything else is refused rather than proxied.
  - service: http_status:404
"@

Set-Content -Path $cfgPath -Value $config -Encoding utf8
Info "Wrote $cfgPath"

# --- Point Dialo at the stable hostname ---
$envPath = Join-Path (Get-Location) ".env.local"
$webhookBase = "https://$Hostname"
if (Test-Path $envPath) {
    $lines = Get-Content $envPath | Where-Object { $_ -notmatch '^(WEBHOOK_BASE_URL|APP_URL|PUBLIC_APP_URL)=' }
    $lines += "WEBHOOK_BASE_URL=$webhookBase"
    $lines += "PUBLIC_APP_URL=$webhookBase"
    Set-Content -Path $envPath -Value $lines -Encoding utf8
    Info "Set WEBHOOK_BASE_URL and PUBLIC_APP_URL to $webhookBase"
} else {
    Warn ".env.local not found. Add: WEBHOOK_BASE_URL=$webhookBase"
}

# --- Optional Windows service ---
if ($InstallService) {
    Info "Installing cloudflared as a Windows service."
    & $cf service install
    if ($LASTEXITCODE -eq 0) {
        Info "Installed. The tunnel now starts on boot and reconnects on its own."
    } else {
        Warn "Service install failed. Run this script from an elevated PowerShell."
    }
}

Write-Host ""
Info "Done."
Info "Webhook URL:  $webhookBase/api/webhooks/sarvam/outbound"
Write-Host ""
Info "Run the tunnel with:   cloudflared tunnel run $TunnelName"
Info "Then start Dialo with: npm run dev:app"
Info "Verify with:           curl $webhookBase/api/health"
