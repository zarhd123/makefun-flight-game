// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), the WebGL
// renderer paints the world and the DOM HUD paints the instruments. The game
// moves between four screens: title, play, paused and ended (landed / crashed).
//
// ?seed=N fixes the island. ?shot=title|chase|cockpit|coast (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, MAX_FRAME, RINGS, STEP } from './config.js';
import { createRandom } from './random.js';
import { createTerrain } from './terrain.js';
import { createWorld, EVENT_CRASHED, EVENT_LANDED, EVENT_RING } from './world.js';
import { ACTION_CAMERA, ACTION_CONFIRM, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const terrain = createTerrain(seed);
const world = createWorld(terrain, seed);
const renderer = createRenderer(canvas, terrain);
const hud = createHud();
const audio = createAudio();
const input = createInput(canvas);
let camera = 'chase';
let sun = 'day';
let screen = 'title';
let best = 0;

try {
  best = Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
} catch {
  best = 0;
}
function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function announce(message) {
  status.textContent = message;
}

function runShot(name) {
  const scene = stageShot(name, world);
  camera = scene.camera;
  sun = scene.sun;
  screen = scene.screen;
  if (screen === 'title') {
    hud.showScreen('title', { best });
    document.body.classList.add('shot-title');
    announce('Sky Courier. Press Space or click to fly.');
  } else {
    hud.showScreen(null);
    announce('Sky Courier screenshot scene.');
  }
  world.state.messageTimer = 30;
  let painted = 0;
  function paint() {
    renderer.draw(world.state, {
      camera, sun, time: 12, snapCamera: true, dt: 1 / 60,
      chaseDist: scene.chaseDist, chaseHeight: scene.chaseHeight, chaseRight: scene.chaseRight,
      hero: scene.hero,
    });
    hud.update(world.state, RINGS, screen, camera);
    painted += 1;
    if (painted < 3) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();
  let time = 0;

  function startGame() {
    audio.ensure();
    audio.click();
    world.reset();
    screen = 'play';
    camera = 'chase';
    sun = 'day';
    hud.showScreen(null);
    announce(`Flying. ${RINGS.length} rings, then land on runway 09.`);
  }

  function endGame(landed) {
    screen = 'ended';
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    const lines = [
      `Score ${world.state.score} — best ${best}`,
      `Rings ${world.state.ringsDone} of ${RINGS.length} — time ${Math.round(world.state.elapsed)} s`,
      world.state.message,
    ];
    hud.showScreen('ended', { title: landed ? 'Mission complete — welcome home!' : 'Run over', lines });
    announce(`${landed ? 'Landed.' : 'Crashed.'} Score ${world.state.score}. Best ${best}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_CAMERA && screen === 'play') {
      camera = camera === 'chase' ? 'cockpit' : 'chase';
      audio.click();
    }
    if (actions & ACTION_CONFIRM) {
      if (screen === 'title' || screen === 'ended') startGame();
    }
    if (actions & ACTION_PAUSE) {
      if (screen === 'play') {
        screen = 'paused';
        hud.showScreen('paused');
        announce('Paused.');
      } else if (screen === 'paused') {
        screen = 'play';
        hud.showScreen(null);
        announce('Flying.');
      }
    }
  }

  function step() {
    const controls = input.controls();
    const events = world.step(STEP, controls);
    if (events & EVENT_RING) audio.ring();
    if (events & EVENT_LANDED) {
      audio.land();
      endGame(true);
    } else if (events & EVENT_CRASHED) {
      audio.crash();
      endGame(false);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    time += dt;
    handleActions();
    if (screen === 'play') {
      accumulator += dt;
      while (accumulator >= STEP) {
        step();
        accumulator -= STEP;
        if (screen !== 'play') break;
      }
    } else {
      accumulator = 0;
    }
    // On the title screen the world idles: the plane sits on the runway at dawn.
    const drawSun = screen === 'title' ? 'dawn' : sun;
    renderer.draw(world.state, { camera, sun: drawSun, time: time / 1000, dt });
    hud.update(world.state, RINGS, screen, camera);
    audio.update(world.state);
  }

  // Leaving the tab pauses a running game rather than letting it fly unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'play') {
      screen = 'paused';
      hud.showScreen('paused');
      announce('Paused.');
    }
  });

  hud.showScreen('title', { best });
  announce('Sky Courier. Press Space or click to fly.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
