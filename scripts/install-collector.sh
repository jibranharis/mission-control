#!/bin/bash
# Installs the Claude Code collector on a Mac and runs it every 10 minutes.
#   curl -fsSL https://raw.githubusercontent.com/jibranharis/mission-control/main/scripts/install-collector.sh | bash -s -- https://your-app.vercel.app YOUR_INGEST_TOKEN
set -euo pipefail
URL="${1:-}"; TOKEN="${2:-}"
if [ -z "$URL" ] || [ -z "$TOKEN" ]; then echo "usage: install-collector.sh <dashboard url> <ingest token>"; exit 1; fi
command -v python3 >/dev/null || { echo "python3 is needed (install Xcode Command Line Tools: xcode-select --install)"; exit 1; }
command -v git >/dev/null || { echo "git is needed (xcode-select --install)"; exit 1; }

DIR="$HOME/Library/Application Support/mission-control"
LABEL="com.mission-control.claude-collector"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
curl -fsSL "https://raw.githubusercontent.com/jibranharis/mission-control/main/scripts/claude-collector.py" -o "$DIR/claude-collector.py"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$(command -v python3)</string><string>$DIR/claude-collector.py</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>MC_URL</key><string>$URL</string>
    <key>MC_TOKEN</key><string>$TOKEN</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DIR/collector.log</string>
  <key>StandardErrorPath</key><string>$DIR/collector.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Running once now..."
MC_URL="$URL" MC_TOKEN="$TOKEN" python3 "$DIR/claude-collector.py"
echo "Installed. It runs every 10 minutes; log at $DIR/collector.log"
