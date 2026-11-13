#!/usr/bin/env node
// Builds docs/channels.json (+ channels.js) from Internet Archive "series" items.
//
// Usage:  node scripts/build-channels.mjs
// (behind an HTTP proxy: NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/path/ca.pem node scripts/build-channels.mjs)
//
// Every source is an archive.org item identifier that holds many MP3 episodes
// (the Old Time Radio Researchers "..._Singles" items are ideal: one item, hundreds
// of correctly-timed files). The site never stores audio; it only stores the
// item id + file name and streams straight from archive.org.
//
// To add a station:  add its series to SHOWS (item id -> show name) and list the ids in CHANNELS.
// To add a special:  add an entry to SPECIALS (see the rule types below).

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'channels.json');
const EPISODES_PER_CHANNEL = 36;       // ~18 hours of programming before the loop repeats
const MIN_SECONDS = 14 * 60;           // skip fragments, promos, single "acts"
const MAX_SECONDS = 62 * 60;

// ---------- the shows (archive.org item id -> display name) ----------
// The Shadow, 1937-1954: 200+ episodes, marked Public Domain on archive.org (uploaded by AcousticMonster).
const SHADOW = 'the-shadow-radio-show-1937-1954-old-time-radio-all-available-episodes';
const SHOWS = {
  OTRR_Suspense_Singles: 'Suspense',
  OTRR_Inner_Sanctum_Mysteries_Singles: 'Inner Sanctum Mysteries',
  OTRR_Whistler_Singles: 'The Whistler',
  OTRR_Mysterious_Traveler_Singles: 'The Mysterious Traveler',
  [SHADOW]: 'The Shadow',
  OTRR_X_Minus_One_Singles: 'X Minus One',
  OTRR_Dimension_X_Singles: 'Dimension X',
  OTRR_Dark_Fantasy_Singles: 'Dark Fantasy',
  OTRR_Dragnet_Singles: 'Dragnet',
  OTRR_YoursTrulyJohnnyDollar_Singles: 'Yours Truly, Johnny Dollar',
  OTRR_Philip_Marlowe_Singles: 'The Adventures of Philip Marlowe',
  OTRR_Sam_Spade_Singles: 'The Adventures of Sam Spade',
  OTRR_Richard_Diamond_Private_Detective_Singles: 'Richard Diamond, Private Detective',
  OTRR_Counterspy_Singles: 'Counterspy',
  OTRR_Man_Called_X_Singles: 'The Man Called X',
  Otrr_Dangerous_Assignment_Singles: 'Dangerous Assignment',
  OTRR_This_Is_Your_FBI_Singles: 'This Is Your FBI',
  OTRR_Mr_District_Attorney_Singles: 'Mr. District Attorney',
  OTRR_Cloak_and_Dagger_Singles: 'Cloak and Dagger',
  OTRR_Challenge_of_the_Yukon_Singles: 'Challenge of the Yukon',
  OTRR_Space_Patrol_Singles: 'Space Patrol',
  OTRR_Ranger_Bill_Singles: 'Ranger Bill',
  OTRR_High_Adventure_Singles: 'High Adventure',
  OTRR_Gunsmoke_Singles: 'Gunsmoke',
  OTRR_LoneRanger_Singles: 'The Lone Ranger',
  OTRR_The_Six_Shooter_Singles: 'The Six Shooter',
  OTRR_Fort_Laramie_Singles: 'Fort Laramie',
  'OTRR_Jack_Benny_Singles_1949-1950': 'The Jack Benny Program',
  Otrr_The_Great_Gildersleeve_Singles: 'The Great Gildersleeve',
  OTRR_Harris_Faye_Singles: 'The Phil Harris–Alice Faye Show',
  OTRR_Our_Miss_Brooks_Singles: 'Our Miss Brooks',
  OTRR_My_Friend_Irma_Singles: 'My Friend Irma',
  OTRR_Duffys_Tavern_Singles: "Duffy's Tavern",
  OTRR_Life_with_Luigi_Singles: 'Life with Luigi',
  OTRR_Father_Knows_Best_Singles: 'Father Knows Best',
  OTRR_Abbott_Costello_Singles: 'Abbott and Costello',
  OTRR_Railroad_Hour_Singles: 'The Railroad Hour',
  OTRR_Danny_Kaye_Singles: 'The Danny Kaye Show',
  OTRR_Alka_Seltzer_Time_Singles: 'Alka-Seltzer Time',
  OTRR_Mel_Blanc_Singles: 'The Mel Blanc Show',
  OTRR_Shell_Chateau_Singles: 'Shell Chateau',
  OTRR_Victor_Borge_Collection_Singles: 'Victor Borge',
  OTRR_Day_in_the_Life_of_Dennis_Day_Singles: 'A Day in the Life of Dennis Day',
  OTRR_Lux_Radio_Theater_Singles: 'Lux Radio Theatre',
  OTRR_Cavalcade_of_America_Singles: 'Cavalcade of America',
  OTRR_Broadway_Is_My_Beat_Singles: 'Broadway Is My Beat',
  OTRR_Family_Theater_Singles: 'Family Theater',
  OTRR_Words_At_War_Singles: 'Words at War',
  OTRR_Pacific_Story_Singles: 'Pacific Story',
  OTRR_Proudly_We_Hail_Singles: 'Proudly We Hail',
  OTRR_Destination_Freedom_Singles: 'Destination Freedom',
  OTRR_American_History_Singles: 'American History',
  OTRR_Sound_of_War_Singles: 'Sound of War',
  OTRR_Big_Story_Singles: 'The Big Story',
  OTRR_Sealed_Book_Singles: 'The Sealed Book',
  OTRR_Weird_Circle_Singles: 'The Weird Circle',
  OTRR_Black_Museum_Singles: 'The Black Museum',
  OTRR_Escape_Singles: 'Escape',
  LightsOutoldTimeRadio: 'Lights Out',
  Quiet_Please: 'Quiet, Please',
  // Sherlock Holmes: radio dramas (Old Time Radio) ...
  sherlockholmes_otr: 'The New Adventures of Sherlock Holmes',
  HQSherlockConwayTCS: 'Sherlock Holmes (Tom Conway)',
  tcssherlockholmesjohnstanleyhq: 'Sherlock Holmes (John Stanley)',
  tcssherlockholmesjohnstanleyhq2: 'Sherlock Holmes (John Stanley)',
  SherlockHolmesChristmas: 'Sherlock Holmes',
  // ... and LibriVox readings (public domain audiobooks read by volunteers)
  hound_baskervilles_librivox: 'The Hound of the Baskervilles',
  grimms_english_librivox: 'Grimms’ Fairy Tales',
  andersens_fairytales_librivox: 'Andersen’s Fairy Tales',
  english_fairy_tales_joy_librivox: 'English Fairy Tales',
  aesopforchildren_1308_librivox: 'Aesop for Children',
  just_so_stories: 'Just So Stories',
  potter_treasury_librivox: 'The Tales of Beatrix Potter',
  winniethepooh_2201_librivox: 'Winnie-the-Pooh',
  wind_in_the_willows_solo: 'The Wind in the Willows',
  alice_in_wonderland_librivox: 'Alice’s Adventures in Wonderland',
  christmascarol_librivox: 'A Christmas Carol',
  nightbeforechristmas_librivox: '’Twas the Night Before Christmas',
};

