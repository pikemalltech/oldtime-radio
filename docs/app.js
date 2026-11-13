// Yesterdial: tune in to yesterday. A 1940s living-room radio that tunes into old-time radio
// stations streamed from the Internet Archive.
//
// How it works:
//  • channels.json (built by scripts/build-channels.mjs) lists episodes per station.
//  • Each station is a loop: position = (now - epoch) mod loopLength. Everyone who tunes
//    in hears the same show at the same offset — no server needed.
//  • The dial position `p` (0..1) maps to AM kilocycles. Near a station you hear the show;
//    between stations you hear synthesized static and a heterodyne whistle.

const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => x * x * (3 - 2 * x);
const root = document.documentElement;
const body = document.body;
const stage = $('#stage');
const player = $('#player');

// ---------------------------------------------------------------- constants
const KC_MIN = 540, KC_MAX = 1600;
const kcToP = (kc) => (kc - KC_MIN) / (KC_MAX - KC_MIN);
const pToKc = (p) => Math.round(KC_MIN + p * (KC_MAX - KC_MIN));
const DIAL_X0 = 28, DIAL_W = 484;               // scale margins inside the dial (rem)
const LOCK = 0.009;                              // |p - station| for a perfectly clear signal
const FADE = 0.027;                              // beyond this it is pure static
const STICKY = 0.020;                            // knob resistance near a station
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

// ---------------------------------------------------------------- state
const state = {
  channels: [], sp: [],
  on: false, p: 0, target: 0, vol: 0.7,
  warm: 0, dragging: false, speed: 0,
  selected: null,          // station index we are (about to be) playing
  loaded: null,            // { ch, idx } what the <audio> element holds
  tuned: null,             // station index with a clear signal
  errors: 0,
  specials: [], specialsByCh: {}, lean: false,
  sleepAt: 0, sleepMin: 0, deepLink: null,
};

