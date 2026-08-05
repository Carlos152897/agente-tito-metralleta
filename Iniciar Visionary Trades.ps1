$ErrorActionPreference = "SilentlyContinue"

$repoDir = "C:\Users\carlo\OneDrive\Desktop\visionary-trades\web"
$npm     = "C:\Program Files\nodejs\npm.cmd"
$chrome  = "C:\Users\carlo\AppData\Local\Google\Chrome\Application\chrome.exe"
$port    = 3000
$url     = "http://localhost:$port"
# Generous timeout: right after boot, OneDrive may still be rehydrating
# node_modules files and antivirus may be scanning npm/node for the first time.
$timeoutSeconds = 90
$errLog  = Join-Path $repoDir "dev_error.log"

$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Start-Process -FilePath $npm -ArgumentList "run", "dev" -WorkingDirectory $repoDir -WindowStyle Hidden -RedirectStandardError $errLog

    $elapsed = 0
    $ready = $false
    while ($elapsed -lt $timeoutSeconds) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 1
        $elapsed++
    }

    if (-not $ready) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            "Visionary Trades no arranco a tiempo (espere $timeoutSeconds segundos). Puede que OneDrive siga sincronizando archivos tras encender la PC, o que el servidor haya fallado. Revisa el log: $errLog",
            "Visionary Trades"
        ) | Out-Null
    }
}

if (Test-Path $chrome) {
    Start-Process -FilePath $chrome -ArgumentList $url
} else {
    Start-Process $url
}
