# Proxmox Debian 13 LXC Deployment

This is the recommended deployment path for Amazon Filament Finder.

Why Debian 13:

- this app requires Node.js `>=20`
- Debian 13 includes Node.js 20 in the standard repository
- Debian 13 also includes Chromium in the standard repository

## 1. Create the LXC in Proxmox

Use a Debian 13 template.

Recommended starting resources:

- 2 vCPU
- 2048 MB RAM
- 8 GB disk minimum
- bridge networking with a static DHCP reservation or static IP

Recommended settings:

- unprivileged container: enabled
- start at boot: enabled
- nesting: enabled

If you want the Amazon login setup to happen through a desktop session inside the container, also enable:

- keyctl: enabled

## 2. Install packages in the container

SSH into the LXC as `root`, then run:

```bash
apt update
apt install -y nodejs npm chromium ca-certificates curl git caddy xorg dbus-x11 xfce4 xfce4-goodies xrdp
```

Check the versions:

```bash
node -v
npm -v
chromium --version
```

You want `node -v` to show `v20.x` or newer.

## 3. Create the app user and directories

```bash
useradd --system --create-home --shell /usr/sbin/nologin amazon-filament-finder
mkdir -p /opt/amazon-filament-finder /var/lib/amazon-filament-finder
chown -R amazon-filament-finder:amazon-filament-finder /opt/amazon-filament-finder /var/lib/amazon-filament-finder
```

## 4. Clone the GitHub repo

```bash
cd /opt
git clone https://github.com/Extrautior/amazon-filament-finder.git
chown -R amazon-filament-finder:amazon-filament-finder /opt/amazon-filament-finder
cd /opt/amazon-filament-finder
```

## 5. Install Node dependencies

```bash
sudo -u amazon-filament-finder npm install
```

## 6. Create the server environment file

Create `/etc/amazon-filament-finder.env`:

```bash
cat >/etc/amazon-filament-finder.env <<'EOF'
PORT=3017
RESULT_LIMIT=10
SEARCH_TIMEOUT_MS=30000
APP_PASSWORD=change-this-to-a-shared-password
DATA_DIR=/var/lib/amazon-filament-finder
AMAZON_SESSION_DIR=/var/lib/amazon-filament-finder/amazon-session
HEADLESS=true
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
BROWSER_ARGS=--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage
EOF
chmod 600 /etc/amazon-filament-finder.env
```

## 7. Install the systemd service

```bash
cp /opt/amazon-filament-finder/deploy/amazon-filament-finder.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable amazon-filament-finder
```

## 8. Set up a temporary desktop login for Amazon session creation

The app needs one shared Amazon session stored on disk. The easiest reliable way to create it inside an LXC is to log into a lightweight remote desktop session one time.

Create a temporary admin user:

```bash
useradd -m -s /bin/bash filament-admin
passwd filament-admin
```

Set XFCE as the XRDP desktop:

```bash
echo xfce4-session >/home/filament-admin/.xsession
chown filament-admin:filament-admin /home/filament-admin/.xsession
systemctl enable --now xrdp
```

Then:

1. Connect to the container over RDP from your PC.
2. Sign in as `filament-admin`.
3. Open a terminal in the remote desktop session.
4. Run:

   ```bash
   sudo -u amazon-filament-finder env $(cat /etc/amazon-filament-finder.env | xargs) bash -lc 'cd /opt/amazon-filament-finder && HEADLESS=false npm run session:setup'
   ```

5. In the Chromium window that opens:
   - log in to Amazon
   - set delivery location to Israel
   - search one filament term manually and verify the free-shipping flow looks right
6. Press `Ctrl+C` in the terminal after you are done.

Verify the session:

```bash
sudo -u amazon-filament-finder env $(cat /etc/amazon-filament-finder.env | xargs) bash -lc 'cd /opt/amazon-filament-finder && npm run session:status'
```

If it returns a `ready` status, the shared Amazon session is stored and the app can run headless after that.

## 9. Start the app service

```bash
systemctl start amazon-filament-finder
systemctl status amazon-filament-finder --no-pager
```

Check health:

```bash
curl http://127.0.0.1:3017/health
```

## 10. Put Caddy in front of it

Edit `/etc/caddy/Caddyfile`:

```caddyfile
filament.yourdomain.com {
    reverse_proxy 127.0.0.1:3017
}
```

Then reload Caddy:

```bash
systemctl reload caddy
systemctl status caddy --no-pager
```

Once DNS points at your Proxmox host and port forwarding is set up, Caddy will handle HTTPS automatically.

## 11. Use the app

Open:

```text
https://filament.yourdomain.com
```

Then:

1. Enter the shared password from `APP_PASSWORD`.
2. Click `Search Amazon Filament`.
3. Export CSV or JSON when you want.

## 12. Day-2 operations

### Check service logs

```bash
journalctl -u amazon-filament-finder -n 100 --no-pager
tail -n 100 /var/lib/amazon-filament-finder/logs/app-$(date +%F).log
```

### Restart the app

```bash
systemctl restart amazon-filament-finder
```

### If Amazon expires the session

Repeat the remote desktop login flow from step 8 and run `npm run session:setup` again.

## Debian 12 note

Debian 12 is possible, but not my recommended path for this project. The main reason is that Debian 12 ships Node.js 18, while this app requires Node.js 20 or newer. If you still want Debian 12, install Node 20+ first, then follow the same steps above.
