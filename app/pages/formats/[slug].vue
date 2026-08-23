<script setup lang="ts">
import { getWikiArticle, WIKI_ARTICLES } from '#shared/registry/wiki'

const { t } = useI18n()
const route = useRoute()

const slug = computed(() => String(route.params.slug))
const article = computed(() => getWikiArticle(slug.value))

// неизвестный slug — 404 через штатную error-страницу
if (!article.value) {
  throw createError({ statusCode: 404, statusMessage: 'Wiki article not found', fatal: true })
}

const metaTitle = computed(() => t(`wiki.${slug.value}.meta.title`))
const metaDescription = computed(() => t(`wiki.${slug.value}.meta.description`))

useSiteSeo({
  title: metaTitle,
  description: metaDescription,
  type: 'article'
})

/** История формата: массив абзацев из i18n. */
const history = computed<string[]>(() => t(`wiki.${slug.value}.history`).split('\n').filter(Boolean))

/** «Как он работает»: массив абзацев. */
const how = computed<string[]>(() => t(`wiki.${slug.value}.how`).split('\n').filter(Boolean))

/** Соседние статьи для навигации «читать дальше». */
const neighbors = computed(() => {
  const i = WIKI_ARTICLES.findIndex((a) => a.slug === slug.value)
  return [WIKI_ARTICLES[(i + 1) % WIKI_ARTICLES.length], WIKI_ARTICLES[(i + 2) % WIKI_ARTICLES.length]]
})

/** Deep-link в студию с предвыбранной парой. */
function studioLink(pair: { from: string, to: string }) {
  return `/converter?from=${pair.from}&to=${pair.to}`
}
</script>

<template>
  <article v-if="article" class="relative min-h-screen px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
    <!-- фоновое свечение, как на всём сайте -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div class="absolute -top-32 left-1/2 h-96 w-[720px] -translate-x-1/2 rounded-full bg-violet-500/10 blur-[120px]" />
    </div>

    <div class="relative mx-auto max-w-3xl">
      <!-- заголовок -->
      <header>
        <NuxtLink to="/formats" class="inline-flex items-center gap-1 text-sm text-[var(--ui-text-muted)] transition-colors hover:text-primary">
          <UIcon name="i-lucide-arrow-left" class="size-4" />
          {{ t('wiki.backToIndex') }}
        </NuxtLink>

        <div class="mt-6 flex items-center gap-4">
          <div class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lime-400/20 to-cyan-400/20">
            <UIcon :name="article.icon" class="size-7" />
          </div>
          <div>
            <h1 class="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {{ t(`wiki.${slug}.title`) }}
            </h1>
            <p class="mt-1 text-[var(--ui-text-muted)]">{{ t(`wiki.${slug}.tagline`) }}</p>
          </div>
        </div>
      </header>

      <!-- история -->
      <section class="mt-12">
        <h2 class="flex items-center gap-2 font-display text-xl font-bold">
          <UIcon name="i-lucide-history" class="size-5 text-primary" />
          {{ t('wiki.sectionHistory') }}
        </h2>
        <p v-for="(p, i) in history" :key="i" class="mt-3 leading-relaxed text-[var(--ui-text-muted)]">{{ p }}</p>
      </section>

      <!-- как работает -->
      <section class="mt-10">
        <h2 class="flex items-center gap-2 font-display text-xl font-bold">
          <UIcon name="i-lucide-cog" class="size-5 text-primary" />
          {{ t('wiki.sectionHow') }}
        </h2>
        <p v-for="(p, i) in how" :key="i" class="mt-3 leading-relaxed text-[var(--ui-text-muted)]">{{ p }}</p>
      </section>

      <!-- реклама конвертера -->
      <section class="mt-12">
        <div class="glass rounded-3xl border border-[var(--ui-border)] p-6 sm:p-8">
          <div class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-lime-400 via-emerald-400 to-cyan-400 text-zinc-950 shadow-lg shadow-lime-500/25">
              <UIcon name="i-lucide-wand-sparkles" class="size-5" />
            </div>
            <h2 class="font-display text-lg font-bold">{{ t(`wiki.${slug}.cta.title`) }}</h2>
          </div>
          <p class="mt-3 text-sm leading-relaxed text-[var(--ui-text-muted)]">{{ t(`wiki.${slug}.cta.text`) }}</p>

          <div class="mt-5 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            <template v-if="article.pairs?.length">
              <UButton
                v-for="(pair, i) in article.pairs"
                :key="`${pair.from}-${pair.to}`"
                :to="studioLink(pair)"
                :label="t(`wiki.${slug}.cta.pairs.${pair.from}-${pair.to}`, { from: t(`formatNames.${pair.from}`) || pair.from, to: t(`formatNames.${pair.to}`) || pair.to })"
                :variant="i === 0 ? 'solid' : 'outline'"
                color="primary"
                size="md"
                trailing-icon="i-lucide-arrow-right"
              />
            </template>
            <UButton
              v-else
              to="/converter"
              :label="t(`wiki.${slug}.cta.openStudio`)"
              color="primary"
              size="md"
              trailing-icon="i-lucide-arrow-right"
            />
          </div>
        </div>
      </section>

      <!-- читать дальше -->
      <nav class="mt-12 grid gap-3 sm:grid-cols-2">
        <NuxtLink
          v-for="n in neighbors"
          :key="n.slug"
          :to="`/formats/${n.slug}`"
          class="group flex items-center gap-3 rounded-xl border border-[var(--ui-border)] p-4 transition-colors hover:border-[var(--ui-border-accented)]"
        >
          <UIcon :name="n.icon" class="size-5 shrink-0" />
          <div class="min-w-0">
            <p class="text-sm font-semibold group-hover:text-primary">{{ t(`wiki.${n.slug}.title`) }}</p>
            <p class="truncate text-xs text-[var(--ui-text-muted)]">{{ t(`wiki.${n.slug}.tagline`) }}</p>
          </div>
        </NuxtLink>
      </nav>
    </div>
  </article>
</template>
