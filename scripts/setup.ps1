#!/usr/bin/env pwsh
# AgentLoom post-provision hook: seeds Cosmos catalog + creates Foundry agents +
# seeds the two demo customers. Invoked by ``azd up``.
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot

# azd places resolved outputs into the current environment.
$env:COSMOS_ENDPOINT          = azd env get-value COSMOS_ENDPOINT
$env:COSMOS_DATABASE          = azd env get-value COSMOS_DATABASE
$env:SEARCH_ENDPOINT          = azd env get-value SEARCH_ENDPOINT
$env:STORAGE_ACCOUNT          = azd env get-value STORAGE_ACCOUNT
$env:STORAGE_CONTAINER        = azd env get-value STORAGE_CONTAINER
$env:KEYVAULT_URI             = azd env get-value KEYVAULT_URI
$env:FOUNDRY_PROJECT_ENDPOINT = azd env get-value FOUNDRY_PROJECT_ENDPOINT
$env:FOUNDRY_MODEL_DEPLOYMENT = azd env get-value FOUNDRY_MODEL_DEPLOYMENT

Write-Host "Installing backend dependencies for seed scripts…"
python -m pip install --quiet -r "$repo/backend/requirements.txt"

Write-Host "Creating Foundry agent templates…"
python "$repo/scripts/create_foundry_agents.py"

Write-Host "Seeding demo customers…"
python "$repo/scripts/seed_customers.py"

Write-Host "Done. URLs:"
Write-Host ("  Backend  : " + (azd env get-value BACKEND_URL))
Write-Host ("  Admin    : " + (azd env get-value ADMIN_URL))
Write-Host ("  Customer : " + (azd env get-value CUSTOMER_URL))
