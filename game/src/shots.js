// The screenshot scenes behind ?shot=title|chase|cockpit|coast. Each one plays
// the real rules forward from a fresh world for a fixed number of steps,
// steered by a simple autopilot that flies toward the next ring, so the frame
// is what real play looks like and the same seed always gives the same frame.
import { RINGS, STEP } from './config.js';

const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Steer toward the next ring: bank gently to the bearing, pitch to the
// altitude, ease the throttle toward the given setting. Returns the input
// world.step expects (throttle is a rate, not a setting).
function autopilot(state, target, throttle) {
  const dx = target[0] - state.x;
  const dz = target[2] - state.z;
  // Bearing: 0 = north (-z), 90 = east (+x).
  let bearing = (Math.atan2(dx, -dz) / DEG + 360) % 360;
  let diff = ((bearing - state.heading + 540) % 360) - 180;
  const roll = clamp(diff / 60, -0.55, 0.55);
  const dy = target[1] - state.y;
  const pitch = clamp(dy / 90, -0.45, 0.45);
  const setting = throttle ?? 0.7;
  return { pitch, roll, yaw: 0, throttle: clamp((setting - state.throttle) * 3, -1, 1), brake: false };
}

function flyFor(world, seconds, targetFn, throttle) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    const state = world.state;
    if (state.phase !== 'flying') break;
    const target = targetFn(state);
    world.step(STEP, autopilot(state, target, throttle));
  }
}

/**
 * Set `world` to the named scene and return what to draw over it:
 * the screen overlay, the camera, the sun preset and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  const state = world.state;
  if (name === 'title') {
    // Parked on the runway at dawn, engine idling, title screen over it. The
    // hero camera sits ahead and to the side; the title panel steps to the
    // right (body.shot-title) so the lit nose and the runway read at the
    // left of the frame instead of behind the panel.
    state.phase = 'title';
    state.throttle = 0.15;
    state.y = 5.6;
    state.propAngle = 0.7; // blades rest at a diagonal, like a parked prop
    state.message = '';
    state.messageTimer = 0;
    return { screen: 'title', camera: 'chase', sun: 'dawn', best: 0, snapCamera: true, hero: { fwd: 18, right: -6, up: 5, tFwd: 0, tRight: -7, tUp: 1 } };
  }
  if (name === 'chase') {
    // Take off, climb out and chase the rings: 26 s of real flight at cruise.
    flyFor(world, 26, (s) => RINGS[s.ring % RINGS.length], 0.7);
    return { screen: 'play', camera: 'chase', sun: 'day', best: state.score, snapCamera: true };
  }
  if (name === 'cockpit') {
    // Course flown, on final approach to the runway at golden hour, at
    // approach speed with the throttle back.
    state.ringsDone = RINGS.length;
    state.ring = RINGS.length;
    state.score = RINGS.length * 100;
    state.x = 480;
    state.y = 95;
    state.z = 950;
    state.heading = 90;
    state.pitch = -4;
    state.roll = 0;
    state.speed = 52;
    state.throttle = 0.4;
    state.airborne = true;
    state.message = 'Final approach — runway 09 ahead. Ease the throttle back and flare.';
    state.messageTimer = 30;
    flyFor(world, 1.5, () => [1150, 45, 950], 0.4);
    return { screen: 'play', camera: 'cockpit', sun: 'golden', best: state.score, snapCamera: true };
  }
  // coast: low over the headland toward the mountain pass, two rings already
  // banked — staged directly (no autopilot) so the next ring sits in frame.
  state.ringsDone = 2;
  state.ring = 2;
  state.score = 2 * 100;
  state.x = 26;
  state.y = 170;
  state.z = -533;
  state.heading = 308;
  state.pitch = -1;
  state.roll = -6;
  state.speed = 65;
  state.throttle = 0.65;
  state.airborne = true;
  state.message = 'Ring 3 of 8 — through the mountain pass next.';
  state.messageTimer = 30;
  return { screen: 'play', camera: 'chase', sun: 'day', best: state.score, snapCamera: true };
}
