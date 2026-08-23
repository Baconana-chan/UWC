/**
 * UWC — серверный реестр конвертеров (фаза 0).
 *
 * Пока регистрируем те же IR-пары, что работают в браузере, — чтобы проверить
 * пайплайн «multipart/текст → реестр → конвертер → ответ» end-to-end.
 * С фазы 2 сюда добавятся серверные форматы (парсинг YAML/TOML, XML, vCard/iCal,
 * ZIP/TAR, XLSX/DOCX/PDF) — тир «b/c» — через те же `parse → IrNode / serialize`.
 *
 * from/to — ТОЛЬКО id из этого реестра (белый список), никаких произвольных строк.
 */

import { makeIrPair, type IrFormat } from '../../shared/registry/ir'
import { IR_FORMATS } from '../../shared/registry/irFormats'
import { IMAGE_SERVER_SOURCES, IMAGE_SERVER_TARGETS } from '../../shared/registry/formats'
import { geojsonToCsv } from '../../shared/registry/formats'
import { convertImage } from './imageConverters'
import { docxToHtml, docxToTxt, htmlToDocx, txtToDocx, DOCX_MIME } from './docxConverters'
import { pdfToText, textToPdf, PDF_MIME } from './pdfConverters'
import { xlsxToCsv, csvToXlsx, xlsxToJson, jsonToXlsx, XLSX_MIME } from './xlsxConverters'
import { sqlToJson, jsonToSql, SQL_MIME } from './sqlConverters'

/** MIME — переиспользуемые константы для registry и endpoint. */
export interface ServerConverter {
  /** id пары, например 'ini-to-json' — совпадает с клиентскими id */
  id: string
  from: string
  to: string
  /** 'b' — pure-JS (можно и на edge), 'c' — нативные бинарники (sharp/ffmpeg) */
  tier: 'b' | 'c'
  /** 'text' — из JSON/multipart-текста, 'binary' — только байты файла (картинки и пр.) */
  inputKind: 'text' | 'binary'
  /** выходной MIME; text/* возвращается JSON-обёрткой, остальное — файлом */
  mime: string
  /** расширение выходного файла */
  ext: string
  handler: (input: string | Uint8Array) => string | Uint8Array | Promise<string | Uint8Array>
}

const TEXT_MIME = 'text/plain; charset=utf-8'

/** Те же курируемые пары, что в группе «Данные» на клиенте (formats.ts). */
const PAIRS: Array<[string, string]> = [
  ['ini', 'json'],
  ['json', 'ini'],
  ['csv', 'json'],
  ['json', 'csv'],
  ['ini', 'yaml'],
  ['ini', 'toml'],
  ['csv', 'yaml'],
  ['csv', 'toml'],
  ['json', 'yaml'],
  ['json', 'toml'],
  // фаза 2: YAML-парсинг + vCard/iCal
  ['yaml', 'json'],
  ['yaml', 'ini'],
  ['yaml', 'toml'],
  ['yaml', 'csv'],
  ['vcard', 'json'],
  ['json', 'vcard'],
  ['ical', 'json'],
  ['json', 'ical'],
  // фаза 2: TOML-парсинг (двусторонний) + XML ↔ JSON
  ['toml', 'json'],
  ['toml', 'ini'],
  ['toml', 'yaml'],
  ['toml', 'csv'],
  ['xml', 'json'],
  ['json', 'xml'],
  // geo: KML/GPX → GeoJSON и GeoJSON → KML/GPX/CSV
  ['kml', 'geojson'],
  ['gpx', 'geojson'],
  ['geojson', 'json'],
  ['json', 'geojson'],
  ['geojson', 'kml'],
  ['geojson', 'gpx']
]

function fmt(id: string): IrFormat {
  const f = IR_FORMATS.find((x) => x.id === id)
  if (!f) throw new Error(`Unknown IR format: ${id}`)
  return f
}