const store = {
  get(k, d) { try { const v = localStorage.getItem('otr.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('otr.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------------------------------------------------------------- scheduling
// A station normally loops its lineup. A "special" (Sunday-night suspense, Halloween week,
// Friday the 13th…) takes over the station during a window of the listener's local time.
const DAY = 864e5;
const hm = (d, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime(); };

// [start, end) windows of a rule near `t`: from yesterday to well into the future
function windowsFor(rule, t) {
  const out = [], now = new Date(t);
  if (rule.type === 'weekly') {
    for (let k = -1; k <= 14; k++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
      if (!rule.days.includes(d.getDay())) continue;
      const s = hm(d, rule.from); let e = hm(d, rule.to); if (e <= s) e += DAY;
      out.push([s, e]);
    }
  } else if (rule.type === 'range') {
    const [m1, d1] = rule.from.split('-').map(Number), [m2, d2] = rule.to.split('-').map(Number);
    for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) out.push([new Date(y, m1 - 1, d1).getTime(), new Date(y, m2 - 1, d2 + 1).getTime()]);
  } else if (rule.type === 'friday13') {
    for (let k = -1; k <= 20; k++) {
      const d = new Date(now.getFullYear(), now.getMonth() + k, 13);
      if (d.getDay() === 5) out.push([d.getTime(), new Date(d.getFullYear(), d.getMonth(), 14).getTime()]);
    }
  }
  return out;
}
function specialAt(i, t) {
  for (const s of state.specialsByCh[i] || []) {
    const w = windowsFor(s.rule, t).find((w) => t >= w[0] && t < w[1]);
    if (w) return { s, w };
  }
  return null;
}
function nextSpecialStart(i, t) {
  let best = Infinity;
  for (const s of state.specialsByCh[i] || []) for (const w of windowsFor(s.rule, t)) if (w[0] > t && w[0] < best) best = w[0];
  return best;
}

function scheduleAt(i, t) {
  const ch = state.channels[i];
  const sp = specialAt(i, t);
  if (sp) {
    const { s, w } = sp;
    const pos = ((t - w[0]) / 1000) % s.total;
    let acc = 0;
    for (let k = 0; k < s.episodes.length; k++) {
      const e = s.episodes[k];
      if (pos < acc + e.d) {
        const off = pos - acc, start = t - off * 1000;
        return { idx: k, ep: e, offset: off, start, end: Math.min(start + e.d * 1000, w[1]), special: s };
      }
      acc += e.d;
    }
  }
  const limit = nextSpecialStart(i, t);             // a special may start before this episode would end
  const pos = ((((t - ch.epoch) / 1000) % ch.total) + ch.total) % ch.total;
  let acc = 0;
  for (let k = 0; k < ch.episodes.length; k++) {
    const e = ch.episodes[k];
    if (pos < acc + e.d) {
      const off = pos - acc, start = t - off * 1000;
      return { idx: k, ep: e, offset: off, start, end: Math.min(start + e.d * 1000, limit), special: null };
    }
    acc += e.d;
  }
  const e = ch.episodes[0];
  return { idx: 0, ep: e, offset: 0, start: t, end: t + e.d * 1000, special: null };
}
const nowPlaying = (i) => scheduleAt(i, Date.now());
const audioURL = (e) => `https://archive.org/download/${encodeURIComponent(e.i)}/${e.f.split('/').map(encodeURIComponent).join('/')}`;
const detailsURL = (e) => `https://archive.org/details/${encodeURIComponent(e.i)}`;
const fmtTime = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const epLine = (e) => e.t + (e.y ? ` (${e.y})` : e.n ? ` (${e.n})` : '');

// ---------------------------------------------------------------- layout
// Two views. "Room": the whole radio on its sideboard (the lower part of the sideboard tucks behind the
// control bar, so the radio can be as big as the screen allows). "Lean in": zoom right up to the dial and knobs.
const RADIO_TOP = 722;                         // rem from the sideboard's base to the top of the radio
function layout() {
  const vw = innerWidth, vh = innerHeight;
  const hudH = ($('#hud') && $('#hud').offsetHeight) || 54;
  const floorPx = hudH + 12;                                           // pixels kept clear at the bottom
  const sw = (vw * 0.97) / 740;                                        // width limit (radio is 700 wide)
  let s, base;
  if (state.lean) {
    const regionTop = 650, regionBottom = 300;                         // dial + knobs, in rem above the base
    s = clamp(Math.min((vh - floorPx - 16) / (regionTop - regionBottom), (vw * 0.98) / 590), 0.3, 3);   // fill the width with the dial
    base = floorPx + (vh - floorPx) / 2 - ((regionTop + regionBottom) / 2) * s;
  } else {
    s = clamp(Math.min((vh - floorPx - 14) / (RADIO_TOP - 68), sw), 0.2, 2.4);
    base = floorPx - 68 * s;                                           // show only the top 60rem of the sideboard
    const spare = vh - 14 - (base + RADIO_TOP * s);
    if (spare > 0) base += spare * (vw < vh ? 0.5 : 0.3);              // centre it a little when the screen is tall
  }
  root.style.setProperty('--base', base.toFixed(1) + 'px');
  root.style.setProperty('--hudh', hudH + 'px');
  root.style.setProperty('--s', s.toFixed(4));
  state.scale = s;
  stage.classList.toggle('narrow', vw / s < 1150);              // too little room beside the radio for the window and chairs
}
function setLean(on, animate = true) {
  state.lean = on;
  if (animate) { root.classList.add('zooming'); clearTimeout(setLean.t); setLean.t = setTimeout(() => root.classList.remove('zooming'), 900); }
  layout();
  $('#zoomBtn').setAttribute('aria-pressed', on);
  $('#zoomBtn').querySelector('span').textContent = on ? 'Step back' : 'Lean in';
  store.set('lean', on);
}
addEventListener('resize', layout);
addEventListener('load', layout);
layout();

// ---------------------------------------------------------------- hover tip for the dial's station names
// Shows the station's full name, dial position, a description, and what is on the air there right now.
// Mouse: hover. Keyboard: focus. Touch: a tap shows it for a few seconds while the tap tunes in.
const dialTip = $('#dialTip');
let tipTimer = 0, tipTick = 0, tipAuto = 0;
function fillTip(i) {
  const ch = state.channels[i], np = nowPlaying(i);
  const name = el('b', null, ch.name);
  const kc = el('span', 'kc', `${ch.kc} kc · “${ch.short}” on the dial`);
  const blurb = el('span', 'blurb', ch.blurb);
  const now = el('span', 'now'); now.append(el('em', null, 'On the air now'), document.createTextNode(`${np.ep.s}: ${epLine(np.ep)}`));
  const parts = [name, kc, blurb, now];
  if (np.special) parts.push(el('span', 'special', `★ ${np.special.title}`));
  parts.push(el('span', 'go', state.on && state.tuned === i ? '◉ You are tuned in' : 'Click to tune in'));
  dialTip.replaceChildren(...parts);
}
function placeTip(btn) {
  const r = btn.getBoundingClientRect(), w = dialTip.offsetWidth, h = dialTip.offsetHeight, m = 8;
  const left = clamp((r.left + r.right) / 2 - w / 2, m, innerWidth - w - m);
  const below = r.bottom + 10, above = r.top - h - 10;
  dialTip.style.left = left + 'px';
  dialTip.style.top = (below + h <= innerHeight - m ? below : Math.max(m, above)) + 'px';
}
function showTip(btn, how) {
  if (tourOpen()) return;
  clearTimeout(tipTimer); clearTimeout(tipAuto);
  tipTimer = setTimeout(() => {
    const i = +btn.dataset.i;
    fillTip(i); dialTip.hidden = false; placeTip(btn);
    requestAnimationFrame(() => dialTip.classList.add('show'));
    clearInterval(tipTick); tipTick = setInterval(() => { fillTip(i); placeTip(btn); }, 1000);   // keeps "on now" fresh
    if (how === 'touch') tipAuto = setTimeout(hideTip, 3500);
  }, how === 'touch' ? 0 : 150);
}
function hideTip() {
  clearTimeout(tipTimer); clearInterval(tipTick); clearTimeout(tipAuto);
  dialTip.classList.remove('show'); dialTip.hidden = true;
}
addEventListener('resize', hideTip);
addEventListener('scroll', hideTip, true);

// ---------------------------------------------------------------- dial construction
const dialEl = $('#dial'), scaleEl = $('#dialScale'), needle = $('#needle');
const stripA = $('#stripA'), stripB = $('#stripB');
const knobTune = $('#knobTune'), knobVol = $('#knobVol'), knobPower = $('#knobPower');
const dialX = (p) => DIAL_X0 + p * DIAL_W;

function buildDial() {
  scaleEl.replaceChildren();
  scaleEl.append(el('span', 'rule'), el('span', 'kc', 'KILOCYCLES'));
  for (let kc = 540; kc <= 1600; kc += 20) {
    const t = el('i', 'tick');
    const major = kc % 100 === 0, mid = kc % 60 === 0;
    t.style.left = dialX(kcToP(kc)) + 'rem';
    t.style.height = (major ? 14 : mid ? 9 : 5) + 'rem';
    scaleEl.append(t);
  }
  for (const kc of [600, 800, 1000, 1200, 1400]) {
    const n = el('span', 'num', String(kc / 100));
    n.style.left = dialX(kcToP(kc)) + 'rem';
    scaleEl.append(n);
  }
  state.channels.forEach((ch, i) => {
    const b = el('button', 'st', ch.short);
    b.style.left = dialX(state.sp[i]) + 'rem';
    b.style.top = [64, 94, 124][i % 3] + 'rem';          // three staggered rows keep the names big and apart
    b.setAttribute('aria-label', `Tune to ${ch.name}, ${ch.kc} kilocycles. ${ch.blurb}`);
    b.addEventListener('pointerenter', (e) => showTip(b, e.pointerType));
    b.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hideTip(); });   // touch: let the timer hide it
    b.addEventListener('focus', () => { if (b.matches(':focus-visible')) showTip(b, 'key'); });   // keyboard focus only; a tap also focuses
    b.addEventListener('blur', hideTip);
    b.dataset.i = i;
    b.addEventListener('click', () => goTo(i));
    scaleEl.append(b);
  });
}

// ---------------------------------------------------------------- audio effects (WebAudio)
// The programme itself plays through the <audio> element (cross-origin safe);
// static, whistle, hum and clicks are synthesized here.
let ctx = null, noiseBuf = null, noiseGain, whistleOsc, whistleGain, humGain;
function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const len = ctx.sampleRate * 3;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) {
    b = 0.55 * b + 0.45 * (Math.random() * 2 - 1);
    d[i] = b * 1.5 + (Math.random() < 0.0007 ? (Math.random() * 2 - 1) * 1.6 : 0);   // occasional crackle
  }
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 0.35;
  noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
  src.connect(bp); bp.connect(noiseGain); noiseGain.connect(ctx.destination); src.start();

  whistleOsc = ctx.createOscillator(); whistleOsc.type = 'sine'; whistleOsc.frequency.value = 800;
  whistleGain = ctx.createGain(); whistleGain.gain.value = 0;
  whistleOsc.connect(whistleGain); whistleGain.connect(ctx.destination); whistleOsc.start();

  humGain = ctx.createGain(); humGain.gain.value = 0;
  for (const f of [60, 120, 180]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = f === 60 ? 1 : 0.5 / (f / 60);
    o.connect(g); g.connect(humGain); o.start();
  }
  humGain.connect(ctx.destination);
}
function setGain(node, v) { if (ctx && node) node.gain.setTargetAtTime(v, ctx.currentTime, 0.04); }
function blip(level = 0.25, dur = 0.035, freq = 1500) {
  if (!ctx || !noiseBuf) return;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  const g = ctx.createGain(); g.gain.setValueAtTime(level * Math.pow(state.vol, 1.2) + 0.02, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0005, ctx.currentTime + dur);
  s.connect(f); f.connect(g); g.connect(ctx.destination);
  s.start(ctx.currentTime, Math.random() * 2); s.stop(ctx.currentTime + dur + 0.02);
}

