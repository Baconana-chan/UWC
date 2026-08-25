<script setup lang="ts">
const { t, locale, setLocale } = useI18n()
const colorMode = useColorMode()
const route = useRoute()

const isDark = computed(() => colorMode.value === 'dark')

function toggleColorMode() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}

/** Пункты дропдауна Products */
const products = computed(() => [
  {
    label: t('nav.products.converter'),
    icon: 'i-lucide-wand-sparkles',
    to: '/converter',
    description: t('nav.products.converterDesc'),
    soon: false
  },
  {
    label: t('nav.products.wiki'),
    icon: 'i-lucide-book-open',
    to: '/formats',
    description: t('nav.products.wikiDesc'),
    soon: false
  },
  {
    label: t('nav.products.studio'),
    icon: 'i-lucide-layout-dashboard',
    to: undefined,
    description: t('nav.products.studioDesc'),
    soon: true
  }
])

const links = [
  { labelKey: 'nav.formats', to: '/#formats' },
  { labelKey: 'nav.why', to: '/#why' },
  { labelKey: 'nav.plus', to: '/plus' }
]

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' }
] as const

/** Активен ли какой-то из продуктовых путей (подсветка дропдауна) */
const productsActive = computed(() =>
  ['/converter', '/formats', '/studio'].some(p => route.path.startsWith(p))
)
</script>

<template>
  <header class="sticky top-0 z-50 border-b border-[var(--ui-border)]/70 bg-[var(--ui-bg)]/70 backdrop-blur-xl">
    <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
      <NuxtLink to="/" class="flex items-center gap-2.5">
        <div class="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-lime-400 via-emerald-400 to-cyan-400 text-zinc-950 shadow-lg shadow-lime-500/25">
          <UIcon name="i-lucide-wand-sparkles" class="size-5" />
        </div>
        <span class="font-display text-lg font-bold tracking-tight">UWC</span>
        <UBadge color="primary" variant="soft" size="sm" label="beta" class="hidden sm:inline-flex" />
      </NuxtLink>

      <nav class="hidden items-center gap-1 md:flex">
        <!-- Products: кастомный дропдаун -->
        <UPopover :content="{ align: 'center', side: 'bottom', sideOffset: 8 }" :ui="{ content: 'w-72 p-1.5' }">
          <UButton
            :label="t('nav.products.label')"
            trailing-icon="i-lucide-chevron-down"
            variant="ghost"
            size="sm"
            :color="productsActive ? 'primary' : 'neutral'"
            class="data-[state=open]:bg-[var(--ui-bg-elevated)]"
          />

          <template #content>
            <div class="flex flex-col gap-0.5">
              <template v-for="item in products" :key="item.label">
                <NuxtLink
                  v-if="!item.soon"
                  :to="item.to"
                  class="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--ui-bg-elevated)]"
                >
                  <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-lime-400/15 to-cyan-400/15 text-primary">
                    <UIcon :name="item.icon" class="size-4.5" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <span class="text-sm font-semibold text-[var(--ui-text)]">{{ item.label }}</span>
                    <p class="mt-0.5 text-xs leading-snug text-[var(--ui-text-muted)]">{{ item.description }}</p>
                  </div>
                  <UIcon
                    name="i-lucide-arrow-right"
                    class="mt-2 size-4 shrink-0 text-[var(--ui-text-dimmed)] opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                  />
                </NuxtLink>
                <div v-else class="group flex cursor-default items-start gap-3 rounded-xl px-3 py-2.5 opacity-60">
                  <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-lime-400/15 to-cyan-400/15 text-primary">
                    <UIcon :name="item.icon" class="size-4.5" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-[var(--ui-text)]">{{ item.label }}</span>
                      <UBadge
                        :label="t('nav.products.soon')"
                        color="warning"
                        variant="soft"
                        size="sm"
                        class="!px-1.5 !py-0 text-[10px] font-bold uppercase tracking-wider"
                      />
                    </div>
                    <p class="mt-0.5 text-xs leading-snug text-[var(--ui-text-muted)]">{{ item.description }}</p>
                  </div>
                </div>
              </template>
            </div>
          </template>
        </UPopover>

        <UButton v-for="link in links" :key="link.to" :label="t(link.labelKey)" :to="link.to" variant="ghost" color="neutral" size="sm" />
      </nav>

      <div class="flex items-center gap-1.5">
        <!-- переключатель языка -->
        <div class="flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]/60 p-0.5">
          <UButton
            v-for="l in languages"
            :key="l.code"
            :label="l.label"
            size="sm"
            :variant="locale === l.code ? 'solid' : 'ghost'"
            :color="locale === l.code ? 'primary' : 'neutral'"
            class="!px-2"
            @click="setLocale(l.code)"
          />
        </div>

        <UButton
          to="https://github.com/Baconana-chan/UWC"
          target="_blank"
          icon="i-lucide-github"
          variant="ghost"
          color="neutral"
          size="sm"
          :aria-label="t('nav.github')"
        />
        <UButton
          :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
          variant="ghost"
          color="neutral"
          size="sm"
          :aria-label="isDark ? t('nav.lightMode') : t('nav.darkMode')"
          @click="toggleColorMode"
        />
      </div>
    </div>
  </header>
</template>
