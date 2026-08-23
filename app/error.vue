<script setup lang="ts">
const { t, locale, setLocale } = useI18n()

// персистентность языка — как в app.vue: error.vue рендерится вне основного
// layout, поэтому применяем сохранённый выбор сами (по умолчанию — en)
const localeCookie = useCookie<string>('uwc_locale', { default: () => '', maxAge: 60 * 60 * 24 * 365 })

if (localeCookie.value && localeCookie.value !== locale.value)
  setLocale(localeCookie.value as 'en' | 'ru')

watch(locale, (l) => {
  localeCookie.value = l
})

const router = useRouter()

// Nuxt передаёт error через пропс error
const props = withDefaults(defineProps<{ error?: { statusCode?: number; statusMessage?: string } }>(), {
  error: undefined
})

const statusCode = computed(() => props.error?.statusCode ?? 404)
const is500 = computed(() => statusCode.value >= 500)

const title = computed(() => is500.value ? t('error500.title') : t('error404.title'))
const subtitle = computed(() => is500.value ? t('error500.subtitle') : t('error404.subtitle'))
const text = computed(() => is500.value ? t('error500.text') : t('error404.text'))
const cta = computed(() => is500.value ? t('error500.cta') : t('error404.cta'))
const badge = computed(() => is500.value ? t('error500.badge') : t('error404.badge'))

useHead({
  title: computed(() => `${title.value} — UWC`),
  htmlAttrs: computed(() => ({ lang: locale.value })),
  meta: [
    {
      name: 'robots',
      content: 'noindex, nofollow'
    }
  ]
})

function goHome() {
  clearError({ redirect: '/' })
}

function goBack() {
  // на прямых переходах (открыли ссылку в новой вкладке) назад идти некуда
  if (window.history.length > 1 && document.referrer)
    router.back()
  else
    goHome()
}

function retry() {
  clearError()
  window.location.reload()
}
</script>

<template>
  <UApp class="min-h-screen bg-[var(--ui-bg)] text-[var(--ui-text)] antialiased selection:bg-lime-400/30">
    <NuxtRouteAnnouncer />

    <div class="relative overflow-x-clip">
      <!-- фоновые свечения + сетка, как на главной -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div class="bg-grid absolute inset-0" />
        <div class="animate-drift absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-violet-500/15 blur-[130px] dark:bg-violet-500/20" />
        <div class="animate-drift-slow absolute -right-32 top-1/3 h-96 w-96 rounded-full bg-cyan-400/10 blur-[120px] dark:bg-cyan-400/15" />
        <div class="absolute -left-32 top-2/3 h-96 w-96 rounded-full bg-lime-400/10 blur-[120px] dark:bg-lime-400/15" />
      </div>

      <div class="relative flex min-h-screen flex-col">
        <UwcNavbar />

        <main class="flex flex-1 items-center justify-center px-4 py-16 sm:px-6 sm:py-20">
          <div class="mx-auto max-w-xl text-center">
            <div class="flex justify-center">
              <UBadge color="primary" variant="soft" size="md" class="gap-1.5 px-3 py-1">
                <UIcon :name="is500 ? 'i-lucide-triangle-alert' : 'i-lucide-file-question'" class="size-3.5" />
                {{ badge }}
              </UBadge>
            </div>

            <!-- Большая цифра с градиентом и свечением -->
            <div class="relative mt-8 flex justify-center">
              <div
                class="pointer-events-none absolute inset-x-0 top-1/2 mx-auto h-32 w-72 -translate-y-1/2 rounded-full bg-lime-400/20 blur-[80px]"
                aria-hidden="true"
              />
              <p class="text-gradient relative font-display text-[7rem] font-extrabold leading-none tracking-tight sm:text-[9rem]">
                {{ title }}
              </p>
            </div>

            <h1 class="mt-4 font-display text-2xl font-bold tracking-tight sm:text-3xl">{{ subtitle }}</h1>
            <p class="mx-auto mt-4 max-w-md leading-relaxed text-[var(--ui-text-muted)]">{{ text }}</p>

            <div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <UButton
                :label="cta"
                icon="i-lucide-home"
                color="primary"
                size="lg"
                class="w-full sm:w-auto"
                @click="goHome"
              />
              <UButton
                v-if="is500"
                :label="t('error.retry')"
                icon="i-lucide-refresh-cw"
                variant="outline"
                color="neutral"
                size="lg"
                class="w-full sm:w-auto"
                @click="retry"
              />
              <UButton
                v-else
                :label="t('error.back')"
                icon="i-lucide-arrow-left"
                variant="outline"
                color="neutral"
                size="lg"
                class="w-full sm:w-auto"
                @click="goBack"
              />
            </div>
          </div>
        </main>

        <UwcFooter />
      </div>
    </div>
  </UApp>
</template>
