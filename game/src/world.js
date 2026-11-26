// Flight model and game rules, with no drawing and no browser in it: an arcade
// flight model (throttle, pitch, roll, rudder), terrain and water collisions,
// the 8-ring courier course, runway landings, score and timer. step() advances
// one fixed step and returns what happened as bit flags.
import { COURSE, PLANE, RINGS, STEP } from './config.js';

export const EVENT_RING = 1;
export const EVENT_LANDED = 2;
export const EVENT_CRASHED = 4;
export const EVENT_TAKEOFF = 8;

const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createWorld(terrain, seed) {
  const rw = PLANE.RUNWAY;
  const state = {
    // Position and attitude.
    x: rw.x - 260, y: 6, z: rw.z,
    heading: 90, pitch: 0, roll: 0,
    speed: 0, throttle: 0,
    vspeed: 0,
    // Course progress.
    ring: 0, ringsDone: 0, score: 0, elapsed: 0,
    // Screens.
    phase: 'title', // title | flying | landed | crashed
    message: '',
    messageTimer: 0,
    propAngle: 0,
    airborne: false,
    landed: false,
    best: 0,
  };

  function reset() {
    state.x = rw.x - 260;
    state.y = 5.6; // parked on the flattened airfield (ground 4 m + gear)
    state.z = rw.z;
    state.heading = 90;
    state.pitch = 0;
    state.roll = 0;
    state.speed = 0;
    state.throttle = 0;
    state.vspeed = 0;
    state.ring = 0;
    state.ringsDone = 0;
    state.score = 0;
    state.elapsed = 0;
    state.phase = 'flying';
    state.message = 'Take off! Full throttle, then pull up gently.';
    state.messageTimer = 6;
    state.airborne = false;
    state.landed = false;
  }

  function onRunway(x, z) {
    const dx = x - rw.x;
    const dz = z - rw.z;
    // Runway runs east-west (heading 090): length along x, width along z.
    return Math.abs(dx) < rw.length / 2 && Math.abs(dz) < rw.width / 2;
  }

  function ringTarget() {
    return RINGS[state.ring % RINGS.length];
  }

  // Forward unit vector from heading/pitch (heading 0 = north, -z; 90 = east, +x).
  function forwardVector() {
    const h = state.heading * DEG;
    const p = state.pitch * DEG;
    return [
      Math.sin(h) * Math.cos(p),
      Math.sin(p),
      -Math.cos(h) * Math.cos(p),
    ];
  }

  function step(dt, input) {
    let events = 0;
    if (state.phase !== 'flying') return events;
    state.elapsed += dt;
    if (state.messageTimer > 0) state.messageTimer -= dt;

    // Throttle.
    state.throttle = clamp(state.throttle + input.throttle * PLANE.THROTTLE_RATE * dt, 0, 1);
    if (input.brake) state.throttle = Math.max(0, state.throttle - 0.9 * dt);

    // Attitude: pitch and roll ease toward the stick, rudder yaws the nose.
    const pitchTarget = clamp(input.pitch * PLANE.MAX_PITCH, -PLANE.MAX_PITCH, PLANE.MAX_PITCH);
    const rollTarget = clamp(input.roll * PLANE.MAX_ROLL, -PLANE.MAX_ROLL, PLANE.MAX_ROLL);
    state.pitch += clamp(pitchTarget - state.pitch, -PLANE.PITCH_RATE * dt, PLANE.PITCH_RATE * dt);
    state.roll += clamp(rollTarget - state.roll, -PLANE.ROLL_RATE * dt, PLANE.ROLL_RATE * dt);
    state.heading += (input.yaw * PLANE.YAW_RATE + Math.sin(state.roll * DEG) * 42) * dt;
    state.heading = ((state.heading % 360) + 360) % 360;

    // Speed: thrust along the nose, drag, and gravity's pull on climbs.
    const fwd = forwardVector();
    const thrust = state.throttle * 26;
    let accel = thrust - PLANE.DRAG * state.speed - PLANE.GRAVITY * Math.sin(state.pitch * DEG) * 0.55;
    const groundH = terrain.heightAt(state.x, state.z);
    const onGround = state.y <= groundH + 1.6;
    if (!state.airborne) {
      accel -= 3.5; // rolling resistance
      if (state.speed < PLANE.TAKEOFF_SPEED) state.pitch = Math.max(0, state.pitch * 0.9);
    }
    state.speed = Math.max(0, state.speed + accel * dt);
    if (state.speed > PLANE.MAX_SPEED) state.speed = PLANE.MAX_SPEED;

    // Lift: below stall speed the wing cannot hold the plane up. On the
    // ground the plane rolls until it is fast enough AND rotated (pitch up);
    // only then does it leave the runway.
    const liftFactor = clamp((state.speed - PLANE.STALL_SPEED * 0.55) / (PLANE.STALL_SPEED * 0.9), 0, 1);
    const prevY = state.y;
    state.x += fwd[0] * state.speed * dt;
    state.z += fwd[2] * state.speed * dt;
    if (!state.airborne) {
      state.y = groundH + 1.6;
      if (state.speed > PLANE.TAKEOFF_SPEED && state.pitch > 3) {
        state.airborne = true;
        events |= EVENT_TAKEOFF;
        state.message = 'Airborne! Fly through the glowing rings, then land back on the runway.';
        state.messageTimer = 6;
      }
    } else {
      // In the air the wing carries the climb; near stall it sinks.
      state.y = state.y + fwd[1] * state.speed * liftFactor * dt - (1 - liftFactor) * 9 * dt;
    }
    state.vspeed = (state.y - prevY) / dt;
    state.propAngle += (4 + state.throttle * 38) * dt;

    // Ring gates: pass within the ring's radius while crossing its plane.
    const target = ringTarget();
    const dx = state.x - target[0];
    const dy = state.y - target[1];
    const dz = state.z - target[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < COURSE.RING_RADIUS * 0.95) {
      state.ringsDone += 1;
      state.score += COURSE.RING_POINTS;
      state.ring += 1;
      events |= EVENT_RING;
      if (state.ringsDone >= COURSE.RING_COUNT) {
        state.message = 'Course complete! Land on the runway for the bonus.';
        state.messageTimer = 8;
      } else {
        state.message = `Ring ${state.ringsDone} of ${COURSE.RING_COUNT}! Next ring ahead.`;
        state.messageTimer = 3;
      }
    }

    // Ground and water.
    const h = terrain.heightAt(state.x, state.z);
    const worldEdge = 2050;
    if (Math.abs(state.x) > worldEdge || Math.abs(state.z) > worldEdge) {
      state.message = 'Turn back — you are leaving the island!';
      state.messageTimer = 2;
    }
    if (state.y <= h + 1.2) {
      // Touchdown: a gentle landing on the runway counts; anything else is a crash.
      const gentle = state.vspeed > -4.5 && state.speed < 58 && Math.abs(state.roll) < 18;
      if (onRunway(state.x, state.z) && gentle && state.airborne) {
        state.phase = 'landed';
        state.landed = true;
        const timeBonus = Math.max(0, Math.round(600 - state.elapsed) * COURSE.TIME_BONUS_PER_SEC);
        const courseBonus = state.ringsDone >= COURSE.RING_COUNT ? COURSE.LAND_BONUS : 0;
        state.score += timeBonus + courseBonus;
        state.message = `Landed! Time bonus +${timeBonus}${courseBonus ? `, course bonus +${courseBonus}` : ''}.`;
        events |= EVENT_LANDED;
      } else if (state.airborne || state.speed > 12) {
        state.phase = 'crashed';
        state.message = state.y <= 1.2 && h < 0.5
          ? 'Ditched in the sea! The courier floats, but the run is over.'
          : 'Crashed into the terrain! The courier is a write-off.';
        events |= EVENT_CRASHED;
      } else {
        // Rolling to a stop on the ground.
        state.y = h + 1.6;
        if (state.speed < 0.5 && state.throttle < 0.05) {
          state.speed = 0;
        }
      }
    }
    if (state.y < 0.4 && h < 0.5) {
      // In the water.
      if (state.airborne || state.speed > 12) {
        state.phase = 'crashed';
        state.message = 'Ditched in the sea! The courier floats, but the run is over.';
        events |= EVENT_CRASHED;
      }
    }
    return events;
  }

  return { state, reset, step, ringTarget, onRunway, forwardVector };
}
