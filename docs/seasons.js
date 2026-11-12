// Seasonal decor for the living room. The theme is picked from today's date (listener's local clock) and
// re-checked every few minutes, so the room changes by itself. To preview one, add ?theme=halloween to the URL.
//
//   winter · spring · summer · autumn          (meteorological seasons, northern hemisphere)
//   valentines · july4 · halloween · thanksgiving · christmas   (holiday windows, which win over the seasons)
//   Friday the 13th gets the halloween decor.
//
// This script runs in <head> so the right theme is set before the first paint. The CSS lives in seasons.css;
// the strings of lights, bunting and foliage along the top of the wall are drawn here as SVG tiles.
(function () {
  const THEMES = ['spring', 'summer', 'autumn', 'winter', 'valentines', 'july4', 'halloween', 'thanksgiving', 'christmas'];
  const DAY = 864e5;

  function nthWeekday(year, month, weekday, n) {                 // e.g. 4th Thursday of November
    const first = new Date(year, month, 1);
    return new Date(year, month, 1 + ((7 + weekday - first.getDay()) % 7) + (n - 1) * 7);
  }

  function pick(date) {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const md = (m + 1) * 100 + d;
    const today = new Date(y, m, d).getTime();
    if (date.getDay() === 5 && d === 13) return 'halloween';     // Friday the 13th
    if (md >= 1210 || md <= 101) return 'christmas';             // Dec 10 – Jan 1
    if (md >= 1018 && md <= 1101) return 'halloween';            // Oct 18 – Nov 1
    const thanksgiving = nthWeekday(y, 10, 4, 4).getTime();      // US: 4th Thursday of November
    if (today >= thanksgiving - 10 * DAY && md <= 1130) return 'thanksgiving';
    if (md >= 207 && md <= 215) return 'valentines';             // Feb 7 – 15
    if (md >= 628 && md <= 705) return 'july4';                  // Jun 28 – Jul 5
    if (m >= 2 && m <= 4) return 'spring';
    if (m >= 5 && m <= 7) return 'summer';
    if (m >= 8 && m <= 10) return 'autumn';
    return 'winter';
  }

  // ---- strings of lights / bunting / foliage, as SVG background tiles (160 x 64) ----
  const W = 160, H = 64, C = 46;                                 // tile size, control-point height of the sag
  const sag = (t) => 8 + 2 * (C - 8) * t * (1 - t);              // y of the swag at t (0..1)
  const url = (inner) => `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>${inner}</svg>`)}")`;
  const rope = (color, w) => `<path d='M0 8 Q${W / 2} ${C} ${W} 8' fill='none' stroke='${color}' stroke-width='${w}' stroke-linecap='round'/>`;
  const rnd = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

  function foliage(cfg) {
    const r = rnd(7), parts = [rope('#3b2a1a', 4)];
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = W * t, y = sag(t);
      const col = cfg.leaf[i % cfg.leaf.length], ang = (r() - 0.5) * 140;
      parts.push(`<ellipse cx='${x.toFixed(1)}' cy='${(y + 1).toFixed(1)}' rx='9' ry='3.6' fill='${col}' transform='rotate(${ang.toFixed(0)} ${x.toFixed(1)} ${(y + 1).toFixed(1)})'/>`);
    }
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9, x = W * t + (r() - 0.5) * 6, y = sag(t) + 4 + r() * 4;
      parts.push(`<circle cx='${x.toFixed(1)}' cy='${y.toFixed(1)}' r='${(2.8 + r() * 1.6).toFixed(1)}' fill='${cfg.dots[i % cfg.dots.length]}'/>`);
    }
    return url(parts.join(''));
  }

  function bunting(cfg) {
    const parts = [rope('#3b2a1a', 2.2)], n = 4;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = W * t, y = sag(t), col = cfg.colors[i % cfg.colors.length];
      if (cfg.shape === 'heart') {
        parts.push(`<path d='M0 -4 C-10 -16 -20 -2 0 15 C20 -2 10 -16 0 -4Z' transform='translate(${x.toFixed(1)} ${(y + 8).toFixed(1)}) scale(.95)' fill='${col}' stroke='rgba(0,0,0,.25)' stroke-width='.8'/>`);
      } else {
        parts.push(`<polygon points='${(x - 13).toFixed(1)},${(y - 1).toFixed(1)} ${(x + 13).toFixed(1)},${(y - 1).toFixed(1)} ${x.toFixed(1)},${(y + 30).toFixed(1)}' fill='${col}' stroke='rgba(0,0,0,.3)' stroke-width='.8'/>`);
      }
    }
    return url(parts.join(''));
  }

  // two images with alternating bulbs, so the strand can twinkle
  function lights(cfg) {
    const out = [[rope('#241a12', 1.6)], [rope('#241a12', 1.6)]], n = 10;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = W * t, y = sag(t) + 1, col = cfg.colors[i % cfg.colors.length];
      out[i % 2].push(`<rect x='${(x - 1.6).toFixed(1)}' y='${y.toFixed(1)}' width='3.2' height='4' fill='#241a12'/>`
        + `<circle cx='${x.toFixed(1)}' cy='${(y + 8).toFixed(1)}' r='9' fill='${col}' opacity='.28'/>`
        + `<ellipse cx='${x.toFixed(1)}' cy='${(y + 8).toFixed(1)}' rx='3.6' ry='4.8' fill='${col}'/>`
        + `<ellipse cx='${(x - 1).toFixed(1)}' cy='${(y + 6.5).toFixed(1)}' rx='1.1' ry='1.6' fill='#fff' opacity='.7'/>`);
      out[1 - (i % 2)].push(`<rect x='${(x - 1.6).toFixed(1)}' y='${y.toFixed(1)}' width='3.2' height='4' fill='#241a12'/>`
        + `<ellipse cx='${x.toFixed(1)}' cy='${(y + 8).toFixed(1)}' rx='3.6' ry='4.8' fill='${col}' opacity='.35'/>`);
    }
    return [url(out[0].join('')), url(out[1].join(''))];
  }

  const DECOR = {
    spring: { garland: ['foliage', { leaf: ['#5f9a52', '#7fb86a', '#4d8a45'], dots: ['#f6b8cc', '#fff4b8', '#ffffff', '#f09abb'] }] },
    summer: { lights: { colors: ['#ffe9a8', '#ffd98a', '#fff3c8'] } },
    autumn: { garland: ['foliage', { leaf: ['#d9641a', '#c0392b', '#e8a22e', '#8a4a14'], dots: ['#7a3a12', '#e8a22e'] }] },
    thanksgiving: { garland: ['foliage', { leaf: ['#d9641a', '#c0392b', '#e8a22e', '#8a4a14', '#b8861f'], dots: ['#b8481a', '#e8a22e', '#6b2a10'] }] },
    winter: { lights: { colors: ['#e8f4ff', '#cfe6ff', '#ffffff'] } },
    halloween: { garland: ['bunting', { colors: ['#f08a1c', '#1a1020', '#7a3fa0'], shape: 'flag' }], lights: { colors: ['#ff9a2a', '#ff7a1a'] } },
    christmas: { garland: ['foliage', { leaf: ['#1f6a3a', '#2e8a4c', '#17512c'], dots: ['#c4202e', '#ffffff', '#e6b422'] }], lights: { colors: ['#ff3b3b', '#ffd23a', '#3bd16f', '#3b9cff'] } },
    valentines: { garland: ['bunting', { colors: ['#e0305a', '#ff8fab', '#fff0f3', '#b3203f'], shape: 'heart' }], lights: { colors: ['#ff8fab', '#ffd0dc'] } },
    july4: { garland: ['bunting', { colors: ['#c8202f', '#ffffff', '#1f3f9a'], shape: 'flag' }] },
  };

  const root = document.documentElement;
  const forced = new URLSearchParams(location.search).get('theme');
  let current = null;

  function apply(theme) {
    if (theme === current) return;
    current = theme;
    const d = DECOR[theme] || {};
    root.dataset.theme = theme;
    const set = (k, v) => (v ? root.style.setProperty(k, v) : root.style.removeProperty(k));
    set('--garland-img', d.garland ? (d.garland[0] === 'foliage' ? foliage(d.garland[1]) : bunting(d.garland[1])) : null);
    const l = d.lights ? lights(d.lights) : [null, null];
    set('--lights-a', l[0]); set('--lights-b', l[1]);
    root.dataset.garland = d.garland ? '1' : '0';
    root.dataset.lights = d.lights ? '1' : '0';
    window.dispatchEvent(new CustomEvent('otr-theme', { detail: theme }));
  }

  function refresh() { apply(forced && THEMES.includes(forced) ? forced : pick(new Date())); }
  refresh();
  setInterval(refresh, 5 * 60 * 1000);                           // picks up midnight rollovers

  window.OTR_THEME = { THEMES, pick, set: apply, get: () => current };
})();
