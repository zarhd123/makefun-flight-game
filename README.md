# makefun-flight-game

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/zarhd123/makefun-flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/zarhd123/makefun-flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

Sky Courier — a 3D bush-plane flight game: take off from runway 09, thread eight glowing rings around the island of Kalandra, and bring her home for a gentle landing. A hand-rolled WebGL renderer paints the island (beaches, mountains, lagoon, harbour city, runway), a full HUD shows altitude, speed, heading, throttle, climb rate, compass, attitude and a minimap, and procedural WebAudio gives you the engine drone, wind and ring chimes. No library, no network request, no assets: every line of the game is original code.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. Or open `game/index.html` directly.

## Play

- **W / S** — throttle up / down (mouse wheel works too)
- **Arrow Up / Down** — pitch, **Arrow Left / Right** — roll, **Q / E** — rudder
- **B** — airbrake, **C** — cockpit / chase camera, **P** — pause
- Drag with the mouse to steer.

Fly through all eight rings in order, then land on the runway: a gentle touchdown (slow descent, wings level, on the asphalt) scores the time and course bonuses. Hit a mountain or ditch in the sea and the run is over. Best score is kept in your browser.

## Screenshots

The four screenshots under `screenshots/` are real renders of this game, staged with `?shot=title|chase|cockpit|coast&seed=7` and captured with a headless browser (`node capture.mjs`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=kpx4mmmd&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
