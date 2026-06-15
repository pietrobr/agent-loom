#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Provision the Microsoft Entra identities for AgentLoom *production* auth.

  Creates, across two tenants, everything the backend needs to verify RS256
  tokens (AUTH_MODE=production):

    * Provider workforce tenant (admins)  e.g. paint4kids.onmicrosoft.com
        - "AgentLoom SaaS Console" SPA app registration
        - exposed API scope  api://<appId>/access_as_user
        - app role "admin"  (assigned to the admin user)
    * Customer Entra External ID / CIAM tenant  e.g. agentloomcustomers.onmicrosoft.com
        - "AgentLoom Customer" SPA app registration
        - exposed API scope  api://<appId>/access_as_user
        - directory extension "org_id" on the customer app (emitted as a claim)
        - (optional, -SeedTestUsers) two test users carrying org_id

  It prints the `azd env set ...` lines to wire the backend + SPAs.

.NOTES
  Requires the Azure CLI. You must be able to sign in to BOTH tenants as a
  Global Administrator (the same user works if it is GA of both). The script
  signs in to each tenant in turn with `az login --tenant ... --allow-no-subscriptions`.

  Nothing here is destructive: every object is created if missing and reused if
  it already exists (matched by displayName / UPN).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $WorkforceTenant,                 # e.g. paint4kids.onmicrosoft.com
  [Parameter(Mandatory)] [string] $CiamTenant,                      # e.g. agentloomcustomers.onmicrosoft.com
  [string] $AdminAppName    = "AgentLoom SaaS Console",
  [string] $CustomerAppName = "AgentLoom Customer",
  [string] $AdminUpn,                                               # admin to grant the 'admin' app role (defaults to signed-in user)
  [string[]] $AdminRedirectUris    = @("http://localhost:5173"),
  [string[]] $CustomerRedirectUris = @("http://localhost:5174"),
  [switch] $SeedTestUsers,
  [string] $TestUserPassword                                        # required when -SeedTestUsers; otherwise a random one is generated
)

$ErrorActionPreference = "Stop"
$graph = "https://graph.microsoft.com/v1.0"

function Invoke-Graph {
  param([string]$Method, [string]$Url, $Body)
  $args = @("rest", "--method", $Method, "--url", $Url, "--headers", "Content-Type=application/json")
  if ($PSBoundParameters.ContainsKey('Body') -and $null -ne $Body) {
    $json = ($Body | ConvertTo-Json -Depth 12 -Compress)
    $tmp = New-TemporaryFile
    Set-Content -Path $tmp -Value $json -Encoding utf8
    $args += @("--body", "@$tmp")
  }
  $out = az @args 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  if ([string]::IsNullOrWhiteSpace($out)) { return $null }
  return ($out | ConvertFrom-Json)
}

function Connect-Tenant {
  param([string]$Tenant)
  Write-Host "`n=== Signing in to tenant: $Tenant ===" -ForegroundColor Cyan
  az login --tenant $Tenant --allow-no-subscriptions --only-show-errors | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "az login failed for tenant $Tenant" }
}

function Get-OrCreateApp {
  param([string]$DisplayName, [string[]]$RedirectUris)
  $existing = Invoke-Graph GET "$graph/applications?`$filter=displayName eq '$DisplayName'"
  if ($existing -and $existing.value.Count -gt 0) {
    Write-Host "  app '$DisplayName' already exists (appId $($existing.value[0].appId))"
    return $existing.value[0]
  }
  $body = @{
    displayName    = $DisplayName
    signInAudience = "AzureADMyOrg"
    spa            = @{ redirectUris = $RedirectUris }
  }
  $app = Invoke-Graph POST "$graph/applications" $body
  Write-Host "  created app '$DisplayName' (appId $($app.appId))" -ForegroundColor Green
  return $app
}

