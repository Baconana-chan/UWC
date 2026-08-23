/**
 * UWC — серверные конвертеры DOCX ↔ HTML (фаза 2, уровень B).
 *
 * DOCX — это ZIP-архив с XML-внутри. Мы не парсим ZIP вручную:
 *   - mammoth (BSD-2-Clause) — DOCX → HTML: распаковывает архив, читает
 *     word/document.xml и превращает структуру в чистый HTML (<p>, <h1-6>,
 *     <ul>/<ol>, <table>, <img> — base64). Чистый JS, без ffmpeg и сервера.
 *   - docx (MIT) — HTML → DOCX: собирает OOXML-структуру и упаковывает в ZIP.
 *
 * Оба конвертера работают с байтами: вход — Uint8Array (файл), выход — string (HTML)
 * или Uint8Array (DOCX-файл). Регистрация в server/utils/registry.ts.
 *
 * TODO.md §4: вход — только байты, никаких путей; лимиты на endpoint.
 */

import mammoth from 'mammoth'
import { Document, Packer, Paragraph, TextRun } from 'docx'

/** MIME-типы для DOCX. */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * DOCX (байты) → HTML (string).
 * mammoth.convert принимает Buffer и отдаёт { value: html, messages }.
 */
export async function docxToHtml(input: Uint8Array): Promise<string> {
  const result = await mammoth.convert('html', Buffer.from(input))
  if (result.messages.some((m) => m.type === 'error')) {
    throw new Error('errors.badDocx')
  }
  return result.value
}

/**
 * DOCX (байты) → TXT (string).
 * mammoth.extractRawText достаёт чистый текст без HTML-тегов.
 */
export async function docxToTxt(input: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText(Buffer.from(input))
  if (result.messages.some((m) => m.type === 'error')) {
    throw new Error('errors.badDocx')
  }
  return result.value
}

/**
 * TXT (string) → DOCX (байты).
 * Пробрасываем текст как HTML (переносы строк → <p>), переиспользуем htmlToDocx.
 */
export async function txtToDocx(input: string): Promise<Uint8Array> {
  // каждый абзац (двойной перенос) → <p>, одиночный → <br>
  const html = input
    .split(/\n\n/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('')
  return htmlToDocx(html)
}

/**
 * HTML (string) → DOCX (байты).
 *
 * docx.js не парсит произвольный HTML в DOM — мы делаем лёгкий препроцессинг:
 *   <p>, <h1-6>, <li>, <br> → Paragraph / TextRun.
 * Остальные теги игнорируются (контент сохраняется как текст).
 * Это покрывает 90% типовых HTML-выгрузок (письма, статьи, вики).
 */
export async function htmlToDocx(input: string): Promise<Uint8Array> {
  const paragraphs: Paragraph[] = []

  // разбиваем на блочные элементы
  const blockRe = /<\/(p|h[1-6]|li|div|br)>/gi
  const blocks = input.split(blockRe)
  // split с capturing group: блоки чередуются с именем закрывающего тега

  let i = 0
  while (i < blocks.length) {
    const html = blocks[i]!
    const tag = blocks[i + 1] as string | undefined // закрывающий тег (имя)

    i += 2

    if (!html && tag === 'br') {
      // <br> → пустой абзац (разрыв строки)
      paragraphs.push(new Paragraph({ children: [new TextRun('')] }))
      continue
    }

    const text = html.replace(/<[^>]*>/g, '').trim()
    if (!text) continue

    const heading = tag && tag.match(/^h([1-6])$/)

    if (heading) {
      paragraphs.push(new Paragraph({
        heading: `HEADING_${Math.min(Number(heading[1]), 9) as 1}`,
        children: [new TextRun(text)]
      }))
    }
    else if (tag === 'li') {
      paragraphs.push(new Paragraph({ text }))
    }
    else {
      paragraphs.push(new Paragraph({ text }))
    }
  }

  // если ничего не разобрали — вставляем как есть
  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ text: input.replace(/<[^>]*>/g, '').trim() }))
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: paragraphs
    }]
  })

  const buffer = await Packer.toBuffer(doc)
  return new Uint8Array(buffer)
}
