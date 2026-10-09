// Limited-time events. Their items are won by finishing levels while the
// event runs (any level counts); once it ends, items not won leave the shop.

export interface GameEvent {
  id: string;
  name: string;
  icon: string;
  /** Local time span the event runs (ms since the epoch). */
  starts: number;
  ends: number;
}

/** An item that belongs to an event: won after `levels` levels in it. */
export interface EventPrize {
  id: string;
  levels: number;
}

export const EVENTS: GameEvent[] = [
  {
    id: 'halloween26',
    name: 'Halloween',
    icon: '🎃',
    starts: new Date(2026, 9, 1).getTime(),
    ends: new Date(2026, 10, 2).getTime(),
  },
];

/** The event running now, if any. */
export function liveEvent(now = Date.now()): GameEvent | null {
  return EVENTS.find((e) => now >= e.starts && now < e.ends) ?? null;
}
