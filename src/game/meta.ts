// Progress, economy and the weekly bot league. Everything works offline;
// on CrazyGames the save goes through the SDK's store, which syncs it to the
// player's account when they are logged in.
import { saveStore } from '../platform/ads.ts';

export interface Save {
  level: number;
  /** Highest level reached, for unlocks. */
  best: number;
  theme: string;
  ball: string;
  paint: string;
  sound: boolean;
  music: boolean;
  vibe: boolean;
  coins: number;
  streak: number;
  keys: number;
  hints: number;
  bombs: number;
  /** Weekly league: which week, and stars earned in it. */
  week: number;
  weekStars: number;
  /** Highest level whose unlocks the player has seen in the shop. */
  seenUnlock: number;
  /**
   * Key vault: progress dots per prize (0-2), and `dry`, how many visits in
   * a row ended without a prize (the next one is then guaranteed).
   */
  vault: { hint: number; item: number; coins: number; dry?: number };
  owned: string[];
  /** One-time tips already shown (e.g. 'curves'). */
  tips: string[];
  /** Local day of the last visit: a new day tops up one free hint. */
  day: number;
  /** Ads watched toward each ad-unlock item (see `ads` on cosmetics). */
  adProgress: Record<string, number>;
  /** Super Rewards seen: the first Multiply is free, later ones take an ad. */
  superRewards: number;
}

const SAVE_KEY = 'colormaze.v1';

export const PRICES = { hint: 400, bomb: 200 };

export function loadSave(): Save {
  const fallback: Save = {
    level: 1,
    best: 1,
    theme: 'lavender',
    ball: 'sunny',
    paint: 'pink',
    sound: true,
    music: true,
    vibe: true,
    coins: 0,
    streak: 0,
    keys: 0,
    hints: 3,
    bombs: 3,
    week: weekIndex(),
    weekStars: 0,
    seenUnlock: 1,
    vault: { hint: 0, item: 0, coins: 0 },
    owned: [],
    tips: [],
    day: dayIndex(),
    adProgress: {},
    superRewards: 0,
  };
  try {
    // Prefer the SDK's (cloud) copy; fall back to this browser's, so
    // progress made before the SDK was in use carries over.
    let raw = saveStore()?.getItem(SAVE_KEY) ?? null;
    if (raw === null) {
      try {
        raw = localStorage.getItem(SAVE_KEY);
      } catch {
        raw = null;
      }
    }
    const s: Save = raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    s.best = Math.max(s.best, s.level);
    if (s.day !== dayIndex()) {
      s.day = dayIndex();
      s.hints = Math.max(s.hints, 1);
    }
    if (s.week !== weekIndex()) {
      s.week = weekIndex();
      s.weekStars = 0;
    }
    return s;
  } catch {
    return fallback;
  }
}

/** Days since the epoch in local time. */
export function dayIndex(now = new Date()): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
}

export function storeSave(s: Save) {
  const text = JSON.stringify(s);
  try {
    saveStore()?.setItem(SAVE_KEY, text);
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
  // Keep a local copy too when the SDK's store is the main one.
  try {
    if (saveStore() !== window.localStorage) localStorage.setItem(SAVE_KEY, text);
  } catch {
    /* no local storage */
  }
}

// ---------------------------------------------------------------- league

const WEEK = 7 * 24 * 3600 * 1000;

/** Weeks end at the start of Sunday, local time. */
function weekEnd(now = new Date()): Date {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + ((7 - end.getDay()) % 7 || 7));
  return end;
}

export function weekIndex(now = new Date()): number {
  return Math.round(weekEnd(now).getTime() / WEEK);
}

export function timeLeft(now = new Date()): string {
  const ms = weekEnd(now).getTime() - now.getTime();
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

const NAMES = [
  'Mila', 'Kenji', 'Sofia', 'Arjun', 'Lena', 'Omar', 'Yuki', 'Noah', 'Priya', 'Leo', 'Ava', 'Mateo', 'Zara',
  'Finn', 'Isla', 'Ravi', 'Chloe', 'Emre', 'Nina', 'Theo', 'Aisha', 'Lucas', 'Mei', 'Hugo', 'Sana', 'Jonas',
  'Elif', 'Diego', 'Freya', 'Kofi', 'Ines', 'Bruno', 'Hana', 'Ivan', 'Rosa', 'Tariq', 'Clara', 'Joon',
];
const AVATARS = [
  'linear-gradient(135deg,#ff9a9e,#ff5f8a)', 'linear-gradient(135deg,#a1c4fd,#5a8dee)',
  'linear-gradient(135deg,#ffe29f,#ffa94d)', 'linear-gradient(135deg,#b9f6ca,#3ccf91)',
  'linear-gradient(135deg,#d4b8ff,#8e5cf7)', 'linear-gradient(135deg,#8fd3f4,#32a6c4)',
];

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Standing {
  name: string;
  stars: number;
  you: boolean;
  avatar: string;
}

/**
 * A 30-player league: 29 simulated players whose stars grow through the week
 * along their own pace, plus you. Same week → same rivals.
 */
export function league(week: number, yourStars: number, now = new Date()): { rows: Standing[]; rank: number } {
  const rng = seeded(week * 7907 + 13);
  const elapsed = 1 - (weekEnd(now).getTime() - now.getTime()) / WEEK;
  // 99 rivals: plain names plus gamer tags built from them.
  const tags = ['Pro', 'X', '_7', '99', 'Star', 'Ace', '2010', 'Max', 'Fox', '_GG', 'Jet', '42'];
  const pool = [...NAMES];
  for (const n of NAMES) pool.push(n + tags[Math.floor(rng() * tags.length)]);
  for (const n of NAMES) pool.push(n.toLowerCase() + Math.floor(10 + rng() * 989));
  const names = pool.sort(() => rng() - 0.5).slice(0, 99);
  const rows: Standing[] = names.map((name, i) => {
    const final = Math.round(20 + 300 * rng() ** 1.9);
    const pace = 0.75 + rng() * 0.5;
    return {
      name,
      stars: Math.max(0, Math.round(final * Math.min(1, elapsed ** pace))),
      you: false,
      avatar: AVATARS[i % AVATARS.length],
    };
  });
  rows.push({ name: 'You', stars: yourStars, you: true, avatar: 'linear-gradient(135deg,#ffe066,#ff9f1a)' });
  rows.sort((a, b) => b.stars - a.stars || (a.you ? -1 : b.you ? 1 : 0));
  return { rows, rank: rows.findIndex((r) => r.you) + 1 };
}
