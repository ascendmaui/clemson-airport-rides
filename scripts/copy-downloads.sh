#!/bin/bash
# Copy already-built APKs onto the VPS downloads volume.
# This host only receives files. Do not compile or package apps here.
set -euo pipefail
set +x

if [ -z "${VPS_SSH_KEY:-}" ]; then
  echo "VPS_SSH_KEY is not set. APKs stay on the GitHub release." >&2
  exit 0
fi

: "${VPS_HOST:?VPS_HOST is required when VPS_SSH_KEY is set}"
: "${VPS_USER:?VPS_USER is required when VPS_SSH_KEY is set}"
: "${VPS_KNOWN_HOSTS:?VPS_KNOWN_HOSTS is required when VPS_SSH_KEY is set}"
: "${APK_DIR:?APK_DIR is required}"

bash "$(dirname "$0")/../deploy/prepare-ssh.sh"

host="$(printf '%s' "$VPS_HOST" | tr -d '[:space:]')"
user="$(printf '%s' "$VPS_USER" | tr -d '[:space:]')"
ssh_opts=(
  -i "$HOME/.ssh/deploy_key"
  -o IdentitiesOnly=yes
  -o BatchMode=yes
  -o PreferredAuthentications=publickey
  -o ConnectTimeout=20
  -o UserKnownHostsFile="$HOME/.ssh/known_hosts"
  -o StrictHostKeyChecking=yes
)
dest="$user@$host"
remote_dir="/opt/clemson-rides/downloads"
tag="$(printf '%s' "${RELEASE_TAG:-}" | tr -cd 'A-Za-z0-9._-')"

ssh "${ssh_opts[@]}" "$dest" "mkdir -p $(printf '%q' "$remote_dir") && chmod 755 $(printf '%q' "$remote_dir")"

copy_one() {
  local app="$1"
  local src=""
  src="$(find "$APK_DIR" -type f -name "${app}.apk" -print -quit)"
  if [ -z "$src" ]; then
    echo "missing ${app}.apk under APK_DIR" >&2
    exit 1
  fi
  local names=("${app}.apk")
  if [ -n "$tag" ]; then
    names+=("${app}-${tag}.apk")
  fi
  for name in "${names[@]}"; do
    if ! printf '%s' "$name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$'; then
      echo "refusing unsafe download name" >&2
      exit 1
    fi
    scp "${ssh_opts[@]}" "$src" "$dest:${remote_dir}/${name}.partial"
    ssh "${ssh_opts[@]}" "$dest" "mv $(printf '%q' "${remote_dir}/${name}.partial") $(printf '%q' "${remote_dir}/${name}") && chmod 644 $(printf '%q' "${remote_dir}/${name}")"
    echo "copied ${name}"
  done
}

copy_one rider
copy_one driver
