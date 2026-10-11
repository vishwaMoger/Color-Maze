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
  /** Trail streaming behind the ball (see trail.ts); 'classic' is none. */
  trail?: string;
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
  /** Ads watched toward each item offered for videos (see `offers`). */
  adProgress: Record<string, number>;
  /**
   * Video offers: two locked items (as 'ball:id', 'paint:id', 'board:id')
   * that open for three videos each, until `until` (ms); then two others.
   */
  offers?: { until: number; ids: string[]; v?: number };
  /** Levels finished during each limited-time event (see events.ts). */
  eventLevels?: Record<string, number>;
  /** Highest level whose key was picked up: a level's key counts once. */
  keyLevel?: number;
  /** Event video boosts used today (local day, see dayIndex). */
  eventBoost?: { day: number; n: number };
  /** Super Rewards seen: the first Multiply is free, later ones take an ad. */
  superRewards: number;
  /**
   * Unlock schedule the save was made under. Saves from before the long
   * schedule (no value) keep everything the old one had already given.
   */
  pace?: number;
  /** When this copy was written (ms): copies older than an erase are ignored. */
  savedAt?: number;
}

const SAVE_KEY = 'colormaze.v1';
/** When progress was last erased, kept in this browser (see eraseSave). */
const ERASED_KEY = 'colormaze.erasedAt';

function erasedAt(): number {
  try {
    return Number(localStorage.getItem(ERASED_KEY)) || 0;
  } catch {
    return 0;
  }
}

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
    hints: 2,
    bombs: 2,
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
    // A copy written before the last erase is stale: the SDK's store syncs
    // in the background, so an erase may not have reached it yet.
    const since = erasedAt();
    const read = (get: () => string | null): Partial<Save> | null => {
      try {
        const raw = get();
        const p = raw ? (JSON.parse(raw) as Partial<Save>) : null;
        return p && (p.savedAt ?? 0) >= since ? p : null;
      } catch {
        return null;
      }
    };
    const data = read(() => saveStore()?.getItem(SAVE_KEY) ?? null) ?? read(() => localStorage.getItem(SAVE_KEY));
    // A brand-new save starts on the current unlock schedule; an older one
    // has no `pace` and is brought over by the game (keepOldUnlocks).
    const s: Save = data ? { ...fallback, ...data } : { ...fallback, pace: 2 };
    s.best = Math.max(s.best, s.level);
    // The Teal maze was once id 'mint', the same as the Mint ball.
    if (s.theme === 'mint') s.theme = 'teal';
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
    return { ...fallback, pace: 2 };
  }
}

/** Days since the epoch in local time. */
export function dayIndex(now = new Date()): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
}

/** Set once progress is erased: nothing may write the old save back. */
let erased = false;

/** Wipe all progress (Settings > Start over); the game then reloads fresh. */
export function eraseSave() {
  erased = true;
  // Remembered here first: whatever copy the SDK's store still holds (its
  // sync may lag behind the reload) is then ignored as older than this.
  try {
    localStorage.setItem(ERASED_KEY, String(Date.now()));
  } catch {
    /* no local storage */
  }
  try {
    saveStore()?.removeItem(SAVE_KEY);
  } catch {
    /* nothing stored */
  }
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* no local storage */
  }
}

