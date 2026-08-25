/**
 * UWC — реестр мини-wiki по форматам (/formats/<slug>).
 *
 * Языконезависимый: тексты статей лежат в i18n/locales/*.json под ключом
 * `wiki.<slug>.*` (title, tagline, meta.title, meta.description, history[],
 * how[], cta). Этот файл описывает только структуру: слаг, иконку, категорию
 * и пары конвертеров для CTA-кнопок «открой в студии».
 */

/** Категория статьи — совпадает с категориями FORMAT_CATEGORIES. */
export type WikiCategory = 'text' | 'image' | 'doc' | 'audio' | 'data' | 'useless'

export interface WikiPair {
  /** id исходного формата (для deep-link /converter?from=&to=) */
  from: string
  to: string
}

export interface WikiArticle {
  /** URL-slug: /formats/<slug> */
  slug: string
  /** Отображаемое имя формата (языконезависимое — обычно акроним) */
  name: string
  icon: string
  category: WikiCategory
  /**
   * Пары конвертеров для CTA. Если пара есть в клиентском реестре,
   * студия откроется с уже выбранной конвертацией (?from=&to=).
   * Не задана — CTA ведёт просто в студию (или на вкладку `tab`).
   */
  pairs?: WikiPair[]
  /**
   * Пара живёт только на сервере (уровень B) — deep-link ведёт в студию,
   * где клиентский fallback сам уйдёт на /api/convert.
   */
  serverOnly?: boolean
  /**
   * Если формат живёт не в текстовой вкладке (QR, аудио, архивы) —
   * вместо pairs открываем нужную вкладку студии.
   */
  tab?: 'text' | 'image' | 'audio' | 'gen' | 'qr' | 'zip'
}

