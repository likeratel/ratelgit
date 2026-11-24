#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
swift build --product ratelgit
bin_dir="$(swift build --show-bin-path)"
# The capital letters give Spotlight a word boundary, so typing "git" finds the app.
bundle=".build/RatelGit.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$bin_dir/ratelgit" "$bundle/Contents/MacOS/ratelgit"
cp Resources/AppIcon.icns "$bundle/Contents/Resources/AppIcon.icns"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>ratelgit</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>dev.ratelgit.app</string>
  <key>CFBundleName</key><string>RatelGit</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.2.0</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

if test "${1:-}" != "--build-only"; then
    open "$bundle"
fi
