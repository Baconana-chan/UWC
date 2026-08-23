import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getWikiArticle, WIKI_ARTICLES, WIKI_SLUGS } from '../shared/registry/wiki'
import { TEXT_CONVERTERS } from '../shared/registry/formats'

const en = JSON.parse(readFileSync(resolve(__dirname, '../i18n/locales/wiki-en.json'), 'utf-8')).wiki
const ru = JSON.parse(readFileSync(resolve(__dirname, '../i18n/locales/wiki-ru.json'), 'utf-8')).wiki

describe('wiki registry', () => {
  it('slug уникальны', () => {
    const slugs = WIKI_ARTICLES.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('каждая статья имеет полный контент в обеих локалях (title, tagline, meta, history, how, cta)', () => {
    for (const article of WIKI_ARTICLES) {
      for (const [name, locale] of [['en', en], ['ru', ru]]) {
        const w = locale[article.slug]
        expect(w, `${article.slug} missing in ${locale === en ? 'en' : 'ru'}`).toBeTruthy()
        expect(w.title, `${article.slug}.title (${name})`).toBeTruthy()
        expect(w.tagline, `${article.slug}.tagline (${name})`).toBeTruthy()
        expect(w.meta?.title, `${article.slug}.meta.title (${name})`).toBeTruthy()
        expect(w.meta?.description, `${article.slug}.meta.description (${name})`).toBeTruthy()
        // история и «как работает» — непустые тексты
        expect(w.history.split('\n').filter(Boolean).length, `${article.slug}.history (${name})`).toBeGreaterThanOrEqual(1)
        expect(w.how.split('\n').filter(Boolean).length, `${article.slug}.how (${name})`).toBeGreaterThanOrEqual(1)
        expect(w.cta?.title, `${article.slug}.cta.title (${name})`).toBeTruthy()
        expect(w.cta?.text, `${article.slug}.cta.text (${name})`).toBeTruthy()
      }
    }
  })

  it('пары CTA ссылаются на существующие конвертеры (клиент или сервер)', async () => {
    const { SERVER_CONVERTERS } = await import('../server/utils/registry')
    const clientIds = new Set(TEXT_CONVERTERS.map((c) => c.id))
    const serverPairs = new Set(SERVER_CONVERTERS.map((c) => `${c.from}-to-${c.to}`))

    for (const article of WIKI_ARTICLES) {
      for (const pair of article.pairs ?? []) {
        const pairId = `${pair.from}-to-${pair.to}`
        if (article.serverOnly) {
          expect(serverPairs.has(pairId),
            `${article.slug}: server pair ${pairId} not in SERVER_CONVERTERS`
          ).toBe(true)
        }
        else {
          expect(clientIds.has(pairId),
            `${article.slug}: pair ${pairId} not in TEXT_CONVERTERS`
          ).toBe(true)
        }
      }
    }
  })

  it('getWikiArticle находит по slug и не находит мусор', () => {
    expect(getWikiArticle('json')?.name).toBe('JSON')
    expect(getWikiArticle('nope')).toBeUndefined()
  })

  it('WIKI_SLUGS согласован с реестром', () => {
    expect(WIKI_SLUGS.size).toBe(WIKI_ARTICLES.length)
  })
})
