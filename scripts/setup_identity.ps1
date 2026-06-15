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
        - security-group membership claims on the customer app (the groups model:
          each customer = a cust-<org_id> group; the backend maps group -> org_id)
        - "AgentLoom Provisioning" app the backend uses to create those groups
        - (optional, -SeedTestUsers) two test users + their cust-<org> groups

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
  [string] $TestUserPassword,                                       # required when -SeedTestUsers; otherwise a random one is generated
  [string] $ProvisioningAppName = "AgentLoom Provisioning"          # CIAM app the backend uses to create per-customer groups
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
# 2) CIAM tenant — customer SPA + security-group membership claims              #
# --------------------------------------------------------------------------- #
Connect-Tenant $CiamTenant
$ciamTenantId = (az account show --query tenantId -o tsv)
$ciamSubdomain = $CiamTenant.Split(".")[0]

$custApp = Get-OrCreateApp -DisplayName $CustomerAppName -RedirectUris $CustomerRedirectUris
Ensure-ApiScope -App $custApp
$custSp = Ensure-ServicePrincipal -AppId $custApp.appId

# Customers are mapped to tenants via the **groups** model: each customer has a
# dedicated security group (cust-<org_id>) and the backend resolves the org_id
# from the group object id emitted on the access token. We only need v2 tokens
# and group-membership claims on the customer app — no directory extension or
# claims-mapping policy.
Invoke-Graph PATCH "$graph/applications/$($custApp.id)" @{
  api = @{ requestedAccessTokenVersion = 2 }
} | Out-Null
Write-Host "  set requestedAccessTokenVersion=2 on the customer app"

# Emit security-group membership on the customer access token (the groups model:
# the backend maps a group object id -> org_id). GUIDs are emitted, not names.
Invoke-Graph PATCH "$graph/applications/$($custApp.id)" @{ groupMembershipClaims = "SecurityGroup" } | Out-Null
Write-Host "  set groupMembershipClaims=SecurityGroup on the customer app"

# --------------------------------------------------------------------------- #
# 2b) CIAM provisioning app (client-credentials) — backend creates groups      #
# --------------------------------------------------------------------------- #
# The backend uses this app to create/delete the per-customer security group in
# the CIAM tenant when a customer is added/removed in the Admin Console. It needs
# the Microsoft Graph application permission Group.ReadWrite.All + admin consent,
# and a client secret (stored in Key Vault; printed below).
$graphAppId = "00000003-0000-0000-c000-000000000000"          # Microsoft Graph
$groupRwAllId = "62a82d76-70ea-41e2-9197-370581804d09"        # Group.ReadWrite.All (Application)

$provApp = Invoke-Graph GET "$graph/applications?`$filter=displayName eq '$ProvisioningAppName'"
if ($provApp -and $provApp.value.Count -gt 0) {
  $provApp = $provApp.value[0]
  Write-Host "  provisioning app '$ProvisioningAppName' already exists (appId $($provApp.appId))"
} else {
  $provApp = Invoke-Graph POST "$graph/applications" @{
    displayName            = $ProvisioningAppName
    signInAudience         = "AzureADMyOrg"
    requiredResourceAccess = @(@{
      resourceAppId  = $graphAppId
      resourceAccess = @(@{ id = $groupRwAllId; type = "Role" })
    })
  }
  Write-Host "  created provisioning app '$ProvisioningAppName' (appId $($provApp.appId))" -ForegroundColor Green
}
$provSp = Ensure-ServicePrincipal -AppId $provApp.appId

# Grant + admin-consent Group.ReadWrite.All to the provisioning SP (idempotent).
$graphSp = (Invoke-Graph GET "$graph/servicePrincipals?`$filter=appId eq '$graphAppId'").value[0]
$existingGrants = Invoke-Graph GET "$graph/servicePrincipals/$($provSp.id)/appRoleAssignments"
$hasGrant = $existingGrants.value | Where-Object { $_.appRoleId -eq $groupRwAllId -and $_.resourceId -eq $graphSp.id }
if (-not $hasGrant) {
  Invoke-Graph POST "$graph/servicePrincipals/$($provSp.id)/appRoleAssignments" @{
    principalId = $provSp.id; resourceId = $graphSp.id; appRoleId = $groupRwAllId
  } | Out-Null
  Write-Host "  granted + consented Group.ReadWrite.All to the provisioning app" -ForegroundColor Green
} else {
  Write-Host "  Group.ReadWrite.All already granted to the provisioning app"
}

