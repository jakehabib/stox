/**
 * Deterministic-capable RNG. Every system takes an Rng instance so a game can
 * be replayed bit-for-bit from a seed (useful when balancing the sim).
 */
export class Rng {
  private s: number;

  constructor(seed: number | string = Date.now()) {
    this.s = typeof seed === 'string' ? hashString(seed) : Math.floor(seed) || 1;
    if (this.s === 0) this.s = 0x9e3779b9;
  }

  /** mulberry32 — fast, good enough distribution for a sports sim. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  /** Inclusive integer range. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Box-Muller normal. */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Normal, clamped — the workhorse for attribute rolls. */
  normalClamped(mean: number, sd: number, lo: number, hi: number): number {
    return Math.round(Math.min(hi, Math.max(lo, this.normal(mean, sd))));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Pick by weight map, e.g. { Normal: 0.55, Star: 0.15 }. */
  weighted<T extends string>(weights: Record<T, number>): T {
    const entries = Object.entries(weights) as [T, number][];
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let roll = this.next() * total;
    for (const [k, w] of entries) {
      roll -= w;
      if (roll <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
