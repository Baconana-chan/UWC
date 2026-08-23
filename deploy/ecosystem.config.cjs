// PM2 ecosystem for UWC on a VPS
// Run: pm2 start deploy/ecosystem.config.cjs && pm2 save
// Logs: pm2 logs uwc
//
// The app lives in the user's home directory — no /opt, no permission juggling.
module.exports = {
  apps: [
    {
      name: 'uwc',
      // build first: bun install && bun run build
      script: '.output/server/index.mjs',
      cwd: '/home/debian/uwc', // repo clone location (~/uwc)

      instances: 1, // sharp manages its own threads; multiple instances unneeded
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        NUXT_PUBLIC_SITE_URL: 'https://uwc.rsh.pw',
        // server conversion limits (see nuxt.config.ts runtimeConfig)
        NUXT_MAX_INPUT_MB: 50,
        NUXT_CONVERT_TIMEOUT_MS: 15000
      },

      out_file: '/home/debian/logs/uwc-out.log',
      error_file: '/home/debian/logs/uwc-error.log',
      merge_logs: true,
      time: true
    }
  ]
}
