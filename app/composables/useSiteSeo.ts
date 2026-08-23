/**
 * Единая точка SEO для всех страниц.
 *
 * Использование на странице:
 *   const { t } = useI18n()
 *   useSiteSeo({ title: t('meta.title'), description: t('meta.description') })
 *
 * Даёт: title (с шаблоном «X — UWC» для не-главных), description,
 * canonical, Open Graph и Twitter карты, og:image от siteUrl.
 */
export function useSiteSeo(options: {
  title: string
  description?: string
  /** Не добавлять суффикс « — UWC» (для главной) */
  bareTitle?: boolean
  /** Тип OG-объекта */
  type?: 'website' | 'article'
}) {
  const config = useRuntimeConfig()
  const route = useRoute()
  const siteUrl = config.public.siteUrl.replace(/\/$/, '')

  const fullTitle = options.bareTitle ? options.title : `${options.title} — UWC`
  const canonical = `${siteUrl}${route.path === '/' ? '' : route.path}`
  const ogImage = `${siteUrl}/og-image.png`

  useHead({
    title: fullTitle,
    link: [{ rel: 'canonical', href: canonical }]
  })

  useSeoMeta({
    description: options.description,
    robots: 'index, follow',
    ogTitle: fullTitle,
    ogDescription: options.description,
    ogUrl: canonical,
    ogImage,
    ogLocale: 'en',
    twitterCard: 'summary_large_image',
    twitterTitle: fullTitle,
    twitterDescription: options.description,
    twitterImage: ogImage
  })
}
