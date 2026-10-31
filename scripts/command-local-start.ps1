$ErrorActionPreference = 'Stop'

# One-click launch for the Founder's standalone daily-driver profile
# (command-local/v1, CV-C1c). This native wrapper checks the environment before
# the pinned Node runtime starts, so NODE_OPTIONS/NODE_PATH cannot preload code
# into the lifecycle owner. It does not start, stop or require Hermes, Herdr,
# the Room broker or WSL.
$blockedNames = @(
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE', 'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_PRESERVE_SYMLINKS',
  'NODE_PRESERVE_SYMLINKS_MAIN', 'HOST', 'PORT', 'COMMAND_HOST',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'
)
$unsafeNames = @(Get-ChildItem Env: | Where-Object {
  $name = $_.Name.ToUpperInvariant()
  ($blockedNames -contains $name) -or $name.StartsWith('VITE_')
} | Select-Object -ExpandProperty Name)
if ($unsafeNames.Count -gt 0) {
  [Console]::Error.WriteLine("local startup environment is contaminated: {0}", ($unsafeNames -join ', '))
  exit 1
}

try {
  $configPath = Join-Path $PSScriptRoot '..\lifecycle.command-local.config.json'
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if ($config.profile.name -ne 'command-local/v1' -or $config.host -ne '127.0.0.1') {
    throw 'command-local lifecycle configuration identity or host pin is invalid'
  }
  $node = [string]$config.node
  if (-not [System.IO.Path]::IsPathRooted($node) -or -not (Test-Path -LiteralPath $node -PathType Leaf)) {
    throw 'configured Node runtime is missing or is not an absolute file path'
  }
  $cli = Join-Path $PSScriptRoot 'command-lifecycle.mjs'
  if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'lifecycle owner entrypoint is missing' }

  $uiPort = 5173
  foreach ($c in $config.components) { if ($c.name -eq 'ui') { $uiPort = [int]$c.port } }
  $uiUrl = "http://127.0.0.1:$uiPort/"

  # Already running locally? Just open it.
  & $node $cli 'local-status' '--json' | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "STARQ // COMMAND is already running; opening $uiUrl"
    Start-Process $uiUrl | Out-Null
    exit 0
  }

  # Backup-on-start: snapshot the operating database before PM comes up (a clean
  # no-op on a fresh install). A backup problem warns but never fakes a healthy
  # start - PM's own health contract still gates readiness below.
  $backup = Join-Path $PSScriptRoot 'lifecycle\backup.mjs'
  & $node $backup 'backup' '--if-exists'
  if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine('WARNING: backup-on-start did not complete; continuing (PM health still gates readiness).')
  }

  & $node $cli 'local-start'
  $code = $LASTEXITCODE
  if ($code -eq 0) {
    Write-Host "STARQ // COMMAND is ready; opening $uiUrl"
    Start-Process $uiUrl | Out-Null
  } else {
    [Console]::Error.WriteLine("STARQ // COMMAND local-start did not reach READY (exit {0}); see the lifecycle output above.", $code)
  }
  exit $code
} catch {
  [Console]::Error.WriteLine("local startup refused: {0}", $_.Exception.Message)
  exit 1
}
