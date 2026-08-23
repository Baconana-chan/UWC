<script setup lang="ts">
const { t } = useI18n()

useSiteSeo({
  title: computed(() => t('meta.titleConverter')),
  description: computed(() => t('meta.descriptionConverter'))
})
</script>

<template>
  <div class="px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
    <div class="mx-auto mb-10 max-w-5xl text-center">
      <UBadge color="primary" variant="soft" size="md" class="gap-1.5 px-3 py-1">
        <UIcon name="i-lucide-wand-sparkles" class="size-3.5" />
        {{ t('converterPage.badge') }}
      </UBadge>
      <h1 class="mt-6 font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {{ t('converterPage.title1') }} <span class="text-gradient">{{ t('converterPage.title2') }}</span>
      </h1>
      <p class="mx-auto mt-4 max-w-2xl text-[var(--ui-text-muted)]">
        {{ t('converterPage.subtitle') }}
      </p>
    </div>

    <UwcConvertStudio />
  </div>
</template>
