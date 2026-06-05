# Amazon Filament Finder

Hosted web app that searches `Amazon.com` for `PLA`, `PETG`, `ABS`, `TPU`, and `ASA` filament listings that appear eligible to ship to Israel and sorts them by effective delivered cost per kilogram.

This version uses a hybrid scraping flow:

- Decodo fetches broad filtered Amazon search pages with the Amazon free-shipping filter and Israel geo.
- The existing Playwright/Chromium flow is kept only for optional product-page verification and legacy fallback.
- Results include normal 1kg spools and bundles of full 1kg spools, then sort by price per kg.
- Product-page verification can check listings that become free-shipping eligible only after the order subtotal crosses Amazon's threshold.
- Images, color grouping, export, direct product links, history, auto-refresh, and Discord deal alerts remain in place.

The big runtime change is that scheduled discovery no longer depends on a persistent Amazon browser session. Chromium is still useful for optional verification and emergency browser fallback.

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
- `SEARCH_PROVIDER` (`hybrid` by default, or `browser` for the legacy full-browser scraper)
- `DECODO_AUTH_TOKEN`
- `DECODO_GEO`
- `DECODO_MAX_REQUESTS_PER_RUN`
- `BROWSER_VERIFY_LIMIT_SCHEDULED`
- `BROWSER_VERIFY_LIMIT_MANUAL`
- `ENABLE_LEGACY_BROWSER_SEARCH`
- `AUTO_REFRESH_ENABLED`
- `AUTO_REFRESH_TIMEZONE`
- `AUTO_REFRESH_HOURS`
- `DEAL_NOTIFICATIONS_ENABLED`
- `DISCORD_WEBHOOK_URL`
- `DEAL_NOTIFICATION_RETENTION_DAYS`
- `DEAL_NOTIFICATION_MAX_ITEMS`

Optional browser verification/fallback:

- `HEADLESS=false` while doing first-time session setup
- `BROWSER_EXECUTABLE_PATH` if Chromium is not on `PATH`
- `BROWSER_ARGS=--no-sandbox --disable-setuid-sandbox` if your LXC needs those Chromium flags

By default, the hosted server can automatically run the same search as `Search All` twice per day at `08:00` and `20:00` in `Asia/Jerusalem`. Change `AUTO_REFRESH_HOURS` or disable it with `AUTO_REFRESH_ENABLED=false` if you want a different schedule. `RESULT_LIMIT=0` keeps every normalized result found. `DECODO_MAX_REQUESTS_PER_RUN` is the real crawl budget; keep it low, such as `3` to `10`, while testing a free Decodo plan. Raise it only when you are comfortable with Decodo usage/cost.

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

Hybrid searches use Decodo for broad discovery. A shared Amazon browser session stored in `AMAZON_SESSION_DIR` is only needed if you want browser verification or `SEARCH_PROVIDER=browser`.

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

If Amazon expires the session later, hybrid searches still run, but browser verification is skipped with a warning.

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
