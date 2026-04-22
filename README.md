# Amazon Filament Finder

Hosted web app that searches `Amazon.com` for `PLA`, `PETG`, `ABS`, and `TPU` filament listings that appear eligible to ship to Israel and sorts them by total delivered cost.

This version keeps the same scraping logic as the original local tool:

- search `PLA`, `PETG`, `ABS`, `TPU`
- `1kg` and `2.2lbs` listings only
- Amazon low-to-high sorting
- Amazon's own `Eligible for Free Shipping` search filter
- strict material matching
- images, export, and direct product links

The big runtime change is that the app now uses one persistent server-side Playwright/Chromium profile instead of copying a local Brave profile.

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
- `RESULT_LIMIT`
- `SEARCH_TIMEOUT_MS`

Optional:

- `HEADLESS=false` while doing first-time session setup
- `BROWSER_EXECUTABLE_PATH` if Chromium is not on `PATH`
- `BROWSER_ARGS=--no-sandbox --disable-setuid-sandbox` if your LXC needs those Chromium flags

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

## First-time Amazon session setup

The hosted app depends on one shared Amazon browser session stored in `AMAZON_SESSION_DIR`.

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

If Amazon expires the session later, the hosted API returns a clear reauthentication error instead of empty broken results.

## Proxmox LXC deployment

These steps assume a Debian or Ubuntu LXC.

1. Install system packages:

   ```bash
   sudo apt update
   sudo apt install -y nodejs npm chromium caddy
   ```

2. Create a service user and data directory:

   ```bash
   sudo useradd --system --create-home --shell /usr/sbin/nologin amazon-filament-finder
   sudo mkdir -p /opt/amazon-filament-finder /var/lib/amazon-filament-finder
   sudo chown -R amazon-filament-finder:amazon-filament-finder /opt/amazon-filament-finder /var/lib/amazon-filament-finder
   ```

3. Copy the project into `/opt/amazon-filament-finder`, then install dependencies:

   ```bash
   cd /opt/amazon-filament-finder
   npm install
   ```

4. Create `/etc/amazon-filament-finder.env` from `.env.example`.

5. Copy `deploy/amazon-filament-finder.service` to `/etc/systemd/system/`.

6. Start the service:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now amazon-filament-finder
   ```

7. Update `deploy/Caddyfile` with your hostname, then load it into Caddy for HTTPS reverse proxying.

8. Run the one-time session setup using the same env file and data directory.

## Notes

- This app is intended for a small trusted group, not public-scale scraping.
- Only one live Amazon scrape runs at a time in v1.
- Amazon markup changes over time, so selectors may still need occasional updates.

## Tests

Run:

```powershell
npm test
```
