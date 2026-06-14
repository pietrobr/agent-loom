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

Write-Host "Installing dependencies for the API seeder…"
python -m pip install --quiet httpx

Write-Host "Seeding via backend API ($($env:BACKEND_URL))…"
python "$repo/scripts/seed_via_api.py"

Write-Host "Done. URLs:"
Write-Host ("  Backend  : " + (azd env get-value BACKEND_URL))
Write-Host ("  Admin    : " + (azd env get-value ADMIN_URL))
Write-Host ("  Customer : " + (azd env get-value CUSTOMER_URL))
