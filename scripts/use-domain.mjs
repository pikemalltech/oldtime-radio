#!/usr/bin/env node
// Points the site at a custom domain, or back at the github.io address.
//
//   node scripts/use-domain.mjs yesterdial.com     writes docs/CNAME and updates the canonical / Open Graph / Twitter URLs
//   node scripts/use-domain.mjs --github           removes docs/CNAME and restores the github.io URLs
//
// Run it only once the domain is registered and its DNS records are in place (see README, "Using your own domain").
// A CNAME file makes GitHub redirect the github.io address to the domain, so adding it too early takes the site offline.

import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GITHUB = 'https://pikemalltech.github.io/oldtime-radio';
const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const arg = (process.argv[2] || '').trim().toLowerCase();

if (!arg) { console.error('Usage: node scripts/use-domain.mjs <domain> | --github'); process.exit(1); }
const domain = arg === '--github' ? null : arg.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) { console.error(`"${arg}" doesn't look like a domain name`); process.exit(1); }

const base = domain ? `https://${domain}` : GITHUB;
const file = join(DOCS, 'index.html');
let html = await readFile(file, 'utf8');
const current = (html.match(/<link rel="canonical" href="([^"]+?)\/">/) || [])[1];
if (!current) { console.error('Could not find the canonical URL in docs/index.html'); process.exit(1); }
const count = html.split(current).length - 1;
html = html.split(current).join(base);
await writeFile(file, html);

if (domain) await writeFile(join(DOCS, 'CNAME'), domain + '\n'); else await rm(join(DOCS, 'CNAME'), { force: true });

console.log(`Updated ${count} URL${count === 1 ? '' : 's'} in docs/index.html: ${current}  →  ${base}`);
console.log(domain ? `Wrote docs/CNAME (${domain}).` : 'Removed docs/CNAME.');
console.log('Now commit and push; then check Settings → Pages (custom domain, Enforce HTTPS).');
