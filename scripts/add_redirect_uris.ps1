#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Register the deployed SPA URLs as redirect URIs on the two app registrations.

  After `azd up`, the admin-designer and customer-webapp get their public
  Container Apps URLs. MSAL sign-in only works if those exact origins are listed
  as **SPA redirect URIs** on the matching app registration. setup_identity.ps1
  runs *before* the deployment exists, so it can only seed localhost — this
  script adds the real URLs afterwards.

  It reads everything it needs from the azd environment (URLs + app client ids),
  so there is nothing to copy by hand. Idempotent: existing URIs are kept; the
  deployed origin is appended only if missing.

.DESCRIPTION
  You sign in to each tenant once (the workforce tenant owns the admin app, the
  CIAM tenant owns the customer app). Cached az sessions are reused silently when
  available, exactly like setup_identity.ps1.

.EXAMPLE
  ./scripts/add_redirect_uris.ps1 `
    -WorkforceTenant paint4kids.onmicrosoft.com `
    -CiamTenant      agentloomcustomers.onmicrosoft.com

.EXAMPLE
  # Target a specific azd env (defaults to the current default env):
  ./scripts/add_redirect_uris.ps1 -WorkforceTenant ... -CiamTenant ... -AzdEnv agentloom-prod

.NOTES
  Requires the Azure CLI + Azure Developer CLI, and Global Administrator (or
  Application Administrator) rights in each tenant. Run it after `azd up`.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $WorkforceTenant,   # tenant that owns the admin app
  [Parameter(Mandatory)] [string] $CiamTenant,        # tenant that owns the customer app
  [string] $AzdEnv                                     # optional azd env name (else current default)
)

$ErrorActionPreference = "Stop"
$graph = "https://graph.microsoft.com/v1.0"

function Get-AzdValue {
  param([string]$Key)
  $envArg = if ($AzdEnv) { @("-e", $AzdEnv) } else { @() }
  $val = (azd env get-value $Key @envArg 2>$null)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($val)) { return $null }
  return $val.Trim()
}

function Connect-Tenant {
  param([string]$Tenant)
  # Reuse a cached sign-in when available (no prompt); otherwise sign in.
  $tokJson = az account get-access-token --tenant $Tenant --resource https://graph.microsoft.com -o json 2>$null
  if ($LASTEXITCODE -eq 0 -and $tokJson) {
    $tid = ($tokJson | ConvertFrom-Json).tenant
    $sub = az account list --all --query "[?tenantId=='$tid'] | [0].id" -o tsv 2>$null
    if ($sub) {
      az account set --subscription $sub 2>$null | Out-Null
      Write-Host "  reusing cached sign-in for $Tenant" -ForegroundColor DarkGray
      return
    }
  }
  Write-Host "  signing in to $Tenant ..." -ForegroundColor Cyan
  az login --tenant $Tenant --allow-no-subscriptions --only-show-errors | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "az login failed for tenant $Tenant" }
}

function Add-SpaRedirect {
  param([string]$AppId, [string]$Origin, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($AppId)) { Write-Host "  [$Label] no app id in azd env — skipped" -ForegroundColor Yellow; return }
  if ([string]::IsNullOrWhiteSpace($Origin)) { Write-Host "  [$Label] no URL in azd env — skipped" -ForegroundColor Yellow; return }
  $Origin = $Origin.TrimEnd('/')

  $resp = az rest --method GET --url "$graph/applications?`$filter=appId eq '$AppId'" 2>$null | ConvertFrom-Json
  if (-not $resp -or $resp.value.Count -eq 0) { Write-Host "  [$Label] app '$AppId' not found in this tenant — skipped" -ForegroundColor Yellow; return }
  $obj = $resp.value[0]

  $uris = New-Object System.Collections.Generic.List[string]
  foreach ($u in $obj.spa.redirectUris) { [void]$uris.Add($u) }
  if ($uris -contains $Origin) {
    Write-Host "  [$Label] already present: $Origin"
    return
  }
  [void]$uris.Add($Origin)
  $body = @{ spa = @{ redirectUris = $uris } } | ConvertTo-Json -Depth 6 -Compress
  $tmp = New-TemporaryFile
  Set-Content -Path $tmp -Value $body -Encoding utf8
  az rest --method PATCH --url "$graph/applications/$($obj.id)" --headers "Content-Type=application/json" --body "@$tmp" 2>$null | Out-Null
  Remove-Item $tmp -Force
  Write-Host "  [$Label] added $Origin" -ForegroundColor Green
}

Write-Host "AgentLoom — register deployed SPA redirect URIs" -ForegroundColor Yellow

# Pull URLs + app client ids straight from the azd environment.
$adminUrl    = Get-AzdValue "ADMIN_URL"
$customerUrl = Get-AzdValue "CUSTOMER_URL"
$adminAppId  = Get-AzdValue "VITE_ADMIN_CLIENT_ID"
$custAppId   = Get-AzdValue "VITE_CUSTOMER_CLIENT_ID"

if (-not $adminUrl -and -not $customerUrl) {
  throw "Could not read ADMIN_URL/CUSTOMER_URL from the azd env. Run 'azd up' first (and pass -AzdEnv if needed)."
}

Write-Host "  admin app    : $adminAppId -> $adminUrl"
Write-Host "  customer app : $custAppId -> $customerUrl"

Write-Host "`n--- Workforce tenant (admin app) ---" -ForegroundColor Cyan
Connect-Tenant $WorkforceTenant
Add-SpaRedirect -AppId $adminAppId -Origin $adminUrl -Label "admin"

Write-Host "`n--- CIAM tenant (customer app) ---" -ForegroundColor Cyan
Connect-Tenant $CiamTenant
Add-SpaRedirect -AppId $custAppId -Origin $customerUrl -Label "customer"

Write-Host "`nDone. MSAL sign-in will now accept the deployed SPA origins." -ForegroundColor Green
