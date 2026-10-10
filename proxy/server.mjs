// Runs the FTC Events proxy as a plain Node server (Node 18+), for local
// development or self-hosting:
//   FTC_EVENTS_USERNAME=... FTC_EVENTS_TOKEN=... npm run proxy
import { createServer } from 'node:http'
import { createHandler } from './handler.mjs'

const port = Number(process.env.PORT ?? 8787)
const handler = createHandler({
  username: process.env.FTC_EVENTS_USERNAME,
  token: process.env.FTC_EVENTS_TOKEN,
  nexusKey: process.env.NEXUS_API_KEY,
  allowedOrigins: process.env.ALLOWED_ORIGINS || '*',
})

createServer(async (req, res) => {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const response = await handler(new Request(`http://localhost${req.url}`, { method: req.method, headers }))
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
}).listen(port, () => {
  console.log(`PulseDash FTC Events proxy on http://localhost:${port}`)
  if (!process.env.FTC_EVENTS_USERNAME || !process.env.FTC_EVENTS_TOKEN) {
    console.warn('FTC_EVENTS_USERNAME / FTC_EVENTS_TOKEN are not set: API requests will fail.')
  }
})
