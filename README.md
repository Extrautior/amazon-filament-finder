# Amazon Filament Finder

Hosted web app that searches `Amazon.com` for `PLA`, `PETG`, `ABS`, `TPU`, and `ASA` filament listings that appear eligible to ship to Israel and sorts them by effective delivered cost per kilogram.

This version can run without a paid scraping API:

- The default local provider uses Playwright/Chromium to visit filtered Amazon search pages from the LXC.
- Browser searches use Amazon's free-shipping filter, price sort, all material/bundle query seeds, and configurable pagination limits.
- Results include normal 1kg spools and bundles of full 1kg spools, then sort by price per kg.
- Decodo remains available as an optional API-backed provider if you later decide paid scraping infrastructure is worth it.
- Images, color grouping, export, direct product links, history, auto-refresh, and Discord deal alerts remain in place.

The no-paid path depends on a persistent Amazon browser session. If Amazon expires that session, rerun the setup-session command and set the delivery location to Israel again.

## Hosted behavior

- `POST /api/search` runs a live scrape on demand
- `GET /api/export.csv` exports the latest successful scrape
- `GET /api/export.json` exports the latest successful scrape
- `GET /health` returns a basic liveness and session signal
- `GET /admin/session-status` shows whether the Amazon session looks reusable
- a shared app password is required before searches and exports
- identical overlapping searches reuse one in-flight scrape instead of launching multiple browser jobs
- logs are written to `DATA_DIR/logs/app-YYYY-MM-DD.log`

## Environment

Copy `.env.example` into your preferred service env file and set:

- `APP_PASSWORD`
- `DATA_DIR`
- `AMAZON_SESSION_DIR`
- `PORT`
- `RESULT_LIMIT` (`0` means keep every result found)
- `SEARCH_TIMEOUT_MS`
- `PRODUCT_PAGE_VERIFY_LIMIT`
- `SEARCH_PROVIDER` (`browser` for the no-paid local scraper, or `hybrid`/`decodo` for Decodo-backed scraping)
- `DECODO_AUTH_TOKEN`
- `DECODO_GEO`
- `DECODO_MAX_REQUESTS_PER_RUN`
- `BROWSER_VERIFY_LIMIT_SCHEDULED`
- `BROWSER_VERIFY_LIMIT_MANUAL`
- `BROWSER_MAX_SEARCH_RESULT_PAGES`
- `BROWSER_MAX_RAW_RESULT_ITEMS`
- `BROWSER_MAX_QUERIES_PER_MATERIAL`
- `BROWSER_SINGLE_MATERIAL_MAX_QUERIES`
- `BROWSER_RESULT_SELECTOR_TIMEOUT_MS`
- `BROWSER_SEARCH_CONCURRENCY`
- `ENABLE_LEGACY_BROWSER_SEARCH`
- `AUTO_REFRESH_ENABLED`
- `AUTO_REFRESH_TIMEZONE`
- `AUTO_REFRESH_HOURS`
- `DEAL_NOTIFICATIONS_ENABLED`
- `DISCORD_WEBHOOK_URL`
- `DEAL_NOTIFICATION_RETENTION_DAYS`
- `DEAL_NOTIFICATION_MAX_ITEMS`

Local browser provider:

- `BROWSER_MAX_SEARCH_RESULT_PAGES` default `20`
- `BROWSER_MAX_RAW_RESULT_ITEMS` default `1000`
- `BROWSER_MAX_QUERIES_PER_MATERIAL` default `8`
- `BROWSER_SINGLE_MATERIAL_MAX_QUERIES` default `0`, meaning no extra seed limit for single-material searches
- `BROWSER_RESULT_SELECTOR_TIMEOUT_MS` default `12000`
- `BROWSER_SEARCH_CONCURRENCY` default `4`

Optional browser setup:

- `HEADLESS=false` while doing first-time session setup
- `BROWSER_EXECUTABLE_PATH` if Chromium is not on `PATH`
- `BROWSER_ARGS=--no-sandbox --disable-setuid-sandbox` if your LXC needs those Chromium flags

Optional Decodo / hybrid provider:

