# Downloads Nothing's Glyph Matrix SDK into the Android project.
# The SDK's licence does not allow redistributing it, so it is not kept in this repo.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$dest = "android/app/libs/glyph-matrix-sdk-2.0.aar"
$url = "https://github.com/Nothing-Developer-Programme/GlyphMatrix-Developer-Kit/raw/main/glyph-matrix-sdk-2.0.aar"
New-Item -ItemType Directory -Force -Path "android/app/libs" | Out-Null
if (Test-Path $dest) { Write-Host "Already there: $dest"; exit 0 }
Invoke-WebRequest -Uri $url -OutFile $dest
Write-Host "Saved $dest"
Write-Host "By using it you accept Nothing's licence: https://github.com/Nothing-Developer-Programme/GlyphMatrix-Developer-Kit/blob/main/LICENSE.md"