function Ensure-ApiScope {
  param($App)
  # Expose api://<appId>/access_as_user so the SPA can request a token whose
  # audience is the app itself (the backend validates that audience).
  $appId = $App.appId
  $objId = $App.id
  $scopeId = [guid]::NewGuid().ToString()
  $patch = @{
    identifierUris = @("api://$appId")
    api = @{
      # Emit v2.0 access tokens (issuer https://login.microsoftonline.com/<tid>/v2.0
      # for workforce; https://<sub>.ciamlogin.com/<tid>/v2.0 for CIAM). The
      # backend validates the v2 issuer; v1 tokens (sts.windows.net) are rejected.
      requestedAccessTokenVersion = 2
      oauth2PermissionScopes = @(@{
        id = $scopeId; isEnabled = $true; type = "User"; value = "access_as_user"
        adminConsentDisplayName = "Access AgentLoom as the signed-in user"
        adminConsentDescription = "Allows the app to call the AgentLoom API as the signed-in user."
        userConsentDisplayName  = "Access AgentLoom on your behalf"
        userConsentDescription  = "Allows the app to call the AgentLoom API on your behalf."
      })
    }
  }
  Invoke-Graph PATCH "$graph/applications/$objId" $patch | Out-Null
  Write-Host "  exposed API scope api://$appId/access_as_user"
}

function Ensure-ServicePrincipal {
  param([string]$AppId)
  $sp = Invoke-Graph GET "$graph/servicePrincipals?`$filter=appId eq '$AppId'"
  if ($sp -and $sp.value.Count -gt 0) { return $sp.value[0] }
  return (Invoke-Graph POST "$graph/servicePrincipals" @{ appId = $AppId })
}

Write-Host "AgentLoom — production identity provisioning" -ForegroundColor Yellow

# --------------------------------------------------------------------------- #
# 1) WORKFORCE tenant — admin SPA + app role 'admin'                           #
# --------------------------------------------------------------------------- #
Connect-Tenant $WorkforceTenant
$wfTenantId = (az account show --query tenantId -o tsv)
if (-not $AdminUpn) { $AdminUpn = (az account show --query user.name -o tsv) }

$adminApp = Get-OrCreateApp -DisplayName $AdminAppName -RedirectUris $AdminRedirectUris
Ensure-ApiScope -App $adminApp

# Allow public-client (device-code) flows so the seeder can acquire an admin
# token from the CLI without a client secret (scripts/seed_via_api.py).
Invoke-Graph PATCH "$graph/applications/$($adminApp.id)" @{ isFallbackPublicClient = $true } | Out-Null
Write-Host "  enabled public-client (device-code) flows on the admin app"

# Ensure an 'admin' app role exists on the admin app.
$adminApp = Invoke-Graph GET "$graph/applications/$($adminApp.id)"
$roles = @($adminApp.appRoles)
$adminRole = $roles | Where-Object { $_.value -eq "admin" } | Select-Object -First 1
if (-not $adminRole) {
  $roleId = [guid]::NewGuid().ToString()
  $roles += @{
    id = $roleId; allowedMemberTypes = @("User"); value = "admin"
    displayName = "Admin"; description = "AgentLoom provider administrator"; isEnabled = $true
  }
  Invoke-Graph PATCH "$graph/applications/$($adminApp.id)" @{ appRoles = $roles } | Out-Null
  Write-Host "  added app role 'admin'" -ForegroundColor Green
} else {
  $roleId = $adminRole.id
  Write-Host "  app role 'admin' already present"
}

$adminSp = Ensure-ServicePrincipal -AppId $adminApp.appId

# Assign the admin user to the 'admin' app role.
$adminUser = Invoke-Graph GET "$graph/users/$AdminUpn"
if ($adminUser) {
  $existingAssign = Invoke-Graph GET "$graph/users/$($adminUser.id)/appRoleAssignments?`$filter=resourceId eq $($adminSp.id)"
  $already = $existingAssign.value | Where-Object { $_.appRoleId -eq $roleId }
  if (-not $already) {
    Invoke-Graph POST "$graph/users/$($adminUser.id)/appRoleAssignments" @{
      principalId = $adminUser.id; resourceId = $adminSp.id; appRoleId = $roleId
    } | Out-Null
    Write-Host "  assigned '$AdminUpn' the admin app role" -ForegroundColor Green
  } else {
    Write-Host "  '$AdminUpn' already has the admin app role"
  }
} else {
  Write-Warning "  admin user '$AdminUpn' not found — assign the 'admin' app role manually in the portal."
}

