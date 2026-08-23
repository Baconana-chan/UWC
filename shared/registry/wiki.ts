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
  { slug: 'csv', name: 'CSV', icon: 'vscode-icons:file-type-excel2', category: 'text', pairs: [{ from: 'csv', to: 'json' }, { from: 'csv', to: 'tsv' }] },
  { slug: 'xml', name: 'XML', icon: 'vscode-icons:file-type-xml', category: 'text', pairs: [{ from: 'xml', to: 'json' }] },
  { slug: 'base64', name: 'Base64', icon: 'vscode-icons:file-type-binary', category: 'data', pairs: [] },
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
  { slug: 'ico', name: 'ICO', icon: 'vscode-icons:file-type-image', category: 'image', tab: 'image' },
  // --- аудио ---
  { slug: 'mp3', name: 'MP3', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'wav', name: 'WAV', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'flac', name: 'FLAC', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
  { slug: 'ogg', name: 'OGG', icon: 'vscode-icons:file-type-audio', category: 'audio', tab: 'audio' },
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
  { slug: 'rot13', name: 'ROT13', icon: 'i-lucide-case-sensitive', category: 'useless', pairs: [] }
]

/** Slug'и, для которых есть статья (для интерлинков из лендинга). */
export const WIKI_SLUGS = new Set(WIKI_ARTICLES.map((a) => a.slug))

export function getWikiArticle(slug: string): WikiArticle | undefined {
  return WIKI_ARTICLES.find((a) => a.slug === slug)
}