export function storeSave(s: Save) {
  if (erased) return;
  s.savedAt = Math.max(Date.now(), erasedAt() + 1);
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

// Rival players' handles, each used once per league: the kinds of names
// people really pick (first names, name + initial, nicknames, words with
// a year or a lucky number, the odd all-lowercase or all-caps tag), from
// all over the world, so no league reads like a list of bots.
const NAMES = [
  'Mila', 'kenji.t', 'Sofia R', 'arjun_k', 'Lena', 'OmarH', 'yuki', 'NoahB', 'priya.s', 'Leo M', 'ava_rose', 'Mateo',
  'zara88', 'Finn', 'isla.j', 'Ravi', 'chloe :)', 'Emre', 'nina_b', 'Theo', 'Aisha', 'lucas_br', 'Mei', 'Hugo',
  'sana.k', 'Jonas', 'Elif', 'diego07', 'Freya', 'Kofi', 'Inês', 'bruno_m', 'Hana', 'Ivan P', 'rosa', 'tariq',
  'Clara', 'joon', 'Ananya', 'Rahul S', 'meera_23', 'Vikram', 'sneha', 'Aditya', 'kavya.r', 'rohan', 'Ishaan',
  'Pooja', 'Tanvi', 'harsh_v', 'Deepak', 'Nikhil', 'shreya', 'Mehmet', 'Ayşe', 'burak', 'Zeynep', 'João', 'Luana',
  'gabi.s', 'Rafael', 'Camila', 'Valentina', 'santi_r', 'Martina', 'Lukas', 'Hannah', 'felix_w', 'Emma', 'Mia S',
  'Jakub', 'Zofia', 'łukasz', 'Søren', 'Ingrid', 'Astrid', 'Mikko', 'Aino', 'Pierre', 'Camille', 'Léa', 'Julien',
  'Giulia', 'Marco', 'alessia', 'Lorenzo', 'Elena', 'Nikos', 'Dimitra', 'Andrei', 'Ioana', 'Olga', 'Dmitri',
  'Anya', 'Taras', 'Sakura', 'haruto', 'Ren', 'Minji', 'Jiwoo', 'seo-yeon', 'Wei', 'Lin', 'xiao_yu', 'Linh',
  'Minh', 'Thảo', 'Siti', 'Putri', 'Rizky', 'Angelo', 'Bea', 'Joshua', 'Chidi', 'Amara', 'Tunde', 'Zanele',
  'Youssef', 'Layla', 'Karim', 'Noor', 'Daniel', 'Sarah K', 'jess', 'Mike', 'ashley_b', 'Tyler', 'Brianna',
  'Kevin L', 'Megan', 'jordan', 'Chris P', 'Olivia', 'Ethan', 'Grace', 'Liam', 'Ella', 'Jack', 'Ruby', 'Oscar',
  'Amelia', 'Harry', 'Poppy', 'Callum', 'Niamh', 'Seán', 'Ewan', 'Isabella', 'Jasmine', 'Marcus', 'Tasha',
  'NightOwl', 'sunny_side', 'MoonPie', 'pixelpanda', 'coffee_time', 'Bubbles', 'ZeroGravity', 'luckycat7',
  'mr_noodle', 'Kiwi', 'peachy', 'Mango', 'snowflake', 'blue_jay', 'ThunderBolt', 'cupcake22', 'Sir Rolls',
  'Paintbrush', 'neonfox', 'Waffles', 'tinytiger', 'Starlight', 'qwerty', 'Pumpkin', 'Captain K', 'HappyFeet',
  'nacho', 'Biscuit', 'Comet', 'Raven', 'pickle', 'DragonFly', 'Marshmallow', 'gamer_girl', 'Maverick',
  'PuzzleQueen', 'mazerunner', 'slowpoke', 'Turbo', 'jelly_bean', 'Pepper', 'Shadow', 'ollie_oop',
  'Mr Fox', 'Lollipop', 'xXLeoXx', 'TheRealDan', 'just_mike', 'ellie_bean', 'mom_of_3', 'grandpa joe',
  'kate1988', 'tom_2004', 'sam1999', 'ana2011', 'Max2012', 'eva_2009', 'nick77', 'jen_42', 'rob123',
  'ali_99', 'MARIA', 'JOSE', 'DAVID R', 'sk8erboi', 'BunnyHop', 'Lucky', 'Zen', 'Rocket', 'Sparky',
];
const AVATARS = ['face', 'ball', 'letter', 'sphere'] as const;
export type AvatarKind = (typeof AVATARS)[number];

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
  /** How the player shows: a 3D animal picture, their ball, an initial or a plain ball. */
  avatar: AvatarKind;
  /** Played in the last few minutes. */
  live?: boolean;
}

