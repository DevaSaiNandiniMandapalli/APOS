#!/usr/bin/env bash
# APOS processing API — Oracle Cloud Always Free (ARM Ampere A1) setup.
#
# Run on a fresh Ubuntu 22.04 / 24.04 aarch64 instance as a sudo-capable user:
#   curl -fsSL https://raw.githubusercontent.com/DevaSaiNandiniMandapalli/APOS/master/scripts/deploy-oracle.sh -o deploy.sh
#   sudo DOMAIN=api.nxtgensec.org bash deploy.sh
#
# The service is stateless: no database, no disk, no persistent storage.
set -euo pipefail

DOMAIN="${DOMAIN:-api.nxtgensec.org}"
APP_DIR="${APP_DIR:-/opt/apos}"
REPO="${REPO:-https://github.com/DevaSaiNandiniMandapalli/APOS.git}"
SERVICE_USER="${SERVICE_USER:-apos}"
STATE_DIR="/var/lib/apos"

echo "==> Installing system packages (this takes a few minutes on ARM)"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  python3 python3-venv python3-dev python3-pip build-essential git curl ca-certificates \
  libreoffice ghostscript tesseract-ocr tesseract-ocr-eng ocrmypdf \
  libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
  libffi8 shared-mime-info fonts-dejavu-core \
  caddy

echo "==> Creating the service user and its writable home"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$STATE_DIR"

echo "==> Fetching the repository"
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$APP_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "==> Installing the API into a virtual environment"
sudo -u "$SERVICE_USER" python3 -m venv "$APP_DIR/backend/.venv"
sudo -u "$SERVICE_USER" "$APP_DIR/backend/.venv/bin/python" -m pip install --upgrade pip
sudo -u "$SERVICE_USER" "$APP_DIR/backend/.venv/bin/python" -m pip install -e "$APP_DIR/backend[ocr]"

echo "==> Checking the native engines are visible"
sudo -u "$SERVICE_USER" env HOME="$STATE_DIR" "$APP_DIR/backend/.venv/bin/python" - <<'PY'
import shutil
for name in ("soffice", "gs", "tesseract"):
    print(f"  {name}: {shutil.which(name) or 'MISSING'}")
PY

echo "==> Writing the systemd unit"
tee /etc/systemd/system/apos-api.service >/dev/null <<UNIT
[Unit]
Description=APOS processing API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR/backend
# LibreOffice writes its profile into HOME, so HOME must be writable.
Environment=HOME=$STATE_DIR
Environment=CORS_ORIGINS=https://apos.nxtgensec.org
Environment=APOS_MAX_UPLOAD_MB=50
Environment=APOS_MAX_FILES=20
Environment=APOS_RATE_LIMIT_REQUESTS=120
Environment=APOS_RATE_LIMIT_WINDOW=60
ExecStart=$APP_DIR/backend/.venv/bin/uvicorn apos_api.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now apos-api

echo "==> Waiting for the API to answer"
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1; then
    echo "  API is up"
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:8000/api/v1/health || { echo "API did not start; check: journalctl -u apos-api -n 50"; exit 1; }

echo "==> Configuring Caddy for $DOMAIN"
tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8000 {
		request_body {
			max_size 60MB
		}
	}
}
CADDY
systemctl restart caddy

echo "==> Opening 80/443 (Oracle images ship with iptables rules that block them)"
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
netfilter-persistent save 2>/dev/null || true

echo
echo "=============================================================="
echo " Done. Two things left, both in the Oracle / DNS consoles:"
echo
echo " 1. Oracle VCN -> Security List -> add ingress rules:"
echo "      TCP 80  from 0.0.0.0/0"
echo "      TCP 443 from 0.0.0.0/0"
echo
echo " 2. DNS: add an A record"
echo "      $DOMAIN  ->  $(curl -fsS -4 ifconfig.me 2>/dev/null || echo '<this instance public IP>')"
echo
echo " Then verify:  curl https://$DOMAIN/api/v1/health"
echo "=============================================================="
