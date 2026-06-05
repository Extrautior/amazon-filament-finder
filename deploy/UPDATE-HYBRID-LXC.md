# Update Existing Proxmox LXC to Hybrid Decodo Search

Use this on the LXC that already runs Amazon Filament Finder.

## 1. Copy or pull the updated code

If the LXC uses Git:

```bash
cd /opt/amazon-filament-finder
git pull
```

If the LXC does not use Git, copy this project folder from your PC over `/opt/amazon-filament-finder`, then run:

```bash
chown -R amazon-filament-finder:amazon-filament-finder /opt/amazon-filament-finder
```

## 2. Install dependencies

```bash
cd /opt/amazon-filament-finder
sudo -u amazon-filament-finder npm install
```

## 3. Update `/etc/amazon-filament-finder.env`

Edit the env file:

```bash
nano /etc/amazon-filament-finder.env
```

Use these hybrid settings:

```bash
PORT=3017
RESULT_LIMIT=0
SEARCH_TIMEOUT_MS=30000
SEARCH_PROVIDER=hybrid
DECODO_AUTH_TOKEN=YOUR_DECODO_BASIC_TOKEN_OR_USERNAME_PASSWORD
DECODO_GEO=Israel
DECODO_MAX_REQUESTS_PER_RUN=10
BROWSER_VERIFY_LIMIT_SCHEDULED=5
BROWSER_VERIFY_LIMIT_MANUAL=25
ENABLE_LEGACY_BROWSER_SEARCH=false
AUTO_REFRESH_ENABLED=true
AUTO_REFRESH_TIMEZONE=Asia/Jerusalem
AUTO_REFRESH_HOURS=8,20
APP_PASSWORD=change-this-to-a-shared-password
DATA_DIR=/var/lib/amazon-filament-finder
AMAZON_SESSION_DIR=/var/lib/amazon-filament-finder/amazon-session
HEADLESS=true
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
BROWSER_ARGS=--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage
```

Notes:

- `RESULT_LIMIT=0` means show/export every result found.
- `DECODO_MAX_REQUESTS_PER_RUN=10` means one scan can fetch up to 10 filtered Amazon pages across all search seeds/materials.
- For 2 automatic runs per day, 10 requests/run can use up to about 600 Decodo requests/month.
- For a first smoke test, use `3`. For deeper scans, raise this only after you are comfortable with Decodo billing/usage. A value of `100` can use up to about 6,000 Decodo requests/month.
- `DECODO_AUTH_TOKEN` can be either Decodo's Basic token value or `username:password`; the app accepts both.

Protect the env file:

```bash
chmod 600 /etc/amazon-filament-finder.env
```

## 4. Restart the service

```bash
systemctl daemon-reload
systemctl restart amazon-filament-finder
systemctl status amazon-filament-finder --no-pager
```

## 5. Check health and logs

```bash
curl http://127.0.0.1:3017/health
journalctl -u amazon-filament-finder -n 100 --no-pager
tail -n 100 /var/lib/amazon-filament-finder/logs/app-$(date +%F).log
```

Health should show `sessionStatus` as `ready` when `DECODO_AUTH_TOKEN` is configured.

## 6. Run a tiny live smoke test first

Temporarily set:

```bash
DECODO_MAX_REQUESTS_PER_RUN=3
BROWSER_VERIFY_LIMIT_SCHEDULED=0
```

Restart the service, run one manual PLA search in the UI, and confirm results/export work.

Then restore your real values and restart:

```bash
systemctl restart amazon-filament-finder
```

## 7. Optional browser verification

Hybrid search works without an Amazon browser session, but product-page verification uses the old Playwright session if available. If verification warnings say the browser session is missing or expired, either ignore them or rerun:

```bash
cd /opt/amazon-filament-finder
sudo -u amazon-filament-finder env $(cat /etc/amazon-filament-finder.env | xargs) bash -lc 'HEADLESS=false npm run session:setup'
```

Set delivery location to Israel in the browser, then stop the setup script.