// ---------------------------------------------------------------- signal model
function signalAt(p) {
  let best = 0, bd = 9;
  for (let i = 0; i < state.sp.length; i++) {
    const d = Math.abs(p - state.sp[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, d: bd, sig: smooth(clamp(1 - (bd - LOCK) / (FADE - LOCK), 0, 1)) };
}

// ---------------------------------------------------------------- programme playback
let selectTimer = 0, pauseTimer = 0, loadToken = 0;

function startChannel(i, skip = 0) {
  const token = ++loadToken;
  let np = nowPlaying(i);
  const remaining = (np.end - Date.now()) / 1000;
  const ch = state.channels[i];
  const list = np.special ? np.special.episodes : ch.episodes;
  if (skip) np = { ...np, idx: (np.idx + skip) % list.length, ep: list[(np.idx + skip) % list.length], offset: 0 };
  else if (remaining < 6) np = { ...scheduleAt(i, np.end + 200) };
  state.loaded = { ch: i, idx: np.idx, special: np.special ? np.special.id : null };
  player.src = audioURL(np.ep);
  const seek = () => {
    if (token !== loadToken) return;
    if (np.offset > 1) { try { player.currentTime = Math.min(np.offset, (player.duration || 1e9) - 2); } catch { /* ignore */ } }
  };
  if (player.readyState >= 1) seek(); else player.addEventListener('loadedmetadata', seek, { once: true });
  const pr = player.play();
  if (pr && pr.catch) pr.catch((err) => { if (err.name !== 'AbortError') setStatus('Tap the dial to start the sound'); });
  refreshInfo();
  updateMediaSession();
}

function stopProgramme() {
  loadToken++;
  state.loaded = null;
  player.pause();
  player.removeAttribute('src');
  player.load();
}

player.addEventListener('ended', () => { if (state.loaded && state.on) startChannel(state.loaded.ch); });
player.addEventListener('playing', () => { state.errors = 0; body.classList.add('playing'); });
player.addEventListener('pause', () => body.classList.remove('playing'));
player.addEventListener('error', () => {
  if (!state.loaded || !state.on || !player.getAttribute('src') || player.src.startsWith('data:')) return;
  state.errors++;
  if (state.errors > 4) { setStatus('This station is off the air right now'); return; }
  startChannel(state.loaded.ch, state.errors);      // skip a broken file
});

function syncSelection(immediate = false) {
  const sg = signalAt(state.p);
  const want = state.on && sg.sig > 0 ? sg.i : null;
  if (want === state.selected && !immediate) return;
  state.selected = want;
  clearTimeout(selectTimer); clearTimeout(pauseTimer);
  if (want === null) {
    pauseTimer = setTimeout(() => { if (state.selected === null) stopProgramme(); }, 350);
  } else if (!state.loaded || state.loaded.ch !== want || immediate) {
    selectTimer = setTimeout(() => { if (state.selected === want && state.on) startChannel(want); }, immediate ? 0 : 170);
  }
  refreshInfo();
}

// ---------------------------------------------------------------- UI text
const hName = $('#hName'), hNow = $('#hNow');
let statusOverride = '';
let lastInfoKey = '';
function setStatus(msg) { statusOverride = msg; lastInfoKey = ''; refreshInfo(); setTimeout(() => { if (statusOverride === msg) { statusOverride = ''; lastInfoKey = ''; refreshInfo(); } }, 5000); }

function refreshInfo() {
  const kc = pToKc(state.p);
  let a = '', b = '', name, now, link = null, key;
  if (!state.on) {
    name = 'Radio off';
    now = statusOverride || (state.deepLink != null ? `Shared with you: ${state.channels[state.deepLink].name}. Click POWER to listen` : 'Click the POWER knob to switch on');
    key = 'off|' + now;
  } else if (state.tuned !== null) {
    const ch = state.channels[state.tuned];
    const np = nowPlaying(state.tuned);
    const star = np.special ? '★ ' : '';
    a = star + np.ep.s; b = epLine(np.ep);
    name = `${ch.name} · ${ch.kc} kc` + (np.special ? ` · ★ ${np.special.title}` : '');
    now = statusOverride || `${np.ep.s} — ${epLine(np.ep)}`; link = np.ep;
    key = `t|${state.tuned}|${np.idx}|${np.special ? np.special.id : ''}|${now}`;
  } else {
    a = '· · ·'; b = 'tuning';
    name = `Tuning… ${kc} kc`; now = statusOverride || 'Between stations';
    key = 'u|' + now;
  }
  if (key !== lastInfoKey) {
    lastInfoKey = key;
    stripA.textContent = a; stripB.textContent = b;
    hName.textContent = name;
    hNow.replaceChildren(document.createTextNode(now));
    if (link && !statusOverride) {
      hNow.append(document.createTextNode(' · '));
      const lk = el('a', null, 'source');
      lk.href = detailsURL(link); lk.target = '_blank'; lk.rel = 'noopener';
      hNow.append(lk);
    }
    document.title = state.on && state.tuned !== null ? `${a.replace('★ ', '')} — Yesterdial` : 'Yesterdial: Tune In to Yesterday | Old-Time Radio';
    $('#powerBtn').setAttribute('aria-pressed', state.on);
    knobPower.setAttribute('aria-pressed', state.on);
  }
  stage.querySelectorAll('.st').forEach((b) => b.classList.toggle('lit', state.on && +b.dataset.i === state.tuned));
}
setInterval(() => {
  if (!state.channels.length) return;
  // a scheduled special starting or ending takes over the station right on the dot
  if (state.on && state.tuned !== null && state.loaded && state.loaded.ch === state.tuned) {
    const np = nowPlaying(state.tuned);
    if ((np.special ? np.special.id : null) !== state.loaded.special) startChannel(state.tuned);
  }
  refreshInfo();
  if (state.tuned !== null) updateMediaSession();
  if (state.sleepAt) {
    if (Date.now() >= state.sleepAt) { powerOff(); toast('Good night!'); } else updateSleepBtn();
  }
}, 1000);

function updateMediaSession() {
  if (!('mediaSession' in navigator) || state.tuned === null) return;
  const np = nowPlaying(state.tuned), ch = state.channels[state.tuned];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: np.ep.t, artist: np.ep.s, album: `${ch.name} · Yesterdial` });
  } catch { /* unsupported */ }
}
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', () => powerOn());
    navigator.mediaSession.setActionHandler('pause', () => powerOff());
    navigator.mediaSession.setActionHandler('nexttrack', () => stepStation(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => stepStation(-1));
  } catch { /* some handlers unsupported */ }
}

