$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$wrapper = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'RunSteamDailySync.cmd'))
$rootPrefix = $projectRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if (-not $wrapper.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Scheduled-task wrapper must be inside the project root: $projectRoot"
}

if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) {
  throw "Scheduled-task wrapper was not found: $wrapper"
}

schtasks /Create /TN 'Steam图片每日同步' /TR ('"' + $wrapper + '"') /SC DAILY /ST 11:30 /F
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