- `DECODO_AUTH_TOKEN`
- `DECODO_GEO`
- `DECODO_MAX_REQUESTS_PER_RUN`
- `BROWSER_VERIFY_LIMIT_SCHEDULED`
- `BROWSER_VERIFY_LIMIT_MANUAL`

By default, the hosted server can automatically run the same search as `Search All` twice per day at `08:00` and `20:00` in `Asia/Jerusalem`. Change `AUTO_REFRESH_HOURS` or disable it with `AUTO_REFRESH_ENABLED=false` if you want a different schedule. `RESULT_LIMIT=0` keeps every normalized result found. In browser mode, `BROWSER_MAX_SEARCH_RESULT_PAGES` is the crawl depth budget. Raise it for deeper scans, or lower it if Amazon starts blocking or the LXC is too slow.

If you want Discord deal alerts, set `DEAL_NOTIFICATIONS_ENABLED=true` and provide `DISCORD_WEBHOOK_URL`. The server compares each successful run with the previous snapshot, keeps a persistent notified-history, and sends one summary message only for genuinely new cheapest or discounted deals that have not already been announced recently.

## Local run

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Set the required environment variables.

3. Start the server:

   ```powershell
   npm start
   ```

4. Open `http://localhost:3017`.

## Optional Amazon session setup

Browser searches use a shared Amazon browser session stored in `AMAZON_SESSION_DIR`.

1. Temporarily run the session setup flow with a visible browser:

   ```powershell
   $env:HEADLESS="false"
   npm run session:setup
   ```

2. In that browser:
   - log in to Amazon
   - set the delivery destination to Israel
   - confirm that the `Eligible for Free Shipping` flow looks correct

3. Close the browser or press `Ctrl+C`.

4. Verify the stored session:

   ```powershell
   npm run session:status
   ```

If Amazon expires the session later, browser searches will ask you to refresh the session.

If a setup browser window or a stale Chromium lock file temporarily keeps the shared browser profile busy, the app now retries safely and returns a short "session is busy" message instead of dumping the raw Chromium launch trace.

## Proxmox LXC deployment

Debian 13 is the recommended choice for this project because the app requires Node.js `>=20` and Debian 13 ships Node.js 20 in its standard repositories. Debian 12 ships Node.js 18, so Debian 12 would need an extra Node 20+ install step.

For a complete Proxmox walkthrough, see `deploy/PROXMOX-DEBIAN-13.md`.

These quick steps assume a Debian 13 LXC.

1. Install system packages:

   ```bash
   sudo apt update
   sudo apt install -y nodejs npm chromium
   ```

2. Install Caddy from the official Caddy Debian repository:

   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update
   sudo apt install caddy
   ```

3. Create a service user and data directory:

   ```bash
   sudo useradd --system --create-home --shell /usr/sbin/nologin amazon-filament-finder
   sudo mkdir -p /opt/amazon-filament-finder /var/lib/amazon-filament-finder
   sudo chown -R amazon-filament-finder:amazon-filament-finder /opt/amazon-filament-finder /var/lib/amazon-filament-finder
   ```

4. Copy the project into `/opt/amazon-filament-finder`, then install dependencies:

   ```bash
   cd /opt/amazon-filament-finder
   npm install
   ```

5. Create `/etc/amazon-filament-finder.env` from `.env.example`.

6. Copy `deploy/amazon-filament-finder.service` to `/etc/systemd/system/`.

7. Start the service:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now amazon-filament-finder
   ```

8. Update `deploy/Caddyfile` with your hostname, then load it into Caddy for HTTPS reverse proxying.

9. Run the one-time session setup using the same env file and data directory.

## Notes

- This app is intended for a small trusted group, not public-scale scraping.
- Only one live Amazon scrape runs at a time in v1.
- Amazon markup changes over time, so selectors may still need occasional updates.

## Tests

Run:

```powershell
npm test
```

## Updating a deployed server

Updating the hosted app should not require a reinstall.

1. Pull the latest code:

   ```bash
   cd /opt/amazon-filament-finder
   git pull
   ```

2. Reinstall dependencies only if needed:

   ```bash
   npm install
   ```

3. Restart the service:

   ```bash
   systemctl restart amazon-filament-finder
   ```
