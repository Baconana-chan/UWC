// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },

  // Публичный адрес сайта: canonical, sitemap, og:url.
  // Локально переопределяется NUXT_PUBLIC_SITE_URL=http://localhost:3000
  runtimeConfig: {
    // фаза 0 — лимиты серверной конвертации (переопределяются через NUXT_MAX_INPUT_MB / NUXT_CONVERT_TIMEOUT_MS)
    maxInputMb: 50,
    convertTimeoutMs: 15_000,
    public: {
      siteUrl: 'https://uwc.rsh.pw'
    }
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'dark',
    fallback: 'dark'
  },

  modules: [
    '@nuxt/eslint',
    '@nuxt/icon',
    '@nuxt/fonts',
    '@nuxt/ui',
    '@nuxt/image',
    'reka-ui',
    '@nuxtjs/i18n'
  ],

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' }
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        // SEO по умолчанию — каждая страница переопределяет через useSeoMeta
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'UWC' }
      ]
    }
  },

  icon: {
    // Бандлим ВСЕ используемые иконки (lucide + vscode-icons) в клиентский бандл.
    // Без этого vscode-icons тянутся рантаймом через /api/_nuxt_icon
    // (в dev — медленно, в SSR — warn «[Icon] failed to load icon»).
    clientBundle: {
      scan: {
        // по умолчанию сканер не смотрит .ts/.js — реестр форматов лежит в shared/*.ts
        globInclude: ['**/*.{vue,jsx,tsx,ts,js,md,mdc,mdx,yml,yaml}']
      }
    }
  },

  i18n: {
    baseUrl: 'https://uwc.rsh.pw',
    locales: [
      { code: 'en', name: 'English', language: 'en', files: ['en.json', 'wiki-en.json'] },
      { code: 'ru', name: 'Русский', language: 'ru-RU', files: ['ru.json', 'wiki-ru.json'] }
    ],
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    langDir: 'locales',
    useCookie: true
  },

  nitro: {
    compressPublicAssets: true,
    routeRules: {
      // API — без кэша
      '/api/**': { headers: { 'cache-control': 'no-store' } },
      // статика и клиентские ассеты — длинный кэш с хэшем в имени
      '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      // security headers на всё
      '/**': {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
        }
      }
    }
  }
})
