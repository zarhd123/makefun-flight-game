// Sky Courier — shared constants for the flight game.
// Units: metres, seconds, degrees. Speeds shown to the player in knots / feet.
export const WORLD = {
  SIZE: 4200, // terrain spans -2100..2100 m on x and z
  SEA_LEVEL: 0,
  GRID: 129, // heightmap samples per side
};

export const PLANE = {
  MAX_SPEED: 95, // m/s (~185 kt) at full throttle, level
  CRUISE_SPEED: 62,
  STALL_SPEED: 24, // below this the wing stops lifting
  TAKEOFF_SPEED: 30,
  THROTTLE_RATE: 0.55, // per second
  PITCH_RATE: 55, // deg/s at full deflection
  ROLL_RATE: 110, // deg/s
  YAW_RATE: 22, // deg/s (rudder)
  MAX_PITCH: 42,
  MAX_ROLL: 75,
  DRAG: 0.29,
  GRAVITY: 9.81,
  // Runway: flat strip on the south-east flats, heading east (090).
  RUNWAY: { x: 1150, z: 950, heading: 90, length: 620, width: 34 },
};

export const COURSE = {
  RING_RADIUS: 20,
  RING_COUNT: 8,
  RING_POINTS: 100,
  LAND_BONUS: 500,
  TIME_BONUS_PER_SEC: 4,
};

// Ring gates: [x, y, z] — a loop out over the coast, through the valley,
// over the mountain pass and back to the runway threshold.
export const RINGS = [
  [1150, 90, 320], // climb-out over the flats
  [700, 130, -250], // over the lagoon
  [-250, 170, -750], // coast headland
  [-1150, 240, -950], // mountain pass
  [-1250, 200, 150], // west ridge
  [-750, 150, 900], // valley run
  [150, 110, 1250], // city overfly
  [1150, 70, 950], // final approach, over the threshold
];

export const BEST_KEY = 'skycourier.best';
export const STEP = 1 / 60;
export const MAX_FRAME = 0.25;