export const WIKI_ARTICLES: WikiArticle[] = [
  // --- данные ---
  { slug: 'json', name: 'JSON', icon: 'vscode-icons:file-type-json', category: 'text', pairs: [{ from: 'json', to: 'yaml' }, { from: 'json', to: 'toml' }, { from: 'json', to: 'csv' }, { from: 'json', to: 'xml' }] },
  { slug: 'yaml', name: 'YAML', icon: 'vscode-icons:file-type-yaml', category: 'text', pairs: [{ from: 'yaml', to: 'json' }, { from: 'yaml', to: 'toml' }] },
  { slug: 'toml', name: 'TOML', icon: 'vscode-icons:file-type-toml', category: 'text', pairs: [{ from: 'toml', to: 'json' }, { from: 'toml', to: 'yaml' }] },
  { slug: 'csv', name: 'CSV', icon: 'vscode-icons:file-type-excel2', category: 'text', pairs: [{ from: 'csv', to: 'json' }, { from: 'csv', to: 'tsv' }, { from: 'csv', to: 'markdown' }] },
  { slug: 'tsv', name: 'TSV', icon: 'i-lucide-table', category: 'text', pairs: [{ from: 'tsv', to: 'csv' }, { from: 'tsv', to: 'markdown' }] },
  { slug: 'xml', name: 'XML', icon: 'vscode-icons:file-type-xml', category: 'text', pairs: [{ from: 'xml', to: 'json' }] },
  { slug: 'ini', name: 'INI', icon: 'i-lucide-file-code', category: 'text', pairs: [{ from: 'ini', to: 'json' }, { from: 'ini', to: 'yaml' }, { from: 'ini', to: 'toml' }] },
  { slug: 'hjson', name: 'HJSON', icon: 'i-lucide-braces', category: 'text', pairs: [{ from: 'hjson', to: 'json' }, { from: 'json', to: 'hjson' }] },
  { slug: 'properties', name: 'Properties', icon: 'i-lucide-file-cog', category: 'text', pairs: [{ from: 'properties', to: 'json' }, { from: 'json', to: 'properties' }] },
  { slug: 'env', name: 'ENV', icon: 'i-lucide-file-cog', category: 'text', pairs: [{ from: 'env', to: 'json' }, { from: 'json', to: 'env' }] },
  { slug: 'jsonp', name: 'JSONP', icon: 'i-lucide-braces', category: 'text', pairs: [{ from: 'jsonp', to: 'json' }, { from: 'json', to: 'jsonp' }] },
  { slug: 'markdown', name: 'Markdown', icon: 'vscode-icons:file-type-markdown', category: 'text', pairs: [{ from: 'md', to: 'html' }, { from: 'csv', to: 'markdown' }] },
  { slug: 'html', name: 'HTML', icon: 'vscode-icons:file-type-html', category: 'text', pairs: [{ from: 'html', to: 'md' }] },
  { slug: 'txt', name: 'TXT', icon: 'i-lucide-file-text', category: 'text', serverOnly: true, pairs: [{ from: 'txt', to: 'docx' }, { from: 'pdf', to: 'txt' }] },
  { slug: 'base64', name: 'Base64', icon: 'vscode-icons:file-type-binary', category: 'data', pairs: [] },
  { slug: 'base32', name: 'Base32', icon: 'i-lucide-hash', category: 'data', pairs: [] },
  { slug: 'base36', name: 'Base36', icon: 'i-lucide-hash', category: 'data', pairs: [] },
  { slug: 'base62', name: 'Base62', icon: 'i-lucide-hash', category: 'data', pairs: [] },
  { slug: 'ascii85', name: 'Ascii85', icon: 'i-lucide-hash', category: 'data', pairs: [] },
  { slug: 'hex', name: 'Hex', icon: 'i-lucide-hash', category: 'data', pairs: [{ from: 'hex', to: 'rgb' }] },
  { slug: 'quoted-printable', name: 'Quoted-Printable', icon: 'i-lucide-mail', category: 'data', pairs: [] },
  { slug: 'uuencode', name: 'Uuencode', icon: 'i-lucide-file-archive', category: 'data', pairs: [] },
  { slug: 'idn', name: 'Punycode / IDN', icon: 'i-lucide-globe', category: 'data', pairs: [] },
  { slug: 'jwt', name: 'JWT', icon: 'i-lucide-key-round', category: 'data', pairs: [] },
  { slug: 'sha256', name: 'SHA-256', icon: 'i-lucide-shield-check', category: 'data', pairs: [] },
  { slug: 'md5', name: 'MD5', icon: 'i-lucide-shield-check', category: 'data', pairs: [] },
  { slug: 'crc32', name: 'CRC32', icon: 'i-lucide-hash', category: 'data', pairs: [] },
  { slug: 'iban', name: 'IBAN', icon: 'i-lucide-landmark', category: 'data', pairs: [] },
  { slug: 'roman', name: 'Roman numerals', icon: 'i-lucide-sigma', category: 'data', pairs: [{ from: 'roman', to: 'arabic' }] },
  { slug: 'mac', name: 'MAC address', icon: 'i-lucide-network', category: 'data', pairs: [] },
  { slug: 'color', name: 'HEX / RGB / HSL', icon: 'i-lucide-palette', category: 'data', pairs: [{ from: 'hex', to: 'rgb' }, { from: 'rgb', to: 'hsl' }] },
  { slug: 'vcard', name: 'vCard', icon: 'vscode-icons:file-type-font', category: 'data', pairs: [{ from: 'vcard', to: 'json' }] },
  { slug: 'ical', name: 'iCal', icon: 'i-lucide-calendar', category: 'data', pairs: [{ from: 'ical', to: 'json' }], serverOnly: true },
  { slug: 'geojson', name: 'GeoJSON', icon: 'vscode-icons:file-type-map', category: 'data', pairs: [{ from: 'geojson', to: 'kml' }, { from: 'geojson', to: 'gpx' }], serverOnly: true },
  { slug: 'sql-dump', name: 'SQL', icon: 'vscode-icons:file-type-sql', category: 'data', pairs: [{ from: 'sql', to: 'json' }], serverOnly: true },
  { slug: 'uuid', name: 'UUID', icon: 'i-lucide-fingerprint', category: 'data', tab: 'gen' },
  // --- изображения ---
  { slug: 'png', name: 'PNG', icon: 'vscode-icons:file-type-image', category: 'image', tab: 'image' },
  { slug: 'jpeg', name: 'JPEG', icon: 'vscode-icons:file-type-image', category: 'image', tab: 'image' },
  { slug: 'webp', name: 'WebP', icon: 'vscode-icons:file-type-image', category: 'image', tab: 'image' },
  { slug: 'gif', name: 'GIF', icon: 'vscode-icons:file-type-image', category: 'image', tab: 'image' },
  { slug: 'svg', name: 'SVG', icon: 'vscode-icons:file-type-svg', category: 'image', tab: 'image' },
  { slug: 'heic', name: 'HEIC', icon: 'vscode-icons:file-type-image', category: 'image', tab: 'image' },
  { slug: 'avif', name: 'AVIF', icon: 'vscode-icons:file-type-avif', category: 'image', tab: 'image', serverOnly: true, pairs: [{ from: 'avif', to: 'png' }, { from: 'avif', to: 'jpeg' }] },
  { slug: 'tiff', name: 'TIFF', icon: 'i-lucide-file-image', category: 'image', tab: 'image', serverOnly: true, pairs: [{ from: 'tiff', to: 'png' }, { from: 'tiff', to: 'jpeg' }] },
  { slug: 'bmp', name: 'BMP', icon: 'i-lucide-file-image', category: 'image', tab: 'image', serverOnly: true, pairs: [{ from: 'bmp', to: 'png' }, { from: 'bmp', to: 'jpeg' }] },
  { slug: 'ico', name: 'ICO', icon: 'vscode-icons:file-type-image', category: 'image', tab: 'image', serverOnly: true, pairs: [{ from: 'ico', to: 'png' }, { from: 'ico', to: 'jpeg' }] },
  { slug: 'cur', name: 'CUR', icon: 'i-lucide-file-image', category: 'image', tab: 'image', serverOnly: true, pairs: [{ from: 'cur', to: 'png' }, { from: 'cur', to: 'jpeg' }] },
  { slug: 'ppm', name: 'PPM', icon: 'i-lucide-file-image', category: 'image', tab: 'image', serverOnly: true, pairs: [{ from: 'ppm', to: 'png' }, { from: 'ppm', to: 'jpeg' }] },
  { slug: 'tga', name: 'TGA', icon: 'i-lucide-file-image', category: 'image', tab: 'image', serverOnly: true, pairs: [{ from: 'tga', to: 'png' }, { from: 'tga', to: 'jpeg' }] },
  { slug: 'pcx', name: 'PCX', icon: 'i-lucide-file-image', category: 'image', tab: 'image', serverOnly: true, pairs: [{ from: 'pcx', to: 'png' }, { from: 'pcx', to: 'jpeg' }] },
  { slug: 'xbm', name: 'XBM', icon: 'i-lucide-file-image', category: 'image', tab: 'image', serverOnly: true, pairs: [{ from: 'xbm', to: 'png' }, { from: 'xbm', to: 'jpeg' }] },
  // --- аудио ---
  { slug: 'mp3', name: 'MP3', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'wav', name: 'WAV', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'ogg', name: 'OGG', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'flac', name: 'FLAC', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'aiff', name: 'AIFF', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'caf', name: 'CAF', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'opus', name: 'Opus', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'm4a', name: 'M4A', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'webm-audio', name: 'WebM', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'qoa', name: 'QOA', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  // --- документы ---
  { slug: 'pdf', name: 'PDF', icon: 'vscode-icons:file-type-pdf2', category: 'doc', tab: 'image' },
  { slug: 'docx', name: 'DOCX', icon: 'vscode-icons:file-type-word', category: 'doc', tab: 'image' },
  { slug: 'xlsx', name: 'XLSX', icon: 'vscode-icons:file-type-excel', category: 'doc', tab: 'image', pairs: [] },
  { slug: 'pptx', name: 'PPTX', icon: 'vscode-icons:file-type-powerpoint', category: 'doc', tab: 'image', pairs: [] },
  { slug: 'epub', name: 'EPUB', icon: 'vscode-icons:file-type-html', category: 'doc', tab: 'image', pairs: [] },
  { slug: 'rtf', name: 'RTF', icon: 'vscode-icons:file-type-text', category: 'doc', tab: 'image', pairs: [] },
  // --- архивы ---
  { slug: 'zip', name: 'ZIP', icon: 'vscode-icons:file-type-zip', category: 'data', tab: 'zip', pairs: [] },
  { slug: 'tar', name: 'TAR', icon: 'vscode-icons:file-type-zip', category: 'data', tab: 'zip', pairs: [] },
  { slug: 'gzip', name: 'GZIP', icon: 'vscode-icons:file-type-zip', category: 'data', tab: 'zip', pairs: [] },
  // --- бесполезные (бренд) ---
  { slug: 'qr', name: 'QR', icon: 'i-lucide-qr-code', category: 'useless', tab: 'qr', pairs: [] },
  { slug: 'rot13', name: 'ROT13', icon: 'i-lucide-case-sensitive', category: 'useless', pairs: [] },
  { slug: 'rot47', name: 'ROT47', icon: 'i-lucide-rotate-ccw', category: 'useless', pairs: [] },
  { slug: 'caesar', name: 'Caesar cipher', icon: 'i-lucide-key-round', category: 'useless', pairs: [] },
  { slug: 'atbash', name: 'Atbash', icon: 'i-lucide-shuffle', category: 'useless', pairs: [] },
  { slug: 'morse', name: 'Morse code', icon: 'i-lucide-radio', category: 'useless', pairs: [] },
  { slug: 'a1z26', name: 'A1Z26', icon: 'i-lucide-list-ordered', category: 'useless', pairs: [] },
  { slug: 'bacon', name: 'Bacon cipher', icon: 'i-lucide-egg', category: 'useless', pairs: [] },
  { slug: 'tap', name: 'Tap code', icon: 'i-lucide-grid-2x2', category: 'useless', pairs: [] },
  { slug: 'baudot', name: 'Baudot / ITA2', icon: 'i-lucide-radio-tower', category: 'useless', pairs: [] },
  { slug: 'ebcdic', name: 'EBCDIC', icon: 'i-lucide-server', category: 'useless', pairs: [] },
  { slug: 'fullwidth', name: 'Full-width / Half-width', icon: 'i-lucide-text-cursor', category: 'useless', pairs: [] },
  { slug: 'zalgo', name: 'Zalgo', icon: 'i-lucide-skull', category: 'useless', pairs: [] },
  { slug: 'leet', name: 'Leet speak', icon: 'i-lucide-flame', category: 'useless', pairs: [] },
  { slug: 'slugify', name: 'Slugify', icon: 'i-lucide-link', category: 'useless', pairs: [] },
  { slug: 'translit', name: 'Translit', icon: 'i-lucide-text-cursor', category: 'useless', pairs: [] }
]

/** Slug'и, для которых есть статья (для интерлинков из лендинга). */
export const WIKI_SLUGS = new Set(WIKI_ARTICLES.map((a) => a.slug))

export function getWikiArticle(slug: string): WikiArticle | undefined {
  return WIKI_ARTICLES.find((a) => a.slug === slug)
}