# --------------------------------------------------------------------------- #
# 2) CIAM tenant — customer SPA + org_id directory extension                   #
# --------------------------------------------------------------------------- #
Connect-Tenant $CiamTenant
$ciamTenantId = (az account show --query tenantId -o tsv)
$ciamSubdomain = $CiamTenant.Split(".")[0]

$custApp = Get-OrCreateApp -DisplayName $CustomerAppName -RedirectUris $CustomerRedirectUris
Ensure-ApiScope -App $custApp
$custSp = Ensure-ServicePrincipal -AppId $custApp.appId

# Register the org_id directory extension on the customer app. Claim name is
# extension_<appIdNoHyphens>_org_id.
$extName = "org_id"
$exts = Invoke-Graph GET "$graph/applications/$($custApp.id)/extensionProperties"
$orgExt = $exts.value | Where-Object { $_.name -like "*_org_id" } | Select-Object -First 1
if (-not $orgExt) {
  $orgExt = Invoke-Graph POST "$graph/applications/$($custApp.id)/extensionProperties" @{
    name = $extName; dataType = "String"; targetObjects = @("User")
  }
  Write-Host "  created directory extension '$($orgExt.name)'" -ForegroundColor Green
} else {
  Write-Host "  directory extension '$($orgExt.name)' already exists"
}
$orgIdClaim = $orgExt.name

# In Entra External ID (CIAM) a directory-extension optional claim is NOT
# emitted on access tokens by itself. Instead we map it with a claims-mapping
# policy that emits it as a simple 'org_id' claim, and let the app accept it.
#   1) acceptMappedClaims=true + v2 tokens on the customer app
#   2) a claimsMappingPolicy mapping the extension (ExtensionID) -> 'org_id'
#   3) assign the policy to the customer app's service principal
$extClaimName = $orgExt.name        # directory extension name (set on users)
$emittedClaim = "org_id"            # claim name the policy emits in the token
Invoke-Graph PATCH "$graph/applications/$($custApp.id)" @{
  api = @{ requestedAccessTokenVersion = 2; acceptMappedClaims = $true }
} | Out-Null
Write-Host "  set acceptMappedClaims=true + v2 tokens on the customer app"

$policyDef = '{"ClaimsMappingPolicy":{"Version":1,"IncludeBasicClaimSet":"true","ClaimsSchema":[{"Source":"User","ExtensionID":"' + $extClaimName + '","JwtClaimType":"' + $emittedClaim + '"}]}}'
$existingPolicies = Invoke-Graph GET "$graph/policies/claimsMappingPolicies"
$policy = $existingPolicies.value | Where-Object { $_.displayName -eq "AgentLoom org_id" } | Select-Object -First 1
if (-not $policy) {
  $policy = Invoke-Graph POST "$graph/policies/claimsMappingPolicies" @{
    definition = @($policyDef); displayName = "AgentLoom org_id"; isOrganizationDefault = $false
  }
  Write-Host "  created claims-mapping policy 'AgentLoom org_id'" -ForegroundColor Green
} else {
  Invoke-Graph PATCH "$graph/policies/claimsMappingPolicies/$($policy.id)" @{ definition = @($policyDef) } | Out-Null
  Write-Host "  claims-mapping policy 'AgentLoom org_id' already exists (updated)"
}

