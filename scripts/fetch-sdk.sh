#!/usr/bin/env sh
# Downloads Nothing's Glyph Matrix SDK into the Android project.
# The SDK's licence does not allow redistributing it, so it is not kept in this repo.
set -eu
cd "$(dirname "$0")/.."
DEST="android/app/libs/glyph-matrix-sdk-2.0.aar"
URL="https://github.com/Nothing-Developer-Programme/GlyphMatrix-Developer-Kit/raw/main/glyph-matrix-sdk-2.0.aar"
mkdir -p android/app/libs
if [ -f "$DEST" ]; then echo "Already there: $DEST"; exit 0; fi
curl -fL --retry 3 -o "$DEST" "$URL"
echo "Saved $DEST"
echo "By using it you accept Nothing's licence: https://github.com/Nothing-Developer-Programme/GlyphMatrix-Developer-Kit/blob/main/LICENSE.md"
