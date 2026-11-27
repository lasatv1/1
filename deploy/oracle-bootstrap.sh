#!/usr/bin/env bash
# One-time setup for an Oracle Cloud "Always Free" Ampere (ARM) VM running Ubuntu 24.04.
# Run from the project directory on the server:
#
#   sudo ./deploy/oracle-bootstrap.sh atlas.duckdns.org
#
# Safe to re-run: existing secrets, .env files and data are kept.
set -euo pipefail

DOMAIN="${1:?usage: sudo $0 <your-domain, e.g. atlas.duckdns.org>}"
cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
RUN_USER="${SUDO_USER:-ubuntu}"

echo "==> Installing Docker"
apt-get update -y
apt-get install -y docker.io docker-compose-v2 openssl iptables-persistent
systemctl enable --now docker
usermod -aG docker "$RUN_USER" || true

echo "==> Swap (2 GB) as a safety margin for builds"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Opening ports 80/443 in the VM firewall (Oracle images reject them by default)"
allow() {  # allow <proto> <port>: insert just before Oracle's catch-all REJECT, else append
  iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null && return
  local pos
  pos="$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')"
  if [ -n "$pos" ]; then iptables -I INPUT "$pos" -p "$1" --dport "$2" -j ACCEPT
  else iptables -A INPUT -p "$1" --dport "$2" -j ACCEPT; fi
}
allow tcp 80
allow tcp 443
allow udp 443   # HTTP/3
netfilter-persistent save

echo "==> Secrets (generated here, never copied anywhere)"
umask 077
for f in backend/db/.db_password backend/db/.db_app_password; do
  [ -s "$f" ] || openssl rand -base64 32 | tr -d '/+=\n' > "$f"
done
[ -f backend/.env ] || cp backend/.env.example backend/.env

echo "==> Compose settings (.env in project root)"
cat > .env <<EOF
CTA_DOMAIN=${DOMAIN}
CTA_PUBLIC_ORIGIN=https://${DOMAIN}
# Official postgis/postgis images are amd64-only; this multi-arch build runs on ARM.
CTA_POSTGIS_IMAGE=imresamu/postgis:17-3.5
EOF
chown -R "$RUN_USER":"$RUN_USER" "$PROJECT_DIR"

echo "==> Building and starting (first build takes several minutes)"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo
echo "Done. In a minute or two: https://${DOMAIN}"
echo "Check:  docker compose ps   |   curl -s https://${DOMAIN}/api/health/ready"
echo "Remember to also allow TCP 80/443 in the OCI subnet Security List (see docs/DEPLOY-FREE.md)."
