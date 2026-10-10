# FTC Events API proxy

The PulseDash display reads FTCScout directly from the browser. The official
[FTC Events API](https://ftc-events.firstinspires.org/services/API) is faster
(new results show up within seconds instead of about a minute) and is the
source of official rankings and alliance selections, but it needs a private
key and doesn't allow browser requests. This proxy holds the key and forwards
read-only requests.

The display works without it: it falls back to FTCScout for everything.

What it does:

- Forwards `GET /v2.0/{season}/{events|teams|schedule|rankings|alliances|scores|matches|awards}/...` only, with a fixed set of query parameters.
- Adds the API key on the server. The key never reaches the browser.
- Caches each response for 15 seconds, so a whole event full of pit screens costs one upstream request per endpoint every 15 s.
- Only answers sites listed in `ALLOWED_ORIGINS`.

## 1. Get an API key

Register for a free key at <https://ftc-events.firstinspires.org/services/API/register>.
You receive a username and an authorization token.

## 2a. Deploy to Cloudflare Workers (free tier is plenty)

```sh
cd proxy
npx wrangler login
npx wrangler secret put FTC_EVENTS_USERNAME
npx wrangler secret put FTC_EVENTS_TOKEN
npx wrangler deploy
```

Edit `ALLOWED_ORIGINS` in `wrangler.toml` if the display is hosted somewhere
other than `https://bigbossg13.github.io`. Wrangler prints the worker URL,
e.g. `https://pulsedash-ftc-events-proxy.<you>.workers.dev`.

## 2b. Or run it with Node

```sh
FTC_EVENTS_USERNAME=... FTC_EVENTS_TOKEN=... npm run proxy   # http://localhost:8787
```

`PORT` and `ALLOWED_ORIGINS` are optional.

## 3. Point the display at it

- For everyone using your build: set the repository variable
  `FTC_EVENTS_PROXY_URL` (Settings → Secrets and variables → Actions →
  Variables). The deploy workflow passes it to the build as
  `NEXT_PUBLIC_FTC_EVENTS_PROXY`. Locally, put
  `NEXT_PUBLIC_FTC_EVENTS_PROXY=http://localhost:8787` in `.env.local`.
- For one screen: open the display's **Settings → Data** and paste the URL.

## Optional: FTC Nexus

The proxy can also hold an [FTC Nexus API key](https://ftc.nexus/en/api), so
nobody has to enter one on each screen. It forwards only
`/nexus/v1/events`, `/nexus/v1/event/{key}` and its `/alliances` and `/pits`:

```sh
npx wrangler secret put NEXUS_API_KEY        # Cloudflare
NEXUS_API_KEY=... npm run proxy              # Node
```

Check it with `curl https://<your-proxy>/health`, which reports whether the
credentials are configured.