# Create a fresh client secret (printed once; store it in Key Vault).
$secretResp = Invoke-Graph POST "$graph/applications/$($provApp.id)/addPassword" @{
  passwordCredential = @{ displayName = "agentloom-backend"; endDateTime = (Get-Date).AddYears(1).ToString("o") }
}
$provSecret = $secretResp.secretText
Write-Host "  created provisioning client secret (shown once below)" -ForegroundColor Green

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
    if ($existing) {
      $userId = $existing.id
      Write-Host "  test user '$upn' exists (org=$($u.org))"
    } else {
      $created = Invoke-Graph POST "$graph/users" $body
      $userId = $created.id
      Write-Host "  created test user '$upn' (org=$($u.org))" -ForegroundColor Green
    }

    # Per-customer security group cust-<org> (groups model). Idempotent: reuse by
    # mailNickname. The backend reuses the same group when the customer is seeded.
    $gname = "cust-$($u.org)"
    $grp = Invoke-Graph GET "$graph/groups?`$filter=mailNickname eq '$gname'"
    if ($grp -and $grp.value.Count -gt 0) {
      $groupId = $grp.value[0].id
    } else {
      $grp = Invoke-Graph POST "$graph/groups" @{
        displayName     = "$($u.display) ($($u.org))"
        mailEnabled     = $false
        mailNickname    = $gname
        securityEnabled = $true
        description     = "AgentLoom customer group for org=$($u.org)"
      }
      $groupId = $grp.id
      Write-Host "  created group '$gname' ($groupId)" -ForegroundColor Green
    }
    # Add the user to the group (ignore 'already a member').
    Invoke-Graph POST "$graph/groups/$groupId/members/`$ref" @{
      '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$userId"
    } | Out-Null
    Write-Host "  ensured '$upn' is a member of '$gname'"
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
azd env set PROVISIONING_CLIENT_ID $($provApp.appId)

# Frontends (MSAL):
azd env set VITE_ADMIN_CLIENT_ID    $($adminApp.appId)
azd env set VITE_ADMIN_AUTHORITY    https://login.microsoftonline.com/$wfTenantId
azd env set VITE_ADMIN_API_SCOPE    api://$($adminApp.appId)/access_as_user
azd env set VITE_CUSTOMER_CLIENT_ID $($custApp.appId)
azd env set VITE_CUSTOMER_AUTHORITY https://$ciamSubdomain.ciamlogin.com/$ciamTenantId
azd env set VITE_CUSTOMER_API_SCOPE api://$($custApp.appId)/access_as_user
"@ | Write-Host

Write-Host "`n--- CIAM provisioning secret (store in Key Vault AFTER azd up) ----------" -ForegroundColor Yellow
Write-Host "  Provisioning appId: $($provApp.appId)"
Write-Host "  Client secret     : $provSecret"
Write-Host "  Once the Key Vault exists (after 'azd up'), store it as the secret"
Write-Host "  name the backend expects (default 'ciam-provisioning-secret'):"
Write-Host ""
Write-Host "    az keyvault secret set --vault-name <kv-name> ``"
Write-Host "      --name ciam-provisioning-secret --value `"$provSecret`""
Write-Host "  (kv-name = azd env get-value KEYVAULT_URI → the host label, e.g. agentloomagentloom-prodk)"

Write-Host "`nNOTE: after `azd up`, add the deployed SPA URLs as SPA redirect URIs" -ForegroundColor Yellow
Write-Host "      on both app registrations (admin → ADMIN_URL, customer → CUSTOMER_URL)." -ForegroundColor Yellow
