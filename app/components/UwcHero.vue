<script setup lang="ts">
const { t } = useI18n()

const stats = computed(() => [
  { value: '150+', label: t('hero.statFormats') },
  { value: t('hero.statZeroBytes'), label: t('hero.statServerless') },
  { value: t('hero.statTwoLevels'), label: t('hero.statLevels') }
])
</script>

<template>
  <section class="relative overflow-hidden">
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div class="bg-grid absolute inset-0" />
    </div>

    <div class="relative mx-auto max-w-6xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pb-28 sm:pt-32">
      <div class="flex justify-center">
        <UBadge color="primary" variant="soft" size="md" class="gap-1.5 px-3 py-1">
          <UIcon name="i-lucide-zap" class="size-3.5" />
          Useless Whatever Converter
        </UBadge>
      </div>

      <h1 class="mt-8 font-display text-4xl font-bold leading-[1.15] tracking-tight sm:text-6xl lg:text-7xl">
        {{ t('hero.title1') }} <span class="text-gradient">{{ t('hero.title2') }}</span><br class="hidden sm:block" >
        {{ t('hero.title3') }}
      </h1>

      <p class="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[var(--ui-text-muted)] sm:text-lg">
        {{ t('hero.subtitle') }}
      </p>

      <div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <UButton
          :label="t('hero.ctaConvert')"
          icon="i-lucide-wand-sparkles"
          color="primary"
          size="lg"
          to="#converter"
          class="w-full sm:w-auto"
        />
        <UButton
          :label="t('hero.ctaFormats')"
          icon="i-lucide-arrow-right"
          trailing
          variant="outline"
          color="neutral"
          size="lg"
          to="#formats"
          class="w-full sm:w-auto"
        />
      </div>

      <div class="mt-16 flex flex-col items-center justify-center gap-8 sm:flex-row sm:gap-14">
        <div v-for="(stat, i) in stats" :key="i" class="text-center">
          <div class="font-display text-2xl font-bold sm:text-3xl">
            <span class="text-gradient">{{ stat.value }}</span>
          </div>
          <div class="mt-1.5 text-sm text-[var(--ui-text-muted)]">{{ stat.label }}</div>
        </div>
      </div>
    </div>
  </section>
</template>