// ---------------------------------------------------------------- power / tuning actions
function powerOn() {
  if (state.on) return;
  state.on = true;
  body.classList.replace('off', 'on');
  ensureAudio();
  // unlock the <audio> element inside this user gesture (iOS/Safari)
  player.src = SILENT_WAV; const pr = player.play(); if (pr && pr.catch) pr.catch(() => {});
  blip(0.5, 0.09, 300);
  state.errors = 0; state.deepLink = null;
  syncSelection(true);
  refreshInfo();
  setTimeout(() => { if (state.on && !store.get('guideSeen', false)) body.classList.add('hint-guide'); }, 9000);
}
function powerOff() {
  if (!state.on) return;
  state.on = false;
  body.classList.replace('on', 'off');
  blip(0.4, 0.07, 400);
  clearTimeout(selectTimer);
  state.sleepAt = 0; state.sleepMin = 0; updateSleepBtn();
  state.selected = null; state.tuned = null;
  stopProgramme();
  refreshInfo();
}
const togglePower = () => (state.on ? powerOff() : powerOn());

function goTo(i) {
  state.target = state.sp[i];
  if (!state.on) powerOn();
  blip(0.2, 0.03, 900);
}
function stepStation(dir) {
  const n = state.sp.length, eps = 0.012;
  let j;
  if (dir > 0) { j = state.sp.findIndex((s) => s > state.target + eps); if (j < 0) j = 0; }
  else { j = -1; state.sp.forEach((s, k) => { if (s < state.target - eps) j = k; }); if (j < 0) j = n - 1; }
  goTo(j);
}
function nudge(dp) { state.target = clamp(state.target + dp, 0, 1); state.p = state.target; }
function release() {
  state.dragging = false;
  const sg = signalAt(state.p);
  if (sg.d < 0.03) state.target = state.sp[sg.i]; else state.target = state.p;
  store.set('p', state.target);
}

