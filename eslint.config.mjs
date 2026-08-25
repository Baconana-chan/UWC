// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // Вендоренный код lzma-js (см. шапку файла) не должен соответствовать стилю проекта.
  {
    files: ['shared/lzmaCore.js'],
    rules: {
      'import/no-mutable-exports': 'off',
      'no-redeclare': 'off'
    }
  }
)
