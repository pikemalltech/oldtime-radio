// Anonymous live listener counts (the Yesterdial stats Worker). Everything here is optional: with no URL in
// stats-config.js, or if the connection fails, `window.otrStats.connected` stays false and the page simply
// doesn't show any counts.
//
// What is shared: a random id that lives only as long as this browser tab (sessionStorage), and the id of the
// station you are listening to. No cookies, no accounts, nothing personal.
(function () {
  const cfg = window.OTR_STATS || {};
  const listeners = new Set();
  const api = {
    enabled: !!cfg.url,
    connected: false,
    online: 0,                        // visitors with the page open
    counts: {},                       // station id -> people listening to it right now
    total() { return Object.values(api.counts).reduce((a, b) => a + b, 0); },
    onChange(fn) { listeners.add(fn); },
    setListening() {},                // replaced below when enabled
  };
  window.otrStats = api;
  if (!api.enabled) return;

  const notify = () => listeners.forEach((fn) => { try { fn(api); } catch (e) { console.error(e); } });

  // a random id for this tab
  let id;
  try { id = sessionStorage.getItem('otr.sid'); } catch { /* storage blocked */ }
  if (!id) {
    id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => (b % 36).toString(36)).join('');
    try { sessionStorage.setItem('otr.sid', id); } catch { /* storage blocked */ }
  }

  let ws = null, retries = 0, pingTimer = 0, reconnectTimer = 0, listenTimer = 0;
  let wantCh = null, sentCh = null, leaving = false;

  const send = (o) => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; };
  const push = (ch) => { if (ch !== sentCh && send({ t: 'tune', ch })) sentCh = ch; };

  function connect() {
    clearTimeout(reconnectTimer);
    try { ws = new WebSocket(cfg.url); } catch { schedule(); return; }
    ws.onopen = () => {
      retries = 0; sentCh = null;
      send({ t: 'hi', id });
      if (wantCh) push(wantCh);                                   // we were already listening: say so again
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 45000);
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }    // 'pong' and anything unexpected are ignored
      if (m && m.t === 'counts') {
        api.connected = true;
        api.online = Number(m.online) || 0;
        api.counts = Object.fromEntries(Object.entries(m.c || {}).filter(([k, v]) => /^[a-z0-9-]{1,24}$/.test(k) && Number.isFinite(v)));
        notify();
      }
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      const was = api.connected;
      api.connected = false; api.online = 0; api.counts = {};
      if (was) notify();
      if (!leaving) schedule();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
  }
  function schedule() {                                           // back off 1 s, 2 s, 4 s … up to 30 s, with some jitter
    const delay = Math.min(30000, 1000 * 2 ** retries++) * (0.7 + Math.random() * 0.6);
    reconnectTimer = setTimeout(connect, delay);
  }

  // Tell the server when someone is listening to a station. Stopping is reported straight away; starting only
  // after a few seconds on the station, so tuning past stations doesn't count as listening to them.
  api.setListening = (ch) => {
    wantCh = ch || null;
    clearTimeout(listenTimer);
    if (!wantCh) { push(null); return; }
    listenTimer = setTimeout(() => push(wantCh), 4000);
  };

  addEventListener('pagehide', () => { leaving = true; try { ws && ws.close(); } catch { /* ignore */ } });
  connect();
})();
