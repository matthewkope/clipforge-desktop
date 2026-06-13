#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Rebuilds the desktop app from the current source and reinstalls it into
# /Applications so the Dock app reflects your latest changes. Does NOT
# re-download the bundled tool binaries (uses whatever is already in
# resources/bin; the app prefers your Homebrew tools at runtime anyway).
#
# Usage:
#   npm run app:install          # rebuild + reinstall, then relaunch
#   npm run app:install -- noopen   # rebuild + reinstall, don't relaunch

APP_NAME="ClipForge"
SRC="release/mac-arm64/${APP_NAME}.app"
DEST="/Applications/${APP_NAME}.app"

echo "› Quitting ${APP_NAME} if it is running…"
osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true
pkill -f "/Applications/${APP_NAME}.app" 2>/dev/null || true
sleep 1

echo "› Building renderer + main…"
npm run build

echo "› Regenerating app icon…"
npm run build:app-icon

echo "› Packaging (no code-signing, no binary re-download)…"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir

echo "› Ad-hoc signing (required for Apple Silicon to launch)…"
codesign --force --deep --sign - "$SRC"

echo "› Installing to ${DEST}…"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
touch "$DEST"

echo "✓ ${DEST} updated."
if [ "${1:-}" != "noopen" ]; then
  open -a "$DEST"
  echo "✓ Relaunched ${APP_NAME}."
fi
