#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
  Switch dev ingress on/off without deleting resources, or report its status.
.DESCRIPTION
  Only rg-agentloom-dev and its three named apps can be targeted. The snapshot
  contains ingress settings, not application secrets. Prod is never targeted.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidateSet("Off", "On", "Status")]
    [string] $Action,
    [ValidatePattern('^[0-9a-fA-F-]{36}$')]
    [string] $SubscriptionId = "35d1af6c-ac5f-48f0-a272-d71e37a5fd65",
    [string] $StatePath = (Join-Path (Split-Path -Parent $PSScriptRoot) ".azure\dev-access-state.json"),
    [ValidateRange(1, 600)]
    [int] $VerificationTimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$resourceGroup = "rg-agentloom-dev"
$environmentName = "agentloom-dev"
$appNames = @("admin-designer", "customer-webapp", "backend")
$apiVersion = "2026-07-01"
$StatePath = [IO.Path]::GetFullPath($StatePath)

function Invoke-DevAzure {
    param([string[]] $Arguments, [switch] $NoJsonOutput)
    $output = @(& az @Arguments --subscription $SubscriptionId --only-show-errors --output json 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI failed (exit $LASTEXITCODE): $($output -join [Environment]::NewLine)"
    }
    if ($NoJsonOutput) { return }
    $text = ($output -join [Environment]::NewLine).Trim()
    if ($text) { return ConvertFrom-Json -InputObject $text -AsHashtable }
}

function Get-AppId {
    param([string] $Name)
    return "/subscriptions/$SubscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.App/containerApps/$Name"
}

function Get-DevApp {
    param([string] $Name)
    $id = Get-AppId $Name
    $app = Invoke-DevAzure @("rest", "--method", "GET", "--url", "https://management.azure.com/$($id.TrimStart('/'))?api-version=$apiVersion")
    if (-not $app -or $app.id -ine $id -or -not $app.tags -or $app.tags["azd-env-name"] -ne $environmentName) {
        throw "Refusing to change '$Name': its resource ID or dev environment tag does not match."
    }
    return $app
}

function ConvertTo-CanonicalValue {
    param($Value)
    if ($Value -is [System.Collections.IDictionary]) {
        $result = [ordered]@{}
        foreach ($key in @($Value.Keys | Sort-Object)) {
            $result[$key] = ConvertTo-CanonicalValue $Value[$key]
        }
        return $result
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        return ,@($Value | ForEach-Object { ConvertTo-CanonicalValue $_ })
    }
    return $Value
}

function Get-IngressJson {
    param($Ingress)
    if ($null -eq $Ingress) { return "null" }
    $copy = ConvertFrom-Json ($Ingress | ConvertTo-Json -Depth 40) -AsHashtable
    $copy.Remove("fqdn")
    return ConvertTo-Json (ConvertTo-CanonicalValue $copy) -Depth 40 -Compress
}

function Write-Snapshot {
    param($Snapshot)
    $temporary = "$StatePath.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temporary, ($Snapshot | ConvertTo-Json -Depth 40), [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temporary, $StatePath, $true)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Read-Snapshot {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return $null }
    $snapshot = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json -AsHashtable
    if ($snapshot.schemaVersion -ne 1 -or $snapshot.subscriptionId -ine $SubscriptionId -or
        $snapshot.resourceGroup -ne $resourceGroup -or $snapshot.phase -notin @("Off", "On") -or
        @($snapshot.apps).Count -ne $appNames.Count) {
        throw "Snapshot '$StatePath' does not match the protected dev target or supported format."
    }
    $names = @($snapshot.apps | ForEach-Object { $_.name } | Sort-Object -Unique)
    if (@(Compare-Object ($appNames | Sort-Object) $names).Count) {
        throw "Snapshot '$StatePath' contains unexpected or duplicate apps."
    }
    foreach ($entry in $snapshot.apps) {
        if ($entry.id -ine (Get-AppId $entry.name) -or -not $entry.revision -or -not $entry.ingress) {
            throw "Snapshot '$StatePath' contains an invalid dev app or missing ingress."
        }
    }
    return $snapshot
}

function Wait-Ingress {
    param([string] $Name, $Expected)
    $deadline = [datetime]::UtcNow.AddSeconds($VerificationTimeoutSeconds)
    do {
        $app = Get-DevApp $Name
        if ((Get-IngressJson $app.properties.configuration.ingress) -eq (Get-IngressJson $Expected) -and
            $app.properties.provisioningState -eq "Succeeded") { return $app }
        if ([datetime]::UtcNow -ge $deadline) { throw "Timed out verifying ingress for '$Name'." }
        Start-Sleep -Seconds 2
    } while ($true)
}

function Wait-Endpoint {
    param([string] $Name, [string] $Fqdn)
    $path = if ($Name -eq "backend") { "/healthz" } else { "/" }
    $url = "https://$Fqdn$path"
    $deadline = [datetime]::UtcNow.AddSeconds($VerificationTimeoutSeconds)
    $lastResult = "no response"
    do {
        try {
            $response = Invoke-WebRequest -Uri $url -SkipHttpErrorCheck -TimeoutSec 10 -Headers @{"Cache-Control" = "no-cache"}
            $lastResult = "HTTP $($response.StatusCode)"
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400 -or $response.StatusCode -in @(401, 403)) {
                Write-Host "$Name ready: $url ($lastResult)"
                return
            }
        } catch [System.Net.Http.HttpRequestException] {
            $lastResult = $_.Exception.Message
            Write-Verbose "$url not ready: $lastResult"
        } catch [System.Threading.Tasks.TaskCanceledException] {
            $lastResult = $_.Exception.Message
            Write-Verbose "$url not ready: $lastResult"
        }
        if ([datetime]::UtcNow -ge $deadline) { throw "Timed out verifying '$url': $lastResult" }
        Start-Sleep -Seconds 2
    } while ($true)
}

