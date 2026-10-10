// Cloudflare Worker entry point. Set the secrets with:
//   npx wrangler secret put FTC_EVENTS_USERNAME
//   npx wrangler secret put FTC_EVENTS_TOKEN
import { createHandler } from './handler.mjs'

let handler

export default {
  async fetch(request, env) {
    handler ??= createHandler({
      username: env.FTC_EVENTS_USERNAME,
      token: env.FTC_EVENTS_TOKEN,
      allowedOrigins: env.ALLOWED_ORIGINS || '*',
    })
    return handler(request)
  },
}
