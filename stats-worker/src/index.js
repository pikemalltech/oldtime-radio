// Yesterdial stats: anonymous live listener counts per station, plus simple daily visit stats.
//
//   GET /ws                     WebSocket used by the radio page (origin-checked)
//   GET /counts                 current counts as JSON (public, no personal data)
//   GET /dashboard?key=...      a small private dashboard for the owner (needs the ADMIN_KEY secret)
//   GET /stats.json?key=...     the same numbers as JSON
//
// Privacy: no cookies, no accounts, no IP addresses stored. The page sends a random id that lives
// only as long as the browser tab (sessionStorage); the server keeps counts, not people.

import { DurableObject } from 'cloudflare:workers';

const CHANNEL_RE = /^[a-z0-9-]{1,24}$/;      // a station id, e.g. "shadow"
const ID_RE = /^[A-Za-z0-9]{8,32}$/;         // random per-tab id
const MAX_MESSAGE = 256;                     // bytes: our messages are tiny
const MESSAGES_PER_MINUTE = 40;
const BROADCAST_DELAY_MS = 750;              // counts are pushed to everyone at most about once a second
const KEEP_DAYS = 400;
const DAY = 864e5;

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

// ---------------------------------------------------------------- the Worker (routing, origin check, auth)
function allowedOrigin(origin, env) {
  if (!origin) return false;                                           // browsers always send one on WebSocket
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
}

async function keyOk(request, env) {
  if (!env.ADMIN_KEY) return false;
  const url = new URL(request.url);
  const given = url.searchParams.get('key') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(env.ADMIN_KEY))]);
  return crypto.subtle.timingSafeEqual(a, b);                          // compare digests: constant time, equal length
}

const cors = (request, env) => {
  const origin = request.headers.get('Origin');
  return allowedOrigin(origin, env) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stub = env.STATS.getByName('main');                           // one object holds the whole site's counts

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket connection', { status: 426 });
      if (!allowedOrigin(request.headers.get('Origin'), env)) return new Response('Forbidden', { status: 403 });
      return stub.fetch(request);
    }
    if (url.pathname === '/counts') {
      return Response.json(await stub.getCounts(), { headers: { 'Cache-Control': 'no-store', ...cors(request, env) } });
    }
    if (url.pathname === '/stats.json' || url.pathname === '/dashboard') {
      if (!env.ADMIN_KEY) return new Response('Not found', { status: 404 });
      if (!(await keyOk(request, env))) return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
      const report = await stub.getReport();
      if (url.pathname === '/stats.json') return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
      return new Response(renderDashboard(report), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    return new Response('Yesterdial stats: nothing to see here.', { status: 404 });
  },
};

