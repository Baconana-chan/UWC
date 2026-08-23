<script setup lang="ts">
const { t, locale, setLocale } = useI18n()

// персистентность языка: @nuxtjs/i18n пишет куку только при включённом
// detectBrowserLanguage, поэтому храним выбор сами (по умолчанию — en)
const localeCookie = useCookie<string>('uwc_locale', { default: () => '', maxAge: 60 * 60 * 24 * 365 })

// применяем сохранённый язык и на сервере, и при гидрации — без «мигания»
if (localeCookie.value && localeCookie.value !== locale.value)
  setLocale(localeCookie.value as 'en' | 'ru')

watch(locale, (l) => {
  localeCookie.value = l
})

useHead({
  title: computed(() => t('meta.title')),
  htmlAttrs: computed(() => ({ lang: locale.value }))
})
</script>

<template>
  <UApp class="min-h-screen bg-[var(--ui-bg)] text-[var(--ui-text)] antialiased selection:bg-lime-400/30">
    <NuxtRouteAnnouncer />

    <div class="relative overflow-x-clip">
      <!-- фоновые свечения -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div class="animate-drift absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-violet-500/15 blur-[130px] dark:bg-violet-500/20" />
        <div class="animate-drift-slow absolute -right-32 top-1/3 h-96 w-96 rounded-full bg-cyan-400/10 blur-[120px] dark:bg-cyan-400/15" />
        <div class="absolute -left-32 top-2/3 h-96 w-96 rounded-full bg-lime-400/10 blur-[120px] dark:bg-lime-400/15" />
      </div>

      <div class="relative">
        <UwcNavbar />

        <main>
          <NuxtPage />
        </main>

        <UwcFooter />
      </div>
    </div>
  </UApp>
</template>
