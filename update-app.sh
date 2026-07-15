#!/bin/bash
set -e

APP="/Applications/Raphie's Editor.app"
RESOURCES="$APP/Contents/Resources"

echo "Compiling..."
npm run build:electron

echo "Quitting app..."
osascript -e 'quit app "Raphie'\''s Editor"' 2>/dev/null || true
sleep 1

echo "Packing asar..."
# Create a staging dir with only the files the app needs (exclude dist, .git, etc.)
STAGE="/tmp/raphies-editor-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
for item in node_modules out src src-electron package.json electron-builder.yml electron.vite.config.ts tsconfig.json; do
  if [ -e "$item" ]; then
    cp -r "$item" "$STAGE/"
  fi
done
npx asar pack "$STAGE" /tmp/raphies-editor-app.asar \
  --unpack-dir "node_modules/@remotion" \
  --unpack-dir "node_modules/webpack" \
  --unpack-dir "node_modules/esbuild" \
  --unpack-dir "node_modules/@esbuild" \
  --unpack-dir "src/remotion"
rm -rf "$STAGE"

echo "Replacing app.asar..."
cp /tmp/raphies-editor-app.asar "$RESOURCES/app.asar"

echo "Syncing unpacked files..."
rsync -a --delete /tmp/raphies-editor-app.asar.unpacked/ "$RESOURCES/app.asar.unpacked/"

echo "Launching app..."
open "$APP"

echo "Done! Updated in $(date +%H:%M:%S)"
