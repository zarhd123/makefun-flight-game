// Seeded random numbers: mulberry32 plus a small value-noise helper, so the
// island, the city and the ring course are identical on every load for a seed.
export function createRandom(seed) {
  let a = seed >>> 0;
  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// Smooth 2D value noise on a lattice, deterministic for a seed.
export function makeNoise(seed) {
  const rand = createRandom(seed);
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand.next() * (i + 1));
    const t = base[i];
    base[i] = base[j];
    base[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };
  function noise2(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = grad(perm[perm[xi] + yi], xf, yf);
    const ba = grad(perm[perm[xi + 1] + yi], xf - 1, yf);
    const ab = grad(perm[perm[xi] + yi + 1], xf, yf - 1);
    const bb = grad(perm[perm[xi + 1] + yi + 1], xf - 1, yf - 1);
    const x1 = aa + (ba - aa) * u;
    const x2 = ab + (bb - ab) * u;
    return (x1 + (x2 - x1) * v) * 0.7071;
  }
  // Fractal Brownian motion, 4 octaves.
  return function fbm(x, y) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < 4; i++) {
      sum += amp * noise2(x * freq, y * freq);
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum;
  };
}
