#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Tear down the AgentLoom **production** deployment + its Entra identities.

  This is the inverse of scripts/setup_identity.ps1 (+ `azd up`). It removes,
  for PRODUCTION ONLY:

    * Azure resources of the `agentloom-prod` azd environment  (`azd down --purge`)
    * Workforce tenant : app registration "AgentLoom SaaS Console" (+ its SP)
    * CIAM tenant      : app registrations "AgentLoom Customer" and
                         "AgentLoom Provisioning" (+ their SPs)
    * CIAM tenant      : the demo test users (demo-horizon / demo-novatech) and
                         the per-customer groups (cust-*)   [unless -KeepTestUsersAndGroups]

  It NEVER touches the `agentloom-dev` environment (a hard guard refuses to run
  `azd down` against it).

.DESCRIPTION
  Authentication is asked **once** at the start: the script signs in to both
  Entra tenants a single time, then caches a Microsoft Graph token per tenant
  and switches between them on its own (re-minting silently from the cached
  refresh token when a token nears expiry). `azd down` reuses your existing
  azd/az credentials for the resource subscription.

  Everything is idempotent and best-effort: missing objects are skipped, so you
  can re-run after a partial failure.

.EXAMPLE
  ./scripts/teardown_prod.ps1 `
    -WorkforceTenant paint4kids.onmicrosoft.com `
    -CiamTenant      agentloomcustomers.onmicrosoft.com

.EXAMPLE
  # Keep the demo users/groups; only remove app regs + Azure resources:
  ./scripts/teardown_prod.ps1 -WorkforceTenant ... -CiamTenant ... -KeepTestUsersAndGroups

.NOTES
  Requires the Azure CLI (az) and the Azure Developer CLI (azd). You must be able
  to sign in to BOTH tenants as a Global Administrator. Deleting directory
  objects sends them to the tenant recycle bin (recoverable ~30 days); pass
  -PurgeDeletedObjects to also hard-delete them from deletedItems.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $WorkforceTenant,                 # e.g. paint4kids.onmicrosoft.com
  [Parameter(Mandatory)] [string] $CiamTenant,                      # e.g. agentloomcustomers.onmicrosoft.com
  [string]   $AzdEnv          = "agentloom-prod",                   # PRODUCTION env only — dev is refused
  [string]   $AdminAppName    = "AgentLoom SaaS Console",
  [string]   $CustomerAppName = "AgentLoom Customer",
  [string]   $ProvisioningAppName = "AgentLoom Provisioning",
  [string[]] $TestUserPrefixes = @("demo-horizon", "demo-novatech"),
  [string]   $GroupPrefix     = "cust-",
  [switch]   $KeepTestUsersAndGroups,                               # keep demo-* users + cust-* groups
  [switch]   $SkipAzure,                                            # skip `azd down`
  [switch]   $SkipIdentity,                                         # skip Entra cleanup
  [switch]   $NoPurge,                                              # `azd down` without --purge
  [switch]   $PurgeDeletedObjects,                                  # also hard-delete from directory recycle bin
  [switch]   $Force                                                 # skip the confirmation prompt
)

$ErrorActionPreference = "Stop"
$graph = "https://graph.microsoft.com/v1.0"

# Hard safety: this script must never tear down the test/dev environment.
if ($AzdEnv -match 'dev|test') {
  throw "Refusing to run: AzdEnv '$AzdEnv' looks like a test/dev environment. This script is production-only."
}

# --------------------------------------------------------------------------- #
# Token cache — sign in once per tenant, then mint Graph tokens silently.      #
# --------------------------------------------------------------------------- #
$script:TenantIds  = @{}    # friendly name -> tenant GUID
$script:TokenCache = @{}    # tenant GUID  -> @{ token = ...; exp = [datetime] }

function Connect-AllTenants {
  Write-Host "`n=== Sign-in (asked once) ===" -ForegroundColor Cyan
  foreach ($t in @($WorkforceTenant, $CiamTenant)) {
    Write-Host "  signing in to $t ..." -ForegroundColor Cyan
    az login --tenant $t --allow-no-subscriptions --only-show-errors | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "az login failed for tenant $t" }
    $tid = (az account show --query tenantId -o tsv)
    $script:TenantIds[$t] = $tid
  }
  Write-Host "  workforce tenant : $($script:TenantIds[$WorkforceTenant])"
  Write-Host "  CIAM tenant      : $($script:TenantIds[$CiamTenant])"
}

