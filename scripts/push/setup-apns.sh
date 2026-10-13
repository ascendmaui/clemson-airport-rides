#!/usr/bin/env bash
# Upload one APNs .p8 to the Rider and Driver Expo projects.
# Credentials only. This script never starts a native build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEAM_ID="L85AF3V872"
P8=""
KEY_ID=""

usage() {
  echo "Usage: scripts/push/setup-apns.sh --p8 /path/AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX [--team-id L85AF3V872]" >&2
  echo "Uploads the key with eas credentials. Does not start a native build." >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --p8)
      P8="${2:-}"
      shift 2
      ;;
    --key-id)
      KEY_ID="${2:-}"
      shift 2
      ;;
    --team-id)
      TEAM_ID="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$P8" || -z "$KEY_ID" ]]; then
  usage
  exit 2
fi
if [[ "$TEAM_ID" != "L85AF3V872" ]]; then
  echo "Team id must be L85AF3V872." >&2
  exit 2
fi
if [[ ! "$KEY_ID" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "Key id must be 10 letters or digits from the .p8 filename." >&2
  exit 2
fi
if [[ ! -f "$P8" ]]; then
  echo "P8 file not found: $P8" >&2
  exit 2
fi
if ! grep -q "BEGIN PRIVATE KEY" "$P8"; then
  echo "That file is not an APNs .p8 private key." >&2
  exit 2
fi

if command -v eas >/dev/null 2>&1; then
  EAS_BIN="eas"
else
  EAS_BIN="npx|--yes|eas-cli"
fi

echo "Checking the Expo login. This does not start a build."
# shellcheck disable=SC2086
if [[ "$EAS_BIN" == "eas" ]]; then
  eas whoami
else
  npx --yes eas-cli whoami
fi

upload_one() {
  local app_dir="$1"
  local project_id="$2"
  local bundle_id="$3"
  node --input-type=module -e '
    import { readFileSync } from "node:fs"
    const app = JSON.parse(readFileSync(process.argv[1], "utf8")).expo
    const projectId = app.extra?.eas?.projectId
    const bundleId = app.ios?.bundleIdentifier
    if (projectId !== process.argv[2] || bundleId !== process.argv[3]) {
      console.error(`Refusing to upload. ${process.argv[1]} is ${projectId} ${bundleId}`)
      process.exit(2)
    }
    if ((app.plugins || []).some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-notifications") !== true) {
      console.error("expo-notifications is not configured")
      process.exit(2)
    }
  ' "$app_dir/app.json" "$project_id" "$bundle_id"
  echo "Uploading APNs key ${KEY_ID} for ${bundle_id} (${project_id})"
  python3 "$ROOT/scripts/push/apns_prompts.py" \
    --app-dir "$app_dir" \
    --p8 "$P8" \
    --key-id "$KEY_ID" \
    --team-id "$TEAM_ID" \
    --eas "$EAS_BIN"
}

upload_one "$ROOT/apps/rider" "d02319c9-69ef-4523-a0a5-6712c037d5fa" "com.ascendmaui.clemsonrides.rider"
upload_one "$ROOT/apps/driver" "090d10b8-2f52-4502-ac9d-e8bd0fe35033" "com.ascendmaui.clemsonrides.driver"
echo "APNs key assigned to both Expo projects. No build was started."
