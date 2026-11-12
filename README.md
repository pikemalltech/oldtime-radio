# The Hearthside Hour

A 1940s console radio, in a living room, that tunes into old-time radio stations streamed
straight from the [Internet Archive](https://archive.org/details/oldtimeradio).

**Just double-click `docs/index.html`** (or serve `docs/` with any static server).

## Using it

* **Power knob**: switch on (the tubes take a moment to warm up). Browsers need a click before they will play sound.
* **Tuning**: drag the big knob, scroll over the radio, press ← → (Shift for bigger steps), or click a station name on the dial.
  Between stations you hear static and a heterodyne whistle; the green "magic eye" narrows as you lock on.
* **Radio Guide** (the magazine on the sideboard, or press `G`): *Special Broadcasts* coming up, plus what is on now / next / later on every station.
* **Share** (🔗): copies a link such as `index.html#crime` that opens with the dial set to that station (the visitor
  still has to click Power, because browsers block autoplay). Station ids: `mystery sherlock scifi crime spies adventure western comedy sitcom variety playhouse history chills bedtime`.
  The address bar updates as you tune, so you can also just copy it. Links only work for other people once the site is hosted.
* **Sleep timer** (🌙, or `S`): cycles 15 → 30 → 45 → 60 → 90 min → off. Volume fades over the last 45 seconds, then the radio switches off.
* **Lean in** (🔍, or `Z`): zooms right up to the dial and knobs so the station names are as large as the screen allows; click again (or `Z`) to step back. Your choice is remembered.
* Keys: `Space` power · `↑ ↓` or `[ ]` next/previous station · `+ -` volume · `S` sleep · `Z` lean in · `G` guide · `Esc` close the guide.

## Seasonal decor

The room redecorates itself from the date on the listener's clock (checked every few minutes, so it changes at midnight too). Each theme
changes the wall colour, curtains, rug, armchairs and lampshade, the night scene outside the window, the strings of lights / bunting /
garland along the top of the wall, and the props on the sideboard.

| Theme | When | Outside the window | Props |
|---|---|---|---|
| Winter | Dec–Feb | snowfall, pine tree | cocoa mug, candle, icy fairy lights |
| Valentine's | Feb 7–15 | rising hearts | roses, heart box of chocolates, heart bunting, pink lights |
| Spring | Mar–May | blossom tree, drifting petals | tulips, potted plant, flower garland |
| Summer | Jun–Aug | sunset, fireflies | sunflowers, potted plant, patio lights |
| Fourth of July | Jun 28–Jul 5 | fireworks | flag, red-white-and-blue bunting |
| Autumn | Sep–Nov | harvest moon, falling leaves | pumpkins, candle, leaf garland and wreath |
| Halloween | Oct 18–Nov 1, and every Friday the 13th | bats, haunted hill | jack-o'-lantern, cobwebs, spider, bunting |
| Thanksgiving | 10 days before the 4th Thursday of November | autumn scene | pumpkins, candle, garland and wreath |
| Christmas | Dec 10–Jan 1 | snow, lit houses | tree, presents, wreath, garland, coloured lights |

Preview any theme by adding `?theme=` to the address, e.g. `index.html?theme=halloween` (themes: spring summer autumn winter valentines july4 halloween thanksgiving christmas).
Seasons follow the northern hemisphere and US holidays. Edit `pick()` in `docs/seasons.js` to change the dates; the palettes and props are in `docs/seasons.css`.

## Stations (14)

Mystery Theater 600 · **Baker Street Radio 676** · Rocket Radio 752 · Crime Beat 828 · Spies & Lawmen 904 · Adventure Hour 980 · Western Trail 1056 ·
Laugh Parade 1132 · Sitcom Row 1208 · Showtime Variety 1284 · Radio Playhouse 1360 · The Home Front 1436 · Chiller Hour 1512 · **Bedtime Stories 1588**

* **Baker Street Radio** shuffles the Basil Rathbone/Nigel Bruce, Tom Conway and John Stanley radio dramas, and weaves in
  *The Hound of the Baskervilles* (a LibriVox reading) as a serial: one chapter at a time, in order, between the dramas.
* **Bedtime Stories** plays fairy tales and fables at random (Grimm, Andersen, English fairy tales, Aesop, *Just So Stories*, Beatrix Potter)
  and reads *Winnie-the-Pooh*, *The Wind in the Willows* and *Alice in Wonderland* a chapter at a time, in order. Set the sleep timer.
  Book chapters show "(LibriVox)" instead of a year; LibriVox recordings are public domain, read by volunteers.

## How the "live radio" works

`docs/channels.json` (and `channels.js`, the same data as a script so the page works from `file://`) lists the episodes for each
station (item id, file name, duration). Each station is a loop:

```
position = (now − station.epoch) mod loopLength
```

so everyone hears the same programme at the same offset, with no server. Audio is never copied or re-hosted: the browser
streams `archive.org/download/<item>/<file>` directly.

## Scheduled specials

A special takes over one station during a window of the **listener's local time**, then the station drops back into its
normal loop. Being on that station at the switchover is seamless: the show changes right on the dot (and an episode that would run
over the start of a special is cut off, like a real station going to a scheduled broadcast).

| Special | When | Station |
|---|---|---|
| Friday the 13th Fright Night | every Friday the 13th, all day | Chiller Hour |
| Halloween Week of Horrors | Oct 25–31 | Chiller Hour, Mystery Theater |
| Christmas on the Radio | Dec 20–26 | Laugh Parade, Sitcom Row, Radio Playhouse, Mystery Theater, Western Trail |
| Fourth of July Celebration | Jul 1–4 | The Home Front |
| Veterans Day Salute | Nov 9–11 | The Home Front |
| A Sherlock Holmes Christmas | Dec 20–26 | Baker Street Radio |
| Christmas Bedtime Stories (*’Twas the Night Before Christmas*, then *A Christmas Carol* in five staves) | Dec 20–26 | Bedtime Stories |
| Baker Street Book Club: *The Hound of the Baskervilles*, a complete reading from chapter 1 | Fridays 8 pm–2 am | Baker Street Radio |
| Sunday Night Suspense | Sundays 8–11 pm | Mystery Theater |
| Sunday Night with Jack Benny | Sundays 7–9 pm | Laugh Parade |
| Saturday Night Roundup (Gunsmoke) | Saturdays 7–10 pm | Western Trail |
| Saturday Morning Serials | Saturdays 9 am–noon | Adventure Hour |

Themed ones (holidays, Halloween) pick episodes whose titles match a keyword filter.

## Editing stations and specials

Everything is configured at the top of `scripts/build-channels.mjs`:

* `SHOWS`: archive.org item id → display name. `OPTS`: per-item options (duration limits, `ordered` for books and serials, chapter `titles`, `take`).
* `CHANNELS`: station id, name, dial position (`kc`, keep ~75 apart), optional `count`, and which shows it carries (an array inside `sources` merges several items into one pool).
* `SPECIALS`: id, title, station, rule (`weekly`, `range` or `friday13`), optional `filter` regex, episode `count`, sources.

```bash
npm run build:data
# behind a proxy:  NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/path/to/ca.pem npm run build:data
```

The script fetches each item's file list, drops fragments and serialized chapters (<14 min), de-duplicates, cleans titles,
shuffles with a fixed seed and interleaves the shows so each station alternates like a real lineup. Re-running it changes
every loop, which re-syncs everyone.

## Finding more content

See the notes in the project chat; in short: the Old Time Radio Researchers "Singles" items on archive.org (237 series,
the source of most of this), other Internet Archive collections (Command Performance / G.I. Jive, big-band transcriptions,
the Great 78 Project, LibriVox), Library of Congress, and the Radio Gold Index as a reference for descriptions and air dates.
Always check each item's license.

## Notes

* Many OTRR files are licensed **CC BY-NC-ND**. The site only links and streams (no copies or edits), but keep it
  non-commercial and keep the per-programme "source" links. Check any series you add.
* Fonts (Limelight, Old Standard TT, Special Elite) load from Google Fonts and degrade gracefully to serif.

## Publishing (GitHub Pages)

The site is static; `docs/` is the whole thing. In the repository's Settings → Pages, set *Deploy from a branch*, branch `main`, folder `/docs`.
Any push to `main` then republishes it. Opening `docs/index.html` straight from disk also works.

## License

The code in this repository is released under the [MIT License](LICENSE).

The radio programmes and readings are **not** part of this repository and are not covered by that license. They are streamed
directly from the Internet Archive and remain under their own terms (many Old Time Radio Researchers files are CC BY-NC-ND,
LibriVox recordings are public domain). Keep the site non-commercial and keep the per-programme "source" links.
