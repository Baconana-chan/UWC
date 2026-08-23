/**
 * UWC — серверные конвертеры PDF ↔ текст (фаза 2, уровень B).
 *
 * Библиотеки (чистые JS, без GPL):
 *   - pdf-lib (MIT) — text → PDF: создаёт документ с текстовыми страницами.
 *   - pdfjs-dist/legacy (Apache-2.0) — PDF → text: извлекает текст постранично.
 *     Используется legacy-сборка, которая работает в Node.js без DOM-полифиллов.
 *
 * PDF — бинарный формат. Конвертеры работают с байтами.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'
// legacy-сборка — для Node.js (не требует DOMMatrix, Canvas и пр.)
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** MIME PDF. */
export const PDF_MIME = 'application/pdf'

/**
 * PDF (байты) → TXT (string).
 *
 * pdfjs-dist извлекает текст постранично. legacy-сборка работает в Node.js
 * без DOM-полифиллов (DOMMatrix, Canvas, worker и т.п.).
 */
export async function pdfToText(input: Uint8Array): Promise<string> {
  const loadingTask = getDocument({
    data: input, // pdfjs-dist legacy требует именно Uint8Array, а не Buffer
  })

  try {
    const pdf = await loadingTask.promise
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageStr = textContent.items
        .map((item: { str: string }) => item.str)
        .join('')
      pages.push(pageStr)
    }
    return pages.join('\n\n')
  } finally {
    loadingTask.destroy()
  }
}

/**
 * TXT (string) → PDF (байты).
 *
 * Простой подход: разбиваем текст на строки, каждая страница вмещает N строк.
 * Используем встроенный шрифт Helvetica.
 */
export async function textToPdf(input: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  // параметры страницы A4 в points
  const PAGE_WIDTH = 595
  const PAGE_HEIGHT = 842
  const MARGIN = 50
  const FONT_SIZE = 12
  const LINE_HEIGHT = FONT_SIZE * 1.4
  const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT)

  const lines = input.split('\n')
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    const pageLines = lines.slice(i, i + LINES_PER_PAGE)
    pageLines.forEach((line, j) => {
      page.drawText(line || ' ', {
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN - (j + 1) * LINE_HEIGHT,
        size: FONT_SIZE,
        font
      })
    })
  }

  return new Uint8Array(await pdfDoc.save())
}
