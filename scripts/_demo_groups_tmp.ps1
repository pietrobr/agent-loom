$ErrorActionPreference = "Stop"
$graph = "https://graph.microsoft.com/v1.0"

function Invoke-Graph {
  param([string]$Method, [string]$Url, $Body)
  $a = @("rest", "--method", $Method, "--url", $Url, "--headers", "Content-Type=application/json")
  if ($PSBoundParameters.ContainsKey('Body') -and $null -ne $Body) {
    $json = ($Body | ConvertTo-Json -Depth 12 -Compress)
    $tmp = New-TemporaryFile; Set-Content -Path $tmp -Value $json -Encoding utf8
    $a += @("--body", "@$tmp")
  }
  $out = az @a 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  if ([string]::IsNullOrWhiteSpace($out)) { return $null }
  return ($out | ConvertFrom-Json)
}

$demo = @(
  @{ org = "horizon-travel"; upn = "demo-horizon@agentloomcustomers.onmicrosoft.com"; display = "Demo Horizon Travel" },
  @{ org = "novatech";       upn = "demo-novatech@agentloomcustomers.onmicrosoft.com"; display = "Demo NovaTech" }
)

foreach ($d in $demo) {
  $gname = "cust-$($d.org)"
  $grp = Invoke-Graph GET "$graph/groups?`$filter=mailNickname eq '$gname'"
  if ($grp -and $grp.value.Count -gt 0) {
    $gid = $grp.value[0].id
    Write-Host "group '$gname' exists ($gid)"
  } else {
    $g = Invoke-Graph POST "$graph/groups" @{
      displayName     = "$($d.display) ($($d.org))"
      mailEnabled     = $false
      mailNickname    = $gname
      securityEnabled = $true
      description     = "AgentLoom customer group for org_id=$($d.org)"
    }
    $gid = $g.id
    Write-Host "created group '$gname' ($gid)"
  }

  $u = Invoke-Graph GET "$graph/users/$($d.upn)"
  if (-not $u) { Write-Host "  !! user $($d.upn) not found"; continue }
  Invoke-Graph POST "$graph/groups/$gid/members/`$ref" @{
    '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($u.id)"
  } | Out-Null
  Write-Host "  ensured $($d.upn) is member of $gname"
  Write-Host "GROUPID|$($d.org)|$gid"
}
