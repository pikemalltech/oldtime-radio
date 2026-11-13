// Live listener counts. Leave `url` empty to turn the feature off (the radio works the same without it).
// When the stats Worker is deployed (see stats-worker/README.md) set it to its WebSocket address, e.g.
//   url: 'wss://yesterdial-stats.YOUR-SUBDOMAIN.workers.dev/ws'
window.OTR_STATS = window.OTR_STATS || { url: '' };
