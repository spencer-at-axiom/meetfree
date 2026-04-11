const STALE_MS = 5 * 60 * 1000;
const MAX_SET = 10;

export function mkTtl(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const mon = String(date.getMonth() + 1).padStart(2, '0');
  const yr = String(date.getFullYear()).slice(-2);
  const hrs = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const sec = String(date.getSeconds()).padStart(2, '0');
  return `Meeting ${day}_${mon}_${yr}_${hrs}_${min}_${sec}`;
}

export function mkKey(meetId: string, finAt: string): string {
  return `${meetId}|${finAt}`;
}

export function clrSet(cache: Set<string>, nowMs = Date.now()): void {
  const cutoff = nowMs - STALE_MS;
  for (const key of cache) {
    const splitAt = key.indexOf('|');
    if (splitAt === -1) {
      continue;
    }

    const stamp = key.slice(splitAt + 1);
    if (new Date(stamp).getTime() < cutoff) {
      cache.delete(key);
    }
  }
}

export function capSet(cache: Set<string>): void {
  if (cache.size <= MAX_SET) {
    return;
  }

  const vals = Array.from(cache);
  const trim = vals.slice(0, vals.length - MAX_SET);
  trim.forEach((key) => cache.delete(key));
}

export function getWc(rows: Array<{ text: string }>): number {
  return rows
    .map((row) => row.text.split(/\s+/).length)
    .reduce((sum, cnt) => sum + cnt, 0);
}

export function getWpm(wordCnt: number, durSec: number): number {
  if (durSec <= 0) {
    return 0;
  }

  return wordCnt / (durSec / 60);
}