// ---------------------------------------------------------------- pointer / keyboard controls
function dragKnob(el, { filter, onStart, onDelta, onEnd }) {
  let last = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (filter && !filter(e))) return;
    el.setPointerCapture(e.pointerId);
    last = { x: e.clientX, y: e.clientY, moved: 0 };
    onStart && onStart(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (!last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last.x = e.clientX; last.y = e.clientY; last.moved += Math.abs(dx) + Math.abs(dy);
    onDelta(dx - dy, e);
  });
  const end = (e) => { if (!last) return; const moved = last.moved; last = null; onEnd && onEnd(moved, e); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// tuning knob
dragKnob(knobTune, {
  onStart() { ensureAudio(); state.dragging = true; },
  onDelta(d) {
    const sg = signalAt(state.p);
    let k = d / (DIAL_W * state.scale * 1.7);
    if (sg.d < STICKY) k *= 0.4 + 0.6 * (sg.d / STICKY);          // a little stickiness near a station
    state.p = clamp(state.p + k, 0, 1); state.target = state.p;
  },
  onEnd() { release(); },
});
knobTune.addEventListener('keydown', (e) => {
  const big = e.shiftKey ? 0.03 : 0.006;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { nudge(big); e.preventDefault(); release(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { nudge(-big); e.preventDefault(); release(); }
  else if (e.key === 'PageUp') { stepStation(1); e.preventDefault(); }
  else if (e.key === 'PageDown') { stepStation(-1); e.preventDefault(); }
});

// dial glass: click or drag the needle
dragKnob(dialEl, {
  filter: (e) => !e.target.closest('.st'),
  onStart(e) {
    ensureAudio(); state.dragging = true; moveNeedleTo(e);
  },
  onDelta(_d, e) { if (state.dragging) moveNeedleTo(e); },
  onEnd(moved, e) {
    if (!state.dragging) return;
    if (moved < 4) { /* a plain click */ }
    release();
  },
});
function moveNeedleTo(e) {
  const r = dialEl.getBoundingClientRect();
  const x = (e.clientX - r.left) / state.scale;
  state.p = clamp((x - DIAL_X0) / DIAL_W, 0, 1); state.target = state.p;
}

// wheel over the radio
$('#radio').addEventListener('wheel', (e) => {
  e.preventDefault();
  ensureAudio();
  const sg = signalAt(state.p);
  let k = (e.deltaY + e.deltaX) * 0.00055;
  if (sg.d < STICKY) k *= 0.45;
  state.dragging = true; state.p = clamp(state.p + k, 0, 1); state.target = state.p;
  clearTimeout(wheelTimer); wheelTimer = setTimeout(release, 220);
}, { passive: false });
let wheelTimer = 0;

// volume
function setVolume(v, fromKnob = false) {
  state.vol = clamp(v, 0, 1);
  $('#volRange').value = Math.round(state.vol * 100);
  knobVol.setAttribute('aria-valuenow', Math.round(state.vol * 100));
  knobVol.style.setProperty('--rot', (-135 + state.vol * 270) + 'deg');
  store.set('vol', state.vol);
}
dragKnob(knobVol, { onStart() { ensureAudio(); }, onDelta(d) { setVolume(state.vol + d / 160, true); } });
knobVol.addEventListener('keydown', (e) => {
  if (['ArrowRight', 'ArrowUp'].includes(e.key)) { setVolume(state.vol + 0.05); e.preventDefault(); }
  if (['ArrowLeft', 'ArrowDown'].includes(e.key)) { setVolume(state.vol - 0.05); e.preventDefault(); }
});
$('#volRange').addEventListener('input', (e) => setVolume(e.target.value / 100));

// power
knobPower.addEventListener('click', togglePower);
$('#powerBtn').addEventListener('click', togglePower);
$('#prevBtn').addEventListener('click', () => stepStation(-1));
$('#nextBtn').addEventListener('click', () => stepStation(1));

// global keys
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (tourOpen()) return;
  const inGuide = !$('#guide').hidden;
  if (e.key === 'Escape' && inGuide) { closeGuide(); return; }
  if (inGuide) return;
  if (e.target.closest && e.target.closest('input,textarea,select,[role=slider]')) return;
  const onButton = e.target.closest && e.target.closest('button,a,[role=button]');
  if ((e.key === ' ' || e.key === 'Enter') && !onButton) { togglePower(); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { ensureAudio(); nudge(e.shiftKey ? 0.03 : 0.006); release(); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { ensureAudio(); nudge(e.shiftKey ? -0.03 : -0.006); release(); e.preventDefault(); }
  else if (e.key === 'ArrowUp' || e.key === ']') { stepStation(1); e.preventDefault(); }
  else if (e.key === 'ArrowDown' || e.key === '[') { stepStation(-1); e.preventDefault(); }
  else if (e.key === '+' || e.key === '=') setVolume(state.vol + 0.05);
  else if (e.key === '-') setVolume(state.vol - 0.05);
  else if (e.key.toLowerCase() === 'g') openGuide();
  else if (e.key.toLowerCase() === 'h' || e.key === '?') openTour(0);
  else if (e.key.toLowerCase() === 's') cycleSleep();
  else if (e.key.toLowerCase() === 'z') setLean(!state.lean);
});

// ---------------------------------------------------------------- toast, share links, sleep timer
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

const stationFromHash = () => {
  const id = decodeURIComponent(location.hash.replace(/^#/, '')).toLowerCase();
  return id ? state.channels.findIndex((c) => c.id === id) : -1;
};
async function shareStation() {
  const i = state.tuned !== null ? state.tuned : signalAt(state.p).i;
  const ch = state.channels[i];
  const url = location.href.split('#')[0] + '#' + ch.id;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: `${ch.name} · Yesterdial`, text: `Tune in to ${ch.name} (${ch.kc} kc)`, url });
      return;
    }
  } catch (err) { if (err.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast(`Link to ${ch.name} copied`); }
  catch { window.prompt(`Copy this link to share ${ch.name}:`, url); }
}
addEventListener('hashchange', () => { const i = stationFromHash(); if (i >= 0 && i !== state.tuned) goTo(i); });

const SLEEP_STEPS = [0, 15, 30, 45, 60, 90];
function updateSleepBtn() {
  const b = $('#sleepBtn'), label = b.querySelector('span');
  if (state.sleepAt) {
    const m = Math.max(1, Math.ceil((state.sleepAt - Date.now()) / 60000));
    label.textContent = `${m} min`; b.setAttribute('aria-pressed', 'true');
    b.title = `Radio switches off in about ${m} minute${m === 1 ? '' : 's'}. Click to change.`;
  } else {
    label.textContent = 'Sleep'; b.setAttribute('aria-pressed', 'false'); b.title = 'Sleep timer';
  }
}
function setSleep(min) {
  state.sleepMin = min; state.sleepAt = min ? Date.now() + min * 60000 : 0;
  updateSleepBtn();
  toast(min ? `Sleep timer set: the radio switches off in ${min} minutes` : 'Sleep timer off');
}
function cycleSleep() {
  if (!state.on) { toast('Switch the radio on first, then set the sleep timer'); return; }
  setSleep(SLEEP_STEPS[(SLEEP_STEPS.indexOf(state.sleepMin) + 1) % SLEEP_STEPS.length]);
}
$('#sleepBtn').addEventListener('click', cycleSleep);
$('#shareBtn').addEventListener('click', shareStation);
$('#zoomBtn').addEventListener('click', () => setLean(!state.lean));
$('#hStation').addEventListener('click', openGuide);                       // tap the station name for the full station list

// ---------------------------------------------------------------- the Program Guide
const guideEl = $('#guide'), rowsEl = $('#guideRows');
let guideTimer = 0, lastFocus = null;

function slot(cls, np, withSource) {
  const s = el('div', 'slot ' + cls);
  const t = cls === 'now' ? `ON NOW · since ${fmtTime.format(np.start)}` : fmtTime.format(np.start);
  s.append(el('span', 't', t), el('span', 'show', np.ep.s), el('span', 'ep', epLine(np.ep)));
  if (cls === 'now') {
    const pr = el('span', 'prog'); const b = el('b');
    b.style.width = clamp(((Date.now() - np.start) / (np.end - np.start)) * 100, 0, 100) + '%';
    pr.append(b); s.append(pr);
  }
  if (withSource) {
    const a = el('a', 'src', 'source ↗'); a.href = detailsURL(np.ep); a.target = '_blank'; a.rel = 'noopener';
    a.addEventListener('click', (e) => e.stopPropagation());
    s.append(a);
  }
  return s;
}

const fmtDay = new Intl.DateTimeFormat([], { weekday: 'short', month: 'short', day: 'numeric' });
function whenText(w, active) {
  const [a, b] = w;
  if (active) return `ON NOW · until ${b - a >= 23 * 36e5 ? fmtDay.format(b - 1) : fmtTime.format(b)}`;
  if (b - a >= 23 * 36e5) {
    const sameDay = new Date(a).toDateString() === new Date(b - 1).toDateString();
    return sameDay ? `${fmtDay.format(a)} · all day` : `${fmtDay.format(a)} – ${fmtDay.format(b - 1)}`;
  }
  return `${fmtDay.format(a)} · ${fmtTime.format(a)} – ${fmtTime.format(b)}`;
}
function upcomingSpecials(now) {
  const groups = new Map();
  for (const s of state.specials) {
    const w = windowsFor(s.rule, now).filter((w) => w[1] > now).sort((x, y) => x[0] - y[0])[0];
    if (!w) continue;
    const key = s.title + '|' + w[0];
    if (!groups.has(key)) groups.set(key, { title: s.title, blurb: s.blurb, w, active: w[0] <= now, ch: [] });
    groups.get(key).ch.push(state.channels.findIndex((c) => c.id === s.channel));
  }
  return [...groups.values()].sort((a, b) => (b.active - a.active) || (a.w[0] - b.w[0])).slice(0, 6);
}
function renderSpecials() {
  const box = $('#guideSpecials');
  const list = upcomingSpecials(Date.now());
  box.hidden = !list.length;
  box.replaceChildren(el('h3', null, '★ Special Broadcasts'));
  const grid = el('div', 'spgrid');
  for (const g of list) {
    const d = el('div', 'sp' + (g.active ? ' on' : ''));
    d.setAttribute('role', 'button'); d.tabIndex = 0;
    const names = g.ch.map((i) => state.channels[i].name);
    d.append(el('b', null, g.title), el('span', 'when', whenText(g.w, g.active)), el('span', 'where', names.join(' · ')), el('span', 'blurb', g.blurb));
    d.setAttribute('aria-label', `${g.title}, ${whenText(g.w, g.active)}, on ${names.join(', ')}. Tune in.`);
    const go = () => { closeGuide(); setTimeout(() => goTo(g.ch[0]), 120); };
    d.addEventListener('click', go);
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    grid.append(d);
  }
  box.append(grid);
}

// What a station carries, worked out from its own lineup so it can never go stale: the most-played shows, and the years covered.
// Shows are separated by "·" because some titles contain commas ("Have Gun, Will Travel").
function describeChannel(ch) {
  const counts = new Map();
  let y0 = 9999, y1 = 0;
  for (const e of ch.episodes) {
    counts.set(e.s, (counts.get(e.s) || 0) + 1);
    if (e.y) { y0 = Math.min(y0, e.y); y1 = Math.max(y1, e.y); }
  }
  const shows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const top = shows.slice(0, 5), more = shows.length - top.length;
  return {
    featuring: 'Featuring ' + top.join(' · ') + (more > 0 ? ` · and ${more} more` : ''),
    era: y1 ? `Recorded ${y1 > y0 ? `${y0}–${y1}` : y0}` : '',
  };
}

function renderGuide() {
  renderSpecials();
  $('#guideClock').textContent = new Date().toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  rowsEl.replaceChildren();
  state.channels.forEach((ch, i) => {
    const row = el('div', 'row' + (state.on && state.tuned === i ? ' tuned' : ''));
    row.setAttribute('role', 'button'); row.tabIndex = 0;
    row.setAttribute('aria-label', `Tune to ${ch.name}`);
    const st = el('div', 'station');
    st.append(el('b', null, ch.name), el('i', null, `${ch.kc} kc`), el('span', 'desc', ch.blurb));
    const dc = describeChannel(ch);
    st.append(el('span', 'feat', dc.featuring));
    if (dc.era) st.append(el('span', 'era', dc.era));
    if (state.on && state.tuned === i) st.append(el('span', 'tunedtag', '◉ TUNED IN'));
    const n0 = nowPlaying(i), n1 = scheduleAt(i, n0.end + 500), n2 = scheduleAt(i, n1.end + 500);
    if (n0.special) st.append(el('span', 'spec', '★ ' + n0.special.title));
    row.append(st, slot('now', n0, true), slot('next', n1), slot('later', n2));
    const go = () => { closeGuide(); setTimeout(() => goTo(i), 120); };
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    rowsEl.append(row);
  });
}
function openGuide() {
  if (!state.channels.length) return;
  lastFocus = document.activeElement;
  renderGuide();
  guideEl.hidden = false;
  body.classList.remove('hint-guide'); store.set('guideSeen', true);
  $('#guideClose').focus();
  clearInterval(guideTimer); guideTimer = setInterval(renderGuide, 20000);
}
function closeGuide() {
  guideEl.hidden = true; clearInterval(guideTimer);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
$('#magazine').addEventListener('click', openGuide);
$('#guideBtn').addEventListener('click', openGuide);
$('#guideClose').addEventListener('click', closeGuide);
guideEl.addEventListener('click', (e) => { if (e.target === guideEl) closeGuide(); });

// ---------------------------------------------------------------- the first-visit tour
// Shown once (remembered in localStorage). The Help button or the H key replays it; ?tour=1 forces it, ?tour=0 suppresses it.
const TOUR = [
  { title: 'Welcome to Yesterdial', list: true, text: () => `Yesterdial is a 1940s radio with <b>${numberWord(state.channels.length).toLowerCase()} stations</b> of old-time radio on the air right now:`, after: 'Here is a 30-second tour of the radio.', next: 'Show me around', skip: 'Skip' },
  { target: ['#knobPower'], title: 'Switch it on', text: 'Click the <b>POWER</b> knob. The tubes need a moment to warm up. (Browsers stay silent until you click something, so the sound starts with this click.)' },
  { target: ['#dial', '#knobTune'], title: 'Tune in', text: 'Click a <b>station name</b> on the dial, or drag the big <b>TUNING</b> knob (or scroll over the radio). <b>Hover over a station name</b> for a description and what is on now. When the red needle sits on a station and the green eye narrows, you are locked on. Between stations you will hear static. <kbd>←</kbd> <kbd>→</kbd> fine-tune; <kbd>↑</kbd> <kbd>↓</kbd> jump a station.' },
  { target: ['#magazine'], title: 'Read the Program Guide', text: 'Click the <b>magazine</b> to see what is on <b>now, next and later</b> on every station, plus special broadcasts like Sunday Night Suspense, Friday the 13th and Christmas week.' },
  { target: ['#hud'], title: 'A few more things', text: 'Use ◀ ▶ to change station, 🌙 for a <b>sleep timer</b>, 🔗 to <b>share</b> a station, and 🔍 to <b>lean in</b> for a closer look at the dial. Tap the station name for the full list. The room redecorates itself with the seasons.' },
  { title: 'That’s all there is to it', text: 'Every station follows the clock, so everyone listening hears the same show at the same moment, just like real radio. The help button <b>❓</b> brings this tour back any time.', next: 'Switch on the radio', back: 'Back', skip: 'Just look around', last: true },
];
const tourEl = $('#tour'), tourCard = $('#tourCard'), tourRing = $('#tourRing');
let tourStep = 0, tourFocus = null;
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const numberWord = (n) => NUMBER_WORDS[n] || String(n);
const tourOpen = () => !tourEl.hidden;

function tourRect(sels) {
  let r = null;
  for (const s of sels || []) {
    const el = $(s); if (!el) continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    r = r ? { l: Math.min(r.l, b.left), t: Math.min(r.t, b.top), r: Math.max(r.r, b.right), b: Math.max(r.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
  }
  return r && r.b > 0 && r.t < innerHeight && r.r > 0 && r.l < innerWidth ? r : null;
}

function renderTour() {
  const step = TOUR[tourStep], last = tourStep === TOUR.length - 1;
  $('#tourStep').textContent = tourStep === 0 || last ? 'Yesterdial · tune in to yesterday' : `Step ${tourStep} of ${TOUR.length - 2}`;
  $('#tourTitle').textContent = step.title;
  $('#tourText').innerHTML = typeof step.text === 'function' ? step.text() : step.text;   // our own constant strings only
  const list = $('#tourList'), after = $('#tourAfter');
  list.hidden = !step.list;
  if (step.list) {                                           // every station, by its proper name, straight from the station data
    list.replaceChildren(...state.channels.map((ch) => { const li = el('li', null, ch.name); li.append(el('small', null, `${ch.short} · ${ch.kc} kc`)); return li; }));
  }
  after.hidden = !step.after; after.textContent = step.after || '';
  tourCard.classList.toggle('wide', !!step.list);
  $('#tourDots').replaceChildren(...TOUR.map((_, i) => el('i', i === tourStep ? 'on' : '')));
  $('#tourNext').textContent = step.next || 'Next';
  $('#tourSkip').textContent = step.skip || 'Skip tour';
  $('#tourBack').hidden = tourStep === 0;
  positionTour();
}

function positionTour() {
  if (!tourOpen()) return;
  const step = TOUR[tourStep], vw = innerWidth, vh = innerHeight, m = 12, pad = step.target && step.target[0] === '#hud' ? 6 : 12;
  const rect = tourRect(step.target);
  tourEl.classList.toggle('centered', !rect);
  const cw = tourCard.offsetWidth, ch = tourCard.offsetHeight;
  let left, top;
  if (rect) {
    Object.assign(tourRing.style, { left: rect.l - pad + 'px', top: rect.t - pad + 'px', width: rect.r - rect.l + pad * 2 + 'px', height: rect.b - rect.t + pad * 2 + 'px' });
    left = clamp((rect.l + rect.r) / 2 - cw / 2, m, vw - cw - m);
    const below = rect.b + pad + 16, above = rect.t - pad - 16 - ch;
    top = below + ch <= vh - m ? below : above >= m ? above : clamp(vh - ch - m, m, vh);   // otherwise tuck it against the bottom
  } else {
    left = (vw - cw) / 2; top = Math.max(m, (vh - ch) / 2);
  }
  tourCard.style.left = left + 'px'; tourCard.style.top = top + 'px';
}

function openTour(from = 0) {
  hideTip();
  tourFocus = document.activeElement; tourStep = from;
  if (!$('#guide').hidden) closeGuide();
  tourEl.hidden = false;
  tourCard.style.left = '50%'; tourCard.style.top = '40%';
  renderTour();
  $('#tourNext').focus();
}
function closeTour(powerOnAfter = false) {
  tourEl.hidden = true;
  store.set('welcomed', true);
  if (powerOnAfter) powerOn();
  else if (tourFocus && tourFocus.focus) tourFocus.focus();
}
function tourGo(delta) {
  const n = tourStep + delta;
  if (n < 0) return;
  if (n >= TOUR.length) { closeTour(true); return; }
  tourStep = n; renderTour();
}
$('#tourNext').addEventListener('click', () => tourGo(1));
$('#tourBack').addEventListener('click', () => tourGo(-1));
$('#tourSkip').addEventListener('click', () => closeTour(false));
$('#helpBtn').addEventListener('click', () => openTour(0));
addEventListener('resize', positionTour);
addEventListener('keydown', (e) => {                          // capture phase: the tour owns the keyboard while it is open
  if (!tourOpen()) return;
  if (e.key === 'Escape') { closeTour(false); }
  else if (e.key === 'ArrowRight') { tourGo(1); }
  else if (e.key === 'ArrowLeft') { tourGo(-1); }
  else if (e.key === 'Tab') {
    const f = [...tourCard.querySelectorAll('button')].filter((b) => !b.hidden);
    const i = f.indexOf(document.activeElement);
    const nx = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
    f[nx].focus();
  } else if (e.key === 'Enter' || e.key === ' ') return;     // let the focused button handle it
  else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) { /* swallow stray shortcuts */ }
  else return;
  e.preventDefault(); e.stopPropagation();
}, true);

// ---------------------------------------------------------------- animation loop
const eyeShadow = $('#eyeShadow');
function eyePath(w) {
  const R = 26, a1 = ((90 - w) * Math.PI) / 180, a2 = ((90 + w) * Math.PI) / 180;
  return `M0 0 L${(R * Math.cos(a1)).toFixed(2)} ${(R * Math.sin(a1)).toFixed(2)} A${R} ${R} 0 0 1 ${(R * Math.cos(a2)).toFixed(2)} ${(R * Math.sin(a2)).toFixed(2)} Z`;
}
let lastT = performance.now(), prevP = 0, lastLit = -1, lastKc = -1, lastEye = -1;

function frame(t) {
  const dt = Math.min(0.1, Math.max(0.001, (t - lastT) / 1000)); lastT = t;

  // glide toward the target (clicks, keyboard, station buttons)
  if (!state.dragging && state.p !== state.target) {
    state.p += (state.target - state.p) * (1 - Math.exp(-dt * 6.5));
    if (Math.abs(state.target - state.p) < 2e-4) state.p = state.target;
  }
  const v = Math.abs(state.p - prevP) / dt; prevP = state.p;
  state.speed += (v - state.speed) * (1 - Math.exp(-dt * 10));

  // tube warm-up
  const goal = state.on ? 1 : 0;
  state.warm = clamp(state.warm + clamp(goal - state.warm, state.on ? -dt / 0.4 : -dt / 0.35, dt / 1.7), 0, 1);
  if (Math.abs(state.warm - lastLit) > 0.003) { lastLit = state.warm; root.style.setProperty('--lit', state.warm.toFixed(3)); }

  // signal → sound
  const sg = signalAt(state.p);
  const sig = state.on ? sg.sig : 0;
  const tuned = state.on && sg.d <= LOCK * 1.4 ? sg.i : null;
  if (tuned !== state.tuned) { state.tuned = tuned; refreshInfo(); if (tuned !== null) { blip(0.25, 0.04, 700); updateMediaSession(); try { history.replaceState(null, '', '#' + state.channels[tuned].id); } catch { /* file:// or sandbox */ } } }
  syncSelection();

  const fade = state.sleepAt ? clamp((state.sleepAt - Date.now()) / 45000, 0, 1) : 1;   // slow fade-out before the timer ends
  const master = Math.pow(state.vol, 1.6) * state.warm * fade;
  player.volume = clamp(master * sig, 0, 1);
  if (ctx) {
    const staticLevel = master * ((1 - sig) * 0.5 + 0.02 * sig) * (0.75 + Math.random() * 0.25);
    setGain(noiseGain, state.on ? staticLevel : 0);
    setGain(humGain, state.on ? master * 0.012 : 0);
    const whistle = state.on && sig < 0.98 && sg.d < FADE * 1.6 ? clamp(state.speed * 4, 0, 1) * 0.05 * master : 0;
    setGain(whistleGain, whistle);
    whistleOsc.frequency.setTargetAtTime(160 + sg.d * 36000, ctx.currentTime, 0.03);
  }

  // visuals
  needle.style.transform = `translateX(${dialX(state.p).toFixed(2)}rem)`;
  knobTune.style.setProperty('--rot', (state.p * 860).toFixed(1) + 'deg');
  const kc = pToKc(state.p);
  if (kc !== lastKc) { lastKc = kc; knobTune.setAttribute('aria-valuenow', kc); if (state.on && state.tuned === null) refreshInfo(); }
  const w = 74 - 70 * sig * (0.96 + 0.04 * Math.sin(t / 90));
  if (Math.abs(w - lastEye) > 0.3) { lastEye = w; eyeShadow.setAttribute('d', eyePath(w)); }

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    // channels.js (a script tag) works even when index.html is opened straight from disk;
    // channels.json is the fallback when it is missing.
    let data = window.OTR_CHANNELS;
    if (!data) {
      const res = await fetch('channels.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
    }
    state.channels = data.channels.map((c) => ({ ...c, total: c.episodes.reduce((n, e) => n + e.d, 0) }));
    state.specials = (data.specials || []).map((s) => ({ ...s, total: s.episodes.reduce((n, e) => n + e.d, 0) }));
    state.specialsByCh = {};
    for (const s of state.specials) {
      const i = state.channels.findIndex((c) => c.id === s.channel);
      if (i >= 0) (state.specialsByCh[i] = state.specialsByCh[i] || []).push(s);   // JSON order = priority
    }
  } catch (err) {
    hName.textContent = 'No stations found';
    hNow.textContent = 'Run “npm run build:data” to build channels.json';
    console.error(err);
    return;
  }
  state.sp = state.channels.map((c) => kcToP(c.kc));
  state.p = state.target = clamp(store.get('p', state.sp[0]), 0, 1);
  const linked = stationFromHash();                       // e.g. index.html#crime
  if (linked >= 0) { state.p = state.target = state.sp[linked]; state.deepLink = linked; }
  prevP = state.p;
  buildDial();
  setVolume(store.get('vol', 0.7));
  if (store.get('lean', false)) setLean(true, false);
  refreshInfo();
  requestAnimationFrame(frame);
  const tourParam = new URLSearchParams(location.search).get('tour');
  if (tourParam === '1' || (tourParam !== '0' && !store.get('welcomed', false))) setTimeout(() => openTour(0), 800);
  window.__otr = { state, openTour, goTo, powerOn, powerOff, nowPlaying, scheduleAt, signalAt, windowsFor, cycleSleep };   // handy for debugging in the console
}
boot();
