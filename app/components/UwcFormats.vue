<script setup lang="ts">
import { ALL_FORMATS, FORMAT_CATEGORIES } from '#shared/registry/formats'
import { WIKI_SLUGS } from '#shared/registry/wiki'

const { t } = useI18n()

const marqueeList = computed(() => ALL_FORMATS
  .filter((f, i, arr) => arr.findIndex((x) => x.name === f.name) === i)
  .map((f) => ({ ...f, name: f.nameKey ? t(f.nameKey) : f.name })))
const marqueeList2 = computed(() => [...marqueeList.value].reverse())

/** У формата есть wiki-статья? (имя формата → slug совпадают в нижнем регистре) */
function wikiLink(name: string): string | undefined {
  const slug = name.toLowerCase()
  return WIKI_SLUGS.has(slug) ? `/formats/${slug}` : undefined
}
</script>

<template>
  <section id="formats" class="scroll-mt-24 py-20 sm:py-28">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="flex justify-center">
        <UBadge color="secondary" variant="soft" size="md" class="gap-1.5 px-3 py-1">
          <UIcon name="i-lucide-files" class="size-3.5" />
          {{ t('formatsSection.badge') }}
        </UBadge>
      </div>
      <h2 class="mt-6 text-center font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {{ t('formatsSection.title1') }} <span class="text-gradient">{{ t('formatsSection.title2') }}</span>
      </h2>
      <p class="mx-auto mt-4 max-w-2xl text-center text-[var(--ui-text-muted)]">
        {{ t('formatsSection.subtitle') }}
      </p>
    </div>

    <!-- marquee ribbons -->
    <div class="fade-x marquee-hover-pause relative mt-12 space-y-3 overflow-hidden">
      <div class="animate-marquee flex w-max gap-2.5" style="--marquee-duration: 45s">
        <template v-for="n in 2" :key="n">
          <span
            v-for="f in marqueeList"
            :key="`${n}-${f.name}`"
            class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]/70 px-3 py-1.5 text-xs text-[var(--ui-text-toned)]"
          >
            <UIcon :name="f.icon" class="size-3.5" />
            {{ f.name }}
          </span>
        </template>
      </div>
      <div class="animate-marquee marquee-reverse flex w-max gap-2.5" style="--marquee-duration: 55s">
        <template v-for="n in 2" :key="n">
          <span
            v-for="f in marqueeList2"
            :key="`${n}-${f.name}`"
            class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]/70 px-3 py-1.5 text-xs text-[var(--ui-text-muted)]"
          >
            <UIcon :name="f.icon" class="size-3.5" />
            {{ f.name }}
          </span>
        </template>
      </div>
    </div>

    <!-- category cards -->
    <div class="mx-auto mt-12 grid max-w-6xl gap-5 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
      <div
        v-for="cat in FORMAT_CATEGORIES"
        :key="cat.id"
        class="group relative overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]/50 p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--ui-border-accented)]"
      >
        <div
          class="pointer-events-none absolute -right-12 -top-12 size-36 rounded-full bg-gradient-to-br from-lime-400/10 to-cyan-400/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
          aria-hidden="true"
        />
        <div class="flex items-center gap-3">
          <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-lime-400/20 to-cyan-400/20 text-lime-500 dark:text-lime-300">
            <UIcon :name="cat.icon" class="size-5" />
          </div>
          <h3 class="font-display text-base font-semibold">{{ t(`cats.${cat.id}.title`) }}</h3>
        </div>
        <p class="mt-3 text-sm leading-relaxed text-[var(--ui-text-muted)]">{{ t(`cats.${cat.id}.description`) }}</p>
        <div class="mt-4 flex flex-wrap gap-1.5">
          <component
            :is="wikiLink(f.name) ? 'NuxtLink' : 'span'"
            v-for="f in cat.formats"
            :key="f.name"
            :to="wikiLink(f.name)"
            class="inline-flex items-center gap-1 rounded-md border border-[var(--ui-border)] px-2 py-1 text-xs text-[var(--ui-text-toned)] transition-colors"
            :class="wikiLink(f.name) ? 'hover:border-primary hover:text-primary' : ''"
          >
            <UIcon :name="f.icon" class="size-3.5" />
            {{ f.nameKey ? t(f.nameKey) : f.name }}
          </component>
        </div>
      </div>
    </div>
  </section>
</template>