// Per-item options. Defaults: 14-62 minute episodes, shuffled, year read from the file name.
//   min/max   duration limits in seconds        ordered  keep chapters in order (serials and books)
//   note      shown instead of a year           noYear   don't guess a year from the file name
const LV = { min: 120, max: 90 * 60, note: 'LibriVox', noYear: true };
const OPTS = {
  [SHADOW]: { exclude: /LP Record|Documentary|Radio Documentary/i },       // the item also holds an LP and a 1985 documentary
  hound_baskervilles_librivox: { ...LV, ordered: true },
  grimms_english_librivox: { ...LV, max: 30 * 60 },
  andersens_fairytales_librivox: { ...LV, max: 40 * 60 },
  english_fairy_tales_joy_librivox: { ...LV, max: 30 * 60 },
  aesopforchildren_1308_librivox: { ...LV },
  just_so_stories: { ...LV },
  potter_treasury_librivox: { ...LV, max: 45 * 60 },
  winniethepooh_2201_librivox: { ...LV, ordered: true },
  wind_in_the_willows_solo: { ...LV, ordered: true },
  alice_in_wonderland_librivox: { ...LV, ordered: true },
  christmascarol_librivox: { ...LV, ordered: true },
  nightbeforechristmas_librivox: { ...LV, ordered: true, take: 1 },       // nine readings of one poem; one is plenty
};
// chapter titles missing or garbled in the archive.org metadata
OPTS.hound_baskervilles_librivox.titles = ['Mr. Sherlock Holmes', 'The Curse of the Baskervilles', 'The Problem', 'Sir Henry Baskerville', 'Three Broken Threads', 'Baskerville Hall', 'The Stapletons of Merripit House', 'First Report of Dr. Watson', 'Second Report of Dr. Watson', 'Extract from the Diary of Dr. Watson', 'The Man on the Tor', 'Death on the Moor', 'Fixing the Nets', 'The Hound of the Baskervilles', 'A Retrospection'];
OPTS.alice_in_wonderland_librivox.titles = ['Down the Rabbit-Hole', 'The Pool of Tears', 'A Caucus-Race and a Long Tale', 'The Rabbit Sends in a Little Bill', 'Advice from a Caterpillar', 'Pig and Pepper', 'A Mad Tea-Party', 'The Queen’s Croquet-Ground', 'The Mock Turtle’s Story', 'The Lobster Quadrille', 'Who Stole the Tarts?', 'Alice’s Evidence'];

