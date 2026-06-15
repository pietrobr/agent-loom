#!/usr/bin/env pwsh
# AgentLoom post-provision hook: seeds the catalog (agent templates) + the two
# demo customers (instances + knowledge). Invoked by ``azd up``.
#
# Cosmos DB is private (publicNetworkAccess=Disabled), so this hook cannot reach
# it from the developer machine. Instead it drives the backend Container App —
# which lives inside the VNet — over its public HTTPS ingress (BACKEND_URL).
# The backend performs all the Cosmos/Search/Blob/Foundry writes. No firewall
# changes required.
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot

# azd places resolved outputs into the current environment.
$env:BACKEND_URL              = azd env get-value BACKEND_URL
$env:FOUNDRY_MODEL_DEPLOYMENT = azd env get-value FOUNDRY_MODEL_DEPLOYMENT

# Seed flags (default: enabled). Configure before `azd up` with e.g.
#   azd env set SEED_TEMPLATES false
#   azd env set SEED_DEMO_CUSTOMERS false
$seedTemplates = azd env get-value SEED_TEMPLATES 2>$null
if (-not $seedTemplates) { $seedTemplates = "true" }
$env:SEED_TEMPLATES = $seedTemplates

$seedDemo = azd env get-value SEED_DEMO_CUSTOMERS 2>$null
if (-not $seedDemo) { $seedDemo = "true" }
$env:SEED_DEMO_CUSTOMERS = $seedDemo

# In production auth mode the seeder needs an interactive admin sign-in, which
# must not happen inside `azd up`. Skip auto-seeding and tell the user to run it
# manually as a separate step (keeps dev and prod fully separate).
$authMode = azd env get-value AUTH_MODE 2>$null
if ($authMode -and $authMode.Trim().ToLower() -in @("production", "prod")) {
    $env:AUTH_MODE = $authMode
    Write-Host "AUTH_MODE=production — skipping automatic seeding."
    Write-Host "Run the seed manually once, signing in as the provider admin:"
    Write-Host ""
    Write-Host "  `$env:AUTH_MODE='production'"
    Write-Host "  `$env:BACKEND_URL=(azd env get-value BACKEND_URL)"
    Write-Host "  `$env:VITE_ADMIN_CLIENT_ID=(azd env get-value VITE_ADMIN_CLIENT_ID)"
    Write-Host "  `$env:VITE_ADMIN_AUTHORITY=(azd env get-value VITE_ADMIN_AUTHORITY)"
    Write-Host "  `$env:VITE_ADMIN_API_SCOPE=(azd env get-value VITE_ADMIN_API_SCOPE)"
    Write-Host "  python scripts/seed_via_api.py"
    Write-Host ""
} else {
    Write-Host "Installing dependencies for the API seeder…"
    python -m pip install --quiet httpx
    Write-Host "Seeding via backend API ($($env:BACKEND_URL))…"
    python "$repo/scripts/seed_via_api.py"
}

Write-Host "Done. URLs:"
Write-Host ("  Backend  : " + (azd env get-value BACKEND_URL))
Write-Host ("  Admin    : " + (azd env get-value ADMIN_URL))
Write-Host ("  Customer : " + (azd env get-value CUSTOMER_URL))
