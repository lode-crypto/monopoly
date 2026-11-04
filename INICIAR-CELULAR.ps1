$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$connection = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
if (-not $connection) { throw 'Conecta la computadora a la red Wi-Fi antes de iniciar.' }
$address = $connection.IPv4Address.IPAddress | Select-Object -First 1
$env:HOST = '0.0.0.0'
$env:PORT = '3000'
$env:APP_ORIGIN = "http://${address}:3000"
Write-Host "Abre esta direccion en la computadora y en los celulares: $env:APP_ORIGIN"
Write-Host 'Todos deben estar en la misma red Wi-Fi. Mantén esta ventana abierta.'
& node.exe --env-file=.env server/index.js
