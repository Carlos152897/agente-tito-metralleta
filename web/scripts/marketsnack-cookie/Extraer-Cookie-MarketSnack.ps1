# Extrae la cookie de sesion de MarketSnack directamente de tu navegador (Chrome / Edge /
# Brave, en ese orden de preferencia) y se la manda a Visionary Trades por HTTP -- sin
# pasar por DevTools. Pensado para correr con doble clic sobre
# "Actualizar Cookie MarketSnack.cmd" (que llama a este script).
#
# LIMITACION CONOCIDA Y A PROPOSITO: si tu navegador protege las cookies con "App-Bound
# Encryption" (Chrome/Brave/Edge 127+, valores con prefijo v20), este metodo NO PUEDE
# descifrarlas -- es una proteccion de Windows/Chrome deliberada para que nada fuera del
# propio navegador pueda leer las cookies. Si el script lo detecta, te lo dice con esas
# palabras y para ahi; en ese caso usa el metodo manual (pegar en /ajustes).
#
# Requiere que `npm run dev` (o el server de Visionary Trades) ya este corriendo en
# localhost:3000 -- si no, la cookie se extrae pero no hay a quien mandarsela.

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Security

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile = Join-Path $ScriptDir "extractor.log"
$NodeExe = "C:\Program Files\nodejs\node.exe"
$ApiUrl = "http://localhost:3000/api/marketsnack-cookie"

function Write-Log($msg) {
    $line = "$(Get-Date -Format o) $msg"
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    Write-Host $msg
}

Write-Log "=== Iniciando extraccion de cookie de MarketSnack ==="

if (-not (Test-Path $NodeExe)) {
    Write-Log "ERROR: no encuentro node.exe en $NodeExe. Si Node esta instalado en otro lugar, edita `$NodeExe al inicio de este script."
    Read-Host "Presiona Enter para cerrar"
    exit 1
}

