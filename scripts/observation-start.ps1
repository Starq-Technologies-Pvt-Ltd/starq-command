$ErrorActionPreference = 'Stop'

# This native wrapper checks the environment before the pinned Node runtime is
# started, so NODE_OPTIONS/NODE_PATH cannot preload code into the lifecycle owner.
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
  [Console]::Error.WriteLine("observer environment is contaminated: {0}", ($unsafeNames -join ', '))
  exit 1
}

try {
  $configPath = Join-Path $PSScriptRoot '..\lifecycle.observation.config.json'
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if ($config.profile.name -ne 'command-observation-only/v1' -or $config.host -ne '127.0.0.1') {
    throw 'observation lifecycle configuration identity or host pin is invalid'
  }
  $node = [string]$config.node
  if (-not [System.IO.Path]::IsPathRooted($node) -or -not (Test-Path -LiteralPath $node -PathType Leaf)) {
    throw 'configured Node runtime is missing or is not an absolute file path'
  }
  $cli = Join-Path $PSScriptRoot 'command-lifecycle.mjs'
  if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'lifecycle owner entrypoint is missing' }
  & $node $cli 'observation-start' @args
  exit $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine("observation startup refused: {0}", $_.Exception.Message)
  exit 1
}
