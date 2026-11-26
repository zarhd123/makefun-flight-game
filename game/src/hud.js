// The DOM HUD and screens: big altitude / speed / heading readouts, a compass
// strip, throttle and climb bars, score and ring counter, a minimap, an
// artificial horizon, a backlit gauge panel for the cockpit view, and the
// title / pause / landed / crashed overlays. The WebGL canvas paints the world;
// this paints the instruments on top of it.
import { PLANE } from './config.js';

const MS_TO_KT = 1.94384;
const M_TO_FT = 3.28084;

function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const hud = {
    alt: el('hud-alt'),
    spd: el('hud-spd'),
    hdg: el('hud-hdg'),
    thr: el('hud-thr-fill'),
    thrText: el('hud-thr-text'),
    vsi: el('hud-vsi-fill'),
    vsiText: el('hud-vsi-text'),
    score: el('hud-score'),
    time: el('hud-time'),
    rings: el('hud-rings'),
    message: el('hud-message'),
    compass: el('hud-compass'),
    attitude: el('hud-attitude'),
    minimap: el('hud-minimap'),
    gauges: el('hud-gauges'),
    gaugesWrap: el('gauges-wrap'),
    title: el('screen-title'),
    paused: el('screen-paused'),
    ended: el('screen-ended'),
    endedTitle: el('ended-title'),
    endedLines: el('ended-lines'),
    best: el('title-best'),
  };
  const compassCtx = hud.compass.getContext('2d');
  const attCtx = hud.attitude.getContext('2d');
  const mapCtx = hud.minimap.getContext('2d');
  const gaugeCtx = hud.gauges.getContext('2d');

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function drawCompass(heading) {
    const ctx = compassCtx;
    const w = hud.compass.width;
    const h = hud.compass.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8, 14, 24, 0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.fillStyle = '#e8f0f8';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    const pxPerDeg = w / 120;
    for (let d = -60; d <= 60; d += 5) {
      const deg = ((Math.round(heading) + d) % 360 + 360) % 360;
      const x = w / 2 + d * pxPerDeg;
      const major = deg % 45 === 0;
      const mid = deg % 15 === 0;
      ctx.beginPath();
      ctx.moveTo(x, major ? 8 : mid ? 14 : 20);
      ctx.lineTo(x, h - 8);
      ctx.stroke();
      if (major) ctx.fillText(labels[deg] || String(deg).padStart(3, '0'), x, h / 2 + 2);
      else if (mid) ctx.fillText(String(deg).padStart(3, '0'), x, h / 2 + 2);
    }
    // Centre caret.
    ctx.fillStyle = '#ffb020';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 7, 0);
    ctx.lineTo(w / 2 + 7, 0);
    ctx.lineTo(w / 2, 9);
    ctx.closePath();
    ctx.fill();
  }

  function drawAttitude(pitch, roll) {
    const ctx = attCtx;
    const w = hud.attitude.width;
    const h = hud.attitude.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 2;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-roll * Math.PI / 180);
    const pitchPx = pitch * 1.6;
    ctx.fillStyle = '#2f6fd0';
    ctx.fillRect(-r, -r + pitchPx, r * 2, r - pitchPx + r);
    ctx.fillStyle = '#7a5a34';
    ctx.fillRect(-r, pitchPx, r * 2, r * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r, pitchPx);
    ctx.lineTo(r, pitchPx);
    ctx.stroke();
    ctx.restore();
    // Fixed wings marker.
    ctx.strokeStyle = '#ffb020';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy);
    ctx.lineTo(cx - r * 0.2, cy);
    ctx.moveTo(cx + r * 0.2, cy);
    ctx.lineTo(cx + r * 0.55, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawMinimap(state, rings, ringIndex) {
    const ctx = mapCtx;
    const w = hud.minimap.width;
    const h = hud.minimap.height;
    const scale = w / 4400;
    const toX = (x) => w / 2 + x * scale;
    const toY = (z) => h / 2 + z * scale;
    ctx.clearRect(0, 0, w, h);
    // Sea and island.
    ctx.fillStyle = '#174a6b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4a7a3a';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 1950 * scale, 0, Math.PI * 2);
    ctx.fill();
    // Runway.
    const rw = PLANE.RUNWAY;
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(toX(rw.x - rw.length / 2), toY(rw.z));
    ctx.lineTo(toX(rw.x + rw.length / 2), toY(rw.z));
    ctx.stroke();
    // Rings.
    for (let i = 0; i < rings.length; i++) {
      const p = rings[i];
      ctx.beginPath();
      ctx.arc(toX(p[0]), toY(p[2]), 5, 0, Math.PI * 2);
      if (i < state.ringsDone) {
        ctx.fillStyle = '#2fd05a';
        ctx.fill();
      } else if (i === ringIndex) {
        ctx.strokeStyle = '#ff8c1a';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // The plane.
    const a = state.heading * Math.PI / 180;
    ctx.save();
    ctx.translate(toX(state.x), toY(state.z));
    ctx.rotate(a);
    ctx.fillStyle = '#ffb020';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawGauge(ctx, cx, cy, r, label, value, max, unit) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0a1420';
    ctx.fill();
    ctx.strokeStyle = '#3a5a78';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 5, Math.PI * 0.75, Math.PI * 2.25);
    ctx.strokeStyle = '#567';
    ctx.lineWidth = 1;
    ctx.stroke();
    const frac = Math.max(0, Math.min(1, value / max));
    const angle = Math.PI * 0.75 + frac * Math.PI * 1.5;
    ctx.strokeStyle = '#7dffb0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * (r - 8), cy + Math.sin(angle) * (r - 8));
    ctx.stroke();
    ctx.fillStyle = '#e8f0f8';
    ctx.font = `bold ${Math.round(r * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(value)), cx, cy + r * 0.28);
    ctx.font = `${Math.round(r * 0.28)}px system-ui, sans-serif`;
    ctx.fillStyle = '#9db4c8';
    ctx.fillText(label, cx, cy - r * 0.45);
    ctx.fillText(unit, cx, cy + r * 0.62);
    ctx.restore();
  }

  function drawGauges(state) {
    const ctx = gaugeCtx;
    const w = hud.gauges.width;
    const h = hud.gauges.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(6, 12, 20, 0.82)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2c4a66';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const r = 34;
    const cy = h / 2 + 4;
    drawGauge(ctx, 62, cy, r, 'AIRSPEED', state.speed * MS_TO_KT, 200, 'KT');
    drawGauge(ctx, 158, cy, r, 'ALTITUDE', state.y * M_TO_FT, 12000, 'FT');
    drawGauge(ctx, 254, cy, r, 'THROTTLE', state.throttle * 100, 100, '%');
    drawGauge(ctx, 350, cy, r, 'HEADING', state.heading, 360, 'DEG');
    // Attitude ball, small.
    ctx.save();
    ctx.beginPath();
    ctx.arc(446, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(446, cy);
    ctx.rotate(-state.roll * Math.PI / 180);
    ctx.fillStyle = '#2f6fd0';
    ctx.fillRect(-r, -r + state.pitch * 0.9, r * 2, r - state.pitch * 0.9 + r);
    ctx.fillStyle = '#7a5a34';
    ctx.fillRect(-r, state.pitch * 0.9, r * 2, r * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r, state.pitch * 0.9);
    ctx.lineTo(r, state.pitch * 0.9);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#3a5a78';
    ctx.beginPath();
    ctx.arc(446, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#9db4c8';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ATTITUDE', 446, cy - r - 6);
  }

  function update(state, rings, screen, camera) {
    hud.alt.textContent = String(Math.max(0, Math.round(state.y * M_TO_FT))).padStart(5, '0');
    hud.spd.textContent = String(Math.round(state.speed * MS_TO_KT)).padStart(3, '0');
    hud.hdg.textContent = String(Math.round(state.heading)).padStart(3, '0');
    hud.thr.style.width = `${Math.round(state.throttle * 100)}%`;
    hud.thrText.textContent = `THR ${Math.round(state.throttle * 100)}%`;
    const vsi = state.vspeed * 196.85; // m/s to ft/min
    const vsiFrac = Math.max(-1, Math.min(1, vsi / 2000));
    hud.vsi.style.width = `${Math.abs(vsiFrac) * 50}%`;
    hud.vsi.style.left = vsiFrac >= 0 ? '50%' : `${50 + vsiFrac * 50}%`;
    hud.vsiText.textContent = `VSI ${vsi >= 0 ? '+' : ''}${Math.round(vsi)} FPM`;
    hud.score.textContent = String(state.score);
    hud.time.textContent = fmtTime(state.elapsed);
    hud.rings.textContent = `${state.ringsDone}/${rings.length}`;
    // The message shows while its game-time timer runs (staged shots set it
    // to 30 s so it stays up for the screenshot).
    if (state.message && state.messageTimer > 0) {
      hud.message.textContent = state.message;
      hud.message.style.opacity = '1';
    } else {
      hud.message.style.opacity = '0';
    }
    drawCompass(state.heading);
    drawAttitude(state.pitch, state.roll);
    drawMinimap(state, rings, state.ring % rings.length);
    hud.gaugesWrap.style.display = camera === 'cockpit' ? 'block' : 'none';
    if (camera === 'cockpit') drawGauges(state);
  }

  function showScreen(name, data) {
    hud.title.style.display = name === 'title' ? 'flex' : 'none';
    hud.paused.style.display = name === 'paused' ? 'flex' : 'none';
    hud.ended.style.display = name === 'ended' ? 'flex' : 'none';
    if (name === 'title' && data && data.best > 0) {
      hud.best.textContent = `Best score: ${data.best}`;
    }
    if (name === 'ended' && data) {
      hud.endedTitle.textContent = data.title;
      hud.endedLines.innerHTML = '';
      for (const line of data.lines) {
        const p = document.createElement('p');
        p.textContent = line;
        hud.endedLines.appendChild(p);
      }
    }
  }

  return { update, showScreen };
}
