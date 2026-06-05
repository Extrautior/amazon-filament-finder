# Update Existing Proxmox LXC to Free Browser Search

Use this on the LXC that already runs Amazon Filament Finder. The default mode uses the LXC's Chromium browser instead of a paid scraping API.

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

Use these browser settings:

```bash
PORT=3017
RESULT_LIMIT=0
SEARCH_TIMEOUT_MS=30000
SEARCH_PROVIDER=browser
DECODO_AUTH_TOKEN=
DECODO_GEO=Israel
DECODO_MAX_REQUESTS_PER_RUN=10
BROWSER_VERIFY_LIMIT_SCHEDULED=5
BROWSER_VERIFY_LIMIT_MANUAL=25
BROWSER_MAX_SEARCH_RESULT_PAGES=20
BROWSER_MAX_RAW_RESULT_ITEMS=1000
BROWSER_MAX_QUERIES_PER_MATERIAL=8
BROWSER_SINGLE_MATERIAL_MAX_QUERIES=0
BROWSER_RESULT_SELECTOR_TIMEOUT_MS=12000
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
- `SEARCH_PROVIDER=browser` means no paid API is used.
- `BROWSER_MAX_SEARCH_RESULT_PAGES=20` means one query can crawl up to 20 Amazon result pages.
- `BROWSER_MAX_RAW_RESULT_ITEMS=1000` prevents one bad search from growing forever.
- `BROWSER_MAX_QUERIES_PER_MATERIAL=8` keeps Search All balanced instead of crawling every brand seed for every material.
- `BROWSER_RESULT_SELECTOR_TIMEOUT_MS=12000` skips bad/blocked pages faster than the old 30-second wait.
- If Amazon starts blocking or the LXC is too slow, lower `BROWSER_MAX_SEARCH_RESULT_PAGES` to `5`.
- Optional Decodo mode still exists. If you use it later, set `SEARCH_PROVIDER=hybrid` and add `DECODO_AUTH_TOKEN`.

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

Health should show `sessionStatus` as `ready` when the Amazon browser session is configured.

## 6. Run a tiny live smoke test first

Temporarily set:

```bash
BROWSER_MAX_SEARCH_RESULT_PAGES=2
BROWSER_MAX_RAW_RESULT_ITEMS=100
```

Restart the service, run one manual PLA search in the UI, and confirm results/export work.

Then restore your real values and restart:

```bash
systemctl restart amazon-filament-finder
```

## 7. Browser session

Browser search needs the saved Amazon session. If warnings say the browser session is missing or expired, rerun:

```bash
cd /opt/amazon-filament-finder
sudo -u amazon-filament-finder env $(cat /etc/amazon-filament-finder.env | xargs) bash -lc 'HEADLESS=false npm run session:setup'
```

Set delivery location to Israel in the browser, then stop the setup script.