OPTS.christmascarol_librivox.titles = ['Stave One: Marley’s Ghost', 'Stave Two: The First of the Three Spirits', 'Stave Three: The Second of the Three Spirits', 'Stave Four: The Last of the Spirits', 'Stave Five: The End of It'];
OPTS.nightbeforechristmas_librivox.titles = ['’Twas the Night Before Christmas'];

const SMALL = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
function tidyTitle(t) {
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) {                    // ALL CAPS chapter headings
    t = t.toLowerCase().split(' ').map((w, i) => (i && SMALL.has(w) ? w : w.replace(/(^|-)[a-z]/g, (c) => c.toUpperCase()))).join(' ');
  }
  t = t.replace(/^Introduct Ion$/i, 'Introduction');
  const fables = t.match(/^Fables? [\d-]+:\s*(.+)$/);                // "Fables 93-96: A; B; C; D" -> "A, and 3 more fables"
  if (fables) { const list = fables[1].split(';').map((x) => x.trim()); t = list[0] + (list.length > 1 ? `, and ${list.length - 1} more fable${list.length > 2 ? 's' : ''}` : ''); }
  return t;
}

// ---------- the stations ----------
// kc = position on the dial (AM band, 540-1600 kc). Keep them ~85 kc apart.
const CHANNELS = [
  { id: 'mystery', name: 'Mystery Theater', short: 'MYSTERY', kc: 600, blurb: 'Suspense, whodunits and things that go bump.',
    sources: ['OTRR_Suspense_Singles', 'OTRR_Inner_Sanctum_Mysteries_Singles', 'OTRR_Whistler_Singles', 'OTRR_Mysterious_Traveler_Singles', SHADOW] },
  { id: 'sherlock', name: 'Baker Street Radio', short: 'HOLMES', kc: 676, blurb: 'The world’s only consulting detective, on the air and on the page.', count: 60,
    sources: ['sherlockholmes_otr', 'HQSherlockConwayTCS', ['tcssherlockholmesjohnstanleyhq', 'tcssherlockholmesjohnstanleyhq2'], 'hound_baskervilles_librivox'] },
  { id: 'scifi', name: 'Rocket Radio', short: 'SCI-FI', kc: 752, blurb: 'Tomorrow, as imagined yesterday.',
    sources: ['OTRR_X_Minus_One_Singles', 'OTRR_Dimension_X_Singles', 'OTRR_Dark_Fantasy_Singles'] },
  { id: 'crime', name: 'Crime Beat', short: 'CRIME', kc: 828, blurb: 'Badges, gumshoes and private eyes.',
    sources: ['OTRR_Dragnet_Singles', 'OTRR_YoursTrulyJohnnyDollar_Singles', 'OTRR_Philip_Marlowe_Singles', 'OTRR_Sam_Spade_Singles', 'OTRR_Richard_Diamond_Private_Detective_Singles'] },
  { id: 'spies', name: 'Spies & Lawmen', short: 'SPIES', kc: 904, blurb: 'G-men, secret agents and the DA’s office.',
    sources: ['OTRR_Counterspy_Singles', 'OTRR_Man_Called_X_Singles', 'Otrr_Dangerous_Assignment_Singles', 'OTRR_This_Is_Your_FBI_Singles', 'OTRR_Mr_District_Attorney_Singles', 'OTRR_Cloak_and_Dagger_Singles'] },
  { id: 'adventure', name: 'Adventure Hour', short: 'ADVENTURE', kc: 980, blurb: 'Mounties, rocket rangers and daring escapes.',
    sources: ['OTRR_Challenge_of_the_Yukon_Singles', 'OTRR_Space_Patrol_Singles', 'OTRR_Ranger_Bill_Singles', 'OTRR_High_Adventure_Singles'] },
  { id: 'western', name: 'Western Trail', short: 'WESTERN', kc: 1056, blurb: 'Marshals, outlaws and wide-open spaces.',
    sources: ['OTRR_Gunsmoke_Singles', 'OTRR_LoneRanger_Singles', 'OTRR_The_Six_Shooter_Singles', 'OTRR_Fort_Laramie_Singles'] },
  { id: 'comedy', name: 'Laugh Parade', short: 'COMEDY', kc: 1132, blurb: 'Variety, sitcoms and wisecracks.',
    sources: ['OTRR_Jack_Benny_Singles_1949-1950', 'Otrr_The_Great_Gildersleeve_Singles', 'OTRR_Harris_Faye_Singles'] },
  { id: 'sitcom', name: 'Sitcom Row', short: 'SITCOMS', kc: 1208, blurb: 'Schoolteachers, taverns and family dinners.',
    sources: ['OTRR_Our_Miss_Brooks_Singles', 'OTRR_My_Friend_Irma_Singles', 'OTRR_Duffys_Tavern_Singles', 'OTRR_Life_with_Luigi_Singles', 'OTRR_Father_Knows_Best_Singles', 'OTRR_Abbott_Costello_Singles'] },
  { id: 'variety', name: 'Showtime Variety', short: 'VARIETY', kc: 1284, blurb: 'Musicals, sketches and a little Borge.',
    sources: ['OTRR_Railroad_Hour_Singles', 'OTRR_Danny_Kaye_Singles', 'OTRR_Alka_Seltzer_Time_Singles', 'OTRR_Mel_Blanc_Singles', 'OTRR_Shell_Chateau_Singles', 'OTRR_Victor_Borge_Collection_Singles', 'OTRR_Day_in_the_Life_of_Dennis_Day_Singles'] },
  { id: 'playhouse', name: 'Radio Playhouse', short: 'PLAYHOUSE', kc: 1360, blurb: 'Hollywood stars and great stories, live.',
    sources: ['OTRR_Lux_Radio_Theater_Singles', 'OTRR_Cavalcade_of_America_Singles', 'OTRR_Broadway_Is_My_Beat_Singles', 'OTRR_Family_Theater_Singles'] },
  { id: 'history', name: 'The Home Front', short: 'HISTORY', kc: 1436, blurb: 'Wartime dispatches and stories from American history.',
    sources: ['OTRR_Words_At_War_Singles', 'OTRR_Pacific_Story_Singles', 'OTRR_Proudly_We_Hail_Singles', 'OTRR_Destination_Freedom_Singles', 'OTRR_American_History_Singles', 'OTRR_Sound_of_War_Singles', 'OTRR_Big_Story_Singles'] },
  { id: 'chills', name: 'Chiller Hour', short: 'CHILLS', kc: 1512, blurb: 'Best enjoyed with the lights down low.',
    sources: ['OTRR_Sealed_Book_Singles', 'OTRR_Weird_Circle_Singles', 'OTRR_Black_Museum_Singles', 'OTRR_Escape_Singles', 'LightsOutoldTimeRadio', 'Quiet_Please'] },
  // Bedtime: short tales in random order, plus three books read a chapter at a time, in order,
  // across the loop (a source listed as an array is merged into one pool).
  { id: 'bedtime', name: 'Bedtime Stories', short: 'BEDTIME', kc: 1588, blurb: 'Fairy tales and gentle stories, read aloud. Pair with the sleep timer.', count: 108,
    sources: ['grimms_english_librivox', 'andersens_fairytales_librivox', 'english_fairy_tales_joy_librivox', 'aesopforchildren_1308_librivox', 'just_so_stories', 'potter_treasury_librivox',
      'winniethepooh_2201_librivox', 'wind_in_the_willows_solo', 'alice_in_wonderland_librivox'] },
];

