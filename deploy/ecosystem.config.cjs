// PM2 ecosystem для UWC на VPS
// Запуск: pm2 start ecosystem.config.cjs && pm2 save
// Логи:   pm2 logs uwc
module.exports = {
  apps: [
    {
      name: 'uwc',
      // сборка делается заранее: bun install && bun run build
      script: '.output/server/index.mjs',
      cwd: '/opt/uwc', // путь к проекту на VPS

      instances: 1, // sharp внутри сам управляет потоками; несколько инстансов не нужны
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        NUXT_PUBLIC_SITE_URL: 'https://uwc.rsh.pw',
        // лимиты серверной конвертации (см. nuxt.config.ts runtimeConfig)
        NUXT_MAX_INPUT_MB: 50,
        NUXT_CONVERT_TIMEOUT_MS: 15000
      },

      out_file: '/var/log/uwc/out.log',
      error_file: '/var/log/uwc/error.log',
      merge_logs: true,
      time: true
    }
  ]
}