# Assign the policy to the customer SP (idempotent).
$assigned = Invoke-Graph GET "$graph/servicePrincipals/$($custSp.id)/claimsMappingPolicies"
$already = $assigned.value | Where-Object { $_.id -eq $policy.id }
if (-not $already) {
  Invoke-Graph POST "$graph/servicePrincipals/$($custSp.id)/claimsMappingPolicies/`$ref" @{
    '@odata.id' = "https://graph.microsoft.com/v1.0/policies/claimsMappingPolicies/$($policy.id)"
  } | Out-Null
  Write-Host "  assigned claims-mapping policy to the customer app" -ForegroundColor Green
} else {
  Write-Host "  claims-mapping policy already assigned to the customer app"
}
# The token carries the simple 'org_id' claim; users hold the extension value.
$orgIdClaim = $emittedClaim

# --------------------------------------------------------------------------- #
# 3) (optional) test users in the CIAM tenant                                  #
# --------------------------------------------------------------------------- #
if ($SeedTestUsers) {
  if (-not $TestUserPassword) {
    $TestUserPassword = ("Aa1!" + [guid]::NewGuid().ToString("N").Substring(0, 12))
    Write-Host "`n  Generated test-user password: $TestUserPassword" -ForegroundColor Yellow
  }
  $testUsers = @(
    @{ upnPrefix = "demo-horizon";  display = "Demo Horizon Travel"; org = "horizon-travel" },
    @{ upnPrefix = "demo-novatech"; display = "Demo NovaTech";       org = "novatech" }
  )
  foreach ($u in $testUsers) {
    $upn = "$($u.upnPrefix)@$CiamTenant"
    $existing = Invoke-Graph GET "$graph/users/$upn"
    $body = @{
      accountEnabled    = $true
      displayName       = $u.display
      mailNickname      = $u.upnPrefix
      userPrincipalName = $upn
      passwordProfile   = @{ password = $TestUserPassword; forceChangePasswordNextSignIn = $false }
    }
    $body[$extClaimName] = $u.org
    if ($existing) {
      Invoke-Graph PATCH "$graph/users/$($existing.id)" @{ ($extClaimName) = $u.org } | Out-Null
      Write-Host "  test user '$upn' exists — set org_id=$($u.org)"
    } else {
      Invoke-Graph POST "$graph/users" $body | Out-Null
      Write-Host "  created test user '$upn' (org_id=$($u.org))" -ForegroundColor Green
    }
  }
}

# --------------------------------------------------------------------------- #
# 4) Output the azd env wiring                                                 #
# --------------------------------------------------------------------------- #
Write-Host "`n=========================================================" -ForegroundColor Yellow
Write-Host " Provisioning complete. Wire the deployment with:" -ForegroundColor Yellow
Write-Host "=========================================================" -ForegroundColor Yellow
@"
azd env set AUTH_MODE production
azd env set WORKFORCE_TENANT_ID $wfTenantId
azd env set WORKFORCE_AUDIENCE  $($adminApp.appId)
azd env set CIAM_TENANT_ID      $ciamTenantId
azd env set CIAM_SUBDOMAIN      $ciamSubdomain
azd env set CIAM_AUDIENCE       $($custApp.appId)
azd env set ORG_ID_CLAIM        $orgIdClaim

# Frontends (MSAL):
azd env set VITE_ADMIN_CLIENT_ID    $($adminApp.appId)
azd env set VITE_ADMIN_AUTHORITY    https://login.microsoftonline.com/$wfTenantId
azd env set VITE_ADMIN_API_SCOPE    api://$($adminApp.appId)/access_as_user
azd env set VITE_CUSTOMER_CLIENT_ID $($custApp.appId)
azd env set VITE_CUSTOMER_AUTHORITY https://$ciamSubdomain.ciamlogin.com/$ciamTenantId
azd env set VITE_CUSTOMER_API_SCOPE api://$($custApp.appId)/access_as_user
"@ | Write-Host

Write-Host "`nNOTE: after `azd up`, add the deployed SPA URLs as SPA redirect URIs" -ForegroundColor Yellow
Write-Host "      on both app registrations (admin → ADMIN_URL, customer → CUSTOMER_URL)." -ForegroundColor Yellow
