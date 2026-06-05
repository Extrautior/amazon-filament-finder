# Easiest Update Path

This is the simplest way to update the existing Proxmox LXC.

## What Stays The Same

The app still keeps:

- sorting by material and color
- discounted deal grouping
- direct Amazon links
- CSV/JSON export
- search history
- auto-refresh twice per day
- Discord deal alerts

The new version adds:

- Decodo search instead of fragile Amazon search-page browser scraping
- all results by default with `RESULT_LIMIT=0`
- bundle support
- price per kg sorting
- ASA support
- optional browser verification for unclear top results

## Step 1: Push This Code To GitHub

On your PC, in this project folder:

```powershell
git status
git add .
git commit -m "Add hybrid Decodo filament scraper"
git push origin master
```

## Step 2: Run One Command On The LXC

SSH into the LXC, then run:

```bash
cd /opt/amazon-filament-finder
sudo bash deploy/update-hybrid-lxc.sh
```

The script will ask for:

- your Decodo auth token, or `username:password`
- your app password, or blank to keep the existing password
- max Decodo requests per run, default `10`

Use `3` first for a tiny smoke test. Press Enter for `10` once you know the token works. Only use `100` or more after you are comfortable with Decodo billing/usage.

## Step 3: Open The App

Open your existing app URL.

Run a single PLA search first. If that works, run Search All.

## Important Settings

These are the settings that make the new scraper behave how you asked:

```bash
RESULT_LIMIT=0
SEARCH_PROVIDER=hybrid
DECODO_GEO=Israel
DECODO_MAX_REQUESTS_PER_RUN=10
AUTO_REFRESH_HOURS=8,20
```

`RESULT_LIMIT=0` means the app keeps every result it finds.

`DECODO_MAX_REQUESTS_PER_RUN=10` means the app may fetch up to 10 filtered Amazon pages per run. With two scheduled runs per day, this can use up to about 600 Decodo requests per month. A value of `100` can use up to about 6,000 Decodo requests per month.

## If Something Fails

Check:

```bash
systemctl status amazon-filament-finder --no-pager
journalctl -u amazon-filament-finder -n 100 --no-pager
curl http://127.0.0.1:3017/health
```

If health says `DECODO_AUTH_TOKEN is missing`, rerun:

```bash
cd /opt/amazon-filament-finder
sudo bash deploy/update-hybrid-lxc.sh
```
