#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
  Save dev ingress settings and disable access to its frontends and backend.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $SubscriptionId = "35d1af6c-ac5f-48f0-a272-d71e37a5fd65",
    [string] $StatePath = (Join-Path (Split-Path -Parent $PSScriptRoot) ".azure\dev-access-state.json"),
    [ValidateRange(1, 600)]
    [int] $VerificationTimeoutSeconds = 180
)
& (Join-Path $PSScriptRoot "dev_access.ps1") -Action Off @PSBoundParameters
