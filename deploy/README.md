# UWC — VPS deployment (Caddy + PM2)

Target setup: Node server behind Caddy on the `uwc.rsh.pw` subdomain.

```
Internet ──> Caddy :443 (auto TLS) ──> Node (PM2) :3000
```

## 1. Build

```bash
bun install
bun run test     # all 93 tests must pass
bun run build    # produces .output/
```

⚠️ **Important — native binaries:** sharp binaries are platform-specific.
A `.output` built on Windows/macOS will NOT work on a Linux VPS.
**Build on the server itself** (or in CI with a Linux runner):

```bash
git clone https://github.com/Baconana-chan/UWC /opt/uwc-src && cd /opt/uwc-src
bun install && bun run build
```

## 2. PM2

```bash
npm i -g pm2            # or: bun i -g pm2

sudo mkdir -p /var/log/uwc
pm2 start deploy/ecosystem.config.cjs
pm2 save                # restore after reboot
pm2 startup             # prints a command — run it to enable autostart
```

Check: `curl -I http://localhost:3000` → HTTP 200.

## 3. Caddy

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # or your include dir
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy issues and renews the Let's Encrypt certificate automatically on the
first request. The DNS A record `uwc.rsh.pw` → server IP must exist beforehand.

## 4. Verify production

| What | How |
|---|---|
| Homepage | `curl -s https://uwc.rsh.pw \| grep "<title>"` → UWC — convert anything… |
| Sitemap | `https://uwc.rsh.pw/sitemap.xml` → XML listing every wiki article |
| robots.txt | `https://uwc.rsh.pw/robots.txt` → Allow + Sitemap |
| OG image | paste the URL into https://www.opengraph.xyz or any social debugger |
| Canonical | `<link rel="canonical" href="https://uwc.rsh.pw...">` in the HTML |
| JSON-LD | `view-source:` of the homepage → `application/ld+json` block |
| Security headers | `curl -sI https://uwc.rsh.pw` → X-Frame-Options, nosniff, etc. |
| HTTPS redirect | `http://uwc.rsh.pw` → 301 to https |
| Conversions | convert text and an image through the UI |

## 5. Search Console

1. Open https://search.google.com/search-console
2. Add property `https://uwc.rsh.pw` (DNS TXT verification)
3. Submit the sitemap: Indexing → Sitemaps → `sitemap.xml`
4. Request indexing for the homepage manually — Google crawls the rest via links

## Updating

```bash
cd /opt/uwc-src
git pull
bun install
bun run build
pm2 restart uwc
```

Downtime is ~1–2 seconds (PM2 restart).
