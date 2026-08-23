<script setup lang="ts">
import { WIKI_ARTICLES } from '#shared/registry/wiki'

const { t } = useI18n()

useSiteSeo({
  title: computed(() => t('wiki.index.title')),
  description: computed(() => t('wiki.index.description'))
})
</script>

<template>
  <div class="relative min-h-screen px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
    <div class="mx-auto mb-10 max-w-5xl text-center">
      <UBadge color="secondary" variant="soft" size="md" class="gap-1.5 px-3 py-1">
        <UIcon name="i-lucide-book-open" class="size-3.5" />
        {{ t('wiki.index.badge') }}
      </UBadge>
      <h1 class="mt-6 font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {{ t('wiki.index.title1') }} <span class="text-gradient">{{ t('wiki.index.title2') }}</span>
      </h1>
      <p class="mx-auto mt-4 max-w-2xl text-[var(--ui-text-muted)]">
        {{ t('wiki.index.subtitle') }}
      </p>
    </div>

    <div class="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="article in WIKI_ARTICLES"
        :key="article.slug"
        :to="`/formats/${article.slug}`"
        class="group rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]/50 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--ui-border-accented)]"
      >
        <div class="flex items-center gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-lime-400/20 to-cyan-400/20">
            <UIcon :name="article.icon" class="size-5" />
          </div>
          <h2 class="font-display text-base font-semibold group-hover:text-primary">{{ article.name }}</h2>
        </div>
        <p class="mt-3 line-clamp-2 text-sm leading-relaxed text-[var(--ui-text-muted)]">
          {{ t(`wiki.${article.slug}.tagline`) }}
        </p>
        <span class="mt-3 inline-flex items-center gap-1 text-xs text-primary">
          {{ t('wiki.readMore') }}
          <UIcon name="i-lucide-arrow-right" class="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </NuxtLink>
    </div>
  </div>
</template>