function Show-DevStatus {
    foreach ($name in $appNames) {
        $app = Get-DevApp $name
        $ingress = $app.properties.configuration.ingress
        [pscustomobject]@{
            App = $name
            Ingress = if (-not $ingress) { "Disabled" } elseif ($ingress.external) { "External" } else { "Internal" }
            Url = if ($ingress) { "https://$($ingress.fqdn)" } else { $null }
            Revision = $app.properties.latestRevisionName
        }
    }
}

Get-Command az -ErrorAction Stop | Out-Null
$account = Invoke-DevAzure @("account", "show")
if (-not $account -or $account.id -ine $SubscriptionId) {
    throw "Sign in to an Azure identity that can access subscription '$SubscriptionId'."
}
if ($Action -eq "Status") { Show-DevStatus; return }
foreach ($name in $appNames) { Get-DevApp $name | Out-Null }
if (-not $PSCmdlet.ShouldProcess("$SubscriptionId/$resourceGroup", "DEV $Action ingress for all three apps")) { return }

$lock = $null
try {
    $directory = Split-Path -Parent $StatePath
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $lock = [IO.File]::Open("$StatePath.lock", [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $apps = @($appNames | ForEach-Object { Get-DevApp $_ })
    $snapshot = Read-Snapshot
    if ($Action -eq "Off") {
        if (-not $snapshot -or $snapshot.phase -eq "On") {
            foreach ($app in $apps) {
                if (-not $app.properties.configuration.ingress) {
                    throw "Cannot save the original ingress for '$($app.name)'. Restore it before the first DEV OFF."
                }
            }
            $snapshot = @{
                schemaVersion = 1
                subscriptionId = $SubscriptionId
                resourceGroup = $resourceGroup
                phase = "Off"
                capturedUtc = [datetime]::UtcNow.ToString("o")
                apps = @($apps | ForEach-Object {
                    @{name = $_.name; id = $_.id; revision = $_.properties.latestRevisionName; ingress = $_.properties.configuration.ingress}
                })
            }
            Write-Snapshot $snapshot
        }
        foreach ($app in $apps) {
            if ($app.properties.configuration.ingress) {
                Invoke-DevAzure -Arguments @("containerapp", "ingress", "disable", "--name", $app.name, "--resource-group", $resourceGroup) -NoJsonOutput
            }
            Wait-Ingress $app.name $null | Out-Null
            Write-Host "$($app.name): ingress disabled"
        }
    } else {
        if (-not $snapshot) { throw "No snapshot at '$StatePath'. Run DEV OFF first; original settings will not be guessed." }
        foreach ($entry in $snapshot.apps) {
            $app = $apps | Where-Object { $_.name -eq $entry.name } | Select-Object -First 1
            if ($app.properties.latestRevisionName -ne $entry.revision) {
                throw "App '$($entry.name)' was redeployed after the snapshot. Review its ingress before restoring it."
            }
        }
        foreach ($entry in $snapshot.apps) {
            $app = $apps | Where-Object { $_.name -eq $entry.name } | Select-Object -First 1
            if ((Get-IngressJson $app.properties.configuration.ingress) -ne (Get-IngressJson $entry.ingress)) {
                $bodyPath = "$StatePath.$([guid]::NewGuid().ToString('N')).request.json"
                try {
                    $ingress = Get-IngressJson $entry.ingress | ConvertFrom-Json -AsHashtable
                    $body = @{location = $app.location; properties = @{configuration = @{ingress = $ingress}}} | ConvertTo-Json -Depth 40
                    [IO.File]::WriteAllText($bodyPath, $body, [Text.UTF8Encoding]::new($false))
                    $url = "https://management.azure.com/$(($entry.id).TrimStart('/'))?api-version=$apiVersion"
                    Invoke-DevAzure -Arguments @("rest", "--method", "PATCH", "--url", $url, "--headers", "Content-Type=application/json", "--body", "@$bodyPath") -NoJsonOutput
                } finally {
                    if (Test-Path -LiteralPath $bodyPath) { Remove-Item -LiteralPath $bodyPath -Force }
                }
            }
            $restored = Wait-Ingress $entry.name $entry.ingress
            if ($restored.properties.configuration.ingress.external) {
                Wait-Endpoint $entry.name $restored.properties.configuration.ingress.fqdn
            }
        }
        $snapshot.phase = "On"
        Write-Snapshot $snapshot
        Write-Warning "DEV access is restored with its previous authentication settings; demo access may still be anonymous."
    }
} catch {
    throw [InvalidOperationException]::new(
        "DEV $Action did not complete. Some apps may already have changed. Check Status and retry using the same snapshot '$StatePath'. $($_.Exception.Message)",
        $_.Exception
    )
} finally {
    if ($lock) { $lock.Dispose() }
}
Show-DevStatus
