# UWC — Useless Whatever Converter

> Convert anything, into anything. A fast, privacy-first conversion toolbox that runs in your browser.

**UWC** is a free and open-source web converter covering both the popular formats (JPEG/PNG, JSON/CSV) and the gloriously useless ones (QR, vCard, iCal, GeoJSON, translit, ROT13…). Most conversions run **entirely client-side** — your files never leave your machine.

🔗 **Live:** [uwc.rsh.pw](https://uwc.rsh.pw)

## What it converts

| Category | Formats / features |
|---|---|
| **Text** | 70+ instant converters: case, encodings (Base64/Hex/URL), hashes (SHA/MD5), Markdown↔HTML, translit, keyboard layout, ROT13, leet… |
| **Data** | JSON ↔ YAML ↔ TOML ↔ INI ↔ CSV ↔ XML (two-way via an IR star), vCard, iCal, GeoJSON↔KML/GPX, SQL dumps |
| **Images** | PNG/JPEG/WebP/GIF/SVG/BMP in-browser; AVIF/HEIC/TIFF/ICO on the server (sharp + libheif) |
| **Audio** | 10×10 pairs via a PCM hub (Web Audio decode → @audio/encode) — no ffmpeg |
| **Archives** | ZIP, TAR, TAR.GZ/.tgz, GZIP, Brotli — unpacked right in the browser |
| **QR** | generation (`qrcode`) + scanning from images (`jsqr`) |
| **Generators** | UUID v1–v8, ULID, passwords, passphrases, API keys (CSPRNG) |

Plus a [format wiki](https://uwc.rsh.pw/formats/json) — short articles on where formats came from and how they work — and [UWC+](https://uwc.rsh.pw/plus), a community program for requesting exotic formats.

## Tech stack

- **[Nuxt](https://nuxt.com)** (Vue 3) + **Nuxt UI** + Tailwind CSS
- **@nuxtjs/i18n** — English & Russian
- **Nitro** server for heavy conversions (sharp, exceljs, mammoth, pdf-lib)
- **fflate**, Web Audio API, WebCrypto — client-side heavy lifting
- Tests: Vitest · Package manager: [Bun](https://bun.sh)

## Getting started

Requires [Bun](https://bun.sh) (or Node 22+ with npm).

```bash
bun install

# dev server on http://localhost:3000
bun run dev

# run tests (93 tests across 8 files)
bun run test

# production build → .output/
bun run build
node .output/server/index.mjs
```

## Project structure

```
app/
  pages/                 # landing, /converter, /formats wiki, /plus
  components/            # studio, navbar, hero, dropzone…
  utils/                 # image/audio/QR/archive converters (client-side)
  composables/
shared/registry/         # language-neutral converter registries
server/
  utils/registry.ts      # 97 server converters (whitelisted pairs)
  api/                   # POST /api/convert, GET /api/formats
i18n/locales/            # all UI strings (en/ru) incl. wiki content
tests/                   # vitest suites
deploy/                  # Caddyfile, PM2 ecosystem, VPS guide
```

### Architecture notes

- **IR star for data formats:** each format is a `parse → IrNode` / `serialize(IR)` module; N² pairs at the cost of 2N modules. Tier (client vs server) is a property of the format, not the pair.
- **PNG/RGBA hub for images:** a new format = one adapter module; pairs are generated from sources × targets.
- **PCM hub for audio:** input is always decoded to PCM via Web Audio, then re-encoded.
- **Client-first:** whatever the browser can do never touches the server. The server is a fallback, clearly badged in the UI.

## Contributing

Found a missing format? Open an issue via the [UWC+ program](https://uwc.rsh.pw/plus) — include the format spec and an example file. Code PRs are welcome too: keep converters in registries (not components), add round-trip tests, and match existing style.

```bash
bun run lint     # eslint
bun run test     # vitest
bun run build    # must exit clean
```

## Privacy

No accounts, no tracking, no storage. Files sent to the server for heavy conversions are processed in memory and discarded immediately. Client-side conversions never leave your device.

## License

MIT — see [LICENSE](LICENSE).