function Get-GraphToken {
  param([string]$TenantId)
  $cached = $script:TokenCache[$TenantId]
  if ($cached -and $cached.exp -gt (Get-Date).AddMinutes(5)) { return $cached.token }
  # Re-mint silently from the cached refresh token (no interactive prompt).
  $raw = az account get-access-token --tenant $TenantId --resource https://graph.microsoft.com -o json 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
    throw "Could not obtain a Graph token for tenant $TenantId (try re-running; the cached login may have expired)."
  }
  $obj = $raw | ConvertFrom-Json
  $exp = try { [datetime]$obj.expiresOn } catch { (Get-Date).AddMinutes(30) }
  $script:TokenCache[$TenantId] = @{ token = $obj.accessToken; exp = $exp }
  return $obj.accessToken
}

function Invoke-Graph {
  param([string]$TenantId, [string]$Method, [string]$Url, $Body)
  $headers = @{ Authorization = "Bearer $(Get-GraphToken $TenantId)"; "Content-Type" = "application/json" }
  try {
    if ($PSBoundParameters.ContainsKey('Body') -and $null -ne $Body) {
      $json = ($Body | ConvertTo-Json -Depth 12 -Compress)
      return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -Body $json
    }
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 404) { return $null }           # already gone — idempotent
    if ($code -eq 204) { return $null }           # no content
    throw
  }
}

function Graph-Filter {
  param([string]$Resource, [string]$Filter)      # builds an URL-encoded $filter query
  $enc = [uri]::EscapeDataString($Filter)
  return "$graph/$Resource`?`$filter=$enc"
}

# --------------------------------------------------------------------------- #
# Identity teardown helpers                                                    #
# --------------------------------------------------------------------------- #
function Remove-AppRegistration {
  param([string]$TenantId, [string]$DisplayName)
  $apps = Invoke-Graph $TenantId GET (Graph-Filter "applications" "displayName eq '$DisplayName'")
  if (-not $apps -or $apps.value.Count -eq 0) {
    Write-Host "  app '$DisplayName' not found — skipped"
    return
  }
  foreach ($app in $apps.value) {
    # Delete the service principal first (best-effort; deleting the app usually
    # cascades, but we remove it explicitly to be safe).
    $sp = Invoke-Graph $TenantId GET (Graph-Filter "servicePrincipals" "appId eq '$($app.appId)'")
    if ($sp -and $sp.value.Count -gt 0) {
      Invoke-Graph $TenantId DELETE "$graph/servicePrincipals/$($sp.value[0].id)" | Out-Null
      Write-Host "  deleted service principal of '$DisplayName'" -ForegroundColor Green
    }
    Invoke-Graph $TenantId DELETE "$graph/applications/$($app.id)" | Out-Null
    Write-Host "  deleted app registration '$DisplayName' (appId $($app.appId))" -ForegroundColor Green
    if ($PurgeDeletedObjects) {
      Invoke-Graph $TenantId DELETE "$graph/directory/deletedItems/$($app.id)" | Out-Null
      Write-Host "    purged '$DisplayName' from the directory recycle bin"
    }
  }
}

function Remove-TestUser {
  param([string]$TenantId, [string]$UpnPrefix)
  $upn = "$UpnPrefix@$CiamTenant"
  $user = Invoke-Graph $TenantId GET "$graph/users/$([uri]::EscapeDataString($upn))"
  if (-not $user) { Write-Host "  user '$upn' not found — skipped"; return }
  Invoke-Graph $TenantId DELETE "$graph/users/$($user.id)" | Out-Null
  Write-Host "  deleted test user '$upn'" -ForegroundColor Green
  if ($PurgeDeletedObjects) {
    Invoke-Graph $TenantId DELETE "$graph/directory/deletedItems/$($user.id)" | Out-Null
    Write-Host "    purged '$upn' from the directory recycle bin"
  }
}

function Remove-CustomerGroups {
  param([string]$TenantId, [string]$Prefix)
  $groups = Invoke-Graph $TenantId GET "$graph/groups?`$select=id,displayName,mailNickname&`$top=999"
  if (-not $groups -or $groups.value.Count -eq 0) { Write-Host "  no groups found — skipped"; return }
  $matches = $groups.value | Where-Object { $_.mailNickname -like "$Prefix*" }
  if (-not $matches -or @($matches).Count -eq 0) { Write-Host "  no '$Prefix*' groups — skipped"; return }
  foreach ($g in $matches) {
    Invoke-Graph $TenantId DELETE "$graph/groups/$($g.id)" | Out-Null
    Write-Host "  deleted group '$($g.mailNickname)' ($($g.id))" -ForegroundColor Green
    if ($PurgeDeletedObjects) {
      Invoke-Graph $TenantId DELETE "$graph/directory/deletedItems/$($g.id)" | Out-Null
      Write-Host "    purged group '$($g.mailNickname)' from the recycle bin"
    }
  }
}

