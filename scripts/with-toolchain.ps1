param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Command,

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$CommandArgs
)

$ErrorActionPreference = "Stop"

$nativeRustBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path -LiteralPath $nativeRustBin) {
  $env:PATH = "$nativeRustBin;$env:PATH"
}

$resolved = Get-Command $Command -ErrorAction Stop
& $resolved.Source @CommandArgs
exit $LASTEXITCODE
