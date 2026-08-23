<script setup lang="ts">
const { t } = useI18n()

const links = [
  { labelKey: 'nav.converter', to: '/converter' },
  { labelKey: 'nav.formats', to: '/#formats' },
  { labelKey: 'nav.plus', to: '/plus' }
]
</script>

<template>
  <footer class="border-t border-[var(--ui-border)]">
    <div class="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div class="flex flex-col items-center justify-between gap-6 sm:flex-row">
        <div class="flex items-center gap-2.5">
          <div class="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-lime-400 via-emerald-400 to-cyan-400 text-zinc-950">
            <UIcon name="i-lucide-wand-sparkles" class="size-4" />
          </div>
          <div>
            <p class="font-display text-sm font-bold">UWC</p>
            <p class="text-xs text-[var(--ui-text-muted)]">{{ t('footer.tagline') }}</p>
          </div>
        </div>

        <div class="flex items-center gap-1">
          <UButton v-for="link in links" :key="link.to" :label="t(link.labelKey)" :to="link.to" variant="ghost" color="neutral" size="sm" />
        </div>
      </div>

      <div class="mt-8 flex flex-col items-center justify-between gap-3 border-t border-[var(--ui-border)] pt-6 text-xs text-[var(--ui-text-dimmed)] sm:flex-row">
        <p>© 2026 UWC · Useless Whatever Converter</p>
        <p>Nuxt 4 · Nitro · Nuxt UI · Reka UI · Tailwind v4</p>
      </div>
    </div>
  </footer>
</template>
