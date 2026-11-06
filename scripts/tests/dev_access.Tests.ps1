#Requires -Version 7.0
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$scripts = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "agentloom-dev-access-tests-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$subscription = "35d1af6c-ac5f-48f0-a272-d71e37a5fd65"
$global:DevTestCalls = [Collections.Generic.List[object]]::new()
$global:DevTestApps = @{}
$global:DevTestFailApp = $null
$global:DevTestHttpStatus = 200
$passed = 0

function Copy-Value($Value) {
    return $Value | ConvertTo-Json -Depth 40 | ConvertFrom-Json -AsHashtable
}

function Reset-Fixture {
    $global:DevTestCalls.Clear()
    $global:DevTestFailApp = $null
    $global:DevTestHttpStatus = 200
    $global:DevTestApps = @{}
    foreach ($name in @("admin-designer", "customer-webapp", "backend")) {
        $global:DevTestApps[$name] = @{
            name = $name
            location = "swedencentral"
            id = "/subscriptions/$subscription/resourceGroups/rg-agentloom-dev/providers/Microsoft.App/containerApps/$name"
            tags = @{"azd-env-name" = "agentloom-dev"}
            properties = @{
                latestRevisionName = "$name--revision1"
                provisioningState = "Succeeded"
                configuration = @{
                    ingress = @{
                        external = $true
                        targetPort = if ($name -eq "backend") { 8000 } else { 80 }
                        transport = "Auto"
                        fqdn = "$name.dev.example"
                        allowInsecure = $false
                        ipSecurityRestrictions = @(@{name = "office"; ipAddressRange = "192.0.2.1/32"; action = "Allow"})
                        traffic = @(@{latestRevision = $true; weight = 100})
                        stickySessions = @{affinity = "sticky"}
                        customDomains = $null
                    }
                    registries = @(@{server = "dev.example"; identity = "dev-identity"})
                }
                template = @{containers = @(@{image = "unchanged-image"; env = @(@{name = "AUTH_MODE"; value = "dev"})})}
            }
        }
    }
}

function Get-Argument([object[]] $Arguments, [string] $Name) {
    $index = [array]::IndexOf($Arguments, $Name)
    if ($index -lt 0) { throw "Missing mock argument: $Name" }
    return $Arguments[$index + 1]
}

function global:az {
    $arguments = @($args)
    $global:LASTEXITCODE = 0
    $global:DevTestCalls.Add($arguments)
    if ((Get-Argument $arguments "--subscription") -ne $subscription) {
        throw "Unexpected subscription in mock Azure call."
    }
    if ($arguments[0] -eq "account") { return (@{id = $subscription} | ConvertTo-Json -Compress) }
    if ($arguments[0] -eq "containerapp") {
        $name = Get-Argument $arguments "--name"
        if ((Get-Argument $arguments "--resource-group") -ne "rg-agentloom-dev") { throw "Prod target reached!" }
        if ($name -eq $global:DevTestFailApp) {
            $global:LASTEXITCODE = 1
            return "Simulated Azure failure"
        }
        $global:DevTestApps[$name].properties.configuration.ingress = $null
        return "/ Running ..`nIngress disabled."
    }
    if ($arguments[0] -eq "rest") {
        $url = Get-Argument $arguments "--url"
        if ($url -notmatch '/resourceGroups/rg-agentloom-dev/providers/Microsoft.App/containerApps/([^?]+)\?') {
            throw "Unexpected resource URL: $url"
        }
        $name = $Matches[1]
        if ((Get-Argument $arguments "--method") -eq "PATCH") {
            $bodyPath = (Get-Argument $arguments "--body").Substring(1)
            $body = Get-Content -LiteralPath $bodyPath -Raw | ConvertFrom-Json -AsHashtable
            if ($body.location -ne $global:DevTestApps[$name].location) { throw "Resource location was not preserved." }
            if ($body.properties.configuration.Count -ne 1 -or -not $body.properties.configuration.Contains("ingress")) {
                throw "Update changed more than ingress."
            }
            $ingress = $body.properties.configuration.ingress
            if ($ingress.Contains("fqdn")) { throw "Read-only FQDN submitted to ARM." }
            $ingress["fqdn"] = "$name.dev.example"
            $global:DevTestApps[$name].properties.configuration.ingress = $ingress
            return "/ Running ..`nUpdate completed."
        }
        return ($global:DevTestApps[$name] | ConvertTo-Json -Depth 40 -Compress)
    }
    throw "Unexpected Azure command."
}