// ---------- scheduled specials ----------
// A special takes over one station during a window of the listener's LOCAL time, then the
// station returns to its normal loop. Rule types:
//   { type: 'weekly',   days: [0], from: '20:00', to: '23:00' }   days: 0 = Sunday ... 6 = Saturday
//   { type: 'range',    from: '10-25', to: '10-31' }              every year, whole days, inclusive
//   { type: 'friday13' }                                          every Friday the 13th, all day
// `filter` (regex, case-insensitive) keeps only episodes whose title/file name match.
const XMAS = 'christmas|xmas|santa|noel|yule|scrooge|nativity|holiday|new year';
const SCARY = 'ghost|haunt|horror|halloween|witch|vampire|werewolf|monster|zombie|graveyard|skeleton|coffin|corpse|terror|spook|devil|curse|mummy|grave|dead|doom|nightmare|scream|bones';
const SPECIALS = [
  // holidays first: they win over weekly slots
  { id: 'fri13', title: 'Friday the 13th Fright Night', blurb: 'All day long. Don’t listen alone.', rule: { type: 'friday13' }, channel: 'chills', filter: SCARY, count: 20,
    sources: ['OTRR_Escape_Singles', 'OTRR_Weird_Circle_Singles', 'OTRR_Sealed_Book_Singles', 'OTRR_Suspense_Singles', 'OTRR_Inner_Sanctum_Mysteries_Singles', 'OTRR_Whistler_Singles', 'OTRR_Mysterious_Traveler_Singles', SHADOW, 'LightsOutoldTimeRadio', 'Quiet_Please', 'OTRR_Dark_Fantasy_Singles'] },
  { id: 'halloween', title: 'Halloween Week of Horrors', blurb: 'Seven nights of the spookiest broadcasts on the dial.', rule: { type: 'range', from: '10-25', to: '10-31' }, channel: 'chills', filter: SCARY, count: 24,
    sources: ['OTRR_Escape_Singles', 'OTRR_Weird_Circle_Singles', 'OTRR_Sealed_Book_Singles', 'LightsOutoldTimeRadio', 'Quiet_Please', 'OTRR_Dark_Fantasy_Singles', 'OTRR_Suspense_Singles'] },
  { id: 'halloween-mystery', title: 'Halloween Week of Horrors', blurb: 'Seven nights of Inner Sanctum and Suspense at their creepiest.', rule: { type: 'range', from: '10-25', to: '10-31' }, channel: 'mystery', filter: SCARY, count: 24,
    sources: ['OTRR_Inner_Sanctum_Mysteries_Singles', 'OTRR_Suspense_Singles', 'OTRR_Whistler_Singles', 'OTRR_Mysterious_Traveler_Singles', SHADOW] },
  { id: 'xmas-comedy', title: 'Christmas on the Radio', blurb: 'Holiday episodes, December 20–26.', rule: { type: 'range', from: '12-20', to: '12-26' }, channel: 'comedy', filter: XMAS, count: 24,
    sources: ['Otrr_The_Great_Gildersleeve_Singles', 'OTRR_Harris_Faye_Singles', 'OTRR_Jack_Benny_Singles_1949-1950'] },
  { id: 'xmas-sitcom', title: 'Christmas on the Radio', blurb: 'Holiday episodes, December 20–26.', rule: { type: 'range', from: '12-20', to: '12-26' }, channel: 'sitcom', filter: XMAS, count: 24,
    sources: ['OTRR_Our_Miss_Brooks_Singles', 'OTRR_Duffys_Tavern_Singles', 'OTRR_Abbott_Costello_Singles', 'OTRR_Father_Knows_Best_Singles', 'OTRR_Life_with_Luigi_Singles', 'OTRR_My_Friend_Irma_Singles'] },
  { id: 'xmas-playhouse', title: 'Christmas on the Radio', blurb: 'Holiday dramas, December 20–26.', rule: { type: 'range', from: '12-20', to: '12-26' }, channel: 'playhouse', filter: XMAS, count: 16,
    sources: ['OTRR_Lux_Radio_Theater_Singles', 'OTRR_Cavalcade_of_America_Singles', 'OTRR_Family_Theater_Singles', 'OTRR_Broadway_Is_My_Beat_Singles'] },
  { id: 'xmas-mystery', title: 'Christmas on the Radio', blurb: 'Yuletide suspense, December 20–26.', rule: { type: 'range', from: '12-20', to: '12-26' }, channel: 'mystery', filter: XMAS, count: 12,
    sources: ['OTRR_Suspense_Singles', 'OTRR_Whistler_Singles', 'OTRR_Inner_Sanctum_Mysteries_Singles', SHADOW] },
  { id: 'xmas-western', title: 'Christmas on the Radio', blurb: 'Christmas on the frontier, December 20–26.', rule: { type: 'range', from: '12-20', to: '12-26' }, channel: 'western', filter: XMAS, count: 12,
    sources: ['OTRR_Gunsmoke_Singles', 'OTRR_LoneRanger_Singles', 'OTRR_The_Six_Shooter_Singles'] },
  { id: 'july4', title: 'Fourth of July Celebration', blurb: 'Stories of liberty and the nation’s founding, July 1–4.', rule: { type: 'range', from: '07-01', to: '07-04' }, channel: 'history',
    filter: 'independence|liberty|revolution|patriot|declaration|1776|washington|jefferson|franklin|lincoln|freedom|constitution|america', count: 16,
    sources: ['OTRR_American_History_Singles', 'OTRR_Cavalcade_of_America_Singles', 'OTRR_Destination_Freedom_Singles', 'OTRR_Proudly_We_Hail_Singles'] },
  { id: 'veterans', title: 'Veterans Day Salute', blurb: 'Dispatches from the war years, November 9–11.', rule: { type: 'range', from: '11-09', to: '11-11' }, channel: 'history', count: 20,
    sources: ['OTRR_Words_At_War_Singles', 'OTRR_Sound_of_War_Singles', 'OTRR_Pacific_Story_Singles', 'OTRR_Proudly_We_Hail_Singles'] },
  { id: 'sherlock-christmas', title: 'A Sherlock Holmes Christmas', blurb: 'The Blue Carbuncle and other yuletide cases, December 20–26.', rule: { type: 'range', from: '12-20', to: '12-26' }, channel: 'sherlock',
    filter: 'christmas|carol|carbuncle|yule|xmas|new year', count: 12,
    sources: ['SherlockHolmesChristmas', 'sherlockholmes_otr', 'HQSherlockConwayTCS', 'tcssherlockholmesjohnstanleyhq', 'tcssherlockholmesjohnstanleyhq2'] },
  { id: 'xmas-bedtime', title: 'Christmas Bedtime Stories', blurb: '’Twas the night before Christmas, then A Christmas Carol in five staves, December 20–26.', rule: { type: 'range', from: '12-20', to: '12-26' }, channel: 'bedtime', count: 8,
    sources: ['nightbeforechristmas_librivox', 'christmascarol_librivox'] },
  // weekly appointment listening
  { id: 'hound-reading', title: 'Baker Street Book Club: The Hound of the Baskervilles', blurb: 'A complete reading, from the first knock at the door to the last chapter on the moor.', rule: { type: 'weekly', days: [5], from: '20:00', to: '02:00' }, channel: 'sherlock', count: 15,
    sources: ['hound_baskervilles_librivox'] },
  { id: 'shadow-knows', title: 'The Shadow Knows', blurb: 'Lamont Cranston and the Shadow, from 1937 to 1954. Who knows what evil lurks in the hearts of men?', rule: { type: 'weekly', days: [0], from: '17:30', to: '19:30' }, channel: 'mystery', count: 8,
    sources: [SHADOW] },
  { id: 'sunday-suspense', title: 'Sunday Night Suspense', blurb: 'An hour or three of radio’s most celebrated thriller series.', rule: { type: 'weekly', days: [0], from: '20:00', to: '23:00' }, channel: 'mystery', count: 8,
    sources: ['OTRR_Suspense_Singles'] },
  { id: 'sunday-benny', title: 'Sunday Night with Jack Benny', blurb: 'Jack, Mary, Rochester and the Phil Harris band.', rule: { type: 'weekly', days: [0], from: '19:00', to: '21:00' }, channel: 'comedy', count: 8,
    sources: ['OTRR_Jack_Benny_Singles_1949-1950', 'OTRR_Harris_Faye_Singles'] },
  { id: 'saturday-roundup', title: 'Saturday Night Roundup', blurb: 'Three hours of Dodge City with Matt Dillon.', rule: { type: 'weekly', days: [6], from: '19:00', to: '22:00' }, channel: 'western', count: 8,
    sources: ['OTRR_Gunsmoke_Singles'] },
  { id: 'saturday-serials', title: 'Saturday Morning Serials', blurb: 'Space cadets, Mounties and rangers, just like the old Saturday mornings.', rule: { type: 'weekly', days: [6], from: '09:00', to: '12:00' }, channel: 'adventure', count: 8,
    sources: ['OTRR_Space_Patrol_Singles', 'OTRR_Challenge_of_the_Yukon_Singles', 'OTRR_Ranger_Bill_Singles'] },
];

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'otr-radio-prototype/0.1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(800 * (i + 1));
    }
  }
}

