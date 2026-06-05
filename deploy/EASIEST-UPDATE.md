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

- a no-paid-API browser scraper that crawls more Amazon result pages
- all results by default with `RESULT_LIMIT=0`
- bundle support
- price per kg sorting
- ASA support
- optional Decodo mode if you later decide an API is worth paying for

## Step 1: Push This Code To GitHub

I already pushed the update to GitHub. You do not need this step unless you make your own edits later.

```powershell
git status
git add .
git commit -m "Update filament scraper"
git push origin master
```

## Step 2: Run One Command On The LXC

SSH into the LXC, then run:

```bash
cd /opt/amazon-filament-finder
sudo bash deploy/update-hybrid-lxc.sh
```

The script will ask for:

- your app password, or blank to keep the existing password
- max browser pages per query, default `20`
- max raw browser items per query, default `1000`

Press Enter for both browser limits first. If Amazon starts blocking or searches take too long, rerun the script and lower pages to `5`.

## Step 3: Open The App

Open your existing app URL.

Run a single PLA search first. If that works, run Search All.

## Important Settings

These are the settings that make the new scraper behave how you asked:

```bash
RESULT_LIMIT=0
SEARCH_PROVIDER=browser
BROWSER_MAX_SEARCH_RESULT_PAGES=20
BROWSER_MAX_RAW_RESULT_ITEMS=1000
AUTO_REFRESH_HOURS=8,20
```

`RESULT_LIMIT=0` means the app keeps every result it finds.

`SEARCH_PROVIDER=browser` means no paid scraping API is used. The LXC's Chromium browser visits Amazon search pages with the free-shipping filter, crawls pagination up to `BROWSER_MAX_SEARCH_RESULT_PAGES`, and the app sorts the normalized results by effective price per kg.

## If Something Fails

Check:

```bash
systemctl status amazon-filament-finder --no-pager
journalctl -u amazon-filament-finder -n 100 --no-pager
curl http://127.0.0.1:3017/health
```

If the browser session expires, rerun:

```bash
cd /opt/amazon-filament-finder
sudo -u amazon-filament-finder env $(cat /etc/amazon-filament-finder.env | xargs) bash -lc 'HEADLESS=false npm run session:setup'
```