function global:Invoke-WebRequest {
    [CmdletBinding()]
    param([string] $Uri, [switch] $SkipHttpErrorCheck, [int] $TimeoutSec, [hashtable] $Headers)
    if ($Uri -notmatch '^https://(admin-designer|customer-webapp|backend)\.dev\.example(/healthz|/)$') {
        throw "Unexpected endpoint: $Uri"
    }
    return [pscustomobject]@{StatusCode = $global:DevTestHttpStatus}
}

function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}

function Assert-Throws([scriptblock] $Code, [string] $Pattern) {
    try { & $Code | Out-Null }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "Unexpected failure: $($_.Exception.Message)" }
        return
    }
    throw "Expected a failure matching '$Pattern'."
}

function Get-Mutations {
    return ,@($global:DevTestCalls | Where-Object {
        $_[0] -eq "containerapp" -or ($_[0] -eq "rest" -and (Get-Argument $_ "--method") -eq "PATCH")
    })
}

function Run-Test([string] $Name, [scriptblock] $Code) {
    Reset-Fixture
    $state = Join-Path $testRoot "$Name.json"
    & $Code $state
    $script:passed++
    Write-Host "PASS $Name"
}

try {
    Run-Test "whatif-no-writes" {
        param($state)
        & "$scripts\dev_off.ps1" -StatePath $state -WhatIf | Out-Null
        & "$scripts\dev_on.ps1" -StatePath $state -WhatIf | Out-Null
        Assert-True ((Get-Mutations).Count -eq 0) "WhatIf changed Azure."
        Assert-True (-not (Test-Path -LiteralPath $state)) "WhatIf created a snapshot."
        Assert-True (-not (Test-Path -LiteralPath "$state.lock")) "WhatIf created a lock."
    }
    Run-Test "off-on-full-restore" {
        param($state)
        $original = Copy-Value $global:DevTestApps
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        Assert-True ((Get-Mutations).Count -eq 3) "OFF did not disable all apps."
        foreach ($app in $global:DevTestApps.Values) {
            Assert-True ($null -eq $app.properties.configuration.ingress) "Ingress remains enabled."
        }
        $saved = Get-Content -LiteralPath $state -Raw
        Assert-True ($saved -notmatch 'unchanged-image|AUTH_MODE|registries') "Snapshot contains unrelated app configuration."
        & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false | Out-Null
        foreach ($name in $global:DevTestApps.Keys) {
            $app = $global:DevTestApps[$name]
            Assert-True ($app.properties.configuration.ingress.targetPort -eq $original[$name].properties.configuration.ingress.targetPort) "Port not restored."
            Assert-True ($app.properties.configuration.ingress.ipSecurityRestrictions[0].ipAddressRange -eq "192.0.2.1/32") "IP restrictions lost."
            Assert-True ($app.properties.configuration.ingress.stickySessions.affinity -eq "sticky") "Sticky sessions lost."
            Assert-True ($app.properties.template.containers[0].image -eq "unchanged-image") "Image changed."
            Assert-True ($app.properties.configuration.registries[0].identity -eq "dev-identity") "Registry identity changed."
        }
        Assert-True ((Get-Content -LiteralPath $state -Raw | ConvertFrom-Json).phase -eq "On") "ON completion not saved."
    }
    Run-Test "repeat-off-preserves-snapshot" {
        param($state)
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        $saved = Get-Content -LiteralPath $state -Raw
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        Assert-True ($saved -ceq (Get-Content -LiteralPath $state -Raw)) "Repeated OFF overwrote original settings."
        Assert-True ((Get-Mutations).Count -eq 3) "Repeated OFF changed already-disabled apps."
        & "$scripts\dev_on.ps1" -StatePath $state -WhatIf | Out-Null
        Assert-True ((Get-Mutations).Count -eq 3) "ON WhatIf changed Azure."
    }
    Run-Test "repeat-on-no-patch" {
        param($state)
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false | Out-Null
        $count = (Get-Mutations).Count
        & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false | Out-Null
        Assert-True ((Get-Mutations).Count -eq $count) "Repeated ON rewrote unchanged ingress."
    }
    Run-Test "missing-snapshot-refused" {
        param($state)
        Assert-Throws { & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false } "No snapshot"
        Assert-True ((Get-Mutations).Count -eq 0) "ON without a snapshot changed Azure."
    }
    Run-Test "prod-tag-refused" {
        param($state)
        $global:DevTestApps["backend"].tags["azd-env-name"] = "agentloom-prod5"
        Assert-Throws { & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false } "does not match"
        Assert-True ((Get-Mutations).Count -eq 0) "Prod-tagged app changed."
    }
    Run-Test "prod-resource-id-refused" {
        param($state)
        $global:DevTestApps["backend"].id = $global:DevTestApps["backend"].id.Replace("rg-agentloom-dev", "rg-agentloom-prod5")
        Assert-Throws { & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false } "does not match"
        Assert-True ((Get-Mutations).Count -eq 0) "Unexpected resource ID allowed an update."
    }
    Run-Test "missing-original-ingress-refused" {
        param($state)
        $global:DevTestApps["backend"].properties.configuration.ingress = $null
        Assert-Throws { & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false } "Cannot save the original"
        Assert-True ((Get-Mutations).Count -eq 0) "OFF proceeded without restorable settings."
    }
    Run-Test "snapshot-write-failure-stops-off" {
        param($state)
        New-Item -ItemType Directory -Path $state | Out-Null
        Assert-Throws { & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false } "did not complete"
        Assert-True ((Get-Mutations).Count -eq 0) "Azure changed before a successful snapshot write."
    }
    Run-Test "concurrent-run-refused" {
        param($state)
        $held = [IO.File]::Open("$state.lock", [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try {
            Assert-Throws { & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false } "did not complete"
            Assert-True ((Get-Mutations).Count -eq 0) "Lock conflict allowed Azure changes."
        } finally { $held.Dispose() }
    }
    Run-Test "tampered-snapshot-refused" {
        param($state)
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        $saved = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json -AsHashtable
        $saved.resourceGroup = "rg-agentloom-prod5"
        $saved | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $state
        $count = (Get-Mutations).Count
        Assert-Throws { & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false } "protected dev target"
        Assert-True ((Get-Mutations).Count -eq $count) "Tampered snapshot caused an update."
    }
    Run-Test "redeploy-refused-before-restore" {
        param($state)
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        $global:DevTestApps["backend"].properties.latestRevisionName = "new-revision"
        $count = (Get-Mutations).Count
        Assert-Throws { & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false } "redeployed"
        Assert-True ((Get-Mutations).Count -eq $count) "Redeployed app allowed a stale restore."
    }
    Run-Test "partial-off-retry" {
        param($state)
        $global:DevTestFailApp = "customer-webapp"
        Assert-Throws { & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false } "Simulated Azure failure"
        Assert-True (Test-Path -LiteralPath $state) "Partial failure lost the snapshot."
        Assert-True ($null -eq $global:DevTestApps["admin-designer"].properties.configuration.ingress) "First app not disabled."
        $saved = Get-Content -LiteralPath $state -Raw
        $global:DevTestFailApp = $null
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        Assert-True ($saved -ceq (Get-Content -LiteralPath $state -Raw)) "Retry overwrote snapshot."
        & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false | Out-Null
    }
    Run-Test "endpoint-failure-retains-snapshot" {
        param($state)
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        $global:DevTestHttpStatus = 500
        Assert-Throws { & "$scripts\dev_on.ps1" -StatePath $state -VerificationTimeoutSeconds 1 -Confirm:$false } "Timed out"
        Assert-True ((Get-Content -LiteralPath $state -Raw | ConvertFrom-Json).phase -eq "Off") "Failed verification reported success."
        $global:DevTestHttpStatus = 200
        & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false | Out-Null
    }
    Run-Test "status-read-only" {
        param($state)
        $result = @(& "$scripts\dev_access.ps1" -Action Status -StatePath $state)
        Assert-True ($result.Count -eq 3) "Status did not include all three apps."
        Assert-True ((Get-Mutations).Count -eq 0) "Status changed Azure."
    }
    Run-Test "next-cycle-captures-fresh-config" {
        param($state)
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false | Out-Null
        $global:DevTestApps["backend"].properties.configuration.ingress.ipSecurityRestrictions[0].ipAddressRange = "192.0.2.2/32"
        & "$scripts\dev_off.ps1" -StatePath $state -Confirm:$false | Out-Null
        & "$scripts\dev_on.ps1" -StatePath $state -Confirm:$false | Out-Null
        Assert-True ($global:DevTestApps["backend"].properties.configuration.ingress.ipSecurityRestrictions[0].ipAddressRange -eq "192.0.2.2/32") "Next cycle restored stale settings."
    }
    Write-Host "$passed dev access tests passed; all Azure and HTTP calls were mocked."
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
    Remove-Item Function:\az, Function:\Invoke-WebRequest
}
