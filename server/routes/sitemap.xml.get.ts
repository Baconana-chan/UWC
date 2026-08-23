/**
 * GET /sitemap.xml — динамическая карта сайта.
 *
 * Статические страницы + все wiki-статьи из реестра. Стратегия i18n —
 * no_prefix (один URL, язык выбирается клиентом), поэтому hreflang не нужен:
 * каждая страница одна на оба языка.
 */
import { WIKI_ARTICLES } from '#shared/registry/wiki'

export default defineEventHandler((event) => {
  const siteUrl = useRuntimeConfig(event).public.siteUrl.replace(/\/$/, '')

  const staticPages = ['', '/converter', '/formats', '/plus']
  const wikiPages = WIKI_ARTICLES.map(a => `/formats/${a.slug}`)

  const urls = [...staticPages, ...wikiPages]
    .map(path => {
      const loc = `${siteUrl}${path}`
      const priority = path === '' ? '1.0' : path === '/converter' ? '0.9' : path.startsWith('/formats/') ? '0.6' : '0.7'
      return [
        '  <url>',
        `    <loc>${loc}</loc>`,
        `    <changefreq>${path === '' || path === '/converter' ? 'weekly' : 'monthly'}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>'
      ].join('\n')
    })

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>'
  ].join('\n')

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=86400')
  return xml
})
