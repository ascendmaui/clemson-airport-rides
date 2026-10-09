#!/bin/bash
# Turn GitHub secret material into a private key and known_hosts file.
# Prints the key type and public fingerprint only. Never prints the secret.
set -euo pipefail
set +x

if [ -z "${VPS_SSH_KEY:-}" ]; then
  echo "VPS_SSH_KEY is empty" >&2
  exit 1
fi
if [ -z "${VPS_KNOWN_HOSTS:-}" ]; then
  echo "VPS_KNOWN_HOSTS is empty" >&2
  exit 1
fi

umask 077
mkdir -p "$HOME/.ssh"
python3 - <<'PY'
import base64
import os
import pathlib
import re
import subprocess

raw = os.environ.get("VPS_SSH_KEY", "")
hosts = os.environ.get("VPS_KNOWN_HOSTS", "")
ssh_dir = pathlib.Path.home() / ".ssh"
ssh_dir.mkdir(mode=0o700, exist_ok=True)

def unescape(text):
    return text.replace("\\n", "\n").replace('\\"', '"')

def pem_ok(text):
    return "-----BEGIN " in text and "PRIVATE KEY-----" in text

text = raw.replace("\r\n", "\n").replace("\r", "\n").strip()
quoted = False
if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
    text = text[1:-1]
    quoted = True

variants = [("raw", text), ("escaped-newlines", unescape(text))]
if quoted:
    variants.insert(0, ("quoted", unescape(text)))
compact = re.sub(r"\s+", "", text)
try:
    decoded = base64.b64decode(compact, validate=True).decode("utf-8")
    variants.append(("base64", unescape(decoded)))
except Exception:
    pass

chosen = None
method = None
key_path = ssh_dir / "deploy_key"
for name, item in variants:
    item = item.strip()
    if not pem_ok(item) or "-----\n" not in item:
        continue
    if not item.endswith("\n"):
        item += "\n"
    key_path.write_text(item)
    key_path.chmod(0o600)
    check = subprocess.run(["ssh-keygen", "-y", "-f", str(key_path)], capture_output=True)
    if check.returncode == 0:
        chosen = item
        method = name
        break

if chosen is None:
    raise SystemExit("VPS_SSH_KEY is not a PEM private key OpenSSH can read. Paste the private key, with real line breaks or \\n between lines.")

host_text = hosts.replace("\r\n", "\n").replace("\r", "\n").strip()
if (host_text.startswith('"') and host_text.endswith('"')) or (host_text.startswith("'") and host_text.endswith("'")):
    host_text = host_text[1:-1]
host_text = host_text.replace("\\n", "\n").strip()
if not host_text.endswith("\n"):
    host_text += "\n"
host_path = ssh_dir / "known_hosts"
host_path.write_text(host_text)
host_path.chmod(0o600)
(ssh_dir / "key-method").write_text(method + "\n")
PY

if ! ssh-keygen -y -f "$HOME/.ssh/deploy_key" >/dev/null 2>&1; then
  echo "VPS_SSH_KEY parsed as PEM but OpenSSH could not read it." >&2
  exit 1
fi

method="$(tr -d '[:space:]' < "$HOME/.ssh/key-method")"
fingerprint="$(ssh-keygen -lf "$HOME/.ssh/deploy_key")"
echo "deploy key ready method=$method fingerprint=$fingerprint"
