#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/amazon-filament-finder}"
ENV_FILE="${ENV_FILE:-/etc/amazon-filament-finder.env}"
SERVICE_NAME="${SERVICE_NAME:-amazon-filament-finder}"
APP_USER="${APP_USER:-amazon-filament-finder}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root on the LXC:"
  echo "  sudo bash deploy/update-hybrid-lxc.sh"
  exit 1
fi

if [[ ! -d "${APP_DIR}" ]]; then
  echo "App directory not found: ${APP_DIR}"
  echo "Clone the repo first, or set APP_DIR=/path/to/app."
  exit 1
fi

echo "==> Updating code in ${APP_DIR}"
cd "${APP_DIR}"

if [[ -d .git ]]; then
  git pull --ff-only
else
  echo "No .git directory found. Skipping git pull."
  echo "Copy the updated files into ${APP_DIR}, then rerun this script."
fi

echo "==> Installing Node dependencies"
sudo -u "${APP_USER}" npm install

echo "==> Preparing ${ENV_FILE}"
touch "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

read -r -p "Decodo auth token or username:password: " DECODO_AUTH_TOKEN_INPUT
read -r -p "App password for the web UI [leave blank to keep existing]: " APP_PASSWORD_INPUT
read -r -p "Max Decodo requests per run [100]: " DECODO_MAX_REQUESTS_INPUT
DECODO_MAX_REQUESTS_INPUT="${DECODO_MAX_REQUESTS_INPUT:-100}"

set_env() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(printf '%s' "${value}" | sed 's/[&|\\]/\\&/g')"
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${ENV_FILE}"
  fi
}

set_env PORT "${PORT:-3017}"
set_env RESULT_LIMIT "0"
set_env SEARCH_TIMEOUT_MS "${SEARCH_TIMEOUT_MS:-30000}"
set_env SEARCH_PROVIDER "hybrid"
set_env DECODO_AUTH_TOKEN "${DECODO_AUTH_TOKEN_INPUT}"
set_env DECODO_GEO "Israel"
set_env DECODO_MAX_REQUESTS_PER_RUN "${DECODO_MAX_REQUESTS_INPUT}"
set_env BROWSER_VERIFY_LIMIT_SCHEDULED "5"
set_env BROWSER_VERIFY_LIMIT_MANUAL "25"
set_env ENABLE_LEGACY_BROWSER_SEARCH "false"
set_env AUTO_REFRESH_ENABLED "true"
set_env AUTO_REFRESH_TIMEZONE "Asia/Jerusalem"
set_env AUTO_REFRESH_HOURS "8,20"
set_env DATA_DIR "/var/lib/amazon-filament-finder"
set_env AMAZON_SESSION_DIR "/var/lib/amazon-filament-finder/amazon-session"
set_env HEADLESS "true"
set_env BROWSER_EXECUTABLE_PATH "/usr/bin/chromium"
set_env BROWSER_ARGS "--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"

if [[ -n "${APP_PASSWORD_INPUT}" ]]; then
  set_env APP_PASSWORD "${APP_PASSWORD_INPUT}"
elif ! grep -qE "^APP_PASSWORD=" "${ENV_FILE}"; then
  set_env APP_PASSWORD "change-me"
fi

mkdir -p /var/lib/amazon-filament-finder
chown -R "${APP_USER}:${APP_USER}" /var/lib/amazon-filament-finder "${APP_DIR}"

echo "==> Running tests"
sudo -u "${APP_USER}" npm test

echo "==> Restarting ${SERVICE_NAME}"
systemctl daemon-reload
systemctl restart "${SERVICE_NAME}"
systemctl status "${SERVICE_NAME}" --no-pager

echo "==> Health check"
curl -fsS http://127.0.0.1:3017/health
echo
echo "Done. Open your app and run a small PLA search first."
