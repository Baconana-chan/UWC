/**
 * GET /api/formats — список серверных конвертеров для UI (фаза 0).
 * С фазы 2 студия будет мержить этот список с клиентским реестром
 * (тяжёлые форматы уезжают на сервер, лёгкие остаются в браузере).
 */

import { SERVER_CONVERTERS } from '../utils/registry'

export default defineEventHandler(() => ({
  converters: SERVER_CONVERTERS.map(({ id, from, to, tier }) => ({ id, from, to, tier }))
}))
