// Drawing only: a hand-rolled WebGL renderer (no library, no network). One lit
// shader paints the terrain, water, runway, city, trees, rings, clouds and the
// plane; a sky dome, sun and fog frame the scene. Two cameras: chase and
// cockpit. All geometry is built once from the terrain; per frame only the
// plane, the prop and the clouds move.
import { PLANE, RINGS, WORLD } from './config.js';
import { buildPlaneMesh, buildPropMesh, buildTipLights } from './plane.js';

const DEG = Math.PI / 180;

// ---- tiny mat4 helpers (column-major, like WebGL expects) ----
function matIdentity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function matMultiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function matPerspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovDeg * DEG) / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}
function matLookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const o = new Float32Array(16);
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  o[15] = 1;
  return o;
}
function matRotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
function matRotX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
function matRotZ(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function matTranslate(x, y, z) {
  const o = matIdentity();
  o[12] = x; o[13] = y; o[14] = z;
  return o;
}
function matScale(sx, sy, sz) {
  const o = matIdentity();
  o[0] = sx; o[5] = sy; o[10] = sz;
  return o;
}

// Plane orientation: the model is built with its nose at +Z and its tail at
// -Z, while the world flies with forward (sin h, -, -cos h). R =
// Ry(180° - heading) * Rx(-pitch) * Rz(-roll) maps the model onto the flight.
export function planeMatrix(state) {
  const yaw = matRotY((180 - state.heading) * DEG);
  const pitch = matRotX(-state.pitch * DEG);
  const roll = matRotZ(state.roll * DEG);
  const rot = matMultiply(yaw, matMultiply(pitch, roll));
  return matMultiply(matTranslate(state.x, state.y, state.z), rot);
}
export function planeForward(state) {
  const h = state.heading * DEG;
  const p = state.pitch * DEG;
  return [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
}

const VERT = `
attribute vec3 aPos; attribute vec3 aColor; attribute vec3 aNormal;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vColor; varying vec3 vNormal; varying float vDepth;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vec4 cp = uMVP * wp;
  gl_Position = cp;
  vColor = aColor;
  vNormal = normalize(mat3(uModel) * aNormal);
  vDepth = -cp.z;
}`;
const FRAG = `
precision mediump float;
uniform vec3 uSun; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
uniform float uEmissive; uniform float uAlpha;
varying vec3 vColor; varying vec3 vNormal; varying float vDepth;
void main() {
  vec3 n = normalize(vNormal);
  float diff = 0.55 + 0.45 * max(dot(n, normalize(uSun)), 0.0);
  vec3 col = uEmissive > 0.5 ? vColor : vColor * diff;
  float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFogColor, f), uAlpha);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

// ---- mesh helpers: push triangles with flat normals into arrays ----
function triPos(out, a, b, c, color) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / len, n[1] / len, n[2] / len];
  for (const p of [a, b, c]) {
    out.positions.push(p[0], p[1], p[2]);
    out.colors.push(color[0], color[1], color[2]);
    out.normals.push(n[0], n[1], n[2]);
  }
}
function quadPos(out, a, b, c, d, color) {
  triPos(out, a, b, c, color);
  triPos(out, a, c, d, color);
}
function boxPos(out, cx, cy, cz, w, h, d, color, topColor) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  quadPos(out, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color); // bottom
  quadPos(out, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], topColor || color); // top
  quadPos(out, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color); // left
  quadPos(out, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], color); // right
  quadPos(out, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], color); // back
  quadPos(out, [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1], color); // front
}
function conePos(out, cx, cy, cz, r, h, color, sides) {
  const top = [cx, cy + h, cz];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
    triPos(out, p0, p1, top, color);
    triPos(out, [cx, cy, cz], p1, p0, color);
  }
}

// A torus ring in the XY plane, centred at the origin, facing +Z.
function torus(out, radius, tube, color, seg, tubeSeg) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    for (let j = 0; j < tubeSeg; j++) {
      const b0 = (j / tubeSeg) * Math.PI * 2;
      const b1 = ((j + 1) / tubeSeg) * Math.PI * 2;
      const p = (a, b) => [
        (radius + tube * Math.cos(b)) * Math.cos(a),
        (radius + tube * Math.cos(b)) * Math.sin(a),
        tube * Math.sin(b),
      ];
      const n = (a, b) => [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
      const q = [p(a0, b0), p(a1, b0), p(a1, b1), p(a0, b1)];
      const nn = [n(a0, b0), n(a1, b0), n(a1, b1), n(a0, b1)];
      for (const [v, nv] of [[q[0], nn[0]], [q[1], nn[1]], [q[2], nn[2]]]) {
        out.positions.push(v[0], v[1], v[2]);
        out.colors.push(color[0], color[1], color[2]);
        out.normals.push(nv[0], nv[1], nv[2]);
      }
      for (const [v, nv] of [[q[0], nn[0]], [q[2], nn[2]], [q[3], nn[3]]]) {
        out.positions.push(v[0], v[1], v[2]);
        out.colors.push(color[0], color[1], color[2]);
        out.normals.push(nv[0], nv[1], nv[2]);
      }
    }
  }
}

// Sky dome: a half-sphere whose vertex colour blends horizon to zenith.
function skyDome(radius, horizon, zenith) {
  const out = { positions: [], colors: [], normals: [] };
  const segs = 24;
  const rings = 8;
  for (let j = 0; j < rings; j++) {
    const t0 = j / rings;
    const t1 = (j + 1) / rings;
    const y0 = Math.sin(t0 * Math.PI * 0.5) * radius;
    const y1 = Math.sin(t1 * Math.PI * 0.5) * radius;
    const r0 = Math.cos(t0 * Math.PI * 0.5) * radius;
    const r1 = Math.cos(t1 * Math.PI * 0.5) * radius;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const c0 = horizon.map((v, k) => v + (zenith[k] - v) * t0);
      const c1 = horizon.map((v, k) => v + (zenith[k] - v) * t1);
      const p = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r];
      triPos(out, p(r0, y0, a0), p(r1, y1, a0), p(r1, y1, a1), c0);
      triPos(out, p(r0, y0, a0), p(r1, y1, a1), p(r0, y0, a1), c0);
      void c1;
    }
  }
  return out;
}

export const SUN_PRESETS = {
  dawn: { dir: [0.55, 0.28, -0.79], horizon: [1.0, 0.72, 0.45], zenith: [0.35, 0.5, 0.78], fog: [0.98, 0.78, 0.58] },
  day: { dir: [0.45, 0.75, -0.48], horizon: [0.74, 0.86, 0.96], zenith: [0.16, 0.42, 0.78], fog: [0.78, 0.87, 0.94] },
  golden: { dir: [-0.62, 0.3, 0.55], horizon: [1.0, 0.66, 0.38], zenith: [0.3, 0.44, 0.72], fog: [0.96, 0.72, 0.5] },
};

export function createRenderer(canvas, terrain) {
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL is not available in this browser');
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('program: ' + gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);
  const loc = {
    aPos: gl.getAttribLocation(program, 'aPos'),
    aColor: gl.getAttribLocation(program, 'aColor'),
    aNormal: gl.getAttribLocation(program, 'aNormal'),
    uMVP: gl.getUniformLocation(program, 'uMVP'),
    uModel: gl.getUniformLocation(program, 'uModel'),
    uSun: gl.getUniformLocation(program, 'uSun'),
    uFogColor: gl.getUniformLocation(program, 'uFogColor'),
    uFogNear: gl.getUniformLocation(program, 'uFogNear'),
    uFogFar: gl.getUniformLocation(program, 'uFogFar'),
    uEmissive: gl.getUniformLocation(program, 'uEmissive'),
    uAlpha: gl.getUniformLocation(program, 'uAlpha'),
  };

  function makeBuffer(mesh, indexed) {
    const buf = {};
    buf.pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.STATIC_DRAW);
    buf.col = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.col);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.colors), gl.STATIC_DRAW);
    buf.nor = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.nor);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.normals), gl.STATIC_DRAW);
    if (indexed) {
      buf.idx = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx);
      // WebGL1 only draws UNSIGNED_SHORT indices without an extension, and
      // the terrain has 129x129 = 16641 vertices, which fits in 16 bits.
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
      buf.count = mesh.indices.length;
    } else {
      buf.count = mesh.positions.length / 3;
    }
    buf.indexed = !!indexed;
    return buf;
  }
  function bind(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.col);
    gl.enableVertexAttribArray(loc.aColor);
    gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.nor);
    gl.enableVertexAttribArray(loc.aNormal);
    gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 0, 0);
    if (buf.indexed) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx);
  }
  function drawBuf(buf, model, emissive, alpha) {
    bind(buf);
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniform1f(loc.uEmissive, emissive ? 1 : 0);
    gl.uniform1f(loc.uAlpha, alpha === undefined ? 1 : alpha);
    if (buf.indexed) gl.drawElements(gl.TRIANGLES, buf.count, gl.UNSIGNED_SHORT, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, buf.count);
  }

  // ---- static world geometry ----
  const terrainBuf = makeBuffer(
    { positions: terrain.positions, colors: terrain.colors, normals: terrain.normals, indices: terrain.indices },
    true,
  );

  // Water: one big quad at sea level, slightly below the beach line.
  const waterMesh = { positions: [], colors: [], normals: [] };
  const W = WORLD.SIZE / 2 + 600;
  quadPos(waterMesh, [-W, 0.15, -W], [W, 0.15, -W], [W, 0.15, W], [-W, 0.15, W], [0.1, 0.42, 0.62]);
  const waterBuf = makeBuffer(waterMesh, false);

  // Airfield: runway slab, centreline dashes, threshold bars, edge lights, windsock, hangar, tower.
  const fieldMesh = { positions: [], colors: [], normals: [] };
  const rw = PLANE.RUNWAY;
  const ASPHALT = [0.16, 0.17, 0.19];
  const WHITE = [0.95, 0.95, 0.92];
  const YELLOW = [0.95, 0.8, 0.2];
  // Slab, a touch above the flattened ground so it never z-fights.
  quadPos(fieldMesh, [rw.x - rw.length / 2, 4.35, rw.z - rw.width / 2], [rw.x + rw.length / 2, 4.35, rw.z - rw.width / 2],
    [rw.x + rw.length / 2, 4.35, rw.z + rw.width / 2], [rw.x - rw.length / 2, 4.35, rw.z + rw.width / 2], ASPHALT);
  // Centreline dashes.
  for (let d = -rw.length / 2 + 30; d < rw.length / 2 - 20; d += 40) {
    quadPos(fieldMesh, [rw.x + d, 4.42, rw.z - 1.2], [rw.x + d + 22, 4.42, rw.z - 1.2],
      [rw.x + d + 22, 4.42, rw.z + 1.2], [rw.x + d, 4.42, rw.z + 1.2], WHITE);
  }
  // Threshold bars at both ends.
  for (const end of [-1, 1]) {
    for (let k = -2; k <= 2; k++) {
      const x0 = rw.x + end * (rw.length / 2 - 26);
      quadPos(fieldMesh, [x0, 4.42, rw.z + k * 6 - 2], [x0 + 14, 4.42, rw.z + k * 6 - 2],
        [x0 + 14, 4.42, rw.z + k * 6 + 2], [x0, 4.42, rw.z + k * 6 + 2], WHITE);
    }
  }
  // Runway numbers "09" / "27" as simple block digits (two quads each, reads at distance).
  quadPos(fieldMesh, [rw.x - rw.length / 2 + 40, 4.42, rw.z - 8], [rw.x - rw.length / 2 + 52, 4.42, rw.z - 8],
    [rw.x - rw.length / 2 + 52, 4.42, rw.z + 8], [rw.x - rw.length / 2 + 40, 4.42, rw.z + 8], YELLOW);
  // Taxiway to the hangar.
  quadPos(fieldMesh, [rw.x + 60, 4.35, rw.z + rw.width / 2], [rw.x + 110, 4.35, rw.z + rw.width / 2],
    [rw.x + 110, 4.35, rw.z + 150], [rw.x + 60, 4.35, rw.z + 150], [0.2, 0.2, 0.22]);
  // Hangar (arched roof approximated by a box + a darker roof box) and tower.
  boxPos(fieldMesh, rw.x + 130, 12, rw.z + 185, 46, 16, 34, [0.75, 0.72, 0.68], [0.55, 0.55, 0.58]);
  boxPos(fieldMesh, rw.x + 130, 18, rw.z + 185, 47, 3, 35, [0.5, 0.5, 0.54]);
  boxPos(fieldMesh, rw.x - 180, 16, rw.z + 120, 12, 24, 12, [0.8, 0.78, 0.74]);
  boxPos(fieldMesh, rw.x - 180, 30, rw.z + 120, 18, 6, 18, [0.15, 0.3, 0.45]);
  // Windsock pole + orange cone.
  boxPos(fieldMesh, rw.x - 40, 10, rw.z - 60, 0.8, 12, 0.8, [0.9, 0.9, 0.9]);
  conePos(fieldMesh, rw.x - 40, 15.5, rw.z - 60, 1.6, 7, [0.95, 0.45, 0.1], 8);
  const fieldBuf = makeBuffer(fieldMesh, false);

  // Edge lights: small emissive boxes along both runway edges.
  const lightMesh = { positions: [], colors: [], normals: [] };
  for (let d = -rw.length / 2 + 10; d <= rw.length / 2 - 10; d += 40) {
    for (const side of [-1, 1]) {
      boxPos(lightMesh, rw.x + d, 5.2, rw.z + side * (rw.width / 2 + 3), 1.4, 1.4, 1.4, [1.0, 0.85, 0.3]);
    }
  }
  const lightBuf = makeBuffer(lightMesh, false);

  // City buildings, merged.
  const cityMesh = { positions: [], colors: [], normals: [] };
  for (const b of terrain.buildings) {
    boxPos(cityMesh, b.x, b.h / 2 + 4, b.z, b.w, b.h, b.d, b.color, [0.25, 0.26, 0.3]);
  }
  const cityBuf = makeBuffer(cityMesh, false);

  // Trees: trunk + two stacked cones, merged.
  const treeMesh = { positions: [], colors: [], normals: [] };
  for (const t of terrain.trees) {
    boxPos(treeMesh, t.x, t.y + 1.2 * t.s, t.z, 0.7 * t.s, 2.4 * t.s, 0.7 * t.s, [0.35, 0.24, 0.14]);
    conePos(treeMesh, t.x, t.y + 2.4 * t.s, t.z, 3.4 * t.s, 6.5 * t.s, [0.16, 0.42, 0.18], 6);
    conePos(treeMesh, t.x, t.y + 5.4 * t.s, t.z, 2.4 * t.s, 5 * t.s, [0.2, 0.5, 0.22], 6);
  }
  const treeBuf = makeBuffer(treeMesh, false);

  // Clouds: three crossed quads each, built once, drifted by a model matrix.
  const cloudMesh = { positions: [], colors: [], normals: [] };
  const CLOUD = [1, 1, 1];
  for (const [dx, dz, w] of [[-1, 0, 1.6], [0, 0, 2.0], [1, 0, 1.4]]) {
    quadPos(cloudMesh, [dx * 30 - w * 25, -6, dz * 10], [dx * 30 + w * 25, -6, dz * 10],
      [dx * 30 + w * 25, 6, dz * 10], [dx * 30 - w * 25, 6, dz * 10], CLOUD);
    quadPos(cloudMesh, [dx * 30, -6, dz * 10 - w * 25], [dx * 30, -6, dz * 10 + w * 25],
      [dx * 30, 6, dz * 10 + w * 25], [dx * 30, 6, dz * 10 - w * 25], CLOUD);
  }
  const cloudBuf = makeBuffer(cloudMesh, false);

  // Rings: one torus mesh per gate colour (next = orange, passed = green,
  // upcoming = dim blue), built once.
  const ringMeshes = {};
  for (const [name, color] of [['next', [1.0, 0.55, 0.1]], ['passed', [0.2, 0.85, 0.3]], ['todo', [0.35, 0.55, 0.85]]]) {
    const mesh = { positions: [], colors: [], normals: [] };
    torus(mesh, 20, 1.1, color, 28, 6);
    ringMeshes[name] = makeBuffer(mesh, false);
  }

  const planeBuf = makeBuffer(buildPlaneMesh(), false);
  const propBuf = makeBuffer(buildPropMesh(), false);
  const tipBuf = makeBuffer(buildTipLights(), false);

  let skyBuf = null;
  let skyPreset = 'day';
  function ensureSky(preset) {
    if (skyBuf && skyPreset === preset) return;
    skyPreset = preset;
    const p = SUN_PRESETS[preset];
    skyBuf = makeBuffer(skyDome(3800, p.horizon, p.zenith), false);
  }

  // Sun disc: a small emissive quad billboarded toward the camera.
  const sunMesh = { positions: [], colors: [], normals: [] };
  quadPos(sunMesh, [-60, -60, 0], [60, -60, 0], [60, 60, 0], [-60, 60, 0], [1.0, 0.9, 0.6]);
  const sunBuf = makeBuffer(sunMesh, false);

  const chase = { eye: [0, 60, 0], target: [0, 40, 0] };

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(window.innerWidth * ratio);
    const h = Math.round(window.innerHeight * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // Ring i faces the course: its plane is perpendicular to the segment from the
  // previous gate to the next one.
  function ringMatrix(i, pulse) {
    const p = RINGS[i];
    const prev = RINGS[(i - 1 + RINGS.length) % RINGS.length];
    const next = RINGS[(i + 1) % RINGS.length];
    let dx = next[0] - prev[0];
    let dz = next[2] - prev[2];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // Torus lies in XY facing +Z; rotate Y so +Z points along the course.
    const yaw = Math.atan2(dx, dz);
    const s = pulse ? 1 + 0.045 * Math.sin(performance.now() / 260) : 1;
    const m = matMultiply(matTranslate(p[0], p[1], p[2]), matMultiply(matRotY(yaw), matScale(s, s, s)));
    return m;
  }

  function draw(state, opts) {
    const preset = (opts && opts.sun) || 'day';
    const camera = (opts && opts.camera) || 'chase';
    const time = (opts && opts.time) || 0;
    ensureSky(preset);
    const sun = SUN_PRESETS[preset];
    resize();
    gl.clearColor(sun.fog[0], sun.fog[1], sun.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = matPerspective(62, aspect, 0.5, 9000);
    const fwd = planeForward(state);
    let eye;
    let target;
    let up = [0, 1, 0];
    const hero = opts && opts.hero;
    if (hero) {
      // A staged hero shot: the camera sits at a fixed offset from the plane
      // (fwd/right/up in metres, relative to the heading) and looks back at it.
      const h = state.heading * DEG;
      const fwdH = [Math.sin(h), 0, -Math.cos(h)];
      const right = [Math.cos(h), 0, Math.sin(h)];
      eye = [
        state.x + fwdH[0] * hero.fwd + right[0] * hero.right,
        state.y + hero.up,
        state.z + fwdH[2] * hero.fwd + right[2] * hero.right,
      ];
      target = [
        state.x + fwdH[0] * (hero.tFwd || 0) + right[0] * (hero.tRight || 0),
        state.y + (hero.tUp || 0),
        state.z + fwdH[2] * (hero.tFwd || 0) + right[2] * (hero.tRight || 0),
      ];
      chase.eye = eye.slice();
      chase.target = target.slice();
    } else if (camera === 'cockpit') {
      eye = [state.x + fwd[0] * 0.7, state.y + 1.05, state.z + fwd[2] * 0.7];
      target = [state.x + fwd[0] * 60, state.y + fwd[1] * 60 + 1, state.z + fwd[2] * 60];
      // Bank the view with the plane.
      const r = state.roll * DEG;
      up = [Math.sin(r), Math.cos(r), 0];
      // Keep the up vector roughly world-up in the horizontal plane:
      up = [Math.sin(r) * Math.cos(state.heading * DEG), Math.cos(r), Math.sin(r) * Math.sin(state.heading * DEG)];
    } else {
      // Chase camera: behind and above the plane, smoothed, and level with
      // the horizon — it follows the heading, never the pitch or the bank, so
      // a steep climb or a hard turn never tips the world out of frame.
      // opts.chaseDist / chaseHeight / chaseRight let a staged shot reframe.
      const dist = (opts && opts.chaseDist) || 15;
      const height = (opts && opts.chaseHeight) || 6;
      const rightOff = (opts && opts.chaseRight) || 0;
      const h = state.heading * DEG;
      const fwdH = [Math.sin(h), 0, -Math.cos(h)];
      const right = [Math.cos(h), 0, Math.sin(h)];
      const wantEye = [
        state.x - fwdH[0] * dist + right[0] * rightOff,
        state.y + height,
        state.z - fwdH[2] * dist + right[2] * rightOff,
      ];
      const wantTarget = [
        state.x + fwdH[0] * 12 + right[0] * rightOff,
        state.y + 1.5,
        state.z + fwdH[2] * 12 + right[2] * rightOff,
      ];
      // Frame-rate independent smoothing: the chase camera closes ~99% of
      // the gap in half a second, whatever the display's rate.
      const k = opts && opts.snapCamera ? 1 : 1 - Math.exp(-6 * ((opts && opts.dt) || 0.016));
      for (let i = 0; i < 3; i++) {
        chase.eye[i] += (wantEye[i] - chase.eye[i]) * k;
        chase.target[i] += (wantTarget[i] - chase.target[i]) * k;
      }
      // Never let the chase camera sink under the terrain.
      const ground = terrain.heightAt(chase.eye[0], chase.eye[2]);
      if (chase.eye[1] < ground + 2.5) chase.eye[1] = ground + 2.5;
      eye = chase.eye;
      target = chase.target;
    }
    const view = matLookAt(eye, target, up);
    const vp = matMultiply(proj, view);
    gl.uniformMatrix4fv(loc.uMVP, false, vp);
    gl.uniform3fv(loc.uSun, sun.dir);
    gl.uniform3fv(loc.uFogColor, sun.fog);
    gl.uniform1f(loc.uFogNear, 500);
    gl.uniform1f(loc.uFogFar, 3400);
    const ident = matIdentity();

    // Sky dome centred on the camera (no fog, emissive).
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(loc.uFogNear, 1e9);
    gl.uniform1f(loc.uFogFar, 1e9 + 1);
    drawBuf(skyBuf, matTranslate(eye[0], 0, eye[2]), true, 1);
    // Sun disc.
    const sunPos = [eye[0] + sun.dir[0] * 3200, sun.dir[1] * 3200, eye[2] + sun.dir[2] * 3200];
    const sunModel = matMultiply(matTranslate(sunPos[0], sunPos[1], sunPos[2]), matRotY(Math.atan2(-sun.dir[0], -sun.dir[2])));
    drawBuf(sunBuf, sunModel, true, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.uniform1f(loc.uFogNear, 500);
    gl.uniform1f(loc.uFogFar, 3400);

    drawBuf(terrainBuf, ident, false, 1);
    drawBuf(waterBuf, ident, false, 1);
    drawBuf(fieldBuf, ident, false, 1);
    drawBuf(cityBuf, ident, false, 1);
    drawBuf(treeBuf, ident, false, 1);

    drawRings(state, vp);

    // Clouds drift east, slowly.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const c of terrain.clouds) {
      const cx = c.x + time * c.v;
      const wrapped = ((cx + 2100) % 4200) - 2100;
      drawBuf(cloudBuf, matTranslate(wrapped, c.y, c.z), true, 0.92);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // The plane (hidden in cockpit view) and its spinning prop at the nose.
    if (camera !== 'cockpit') {
      const pm = planeMatrix(state);
      drawBuf(planeBuf, pm, false, 1);
      const propModel = matMultiply(pm, matMultiply(matTranslate(0, 0.05, 0), matRotZ(state.propAngle)));
      drawBuf(propBuf, propModel, false, 1);
      drawBuf(tipBuf, pm, true, 1);
    } else {
      // No 3D dashboard: the DOM gauge panel below the windscreen already
      // shows the instruments lit, and a 3D panel here only clutters the
      // bottom of the view. The propeller is drawn faint and translucent: a
      // solid disc would black out the windscreen.
      const pm = planeMatrix(state);
      const propModel = matMultiply(pm, matMultiply(matTranslate(0, 0.05, 0), matRotZ(state.propAngle)));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      drawBuf(propBuf, propModel, false, 0.22);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  // Rings need per-gate colours: pick the prebuilt mesh for each gate's state.
  function drawRings(state, vp) {
    gl.uniformMatrix4fv(loc.uMVP, false, vp);
    for (let i = 0; i < RINGS.length; i++) {
      const passed = i < state.ringsDone;
      const next = i === state.ring % RINGS.length;
      const buf = passed ? ringMeshes.passed : next ? ringMeshes.next : ringMeshes.todo;
      drawBuf(buf, ringMatrix(i, next), true, 1);
    }
  }

  return { draw };
}
