# Yesterdial stats Worker

A tiny [Cloudflare Worker](https://developers.cloudflare.com/workers/) with one
[Durable Object](https://developers.cloudflare.com/durable-objects/) that gives the radio:

* **live listener counts**: how many people are tuned in to each station right now (shown in the Program Guide, the dial tips, the control bar and a corner chip);
* **simple visit stats** for you: visits per day, tune-ins and hours listened per station, peak listeners, on a private dashboard.

It is anonymous. No cookies, no accounts, no IP addresses stored. The page sends a random ID that lives only as long as the browser tab,
plus the station someone is listening to. The server keeps counts, not people. Everything is optional: if the Worker is down or not set up,
the radio works exactly the same and simply shows no counts.

## Deploy it

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and [Node.js](https://nodejs.org) 20 or newer.

```bash
cd stats-worker
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

The deploy prints the Worker's address, like `https://yesterdial-stats.YOUR-SUBDOMAIN.workers.dev` (on a first deploy Cloudflare asks you to pick the
`YOUR-SUBDOMAIN` part). Then pick a private key for your dashboard (a long random passphrase; wrangler asks you to type it):

```bash
npx wrangler secret put ADMIN_KEY
```

Finally point the page at it: edit `docs/stats-config.js` and set

```js
window.OTR_STATS = window.OTR_STATS || { url: 'wss://yesterdial-stats.YOUR-SUBDOMAIN.workers.dev/ws' };
```

then commit and push. Reload https://yesterdial.com and a "● N listening" chip appears in the corner.

## Yesterdial's deployment

Deployed as `yesterdial-stats` on Cloudflare, at `https://yesterdial-stats.round-butterfly-e9c6.workers.dev` (the WebSocket is `/ws`). `docs/stats-config.js` points the page at it.
To redeploy after a change: `npx wrangler deploy` (it needs a Cloudflare API token with *Account → Workers Scripts → Edit*).

## Your dashboard

`https://yesterdial-stats.YOUR-SUBDOMAIN.workers.dev/dashboard?key=YOUR_ADMIN_KEY` (bookmark it; `/stats.json?key=...` gives the same numbers as JSON).
Days are UTC. A *visit* is one browser tab opening the radio; a *tune-in* is someone staying on a station for a few seconds.

## What it exposes

* `GET /ws`: the WebSocket the page uses. Only the pages in `ALLOWED_ORIGINS` (in `wrangler.toml`) can connect.
* `GET /counts`: the current counts as JSON (public, nothing personal).
* `GET /dashboard`, `GET /stats.json`: need the `ADMIN_KEY`.

## Try it on your own computer

```bash
cp .dev.vars.example .dev.vars
npx wrangler dev
```

`wrangler dev` runs the real Worker locally on `http://localhost:8787`. To point a local copy of the page at it, set
`window.OTR_STATS = { url: 'ws://localhost:8787/ws' }` before the page's scripts run (the page only reads `OTR_STATS` if it is already set).

## Limits

On Cloudflare's free plan this comfortably covers a hobby site. Usage shows in the Cloudflare dashboard. If a limit is ever reached the counts simply stop
updating; nothing else on the site is affected.
