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
- `AUTO_REFRESH_ENABLED`
- `AUTO_REFRESH_TIMEZONE`
- `AUTO_REFRESH_HOURS`

Optional:

- `HEADLESS=false` while doing first-time session setup
- `BROWSER_EXECUTABLE_PATH` if Chromium is not on `PATH`
- `BROWSER_ARGS=--no-sandbox --disable-setuid-sandbox` if your LXC needs those Chromium flags

By default, the hosted server can automatically run the same search as `Search All` twice per day at `08:00` and `20:00` in `Asia/Jerusalem`. Change `AUTO_REFRESH_HOURS` or disable it with `AUTO_REFRESH_ENABLED=false` if you want a different schedule.

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
