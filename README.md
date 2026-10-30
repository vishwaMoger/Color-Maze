<p align="center">
  <img width="100%" src="https://capsule-render.vercel.app/api?type=slice&color=0:FF5E7E,25:FFD93D,50:6BCB77,75:4D96FF,100:9B5DE5&height=260&section=header&text=%F0%9F%8E%A8%20COLOR%20MAZE&fontSize=76&fontColor=ffffff&fontAlign=60&fontAlignY=38&rotate=-6&stroke=000000&strokeWidth=2&desc=Swipe.%20Slide.%20Paint%20every%20tile.&descSize=24&descAlign=60&descAlignY=60&animation=fadeIn" alt="Color Maze" />
</p>

<p align="center">
  <img src="docs/hero.svg" width="640" alt="Animated: a glowing ball slides through a maze painting every tile in rainbow colours" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fredoka&weight=600&size=24&duration=2500&pause=600&color=F15BB5&center=true&vCenter=true&width=700&lines=%F0%9F%91%86+Swipe+the+ball...;%F0%9F%8F%83+It+slides+until+it+hits+a+wall...;%F0%9F%8E%A8+Every+tile+it+crosses+gets+painted!;%E2%AD%90+Paint+them+all+to+win.;%E2%99%BE%EF%B8%8F+Infinite+levels.+Zero+stress." alt="tagline" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/PixiJS-8-E72264?style=for-the-badge&logo=pixijs&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/WebGL-HTML5-990000?style=for-the-badge&logo=webgl&logoColor=white" />
  <img src="https://img.shields.io/badge/Platform-Desktop%20%2B%20Mobile%20Web-6BCB77?style=for-the-badge&logo=googlechrome&logoColor=white" />
  <img src="https://img.shields.io/badge/Genre-Relaxing%20Puzzle-9B5DE5?style=for-the-badge" />
</p>

---

<p align="center">
  <img width="100%" src="docs/readme/pillars.svg" alt="Design pillars: Relax First, Satisfying Feel, Next Goal, Clean Screen" />
</p>

---

<h2 align="center">🎮 HOW IT PLAYS</h2>

```mermaid
flowchart LR
    S(["👆 Swipe<br/>or WASD / arrows"]):::a --> G["🏃 Ball glides<br/>until it hits a wall"]:::b
    G --> P["🎨 Tiles painted<br/>+ musical note 🎵"]:::c
    P --> Q{"All tiles<br/>painted?"}:::d
    Q -- "not yet" --> S
    Q -- "yes!" --> W["🌊 Colour wave<br/>⭐⭐⭐ stars<br/>🪙 coins"]:::e
    W --> N(["➡️ Next level"]):::a
    classDef a fill:#F15BB5,color:#fff,stroke:#fff
    classDef b fill:#FF9F45,color:#000,stroke:#fff
    classDef c fill:#FFD93D,color:#000,stroke:#fff
    classDef d fill:#4D96FF,color:#fff,stroke:#fff
    classDef e fill:#6BCB77,color:#000,stroke:#fff
```

<p align="center">
⭐⭐⭐ <b>Optimal moves</b> &nbsp;·&nbsp; ⭐⭐ <b>Close</b> &nbsp;·&nbsp; ⭐ <b>Finished</b> — you always get at least one star.
</p>

---

<p align="center">
  <img width="100%" src="docs/readme/levels.svg" alt="Infinite levels: seeded, solver-checked, hand-made start, picture, puzzle and bonus levels" />
</p>

```mermaid
flowchart LR
    E["😌 Easy"]:::e --> M["🙂 Medium"]:::m --> H["🧠 Hard"]:::h --> B["😮‍💨 Breather"]:::e --> X["🎁 BONUS<br/>x3 · x4 · x7 multiplier"]:::x --> E
    classDef e fill:#6BCB77,color:#000,stroke:#fff
    classDef m fill:#FFD93D,color:#000,stroke:#fff
    classDef h fill:#FF5E7E,color:#fff,stroke:#fff
    classDef x fill:#9B5DE5,color:#fff,stroke:#fff
```

---

<p align="center">
  <img width="100%" src="docs/readme/juice.svg" alt="Feel and juice: the ball, the board, level clear, musical paint" />
</p>

---

<h2 align="center">🎁 PROGRESSION & REWARDS</h2>

```mermaid
mindmap
  root((🎨 Color Maze))
    🪙 Coins
      Hints
      Boosters
      Cosmetics
    🔥 Win Streak
      Rewards at 3 / 5 / 10
      Glowing trail
      Daily streak save
    🔑 Keys
      3 keys open a Safe
      Exclusive cosmetics
    📅 Daily
      7-day calendar
      Daily picture puzzle
    🛍️ Shop
      Balls
      Paints
      Boards
      Trails
```

<p align="center">
<b>🛍️ Animated boards:</b> 🌊 Ocean caustics · 🧊 Ice that melts under paint · 🌌 Night sky · 🌋 Lava pulse · 🌷 Garden · 💡 Neon edges<br/>
<sub>Real lit materials: wood, marble, terrazzo, grass, sand, felt, metal, glass, candy. Every board × paint combination passes a contrast check.</sub>
</p>

---

<p align="center">
  <img width="100%" src="docs/readme/tech.svg" alt="Tech: 60 FPS, any screen, accessible, auto-tested" />
</p>

```text
src/
├── game/        🎮 core mechanics, ball physics, painting
├── levels/      ♾️ seeded generator + solver
├── ui/          🖼️ clay buttons, frosted panels, spring transitions
├── audio/       🎵 musical painting + SFX
├── platform/    🌐 web portal SDK integration
└── assets/      🎨 sprites & fonts
scripts/
├── check-levels.ts      🤖 verify every level is solvable
├── check-mechanics.ts   🧪 mechanics regression tests
└── render-*.py          🖌️ procedural icon renders (coin, key, star…)
```

---

<h2 align="center">🚀 RUN IT</h2>

```bash
git clone https://github.com/vishwaMoger/Color-Maze.git
cd Color-Maze
npm install
npm run dev
```

| Command | What it does |
|:--|:--|
| `npm run dev` | 🔥 Start the dev server with hot reload |
| `npm run build` | 📦 Type-check and build for production |
| `npm test` | 🧪 Type-check, mechanics tests and verify 60 levels |
| `npm run check-levels` | 🤖 Run the level solver |
| `npm run build:crazygames` | 🌐 Build the web-portal package |

📄 Full design document: [`docs/DESIGN.md`](docs/DESIGN.md)

---

<p align="center">
  <b>Made with ❤️ and a lot of 🎨 by <a href="https://github.com/vishwaMoger">Vishwa Moger</a></b><br/>
  <sub>Game Developer · 3+ years · Bangalore, India</sub>
</p>

<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:9B5DE5,25:4D96FF,50:6BCB77,75:FFD93D,100:FF5E7E&height=120&section=footer" />
