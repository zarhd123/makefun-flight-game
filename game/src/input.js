// Keyboard and mouse input for the flight game. Held keys steer; one-shot
// presses (confirm, pause, camera) are queued as bit flags and taken once by
// the loop, so a press between two frames is never lost or counted twice.
// Mouse: drag steers pitch/roll, wheel is the throttle.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_CAMERA = 4;

const PITCH_UP = new Set(['ArrowUp', 'KeyW']);
const PITCH_DOWN = new Set(['ArrowDown', 'KeyS']);
const ROLL_LEFT = new Set(['ArrowLeft', 'KeyA']);
const ROLL_RIGHT = new Set(['ArrowRight', 'KeyD']);
const YAW_LEFT = new Set(['KeyQ']);
const YAW_RIGHT = new Set(['KeyE']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const CAMERA = new Set(['KeyC']);
const BRAKE = new Set(['KeyB']);

export function createInput(target) {
  const held = new Set();
  let actions = 0;
  let mousePitch = 0;
  let mouseRoll = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let wheelThrottle = 0;

  window.addEventListener('keydown', (event) => {
    if (PITCH_UP.has(event.code) || PITCH_DOWN.has(event.code) || ROLL_LEFT.has(event.code)
      || ROLL_RIGHT.has(event.code) || YAW_LEFT.has(event.code) || YAW_RIGHT.has(event.code)
      || THROTTLE_UP.has(event.code) || THROTTLE_DOWN.has(event.code) || BRAKE.has(event.code)) {
      held.add(event.code);
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (CAMERA.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CAMERA;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go on blur.
  window.addEventListener('blur', () => {
    held.clear();
    dragging = false;
  });

  target.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    mouseRoll = Math.max(-1, Math.min(1, mouseRoll + dx / 160));
    mousePitch = Math.max(-1, Math.min(1, mousePitch + dy / 160));
  });
  target.addEventListener('pointerup', () => {
    dragging = false;
    mousePitch = 0;
    mouseRoll = 0;
  });
  target.addEventListener('wheel', (event) => {
    wheelThrottle += event.deltaY < 0 ? 0.12 : -0.12;
    event.preventDefault();
  }, { passive: false });

  function has(set) {
    for (const code of set) if (held.has(code)) return true;
    return false;
  }

  return {
    // Stick inputs, each -1..1: pitch (up positive), roll (right positive),
    // yaw (right positive), throttle change (-1..1 per second, roughly).
    controls() {
      const pitch = (has(PITCH_UP) ? 1 : 0) - (has(PITCH_DOWN) ? 1 : 0) - mousePitch;
      const roll = (has(ROLL_RIGHT) ? 1 : 0) - (has(ROLL_LEFT) ? 1 : 0) + mouseRoll;
      const yaw = (has(YAW_RIGHT) ? 1 : 0) - (has(YAW_LEFT) ? 1 : 0);
      let throttle = (has(THROTTLE_UP) ? 1 : 0) - (has(THROTTLE_DOWN) ? 1 : 0) + wheelThrottle;
      wheelThrottle = 0;
      return {
        pitch: Math.max(-1, Math.min(1, pitch)),
        roll: Math.max(-1, Math.min(1, roll)),
        yaw,
        throttle: Math.max(-1, Math.min(1, throttle)),
        brake: has(BRAKE),
      };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
