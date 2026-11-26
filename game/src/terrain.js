// The island: a seeded heightmap with beaches, green valleys, a rocky mountain
// ridge in the north-west, a lagoon, a flat south-east airfield with a runway and
// a small harbour city. All geometry is built once, at boot, from the seed.
import { WORLD, PLANE, RINGS } from './config.js';
import { createRandom, makeNoise } from './random.js';

const HALF = WORLD.SIZE / 2;
const STEP_M = WORLD.SIZE / (WORLD.GRID - 1);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Height of the bare island at (x, z) before the airfield is flattened.
function baseHeight(fbm, x, z) {
  const r = Math.hypot(x, z);
  // Island falloff: land inside ~1900 m, sea beyond.
  const coast = 1 - smoothstep(1500, 2050, r);
  // Rolling hills plus a mountain ridge in the north-west.
  let h = fbm(x * 0.0011 + 7.3, z * 0.0011 + 2.9) * 95 + 42;
  const ridge = Math.exp(-(((x + 1150) ** 2) / (2 * 620 * 620) + ((z + 850) ** 2) / (2 * 520 * 520)));
  h += ridge * 230;
  const peak = Math.exp(-(((x + 1350) ** 2) / (2 * 260 * 260) + ((z + 1050) ** 2) / (2 * 240 * 240)));
  h += peak * 130;
  // A lagoon dip south of the centre.
  const lagoon = Math.exp(-(((x - 650) ** 2) / (2 * 420 * 420) + ((z + 300) ** 2) / (2 * 380 * 380)));
  h -= lagoon * 26;
  h = h * coast - 14 * (1 - coast);
  return h;
}

function flattenAirfield(h, x, z) {
  const rw = PLANE.RUNWAY;
  const d = Math.hypot(x - rw.x, z - rw.z);
  const t = 1 - smoothstep(240, 520, d);
  return h * (1 - t) + 4 * t;
}

export function createTerrain(seed) {
  const fbm = makeNoise(seed);
  const rand = createRandom(seed ^ 0x9e3779b9);
  const N = WORLD.GRID;
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * STEP_M;
      const z = -HALF + j * STEP_M;
      heights[j * N + i] = flattenAirfield(baseHeight(fbm, x, z), x, z);
    }
  }

  function heightAt(x, z) {
    const gx = clamp((x + HALF) / STEP_M, 0, N - 1.001);
    const gz = clamp((z + HALF) / STEP_M, 0, N - 1.001);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const h00 = heights[j * N + i];
    const h10 = heights[j * N + i + 1];
    const h01 = heights[(j + 1) * N + i];
    const h11 = heights[(j + 1) * N + i + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  // Vertex colours by height and slope: sand at the shore, grass in the valleys,
  // rock on steep ground, snow on the high peaks, seabed sand under the water.
  function colorAt(x, z, h, slope) {
    if (h < 0.5) return [0.76, 0.7, 0.5]; // wet sand / seabed
    if (h < 3.5) return [0.93, 0.85, 0.62]; // beach
    if (h > 210) return [0.94, 0.95, 0.97]; // snow
    if (slope > 0.55 || h > 150) return [0.42, 0.38, 0.36]; // rock
    if (h > 95) return [0.36, 0.45, 0.25]; // high meadow
    // Grass with a little patchiness from the noise.
    const p = fbm(x * 0.01, z * 0.01) * 0.5 + 0.5;
    return [0.32 + p * 0.1, 0.58 + p * 0.08, 0.22 + p * 0.05];
  }

  // Build the terrain mesh: positions, per-vertex colours, normals, indices.
  const positions = [];
  const colors = [];
  const normals = [];
  const indices = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * STEP_M;
      const z = -HALF + j * STEP_M;
      const h = heights[j * N + i];
      const hx = heightAt(x + STEP_M, z) - heightAt(x - STEP_M, z);
      const hz = heightAt(x, z + STEP_M) - heightAt(x, z - STEP_M);
      const slope = Math.hypot(hx, hz) / (2 * STEP_M);
      const c = colorAt(x, z, h, slope);
      positions.push(x, h, z);
      colors.push(c[0], c[1], c[2]);
      const inv = 1 / Math.hypot(hx, 2 * STEP_M, hz);
      normals.push(-hx * inv, 2 * STEP_M * inv, -hz * inv);
    }
  }
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // The harbour city: flat-roofed blocks on the flats east of the runway.
  const buildings = [];
  for (let gx = 0; gx < 7; gx++) {
    for (let gz = 0; gz < 5; gz++) {
      if (rand.next() < 0.18) continue; // streets and gaps
      const x = 760 + gx * 78 + rand.range(-8, 8);
      const z = 1180 + gz * 72 + rand.range(-8, 8);
      if (Math.hypot(x - PLANE.RUNWAY.x, z - PLANE.RUNWAY.z) < 330) continue;
      const w = rand.range(22, 40);
      const d = rand.range(22, 40);
      const h = rand.range(9, 46);
      const palette = [
        [0.82, 0.78, 0.72], [0.72, 0.68, 0.62], [0.85, 0.7, 0.55],
        [0.6, 0.66, 0.72], [0.78, 0.62, 0.5], [0.9, 0.88, 0.8],
      ];
      buildings.push({ x, z, w, d, h, color: rand.pick(palette) });
    }
  }

  // Pine trees on the grassy slopes, kept off the runway and the city.
  const trees = [];
  let guard = 0;
  while (trees.length < 420 && guard < 6000) {
    guard++;
    const x = rand.range(-1900, 1900);
    const z = rand.range(-1900, 1900);
    const h = heightAt(x, z);
    if (h < 4 || h > 120) continue;
    if (Math.hypot(x - PLANE.RUNWAY.x, z - PLANE.RUNWAY.z) < 380) continue;
    if (x > 680 && x < 1350 && z > 1100 && z < 1560) continue;
    trees.push({ x, z, y: h, s: rand.range(0.8, 1.6) });
  }

  // Clouds drift slowly above the island.
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    clouds.push({
      x: rand.range(-2000, 2000),
      y: rand.range(320, 480),
      z: rand.range(-2000, 2000),
      s: rand.range(60, 150),
      v: rand.range(2, 5),
    });
  }

  return { heights, heightAt, positions, colors, normals, indices, buildings, trees, clouds, RINGS };
}