export const SERVER_CONVERTERS: ServerConverter[] = [
  // текстовые IR-пары (тир 'b' — pure-JS)
  ...PAIRS.map(([from, to]) => {
    const pair = makeIrPair(fmt(from), fmt(to))
    return {
      id: pair.id,
      from,
      to,
      tier: 'b' as const,
      inputKind: 'text' as const,
      mime: TEXT_MIME,
      ext: to,
      handler: pair.run
    }
  }),
  // GeoJSON → CSV: кастомный конвертер (не через makeIrPair, т.к. serializeCsv ждёт массив)
  {
    id: 'geojson-to-csv',
    from: 'geojson',
    to: 'csv',
    tier: 'b' as const,
    inputKind: 'text' as const,
    mime: TEXT_MIME,
    ext: 'csv',
    handler: geojsonToCsv
  },
  // фаза 3: изображения (тир 'c' — sharp/heic-convert). Полная матрица
  // источников × целей минус identity: 10×6 − 6 = 54 пары.
  ...IMAGE_SERVER_SOURCES.flatMap((src) =>
    IMAGE_SERVER_TARGETS
      .filter((dst) => dst.value !== src.value)
      .map((dst) => ({
        id: `${src.value}-to-${dst.value}`,
        from: src.value,
        to: dst.value,
        tier: 'c' as const,
        inputKind: 'binary' as const,
        mime: dst.mime,
        ext: dst.ext,
        handler: (input: string | Uint8Array) => convertImage(input as Uint8Array, src.value, dst.value)
      }))
  ),
  // фаза 2: DOCX ↔ HTML
  {
    id: 'docx-to-html',
    from: 'docx',
    to: 'html',
    tier: 'b' as const,
    inputKind: 'binary' as const,  // вход — бинарный файл
    mime: 'text/html; charset=utf-8',
    ext: 'html',
    handler: (input: string | Uint8Array) => docxToHtml(input as Uint8Array)
  },
  {
    id: 'html-to-docx',
    from: 'html',
    to: 'docx',
    tier: 'b' as const,
    inputKind: 'text' as const,
    mime: DOCX_MIME,
    ext: 'docx',
    handler: (input: string | Uint8Array) => htmlToDocx(input as string)
  },
  // DOCX ↔ TXT
  {
    id: 'docx-to-txt',
    from: 'docx',
    to: 'txt',
    tier: 'b' as const,
    inputKind: 'binary' as const,
    mime: TEXT_MIME,
    ext: 'txt',
    handler: (input: string | Uint8Array) => docxToTxt(input as Uint8Array)
  },
  {
    id: 'txt-to-docx',
    from: 'txt',
    to: 'docx',
    tier: 'b' as const,
    inputKind: 'text' as const,
    mime: DOCX_MIME,
    ext: 'docx',
    handler: (input: string | Uint8Array) => txtToDocx(input as string)
  },
  // PDF ↔ TXT
  {
    id: 'pdf-to-txt',
    from: 'pdf',
    to: 'txt',
    tier: 'b' as const,
    inputKind: 'binary' as const,
    mime: TEXT_MIME,
    ext: 'txt',
    handler: (input: string | Uint8Array) => pdfToText(input as Uint8Array)
  },
  {
    id: 'txt-to-pdf',
    from: 'txt',
    to: 'pdf',
    tier: 'b' as const,
    inputKind: 'text' as const,
    mime: PDF_MIME,
    ext: 'pdf',
    handler: (input: string | Uint8Array) => textToPdf(input as string)
  },
  // XLSX ↔ CSV / JSON
  {
    id: 'xlsx-to-csv',
    from: 'xlsx',
    to: 'csv',
    tier: 'b' as const,
    inputKind: 'binary' as const,
    mime: TEXT_MIME,
    ext: 'csv',
    handler: (input: string | Uint8Array) => xlsxToCsv(input as Uint8Array)
  },
  {
    id: 'csv-to-xlsx',
    from: 'csv',
    to: 'xlsx',
    tier: 'b' as const,
    inputKind: 'text' as const,
    mime: XLSX_MIME,
    ext: 'xlsx',
    handler: (input: string | Uint8Array) => csvToXlsx(input as string)
  },
  {
    id: 'xlsx-to-json',
    from: 'xlsx',
    to: 'json',
    tier: 'b' as const,
    inputKind: 'binary' as const,
    mime: 'application/json',
    ext: 'json',
    handler: (input: string | Uint8Array) => xlsxToJson(input as Uint8Array)
  },
  {
    id: 'json-to-xlsx',
    from: 'json',
    to: 'xlsx',
    tier: 'b' as const,
    inputKind: 'text' as const,
    mime: XLSX_MIME,
    ext: 'xlsx',
    handler: (input: string | Uint8Array) => jsonToXlsx(input as string)
  },
  // SQL dump ↔ JSON (чистый JS, без зависимостей — без GPL sql.js/better-sqlite3)
  {
    id: 'sql-to-json',
    from: 'sql',
    to: 'json',
    tier: 'b' as const,
    inputKind: 'text' as const,
    mime: 'application/json',
    ext: 'json',
    handler: (input: string | Uint8Array) => sqlToJson(input as string)
  },
  {
    id: 'json-to-sql',
    from: 'json',
    to: 'sql',
    tier: 'b' as const,
    inputKind: 'text' as const,
    mime: SQL_MIME,
    ext: 'sql',
    handler: (input: string | Uint8Array) => jsonToSql(input as string)
  }
]

export function getServerConverter(from: string, to: string): ServerConverter | undefined {
  return SERVER_CONVERTERS.find((c) => c.from === from && c.to === to)
}
