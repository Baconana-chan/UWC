# UWC — VPS deployment (Caddy + PM2)

Target setup: Node server behind Caddy on the `uwc.rsh.pw` subdomain.

```
Internet ──> Caddy :443 (auto TLS) ──> Node (PM2) :3000
```

The app lives in the user's home directory (`~/uwc`) — no `/opt`, no permission
juggling, and the server process never runs as root.

## 1. Clone & build (on the VPS)

Requires [Bun](https://bun.sh) (or Node 22+).

```bash
cd ~
git clone https://github.com/Baconana-chan/UWC uwc
cd uwc

bun install        # ⚠️ needed for the build toolchain; .output itself is self-contained
bun run test       # all 93 tests must pass
bun run build      # produces .output/
```

⚠️ **Why build on the VPS:** sharp ships platform-specific native binaries.
A `.output` built on Windows/macOS will not load on Linux — always build where
you run.

## 2. PM2

```bash
mkdir -p ~/logs
npm i -g pm2            # or: bun i -g pm2

pm2 start deploy/ecosystem.config.cjs
pm2 save                # restore after reboot
pm2 startup             # prints a command — run it to enable autostart
```

Check: `curl -I http://localhost:3000` → HTTP 200.

## 3. Caddy

Install Caddy with the official apt repo, then:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # or your include dir
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy issues and renews the Let's Encrypt certificate automatically on the
first request. The DNS A record `uwc.rsh.pw` → server IP must exist beforehand.

The only sudo part of this whole setup is Caddy — everything app-related runs
under your user.

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
cd ~/uwc
git pull
bun install    # only if bun.lock changed
bun run test   # quick sanity check
bun run build
pm2 restart uwc
```

Downtime is ~1–2 seconds (PM2 restart).
