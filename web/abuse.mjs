import { isIP } from 'node:net';

// Browsers can rotate tab IDs/cookies; cost limits therefore use the trusted
// network address as well. Group IPv6 privacy addresses by their /64 network.
export function networkKey(address) {
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) return address.slice(7);
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return 'unknown';
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [left, right = ''] = canonical.split('::');
  const first = left ? left.split(':') : [];
  const last = right ? right.split(':') : [];
  const words = canonical.includes('::') ? [...first, ...Array(8 - first.length - last.length).fill('0'), ...last] : first;
  return words.slice(0, 4).map(word => parseInt(word, 16).toString(16)).join(':') + '::/64';
}

export class AbuseLimit extends Error {
  constructor(retryAfterSec) {
    super('Слишком много запросов к ИИ. Подождите и повторите отправку.');
    this.retryAfterSec = Math.max(1, Math.ceil(retryAfterSec));
  }
}

export function createAbuseGuard({ now = Date.now, startsPerHour = 30, globalStartsPerHour = 120,
  writesPerHour = 180, globalWritesPerHour = 720, maxConcurrent = 12, perIPConcurrent = 3, maxNetworks = 10000 } = {}) {
  for (const value of [startsPerHour, globalStartsPerHour, writesPerHour, globalWritesPerHour, maxConcurrent, perIPConcurrent, maxNetworks]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid anti-spam configuration.');
  }
  const hour = 3600000;
  const networks = new Map();
  const global = { starts: [], writes: [], active: 0 };
  let nextSweep = 0;
  const prune = (items, time) => items.filter(t => t > time - hour);
  function refresh(bucket, time) {
    bucket.starts = prune(bucket.starts, time);
    bucket.writes = prune(bucket.writes, time);
  }
  function check(items, max, time) {
    if (items.length >= max) throw new AbuseLimit((items[0] + hour - time) / 1000);
  }
  return {
    acquire(address, { start = false } = {}) {
      const time = now();
      if (time >= nextSweep) {
        for (const [key, bucket] of networks) {
          refresh(bucket, time);
          if (!bucket.active && !bucket.writes.length) networks.delete(key);
        }
        nextSweep = time + 60000;
      }
      const key = networkKey(address);
      let bucket = networks.get(key);
      if (!bucket) {
        if (networks.size >= maxNetworks) throw new AbuseLimit(60);
        bucket = { starts: [], writes: [], active: 0 };
        networks.set(key, bucket);
      }
      refresh(bucket, time); refresh(global, time);
      if (bucket.active >= perIPConcurrent || global.active >= maxConcurrent) throw new AbuseLimit(5);
      check(bucket.writes, writesPerHour, time); check(global.writes, globalWritesPerHour, time);
      if (start) { check(bucket.starts, startsPerHour, time); check(global.starts, globalStartsPerHour, time); }
      // Reserve synchronously before any async call; failed/refused model work
      // stays charged because it can still spend provider tokens.
      bucket.writes.push(time); global.writes.push(time);
      if (start) { bucket.starts.push(time); global.starts.push(time); }
      bucket.active++; global.active++;
      let released = false;
      return () => {
        if (released) return;
        released = true; bucket.active--; global.active--;
      };
    },
  };
}
