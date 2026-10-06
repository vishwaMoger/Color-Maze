# Color Maze — Game Design Document

Working title: **Color Maze** (final name TBD — it matters for CTR, see §11).
Platform: **HTML5 (PixiJS / WebGL)**, primary target **CrazyGames** (desktop
landscape + mobile portrait). Reference game studied: *Color Maze Adventure*
(Tripledot Studios). Goal: same proven loop, but more beautiful, smoother and
more interesting.

Success metrics (CrazyGames Basic Launch benchmarks):

| Metric | What drives it | Target |
|---|---|---|
| Conversion to gameplay | Thumbnail, title, instant start | Top of category |
| Avg. playtime per session | "One more level" loop, feel, rewards | 10+ min |
| Day-1 retention | Streak, daily reward, league, unlock goals | 10–15 %+ |

Design pillars: **Relaxation first · Satisfying feel · Always a next goal ·
Clean screen.**

---

## 1. Core gameplay

- Swipe (or arrow keys / WASD) → the ball slides until it hits a wall.
- Every tile it crosses is painted. Paint every tile → level complete.
- No timers, no lives, no fail screen.
- **Free, unlimited, instant Undo** and Restart. Undo never breaks the streak.
- **Getting stuck:**
  - Levels 1–~30 and all bonus levels: impossible to get stuck (every
    reachable position can return to the start).
  - Later normal levels: gentle traps are allowed (a move can lead to a
    dead end); Undo makes this thinking, not punishment.
- **Stars (3 ⭐):** finish in the optimal number of moves for 3 stars;
  close → 2; otherwise → 1. Finishing always gives at least 1 star.

## 2. Levels — infinite

- Generated from the level number (seeded): level N is identical for every
  player → fair leagues, shareable, tiny download.
- Every level verified by a solver: fully paintable, optimal move count
  computed (sets 3-star target), trap rules above enforced.
- **First ~25 levels hand-designed** as a tutorial curve; generator after.
- Level types mixed in a rhythm (easy → medium → hard → breather → bonus):
  - **Picture levels**: carved inside silhouettes (heart, crown, letters,
    animals, objects…), often mirror-symmetric.
  - **Puzzle mazes**: compact, order-of-painting matters.
  - **Panorama bonus levels**: wide, long satisfying swipes, never stuck.
- Quality filter rejects: trivial levels (≤ 3 moves past tutorial), single
  forced paths, ugly fragments, and any shape resembling offensive symbols
  (e.g. swastika-like pinwheels) — required for PEGI-12 review.
- Long staircase diagonals cost many moves → used sparingly, mostly in
  bonus/picture levels.
- Every 5th level is a **Bonus level** (see §5).
- New world theme roughly every 20 levels.
- Later: new mechanics introduced one world at a time (portals, one-way
  arrows, switches/gates, cracked tiles, two balls, ice). Not in v1.

## 3. Feel & effects (the main differentiator)

**Ball**
- Input registers on swipe *movement* (not release); a swipe made while
  sliding is buffered and executed next.
- Quick launch, fast glide, squash on impact with tiny rebound.
- Comet stretch + short soft trail while moving.
- Impact: paint droplets, faint shockwave ring, 2–3 px camera nudge,
  haptic tick on mobile.
- Idle: gentle breathing + slowly moving specular highlight.

**Board while solving**
- Paint flows along the path as a wet glossy stream, then settles to a satin
  finish with faint shimmer.
- Long strokes send a soft light ripple across painted area.
- Unpainted tiles have a very faint breathing glow; when only a few remain,
  they twinkle.
- Board saturation and ambient particles increase with progress.
- Last tile: music swell + split-second slow-motion.

**Level complete**
- Color wave sweeps the board → board lifts/tilts/glows → picture levels
  turn into their finished illustration → stars pop in with rising chimes →
  coins arc into the counter → one tap to next level. Fast and skippable.

**Sound (relaxing, ASMR-like)**
- *Musical painting*: each painted tile plays a note of a pentatonic scale,
  so every swipe is a small melody and nothing sounds wrong.
- Soft whoosh (launch), thock (wall), wet squish (paint), sparkling chime
  (complete). Calm ambient/lo-fi music per world, ducked during play.
- Separate music / SFX toggles. Everything muted during ads.

**Performance**: 60 fps on a 4 GB Chromebook and mid phones; crisp at any
DPR; reduced-motion and colorblind-friendly options.

## 4. UI style

- Soft 3D "clay" buttons that press and spring back; frosted-glass panels.
- Rounded friendly display font (e.g. Fredoka / Baloo), bundled locally for
  release.
- Spring-animated transitions; nothing pops abruptly. Counters roll, coins
  and stars fly to where they belong.
- **Gameplay screen stays clean**: maze, ball, and a few small buttons
  (restart, undo, hint, booster, shop, settings, streak, keys, level/bonus
  progress, coins, league badge).
- Layout: portrait on mobile; landscape on desktop with the maze centred and
  UI in side columns.

## 5. Progression & rewards

- **Coins**: earned from levels, bonus levels, streak, daily reward. Spent on
  hints, boosters, and some cosmetics.