function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseYear(...strings) {
  for (const s of strings) {
    if (!s) continue;
    const m4 = s.match(/(?:^|[^\d])(19[2-6]\d)[-_.](\d{2})[-_.](\d{2})(?!\d)/);
    if (m4) return +m4[1];
    const m = s.match(/(?:^|[^\d])(\d{2})[-_.](\d{2})[-_.](\d{2})(?!\d)/) || s.match(/(?:^|[^\d])(\d{2})(\d{2})(\d{2})(?:[^\d]|$)/);
    if (m) {
      const yy = +m[1], mm = +m[2], dd = +m[3];
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return 1900 + yy;
    }
    const y4 = s.match(/\b(19[2-6]\d)\b/);
    if (y4) return +y4[1];
  }
  return null;
}

function cleanTitle(raw, show) {
  let t = raw.replace(/\.mp3$/i, '').replace(/_/g, ' ');
  t = t.replace(/\s*\(\d+-\d+\)[\s\d]*\d+m\d+s\s*$/i, '');            // "(128-44) 28390 29m37s"
  const showWords = show.replace(/^the\s+/i, '').replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  // strip a leading show name (full or partial), then dates / episode numbers
  let prev;
  do {
    prev = t;
    t = t.trim();
    const lead = t.replace(/^the\s+/i, '');
    for (let n = showWords.length; n >= Math.min(2, showWords.length); n--) {
      const re = new RegExp('^' + showWords.slice(0, n).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\W*') + '\\b[\\s\\-–:]*', 'i');
      if (re.test(lead)) { t = lead.replace(re, ''); break; }
    }
    t = t.replace(/^[A-Za-z]{2,6}\s+(?=\d{2,4}[-.]\d{2}[-.]\d{2}|\d{6}\b)/, '');            // "JB 1949-10-23", "CALV 360101"
    t = t.replace(/^[\s\-–:]*(\d{4}[-.]\d{2}[-.]\d{2}|(?:\d{2}|xx)[-.](?:\d{2}|xx)[-.](?:\d{2}|xx)|\d{6}|\dx-xx-xx)\b[\s\-–:]*/i, '');
    t = t.replace(/^[\s\-–:]*ep\s*\d+\b[\s\-–:]*/i, '');
    t = t.replace(/^[\s\-–:]*\(?#?(?:\d{1,4}|x{1,4})\)?(?=\s|$)[\s\-–:]*/i, '');
    t = t.replace(/^[\s\-–:]*\d{2,3}\s+(?:[A-Z]{3,5}\s+)?(?=[A-Z])/, '');          // leftover episode no. / code ("038 TCOT ")
    t = t.replace(/^(\s*\[[^\]]*\]\s*)/, '');
  } while (t !== prev);
  t = t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s{2,}/g, ' ').replace(/^[\s\-–:.,]+|[\s\-–:.,]+$/g, '');
  return t;
}

const rawName = (f) => `${f.name} ${f.title || ''}`;

// archive.org "length" is seconds ("1763.9") or clock time ("65:06", "1:05:06")
const secs = (v) => {
  if (v == null || v === '') return NaN;
  const parts = String(v).split(':').map(parseFloat);
  return parts.some(Number.isNaN) ? NaN : parts.reduce((acc, x) => acc * 60 + x, 0);
};
const rank = (f) => (/64kbps/i.test(f.format || '') ? 0 : 1);        // speech: the small 64 kbps copy is plenty

async function loadSource(src) {
  const o = OPTS[src.item] || {};
  const min = o.min ?? MIN_SECONDS, max = o.max ?? MAX_SECONDS;
  const meta = await getJSON(`https://archive.org/metadata/${encodeURIComponent(src.item)}`);
  const byBase = new Map();                                              // one file per recording
  for (const f of meta.files || []) {
    if (!/\.mp3$/i.test(f.name || '') || !/mp3/i.test(f.format || '')) continue;
    if (o.exclude && o.exclude.test(rawName(f))) continue;
    const dur = secs(f.length);
    if (!(dur >= min && dur <= max)) continue;
    const base = f.name.replace(/\.mp3$/i, '').toLowerCase().replace(/[_-]?64kb$/, '');
    if (/\(\d+(st|nd|rd|th) of \d+\)|\bep\.? ?\d+ \(/i.test(rawName(f))) continue;   // serialized chapters
    if (/\b(act|part)[ _-]*\d\b|promo|trailer|\bintro\b|outtake|commercials?\b/i.test(base) && !o.ordered) continue;
    const prev = byBase.get(base);
    if (!prev || rank(f) < rank(prev.f)) byBase.set(base, { f, dur });
  }
  let files = [...byBase.values()];
  if (o.ordered) files.sort((x, y) => x.f.name.localeCompare(y.f.name, undefined, { numeric: true }));
  if (o.take) files = files.slice(0, o.take);
  const seenTitle = new Set(), eps = [];
  for (const [idx, { f, dur }] of files.entries()) {
    const rawTitle = f.title || f.name;
    let title = cleanTitle(f.title || '', src.show);
    if (!title || title.toLowerCase() === src.show.toLowerCase()) title = cleanTitle(f.name, src.show);
    if (!title) title = f.name.replace(/\.mp3$/i, '').replace(/_/g, ' ');
    if (o.titles && o.titles[idx]) title = o.titles[idx];
    title = tidyTitle(title);
    const y = o.noYear ? null : parseYear(f.name, rawTitle);
    const key = `${y}|${title.toLowerCase()}`;
    if (seenTitle.has(key)) continue;                                    // same episode uploaded twice
    seenTitle.add(key);
    const ep = { t: title, s: src.show, d: Math.round(dur), i: src.item, f: f.name, y };
    if (o.note) ep.n = o.note;
    eps.push(ep);
  }
  return eps;
}

// ---------- main ----------
const cache = new Map();
async function episodesOf(item) {
  if (!cache.has(item)) {
    const show = SHOWS[item];
    if (!show) throw new Error(`no show name for ${item} (add it to SHOWS)`);
    try { const eps = await loadSource({ item, show }); cache.set(item, eps); if (OPTS[item]) console.log(`  · ${item}: ${eps.length} files, ${(eps.reduce((n, e) => n + e.d, 0) / 3600).toFixed(1)} h`); }
    catch (err) { console.warn(`  ! ${item}: ${err.message} (skipped)`); cache.set(item, []); }
  }
  return cache.get(item);
}

// A source entry is an item id, or an array of ids merged into one pool. Pools of
// ordered items (books) keep their chapter order; everything else is shuffled.
async function poolFor(entry, rand, re) {
  const items = Array.isArray(entry) ? entry : [entry];
  let eps = [];
  for (const item of items) eps = eps.concat(await episodesOf(item));
  if (re) eps = eps.filter((e) => re.test(`${e.t} ${e.f}`));
  return items.every((i) => OPTS[i] && OPTS[i].ordered) ? eps : shuffle(eps, rand);
}

function interleave(pools, count) {
  const lineup = [];
  for (let round = 0; lineup.length < count; round++) {
    let added = false;
    for (const pool of pools) {
      if (round < pool.length && lineup.length < count) { lineup.push(pool[round]); added = true; }
    }
    if (!added) break;
  }
  return lineup;
}

async function main() {
  const channels = [];
  for (const ch of CHANNELS) {
    const rand = mulberry32(hash(ch.id));
    const pools = [];
    for (const entry of ch.sources) {
      const pool = await poolFor(entry, rand);
      if (pool.length) pools.push(pool);
    }
    if (!pools.length) throw new Error(`channel ${ch.id} has no episodes`);
    const lineup = interleave(pools, ch.count || EPISODES_PER_CHANNEL);
    const total = lineup.reduce((n, e) => n + e.d, 0);
    console.log(`→ ${ch.name.padEnd(18)} ${String(lineup.length).padStart(2)} episodes from ${pools.length} shows, ${(total / 3600).toFixed(1)} h loop`);
    channels.push({
      id: ch.id, name: ch.name, short: ch.short, kc: ch.kc, blurb: ch.blurb,
      epoch: hash('epoch:' + ch.id) % 86400 * 1000 + Date.UTC(2024, 0, 1), // keeps channels out of lock-step
      episodes: lineup,
    });
  }

  const specials = [];
  for (const sp of SPECIALS) {
    if (!channels.some((c) => c.id === sp.channel)) { console.warn(`  ! special ${sp.id}: unknown channel ${sp.channel}`); continue; }
    const rand = mulberry32(hash('special:' + sp.id));
    const re = sp.filter ? new RegExp(sp.filter, 'i') : null;
    const pools = [];
    for (const entry of sp.sources) {
      const pool = await poolFor(entry, rand, re);
      if (pool.length) pools.push(pool);
    }
    const lineup = interleave(pools, sp.count || 12);
    if (lineup.length < 3) { console.warn(`  ! special ${sp.id}: only ${lineup.length} episodes found, skipped`); continue; }
    console.log(`★ ${sp.id.padEnd(18)} on ${sp.channel.padEnd(9)} ${String(lineup.length).padStart(2)} episodes, ${(lineup.reduce((n, e) => n + e.d, 0) / 3600).toFixed(1)} h`);
    specials.push({ id: sp.id, title: sp.title, blurb: sp.blurb, channel: sp.channel, rule: sp.rule, episodes: lineup });
  }

  await mkdir(dirname(OUT), { recursive: true });
  const payload = JSON.stringify({ built: new Date().toISOString(), channels, specials });
  await writeFile(OUT, payload);
  await writeFile(OUT.replace(/\.json$/, '.js'), `window.OTR_CHANNELS = ${payload};\n`);   // lets index.html work from file://
  console.log(`\nWrote ${OUT} (+ .js)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