# --------------------------------------------------------------------------- #
# Azure resource teardown (azd down) — production env only                     #
# --------------------------------------------------------------------------- #
function Remove-AzureResources {
  $repoRoot = Split-Path -Parent $PSScriptRoot
  Push-Location $repoRoot
  try {
    azd env select $AzdEnv 2>$null | Out-Null
    $envName = (azd env get-value AZURE_ENV_NAME 2>$null)
    if ([string]::IsNullOrWhiteSpace($envName)) { $envName = $AzdEnv }
    if ($envName -match 'dev|test') {
      throw "Refusing `azd down`: selected env '$envName' looks like test/dev."
    }
    Write-Host "  running 'azd down' on env '$envName'..." -ForegroundColor Cyan
    $purgeArg = if ($NoPurge) { @() } else { @("--purge") }
    azd down --force @purgeArg
    if ($LASTEXITCODE -ne 0) { throw "azd down failed (exit $LASTEXITCODE)" }
    Write-Host "  Azure resources of '$envName' removed." -ForegroundColor Green
  } finally {
    Pop-Location
  }
}

# --------------------------------------------------------------------------- #
# Plan + confirmation                                                          #
# --------------------------------------------------------------------------- #
Write-Host "AgentLoom — PRODUCTION teardown" -ForegroundColor Yellow
Write-Host "=========================================================" -ForegroundColor Yellow
Write-Host "The following PRODUCTION items will be DELETED:" -ForegroundColor Yellow
if (-not $SkipAzure) {
  $purgeNote = if ($NoPurge) { "(no purge)" } else { "(--purge: hard-deletes Key Vault / Foundry)" }
  Write-Host "  [Azure]     azd env '$AzdEnv' resources via 'azd down --force' $purgeNote"
}
if (-not $SkipIdentity) {
  Write-Host "  [Workforce] app registration '$AdminAppName' (+ SP)"
  Write-Host "  [CIAM]      app registrations '$CustomerAppName', '$ProvisioningAppName' (+ SPs)"
  if (-not $KeepTestUsersAndGroups) {
    Write-Host "  [CIAM]      test users: $($TestUserPrefixes -join ', ')"
    Write-Host "  [CIAM]      groups matching '$GroupPrefix*' (e.g. cust-horizon-travel, cust-novatech, cust-globex)"
  } else {
    Write-Host "  [CIAM]      (keeping demo users + cust-* groups — -KeepTestUsersAndGroups)"
  }
}
Write-Host "NOT touched: the 'agentloom-dev' test environment." -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Yellow

if (-not $Force) {
  $ans = Read-Host "Type 'DELETE' to proceed"
  if ($ans -ne "DELETE") { Write-Host "Aborted." -ForegroundColor Red; exit 1 }
}

# --------------------------------------------------------------------------- #
# Execute                                                                      #
# --------------------------------------------------------------------------- #
if (-not $SkipIdentity) {
  Connect-AllTenants
  $wfTid   = $script:TenantIds[$WorkforceTenant]
  $ciamTid = $script:TenantIds[$CiamTenant]

  Write-Host "`n--- Workforce tenant cleanup ---" -ForegroundColor Cyan
  Remove-AppRegistration -TenantId $wfTid -DisplayName $AdminAppName

  Write-Host "`n--- CIAM tenant cleanup ---" -ForegroundColor Cyan
  if (-not $KeepTestUsersAndGroups) {
    foreach ($p in $TestUserPrefixes) { Remove-TestUser -TenantId $ciamTid -UpnPrefix $p }
    Remove-CustomerGroups -TenantId $ciamTid -Prefix $GroupPrefix
  }
  Remove-AppRegistration -TenantId $ciamTid -DisplayName $CustomerAppName
  Remove-AppRegistration -TenantId $ciamTid -DisplayName $ProvisioningAppName
}

if (-not $SkipAzure) {
  Write-Host "`n--- Azure resources cleanup ---" -ForegroundColor Cyan
  Remove-AzureResources
}

Write-Host "`n=========================================================" -ForegroundColor Yellow
Write-Host " Production teardown complete." -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Yellow
Write-Host "Reminder: the 'agentloom-dev' environment was left intact." -ForegroundColor Green
if (-not $PurgeDeletedObjects -and -not $SkipIdentity) {
  Write-Host "Deleted Entra objects are in each tenant's recycle bin (~30 days)." -ForegroundColor DarkGray
  Write-Host "Re-run with -PurgeDeletedObjects to hard-delete them now." -ForegroundColor DarkGray
}