- **Bonus level every 5 levels** → **Super Reward** screen: stars + coins with
  a sweeping multiplier bar (x3 · x4 · x7 · x4 · x3) — tap to stop. Pointer
  eases near x7; ticks per segment; x7 triggers gold flash + confetti.
  Full Launch adds an optional "🎬 Double it" rewarded ad.
  Stars and coins are both multiplied; stars feed the league.
- **Win streak** (paint-can counter): grows each level finished without
  restarting/quitting (Undo is fine). Rewards at 3 / 5 / 10…; hot-streak
  cosmetic flair (glowing trail). Soft break: "save streak" once per day
  free (or rewarded ad in Full Launch).
- **Keys 🔑 → Safe**: keys drop from levels; 3 keys open a safe with coins
  and occasionally safe-exclusive cosmetics.
- **New Item bar**: always visible progress toward the next unlock.
- **Daily reward** with a 7-day streak calendar; **daily picture puzzle**.

## 6. Shop / collections

Tabs: **Ball · Paint · Maze (board) · Trail**.
- Unlock routes: free default · level milestones · coins · keys/safe
  exclusives · rewarded ads (Full Launch only, always with a non-ad
  alternative — Basic Launch has no ads and some players use ad-blockers).
- Cadence: faster at the start (≈ levels 5, 10, 15, 25, 35…), then roughly
  every 15 levels, rotating categories, then legendary items at big
  milestones (250, 500, 1000…) and themed sets per world → never runs out.
- Try-before-unlock live preview; red notification dots on new unlocks.
- **Boards are real materials with lighting** (wood, marble, terrazzo, grass,
  sand, felt, metal, glass, candy) and **animated boards** (Ocean caustics,
  Ice that melts under paint, Night sky stars, Lava pulse, Garden, Neon
  edges). Boards react to impacts. Generated procedurally (tiny download).
- Every board × paint combination passes a contrast check.

## 7. Hints & boosters

- **Hint 💡**: shows the next optimal move(s) as soft animated chevrons.
  First free each day; then coins (or rewarded ad in Full Launch).
- **Paint Bomb booster**: a glossy paint ball launches from the button,
  splits into 3 and splats onto the most awkward unpainted tiles (chosen by
  the solver to shorten the remaining solution). Coins / rewarded ad.

## 8. Weekly league (v1: bot league)

- Leagues (Rookie → …) with trophy tiers; ranking by stars collected this
  week; resets Sunday; top 3 get gift boxes; promotion/relegation.
- v1 uses simulated players (seeded names/avatars, plausible score curves)
  — works offline, no server. Later: real leaderboard via CrazyGames accounts
  + small backend.
- After rewards, the player's row animates climbing the table.

## 9. Monetization & ads (CrazyGames)

- **Basic Launch** (2-week test, limited audience): no ads, SDK optional.
  Everything must be earnable without ads. Focus 100 % on metrics.
- **Full Launch**: CrazyGames SDK v3 required — wrapped behind one module so
  it switches on with a flag:
  - `loadingStart/Stop`, `gameplayStart/Stop` around real play,
    `happytime()` on level complete / big rewards, settings listener
    (mute), audio muted during ads, ad error codes handled.
  - Midgame ads only between levels, ≥ 3 min apart (CG enforces it too).
  - Rewarded ads: double reward, hint, booster, streak save, +coins, skin
    shortcut. Always optional.
  - **Banners: never on the gameplay screen by default.** Only on screens
    players stay on ≥ 5 s: shop, league, pause, daily reward. Flush to an
    edge, 10–15 px clear of buttons, ≤ 1 refresh/60 s. Optional experiment
    later: desktop side-column or a reserved mobile bottom strip — the
    layout reserves the space so it can be enabled without redesign.
  - Cloud save via `sdk.data` for logged-in players (+ localStorage).

## 10. CrazyGames technical requirements (checklist)

- Initial download ≤ 20 MB for mobile homepage eligibility (target < 5 MB);
  total ≤ 250 MB; ≤ 1500 files; relative paths only; `index.html` entry.
- Gameplay reachable within ~20 s (target: < 3 s, level 1 starts instantly).
- Landscape-friendly on desktop; runs on a 4 GB Chromebook.
- English required; PEGI 12 content.

## 11. Store presence (CTR)

- Thumbnail: one bold, high-contrast image readable at tiny size — glossy
  ball streaking a vivid paint trail through a half-painted recognisable
  shape. Produce 2–3 variants.
- Title: short, searchable ("Paint", "Maze", "Roll", "Color").
- Short gameplay video of the most satisfying moments.

## 12. Build plan

1. **Feel prototype** (current): one screen, a handful of levels, ball
   physics, liquid paint, board effects, sounds, level-complete sequence,
   3 board themes incl. one animated. Playable link for phone + desktop.
2. Core game: infinite generator v2 (pictures, quality filter, traps),
   stars, undo, progression save, responsive layouts.
3. Meta: coins, Super Reward, streak, keys/safe, shop, hints, booster.
4. League (bots), daily reward/puzzle, settings.
5. CrazyGames SDK module, banners on allowed screens, QA checklist.
6. Thumbnails, title, video → Basic Launch.
