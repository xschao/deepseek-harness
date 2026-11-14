# @deepseek-ai/dsh-ima-kb one-shot installer (Windows PowerShell)
#
# What it does:
#   1. Resolve and validate the repo / plugin directory.
#   2. Run: dsh plugin --profile <Profile> add <repo>/plugins/ima-kb
#      (installs the plugin into the profile and wires bundle/client metadata).
#   3. If the repo's my_config is used as the profile, normalize the dependency
#      back to the relative spec file:../../plugins/ima-kb (dsh plugin add
#      rewrites it to an absolute path).
#   4. Print the next steps (restart, fill credentials, refresh).
#
# Usage:
#   .\scripts\install.ps1                  # repo = script\..\.., profile = web
#   .\scripts\install.ps1 -Profile web
#   .\scripts\install.ps1 -Repo "D:\code\deepseek-harness-master"
#   .\scripts\install.ps1 -SkipAdd        # only validate / normalize paths
param(
  [string]$Repo = "",
  [string]$Profile = "web",
  [switch]$SkipAdd
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Repo)) {
  $Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}
$pluginDir = Join-Path $Repo "plugins\ima-kb"
if (-not (Test-Path $pluginDir)) {
  throw "Plugin directory not found: $pluginDir (use -Repo to point at the repo root)"
}

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$profileDir = Join-Path (Join-Path $dshHome "profiles") $Profile
Write-Host "repo:    $Repo"
Write-Host "plugin:  $pluginDir"
Write-Host "profile: $profileDir"

if (-not $SkipAdd) {
  if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
    throw "dsh command not found. Add the DSH CLI to PATH, or run manually: dsh plugin --profile $Profile add `"$pluginDir`""
  }
  Write-Host "running: dsh plugin --profile $Profile add `"$pluginDir`""
  & dsh plugin --profile $Profile add $pluginDir
  if ($LASTEXITCODE -ne 0) {
    throw "dsh plugin add failed (exit $LASTEXITCODE)"
  }
}

# dsh plugin add writes an absolute file: spec; restore the relative one when
# the repo's my_config directory is used as a profile.
$pkgPath = Join-Path $Repo "my_config\web\package.json"
if (Test-Path $pkgPath) {
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  $current = $pkg.dependencies.'@deepseek-ai/dsh-ima-kb'
  if ($current -ne "file:../../plugins/ima-kb") {
    $pkg.dependencies.'@deepseek-ai/dsh-ima-kb' = "file:../../plugins/ima-kb"
    $json = ($pkg | ConvertTo-Json -Depth 8) + "`n"
    [System.IO.File]::WriteAllText($pkgPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "normalized my_config/web/package.json dependency to file:../../plugins/ima-kb"
  } else {
    Write-Host "my_config/web/package.json dependency is already relative"
  }
}

Write-Host ""
Write-Host "Done. Next steps:"
Write-Host "  1) Restart dsh: dsh-restart (or run dsh web again)"
Write-Host "  2) Open the GUI -> Settings -> IMA, fill your X-Ima-Cookie / X-Ima-Bkn / knowledge base IDs"
Write-Host "  3) Press Ctrl+F5; the sidebar shows the IMA entries (knowledge base + IMA web)"
