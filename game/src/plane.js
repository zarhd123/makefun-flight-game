// The courier plane: a low-poly single-prop bush plane built from triangles,
// orange and cream livery with a dark canopy. Forward is -Z, up is +Y.
// buildPlaneMesh returns flat-shaded triangle soup; buildPropMesh returns the
// two-blade propeller, spun around Z by the renderer.
function tri(out, a, b, c, color) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / len, n[1] / len, n[2] / len];
  for (const p of [a, b, c]) {
    out.positions.push(p[0], p[1], p[2]);
    out.colors.push(color[0], color[1], color[2]);
    out.normals.push(n[0], n[1], n[2]);
  }
}

function quad(out, a, b, c, d, color) {
  tri(out, a, b, c, color);
  tri(out, a, c, d, color);
}

// A tapered box (frustum) from a rectangle at z0 to a smaller one at z1.
function frustum(out, z0, w0, h0, y0, z1, w1, h1, y1, color) {
  const a = [-w0 / 2, y0 - h0 / 2, z0];
  const b = [w0 / 2, y0 - h0 / 2, z0];
  const c = [w0 / 2, y0 + h0 / 2, z0];
  const d = [-w0 / 2, y0 + h0 / 2, z0];
  const e = [-w1 / 2, y1 - h1 / 2, z1];
  const f = [w1 / 2, y1 - h1 / 2, z1];
  const g = [w1 / 2, y1 + h1 / 2, z1];
  const h = [-w1 / 2, y1 + h1 / 2, z1];
  quad(out, a, b, f, e, color); // bottom
  quad(out, d, h, g, c, color); // top
  quad(out, a, e, h, d, color); // left
  quad(out, b, c, g, f, color); // right
  quad(out, e, f, g, h, color); // end cap
  quad(out, b, a, d, c, color); // start cap
}

const ORANGE = [0.92, 0.42, 0.12];
const CREAM = [0.96, 0.9, 0.78];
const DARK = [0.16, 0.18, 0.22];
const GLASS = [0.12, 0.28, 0.42];
const GREY = [0.45, 0.47, 0.5];
const RED = [0.85, 0.15, 0.12];
const GREEN = [0.15, 0.75, 0.3];

export function buildPlaneMesh() {
  const out = { positions: [], colors: [], normals: [] };
  // Fuselage: wide cabin tapering to the tail, nose to the prop.
  frustum(out, 2.6, 1.5, 1.5, 0.1, -1.4, 1.15, 1.15, 0.15, ORANGE);
  frustum(out, -1.4, 1.15, 1.15, 0.15, -3.6, 0.42, 0.55, 0.35, CREAM);
  frustum(out, 2.6, 1.5, 1.5, 0.1, 3.4, 1.05, 1.05, 0.05, ORANGE);
  // Canopy: dark glasshouse over the cabin.
  frustum(out, 0.4, 1.05, 0.55, 0.85, 1.9, 0.7, 0.4, 0.62, GLASS);
  frustum(out, -0.9, 0.95, 0.5, 0.82, 0.4, 1.05, 0.55, 0.85, GLASS);
  // Main wing: long, slightly tapered, with cream tips.
  quad(out, [-5.4, 0.28, 0.9], [-5.4, 0.28, -0.5], [-0.8, 0.32, -0.6], [-0.8, 0.32, 0.9], ORANGE);
  quad(out, [0.8, 0.32, 0.9], [0.8, 0.32, -0.6], [5.4, 0.28, -0.5], [5.4, 0.28, 0.9], ORANGE);
  quad(out, [-5.4, 0.28, 0.9], [-0.8, 0.32, 0.9], [-0.8, 0.32, -0.6], [-5.4, 0.28, -0.5], ORANGE);
  quad(out, [0.8, 0.32, -0.6], [0.8, 0.32, 0.9], [5.4, 0.28, 0.9], [5.4, 0.28, -0.5], ORANGE);
  quad(out, [-6.0, 0.26, 0.85], [-6.0, 0.26, -0.45], [-5.4, 0.28, -0.5], [-5.4, 0.28, 0.9], CREAM);
  quad(out, [5.4, 0.28, 0.9], [5.4, 0.28, -0.5], [6.0, 0.26, -0.45], [6.0, 0.26, 0.85], CREAM);
  // Tailplane and fin.
  quad(out, [-1.9, 0.45, -3.35], [-1.9, 0.45, -4.15], [-0.3, 0.5, -4.2], [-0.3, 0.5, -3.4], CREAM);
  quad(out, [0.3, 0.5, -3.4], [0.3, 0.5, -4.2], [1.9, 0.45, -4.15], [1.9, 0.45, -3.35], CREAM);
  quad(out, [-0.08, 0.5, -3.3], [-0.08, 0.5, -4.2], [-0.08, 1.7, -4.05], [-0.08, 1.7, -3.45], ORANGE);
  quad(out, [0.08, 1.7, -3.45], [0.08, 1.7, -4.05], [0.08, 0.5, -4.2], [0.08, 0.5, -3.3], ORANGE);
  // Landing gear: two struts and wheels, plus a tail wheel.
  for (const s of [-1, 1]) {
    quad(out, [s * 0.55, -0.6, 2.0], [s * 0.55, -0.6, 2.25], [s * 0.75, -1.35, 2.25], [s * 0.75, -1.35, 2.0], GREY);
    quad(out, [s * 0.75, -1.35, 2.0], [s * 0.75, -1.35, 2.25], [s * 0.75, -1.35, 2.25], [s * 0.75, -1.35, 2.0], DARK);
    // Wheel: a flattened box.
    frustum(out, 1.85, 0.28, 0.62, -1.45, 2.4, 0.28, 0.62, -1.45, DARK);
  }
  return out;
}

// The builder above is kept simple; the tip lights are separate tiny meshes.
export function buildTipLights() {
  const out = { positions: [], colors: [], normals: [] };
  // Model forward is +Z and up is +Y, so port (left) is +X: red on the left
  // tip, green on the right tip.
  const mk = (x, color) => {
    frustum(out, -0.5, 0.22, 0.22, 0.28, 0.9, 0.22, 0.22, 0.28, color);
    // Shift the frustum's x centre to the wingtip.
    for (let i = out.positions.length - 36 * 3; i < out.positions.length; i += 3) {
      out.positions[i] += x;
    }
  };
  mk(6.0, RED);
  mk(-6.0, GREEN);
  return out;
}

export function buildPropMesh() {
  const out = { positions: [], colors: [], normals: [] };
  // Spinner cone + two blades in the XY plane at the nose (forward is +Z in
  // the model: the nose is at +Z, the tail at -Z), spinning around the
  // plane's forward axis.
  frustum(out, 3.35, 0.42, 0.42, 0, 3.75, 0.1, 0.1, 0, GREY);
  for (const s of [-1, 1]) {
    quad(out, [-0.16, s * 0.25, 3.55], [0.16, s * 0.25, 3.55], [0.13, s * 1.85, 3.5], [-0.13, s * 1.85, 3.5], DARK);
    quad(out, [-0.13, s * 1.85, 3.5], [0.13, s * 1.85, 3.5], [0.16, s * 0.25, 3.55], [-0.16, s * 0.25, 3.55], DARK);
  }
  return out;
}