/** One sitting of a rival: levels won one after another, a minute or so apart. */
interface Sitting {
  start: number; // seconds into the week
  end: number;
  seed: number;
  levels: number;
  stars: number; // all of it, once the sitting is over
}
interface Rival {
  name: string;
  avatar: AvatarKind;
  sittings: Sitting[];
}

/** The stars of each level a rival wins in a sitting, and when (seconds into the week). */
function sittingWins(s: { start: number; seed: number; levels: number }, upTo = Infinity): { stars: number; at: number } {
  const r = seeded(s.seed);
  let at = s.start;
  let stars = 0;
  for (let i = 0; i < s.levels; i++) {
    at += 40 + r() * 80; // solving a level takes a while
    if (at > upTo) return { stars, at };
    const q = r();
    stars += q < 0.62 ? 3 : q < 0.88 ? 2 : 1;
  }
  return { stars, at };
}

const rivalsCache = new Map<number, Rival[]>();

/**
 * This week's 99 rivals and every sitting they will play. Each is a real
 * looking player with a weekly appetite (most play a fair amount, a few
 * are fanatics who play for hours every day), who plays in sittings at
 * their own times: spread over the week, front loaded (then they drift
 * off) or ramping up toward the end.
 */
function rivals(week: number): Rival[] {
  const cached = rivalsCache.get(week);
  if (cached) return cached;
  const rng = seeded(week * 7907 + 13);
  const pool = [...NAMES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const weekS = WEEK / 1000;
  const list = pool.slice(0, 99).map((name): Rival => {
    const kind = rng();
    const total =
      kind < 0.07 ? 1800 + rng() * 1300 : kind < 0.27 ? 800 + rng() * 900 : kind < 0.67 ? 300 + rng() * 500 : 40 + rng() * 260;
    // Fanatics play every day; the rest may also play mostly early in the
    // week (then drift off) or mostly late.
    const style = kind < 0.27 ? rng() * 0.6 : rng();
    const when = () => {
      const u = rng();
      return style < 0.55 ? u : style < 0.75 ? u * (0.2 + rng() * 0.3) : 1 - (1 - u) ** 2.2;
    };
    const sittings: Sitting[] = [];
    for (let got = 0; got < total; ) {
      const s = { start: when() * weekS, seed: Math.floor(rng() * 2 ** 32), levels: 5 + Math.floor(rng() ** 1.3 * 36) };
      const all = sittingWins(s);
      sittings.push({ ...s, end: all.at, stars: all.stars });
      got += all.stars;
    }
    const pic = rng();
    return { name, avatar: AVATARS[pic < 0.34 ? 0 : pic < 0.68 ? 1 : pic < 0.9 ? 2 : 3], sittings };
  });
  rivalsCache.clear();
  rivalsCache.set(week, list);
  return list;
}

/**
 * The league right now: you and 99 rivals. Rivals keep playing as you do,
 * winning level after level in their sittings (the ones playing right now
 * gain stars every minute or so, with a green dot), so the table is always
 * on the move and a high place has to be fought for and held. Same week →
 * same rivals, and their stars only ever grow.
 */
export function league(week: number, yourStars: number, now = new Date()): { rows: Standing[]; rank: number } {
  const into = Math.max(0, WEEK - (weekEnd(now).getTime() - now.getTime())) / 1000;
  const rows: Standing[] = rivals(week).map((r) => {
    let stars = 0;
    let live = false;
    for (const s of r.sittings) {
      if (into >= s.end) stars += s.stars;
      else if (into >= s.start) {
        stars += sittingWins(s, into).stars;
        live = true;
      }
    }
    return { name: r.name, stars, you: false, avatar: r.avatar, live };
  });
  rows.push({ name: 'You', stars: yourStars, you: true, avatar: 'ball' });
  rows.sort((a, b) => b.stars - a.stars || (a.you ? -1 : b.you ? 1 : 0));
  return { rows, rank: rows.findIndex((r) => r.you) + 1 };
}
