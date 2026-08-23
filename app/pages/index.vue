<script setup lang="ts">
const { t } = useI18n()

useSiteSeo({
  title: computed(() => t('meta.title')),
  description: computed(() => t('meta.description')),
  bareTitle: true
})

// Structured data для поисковиков: что это за приложение
const config = useRuntimeConfig()
const jsonLd = computed(() => ({
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'UWC — Useless Whatever Converter',
  url: config.public.siteUrl,
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any (web browser)',
  browserRequirements: 'Requires JavaScript',
  description: t('meta.description'),
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD'
  },
  featureList: [
    'Text transformations (70+ converters)',
    'Data formats: JSON, YAML, TOML, XML, CSV two-way conversion',
    'Image conversion incl. HEIC and AVIF',
    'Audio conversion without ffmpeg',
    'QR code generation and scanning',
    'Archive extraction: ZIP, TAR, TAR.GZ, GZIP, Brotli'
  ]
}))

useHead({
  script: [{ type: 'application/ld+json', innerHTML: JSON.stringify(jsonLd.value) }]
})
</script>

<template>
  <div>
    <UwcHero />
    <UwcConvertStudio />
    <UwcFormats />
    <UwcFeatures />
  </div>
</template>