$Browsers = @(
    @{ Name = "Chrome"; UserData = "$env:LOCALAPPDATA\Google\Chrome\User Data" },
    @{ Name = "Brave";  UserData = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data" },
    @{ Name = "Edge";   UserData = "$env:LOCALAPPDATA\Microsoft\Edge\User Data" }
)

# Master key del navegador: Local State -> os_crypt.encrypted_key -> quitar el prefijo
# "DPAPI" (5 bytes) -> ProtectedData.Unprotect (CurrentUser). Esto SOLO lo puede hacer
# PowerShell -- el .NET Framework 5.1 no trae AesGcm, asi que el descifrado real de cada
# cookie lo hace Node (extract-cookie.mjs) con esta clave ya en claro.
function Get-MasterKeyBase64($userDataPath, $browserName) {
    $localState = Join-Path $userDataPath "Local State"
    if (-not (Test-Path $localState)) { return $null }
    $json = Get-Content $localState -Raw | ConvertFrom-Json
    $encB64 = $json.os_crypt.encrypted_key
    if (-not $encB64) { return $null }
    $encBytes = [Convert]::FromBase64String($encB64)
    $prefix = [System.Text.Encoding]::ASCII.GetString($encBytes[0..4])
    if ($prefix -ne "DPAPI") {
        Write-Log "AVISO ($browserName): la clave maestra no empieza con 'DPAPI' (empieza con '$prefix'). Eso apunta a App-Bound Encryption -- no se puede continuar con este navegador."
        return $null
    }
    $blob = $encBytes[5..($encBytes.Length - 1)]
    try {
        $keyBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $blob, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    } catch {
        Write-Log "ERROR ($browserName): DPAPI Unprotect fallo -- $_"
        return $null
    }
    return [Convert]::ToBase64String($keyBytes)
}

# Copia un archivo que el navegador tiene abierto: FileStream con FileShare.ReadWrite +
# FileShare.Delete. Copy-Item normal falla aqui porque el navegador tiene el archivo
# abierto sin compartir lectura.
#
# OJO: esto solo funciona si el navegador, AL ABRIR el archivo, concedio FILE_SHARE_READ
# a otros procesos. El modo de compartir lo decide quien abre PRIMERO (el navegador) --
# nuestros flags no pueden forzar acceso si el a el no le dio la gana de compartir. Chrome
# y Edge recientes (verificado aqui con Chrome 150) mantienen la base de cookies con un
# lock que NO concede lectura compartida mientras el navegador esta corriendo, asi que
# esta funcion puede fallar con "being used by another process" de forma legitima y
# esperable -- se distingue de "no existe" devolviendo un objeto con el motivo en vez de
# lanzar, para que el caller pueda avisar con claridad en vez de fallar en seco.
function Copy-LockedFile($source, $destination) {
    if (-not (Test-Path $source)) { return @{ ok = $false; reason = "missing" } }
    try {
        $fsIn = [System.IO.FileStream]::new(
            $source, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
            ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
    } catch {
        return @{ ok = $false; reason = "locked"; detail = $_.Exception.Message }
    }
    try {
        $fsOut = [System.IO.FileStream]::new($destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
        try { $fsIn.CopyTo($fsOut) } finally { $fsOut.Dispose() }
    } finally { $fsIn.Dispose() }
    return @{ ok = $true }
}

$WorkDir = Join-Path $env:TEMP ("marketsnack-extract-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $WorkDir | Out-Null

$Manifest = @()
$AnyLocked = $false
foreach ($b in $Browsers) {
    if (-not (Test-Path $b.UserData)) { continue }
    Write-Log "Revisando $($b.Name)…"
    $keyB64 = Get-MasterKeyBase64 $b.UserData $b.Name
    if (-not $keyB64) { continue }

    $profileNames = @("Default")
    $extra = Get-ChildItem $b.UserData -Directory -Filter "Profile *" -ErrorAction SilentlyContinue
    if ($extra) { $profileNames += ($extra | Select-Object -ExpandProperty Name) }

    foreach ($prof in $profileNames) {
        $cookiesPath = Join-Path $b.UserData "$prof\Network\Cookies"
        if (-not (Test-Path $cookiesPath)) {
            $cookiesPath = Join-Path $b.UserData "$prof\Cookies" # Chrome viejo, sin subcarpeta Network
        }
        if (-not (Test-Path $cookiesPath)) { continue }

        $safeName = ($prof -replace '[^\w]', '_')
        $destDir = Join-Path $WorkDir "$($b.Name)_$safeName"
        New-Item -ItemType Directory -Path $destDir | Out-Null
        $destCookies = Join-Path $destDir "Cookies"
        $copyResult = Copy-LockedFile $cookiesPath $destCookies
        if (-not $copyResult.ok) {
            if ($copyResult.reason -eq "locked") {
                Write-Log "  BLOQUEADO: $($b.Name) / $prof tiene la base de cookies abierta sin conceder lectura compartida (esto es del navegador, no de este script -- ver nota mas abajo)."
                $AnyLocked = $true
            }
            continue
        }
        foreach ($ext in @("-wal", "-shm")) {
            Copy-LockedFile "$cookiesPath$ext" "$destCookies$ext" | Out-Null
        }
        Write-Log "  Copiada la base de cookies de $($b.Name) / $prof."
        $Manifest += @{ browser = $b.Name; profile = $prof; cookiesDb = $destCookies; masterKeyBase64 = $keyB64 }
    }
}

if ($Manifest.Count -eq 0) {
    if ($AnyLocked) {
        Write-Log ""
        Write-Log "No pude leer la base de cookies: el navegador la tiene abierta sin conceder lectura compartida a otros procesos (probado con FileShare.ReadWrite+Delete, que en teoria alcanza para esto -- aqui no alcanzo)."
        Write-Log "Esto es un candado que pone el propio navegador, no algo que se pueda forzar desde fuera sin cerrarlo o sin permisos de administrador (Volume Shadow Copy) -- ninguna de las dos cosas hace este script."
        Write-Log "Prueba cerrando TODAS las ventanas de Chrome/Edge (no solo la pestaña) y vuelve a correr este script -- si el candado se libera al cerrar, funcionara. Si no, usa el metodo manual en /ajustes."
    } else {
        Write-Log "No encontre ninguna base de cookies en Chrome/Brave/Edge (¿estan instalados en las rutas de siempre?). Usa el metodo manual en /ajustes."
    }
    Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    Read-Host "Presiona Enter para cerrar"
    exit 1
}

$ManifestPath = Join-Path $WorkDir "manifest.json"
# Contiene las claves maestras en claro (base64) -- vive solo en TEMP, dentro de una
# carpeta con GUID, y se borra abajo en el finally pase lo que pase con Node.
$Manifest | ConvertTo-Json -Depth 5 | Out-File -FilePath $ManifestPath -Encoding utf8

$nodeExit = 1
try {
    Write-Log "Descifrando cookies y probandolas contra MarketSnack…"
    & $NodeExe (Join-Path $ScriptDir "extract-cookie.mjs") $ManifestPath $ApiUrl $LogFile
    $nodeExit = $LASTEXITCODE
} finally {
    Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}

if ($nodeExit -eq 0) {
    Write-Log "=== Listo ==="
} else {
    Write-Log "=== Termino con problemas (codigo $nodeExit) -- revisa los mensajes de arriba o $LogFile ==="
}

Read-Host "Presiona Enter para cerrar"
exit $nodeExit