// ---------------------------------------------------------------- the Durable Object (one instance holds everything)
export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS seen (day TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (day, id))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, peak INTEGER NOT NULL DEFAULT 0)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS listens (day TEXT NOT NULL, ch TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, secs INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, ch))`);
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));   // keep-alives don't wake the object
  }

  // RPC methods (called by the Worker above)
  async getCounts() { return this.counts(); }
  async getReport() { return this.report(); }

  // The only HTTP request the object receives: the WebSocket upgrade
  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: null, ch: null, since: 0, w: Date.now(), n: 0 });
    server.send(JSON.stringify({ t: 'counts', ...this.counts() }));
    await this.scheduleBroadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- messages from the page: {t:"hi", id} when it loads, {t:"tune", ch} when someone starts or stops listening to a station
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    const a = ws.deserializeAttachment() || {};
    const now = Date.now();
    if (now - (a.w || 0) > 60000) { a.w = now; a.n = 0; }
    if (++a.n > MESSAGES_PER_MINUTE) { ws.close(1008, 'slow down'); return; }
    let m;
    try { m = JSON.parse(message); } catch { return; }

    if (m.t === 'hi' && ID_RE.test(m.id || '') && !a.id) {
      a.id = m.id;
      this.sql.exec(`INSERT OR IGNORE INTO seen (day, id) VALUES (?, ?)`, today(), a.id);   // one row per tab per day = a visit
    } else if (m.t === 'tune' && a.id && (m.ch === null || CHANNEL_RE.test(m.ch || ''))) {
      this.endListen(a);
      a.ch = m.ch; a.since = m.ch ? now : 0;
      if (m.ch) this.sql.exec(`INSERT INTO listens (day, ch, n) VALUES (?, ?, 1) ON CONFLICT (day, ch) DO UPDATE SET n = n + 1`, today(), m.ch);
    }
    ws.serializeAttachment(a);
    await this.scheduleBroadcast();
  }

  async webSocketClose(ws) { this.finish(ws); await this.scheduleBroadcast(); try { ws.close(); } catch { /* already closed */ } }
  async webSocketError(ws) { this.finish(ws); await this.scheduleBroadcast(); }
  finish(ws) { const a = ws.deserializeAttachment(); if (a) { this.endListen(a); a.ch = null; try { ws.serializeAttachment(a); } catch { /* socket gone */ } } }

  // add the time spent on the station someone just left to that station's total
  endListen(a) {
    if (!a.ch || !a.since) return;
    const secs = Math.min(6 * 3600, Math.max(0, Math.round((Date.now() - a.since) / 1000)));
    if (secs) this.sql.exec(`INSERT INTO listens (day, ch, secs) VALUES (?, ?, ?) ON CONFLICT (day, ch) DO UPDATE SET secs = secs + excluded.secs`, today(), a.ch, secs);
  }

  counts() {
    const c = {};
    let online = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || !a.id) continue;
      online++;
      if (a.ch) c[a.ch] = (c[a.ch] || 0) + 1;
    }
    return { online, c };
  }

  // push the counts to everyone, at most about once a second however busy it gets
  async scheduleBroadcast() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + BROADCAST_DELAY_MS);
  }
  async alarm() {
    const snapshot = this.counts();
    const listening = Object.values(snapshot.c).reduce((x, y) => x + y, 0);
    this.sql.exec(`INSERT INTO daily (day, peak) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET peak = MAX(peak, excluded.peak)`, today(), listening);
    const message = JSON.stringify({ t: 'counts', ...snapshot });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(message); } catch { /* closing */ } }
    if ((await this.ctx.storage.get('pruned')) !== today()) {                       // tidy old rows once a day
      const cutoff = daysAgo(KEEP_DAYS);
      this.sql.exec(`DELETE FROM seen WHERE day < ?`, cutoff);
      this.sql.exec(`DELETE FROM daily WHERE day < ?`, cutoff);
      this.sql.exec(`DELETE FROM listens WHERE day < ?`, cutoff);
      await this.ctx.storage.put('pruned', today());
    }
  }

  report() {
    const now = this.counts();
    const since = daysAgo(29);
    const visits = Object.fromEntries(this.sql.exec(`SELECT day, COUNT(*) AS v FROM seen WHERE day >= ? GROUP BY day`, since).toArray().map((r) => [r.day, r.v]));
    const peaks = Object.fromEntries(this.sql.exec(`SELECT day, peak FROM daily WHERE day >= ?`, since).toArray().map((r) => [r.day, r.peak]));
    const listens = Object.fromEntries(this.sql.exec(`SELECT day, SUM(n) AS n FROM listens WHERE day >= ? GROUP BY day`, since).toArray().map((r) => [r.day, r.n]));
    const last30 = [];
    for (let i = 29; i >= 0; i--) { const d = daysAgo(i); last30.push({ day: d, visits: visits[d] || 0, listens: listens[d] || 0, peak: peaks[d] || 0 }); }
    const byChannel = this.sql.exec(`SELECT ch, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS listens30, SUM(CASE WHEN day >= ? THEN secs ELSE 0 END) AS secs30, SUM(n) AS listensAll, SUM(secs) AS secsAll FROM listens GROUP BY ch ORDER BY listens30 DESC, listensAll DESC`, since, since).toArray()
      .map((r) => ({ ch: r.ch, listens30: r.listens30, hours30: +(r.secs30 / 3600).toFixed(1), listensAll: r.listensAll, hoursAll: +(r.secsAll / 3600).toFixed(1) }));
    const allVisits = this.sql.exec(`SELECT COUNT(*) AS n FROM seen`).one().n;
    const allDays = this.sql.exec(`SELECT COUNT(DISTINCT day) AS n FROM seen`).one().n;
    return { generated: new Date().toISOString(), timezone: 'UTC', now: { online: now.online, listening: Object.values(now.c).reduce((x, y) => x + y, 0), byChannel: now.c },
      today: last30[last30.length - 1], last30, byChannel, totals: { visits: allVisits, daysTracked: allDays } };
  }
}

// ---------------------------------------------------------------- the owner's dashboard
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderDashboard(r) {
  const max = Math.max(1, ...r.last30.map((d) => d.visits));
  const rows = r.last30.slice().reverse().map((d) => `<tr><td>${esc(d.day)}</td><td class="n">${d.visits}</td><td class="bar"><i style="width:${Math.round((d.visits / max) * 100)}%"></i></td><td class="n">${d.listens}</td><td class="n">${d.peak}</td></tr>`).join('');
  const ch = r.byChannel.map((c) => `<tr><td>${esc(c.ch)}</td><td class="n">${c.listens30}</td><td class="n">${c.hours30}</td><td class="n">${c.listensAll}</td><td class="n">${c.hoursAll}</td></tr>`).join('') || '<tr><td colspan="5">No listens recorded yet.</td></tr>';
  const live = Object.entries(r.now.byChannel).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ') || 'nobody yet';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Yesterdial stats</title>
<style>body{margin:0;padding:24px;background:#1a110b;color:#efe3c5;font:16px/1.4 Georgia,serif}h1{margin:0 0 4px;font-size:28px;color:#f4c870}h2{margin:28px 0 8px;font-size:15px;letter-spacing:.1em;text-transform:uppercase;color:#d8a23c}
.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:#26180e;border:1px solid #5a4020;border-radius:8px;padding:12px 16px;min-width:130px}.card b{display:block;font-size:30px;color:#fff2d6}.card span{font-size:13px;opacity:.75}
table{border-collapse:collapse;width:100%;max-width:760px}th,td{padding:5px 10px;border-bottom:1px solid #3a2a18;text-align:left}th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#d8a23c}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}td.bar{width:34%}td.bar i{display:block;height:10px;background:#a82a2a;border-radius:2px}small{opacity:.7}</style></head><body>
<h1>Yesterdial stats</h1><small>Anonymous counts only. Days are UTC. Generated ${esc(r.generated)}.</small>
<h2>Right now</h2><div class="cards"><div class="card"><b>${r.now.listening}</b><span>listening</span></div><div class="card"><b>${r.now.online}</b><span>visitors here</span></div></div><p>${live}</p>
<h2>Today</h2><div class="cards"><div class="card"><b>${r.today.visits}</b><span>visits</span></div><div class="card"><b>${r.today.listens}</b><span>tune-ins</span></div><div class="card"><b>${r.today.peak}</b><span>peak listening at once</span></div><div class="card"><b>${r.totals.visits}</b><span>visits, all time (${r.totals.daysTracked} days)</span></div></div>
<h2>By station</h2><table><tr><th>Station</th><th class="n">Tune-ins (30 d)</th><th class="n">Hours (30 d)</th><th class="n">Tune-ins (all)</th><th class="n">Hours (all)</th></tr>${ch}</table>
<h2>Last 30 days</h2><table><tr><th>Day</th><th class="n">Visits</th><th></th><th class="n">Tune-ins</th><th class="n">Peak</th></tr>${rows}</table>
<p><small>A visit is one browser tab opening the radio. A tune-in is someone staying on a station for a few seconds.</small></p></body></html>`;
}
