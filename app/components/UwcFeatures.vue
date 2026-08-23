<script setup lang="ts">
const { t } = useI18n()

const features = [
  {
    id: 'serverless',
    icon: 'i-lucide-zap',
    tile: 'from-lime-400/20 to-emerald-400/20 text-lime-500 dark:text-lime-300'
  },
  {
    id: 'nitro',
    icon: 'i-lucide-cpu',
    tile: 'from-violet-400/20 to-fuchsia-400/20 text-violet-500 dark:text-violet-300'
  },
  {
    id: 'stream',
    icon: 'i-lucide-radio',
    tile: 'from-cyan-400/20 to-sky-400/20 text-cyan-500 dark:text-cyan-300'
  },
  {
    id: 'privacy',
    icon: 'i-lucide-shield-check',
    tile: 'from-amber-400/20 to-orange-400/20 text-amber-500 dark:text-amber-300'
  }
]
</script>

<template>
  <section id="why" class="scroll-mt-24 pb-24 sm:pb-32">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="flex justify-center">
        <UBadge color="primary" variant="soft" size="md" class="gap-1.5 px-3 py-1">
          <UIcon name="i-lucide-heart" class="size-3.5" />
          {{ t('features.badge') }}
        </UBadge>
      </div>
      <h2 class="mt-6 text-center font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {{ t('features.title1') }} <span class="text-gradient">{{ t('features.title2') }}</span>
      </h2>
      <p class="mx-auto mt-4 max-w-2xl text-center text-[var(--ui-text-muted)]">
        {{ t('features.subtitle') }}
      </p>

      <div class="mt-12 grid gap-5 sm:grid-cols-2">
        <div
          v-for="f in features"
          :key="f.id"
          class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]/50 p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--ui-border-accented)]"
        >
          <div :class="`flex size-11 items-center justify-center rounded-xl bg-gradient-to-br ${f.tile}`">
            <UIcon :name="f.icon" class="size-5" />
          </div>
          <h3 class="mt-4 font-display text-base font-semibold">{{ t(`features.items.${f.id}.title`) }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-[var(--ui-text-muted)]">{{ t(`features.items.${f.id}.text`) }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
