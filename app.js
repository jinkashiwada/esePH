const canvas = document.getElementById("sim");
const ctx = canvas.getContext("2d", { alpha: false });

const ui = {
  panel: document.getElementById("panel"),
  panelToggle: document.getElementById("panelToggle"),
  closePanel: document.getElementById("closePanel"),
  qrButton: document.getElementById("qrButton"),
  qrOverlay: document.getElementById("qrOverlay"),
  damBreak: document.getElementById("damBreak"),
  clearWater: document.getElementById("clearWater"),
  addParticles: document.getElementById("addParticles"),
  removeParticles: document.getElementById("removeParticles"),
  colorMode: document.getElementById("colorMode"),
  showVectors: document.getElementById("showVectors"),
  editWalls: document.getElementById("editWalls"),
  autoDemoInterval: document.getElementById("autoDemoInterval"),
  randomTerrain: document.getElementById("randomTerrain"),
  viscosityScale: document.getElementById("viscosityScale"),
  viscosityScaleLabel: document.getElementById("viscosityScaleLabel"),
  waveAmplitude: document.getElementById("waveAmplitude"),
  waveAmplitudeLabel: document.getElementById("waveAmplitudeLabel"),
  wavePeriod: document.getElementById("wavePeriod"),
  wavePeriodLabel: document.getElementById("wavePeriodLabel"),
  legendBar: document.getElementById("legendBar"),
  legendText: document.getElementById("legendText"),
  particleCount: document.getElementById("particleCount"),
  fps: document.getElementById("fps")
};

let W = 0;
let H = 0;
let dpr = 1;
const mode = "tank";
let colorMode = "white";
let showVectors = false;
let editWalls = false;
let lastTime = performance.now();
let fpsSmoother = 60;
let bed = [];
let activePointer = null;
let maxParticles = 1200;
let damBreakCountdownUntil = 0;
let damBreakGateX = 0;
let lastMetricsAt = 0;
let waveMakerX = 0;
let waveMakerVx = 0;
let addParticlesHeld = false;
let removeParticlesHeld = false;
let addParticleCarry = 0;
let removeParticleCarry = 0;
let autoDemoNextAt = 0;

const particles = [];
const wallParticles = [];
const grid = new Map();
const particleRadius = 4.2;
const cell = 26;
const spacing = 11;
const wallSpacing = 9.5;
const h = 25;
const restDensity = 3.55;
const stiffness = 0.38;
const nearStiffness = 0.5;
const viscositySigma = 0.013;
const viscosityBeta = 0.003;
const xsphViscosity = 0.002;
const wallDensityWeight = 0.72;
const wallRelaxScale = 0.92;
const sideWallBand = particleRadius * 3.4;
const bedBoundaryBand = particleRadius * 3.2;
const gravity = 720;
const particleEditRate = 10;

function initialParticleTarget() {
  return W < 700 ? 1600 : 2600;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(320, window.innerWidth);
  H = Math.max(320, window.innerHeight);
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  maxParticles = W < 700 ? 3000 : 6000;
  updateWaveMakerState(performance.now() / 1000);
  resetBed();
  if (particles.length === 0) seedTank();
}

function resetBed(forceDefault = false) {
  const n = Math.ceil(W / 12) + 1;
  const old = bed;
  bed = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const base = H * 0.88;
    bed[i] = !forceDefault && old[i] ? Math.max(H * 0.35, Math.min(H - 28, old[i])) : base;
  }
  rebuildWallParticles();
}

function clampBed(y) {
  return Math.max(H * 0.32, Math.min(H - 28, y));
}

function smoothWholeBed(iterations = 2, radius = 1) {
  for (let k = 0; k < iterations; k += 1) {
    const next = bed.slice();
    for (let i = 0; i < bed.length; i += 1) {
      let sum = 0;
      let weightSum = 0;
      for (let r = -radius; r <= radius; r += 1) {
        const j = Math.max(0, Math.min(bed.length - 1, i + r));
        const weight = radius + 1 - Math.abs(r);
        sum += bed[j] * weight;
        weightSum += weight;
      }
      next[i] = clampBed(sum / weightSum);
    }
    bed = next;
  }
}

function applyRandomTerrain() {
  if (bed.length < 3) resetBed(true);
  const left = staticWallLeft();
  const right = wallRight();
  const base = H * 0.86;
  const amp = H * (0.045 + Math.random() * 0.09);
  const phase = Math.random() * Math.PI * 2;
  const patterns = ["sine1", "sine15", "sine2", "sine3", "sine4", "sineBlend", "steps", "leftHigh", "middleLow", "middleHigh"];
  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  const stepCount = 4 + Math.floor(Math.random() * 4);
  const stepHeights = Array.from({ length: stepCount }, () => (Math.random() - 0.5) * amp * 1.9);
  const invert = Math.random() < 0.5 ? -1 : 1;
  const leftHighUpper = 0.85 + Math.random() * 0.5;
  const leftHighLower = 0.25 + Math.random() * 0.4;
  const middleMain = 0.9 + Math.random() * 0.45;
  const middleSide = 0.15 + Math.random() * 0.35;
  const sineCycles = { sine1: 1, sine15: 1.5, sine2: 2, sine3: 3, sine4: 4 };
  const blendComponents = Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => ({
    cycles: [1, 1.5, 2, 3, 4, 5][Math.floor(Math.random() * 6)],
    ampScale: 0.25 + Math.random() * 0.55,
    phase: Math.random() * Math.PI * 2,
    sign: Math.random() < 0.5 ? -1 : 1
  }));

  for (let i = 0; i < bed.length; i += 1) {
    const x = (i / (bed.length - 1)) * W;
    const t = Math.max(0, Math.min(1, (x - left) / Math.max(1, right - left)));
    const edgeEnvelope = Math.min(1, t / 0.08, (1 - t) / 0.08);
    let y = base;
    if (pattern in sineCycles) {
      y = base + Math.sin(t * Math.PI * 2 * sineCycles[pattern] + phase) * amp * invert * edgeEnvelope;
    } else if (pattern === "sineBlend") {
      let wave = 0;
      let weight = 0;
      for (const c of blendComponents) {
        wave += Math.sin(t * Math.PI * 2 * c.cycles + c.phase) * c.ampScale * c.sign;
        weight += c.ampScale;
      }
      y = base + (wave / Math.max(0.1, weight)) * amp * 1.25 * edgeEnvelope;
    } else if (pattern === "steps") {
      const s = Math.min(stepCount - 1, Math.floor(t * stepCount));
      y = base + stepHeights[s] * edgeEnvelope;
    } else if (pattern === "leftHigh") {
      y = t < 0.5 ? base - amp * leftHighUpper * edgeEnvelope : base + amp * leftHighLower * edgeEnvelope;
    } else {
      const middle = t > 1 / 3 && t < 2 / 3;
      const sign = pattern === "middleLow" ? 1 : -1;
      y = base + (middle ? sign * amp * middleMain : -sign * amp * middleSide) * edgeEnvelope;
    }
    bed[i] = clampBed(y);
  }
  smoothWholeBed(pattern === "steps" ? 5 : 4, pattern === "sineBlend" ? 2 : 1);
  rebuildWallParticles();
  reprojectParticlesAfterBedEdit();
}

function bedY(x) {
  const t = Math.max(0, Math.min(bed.length - 1, (x / W) * (bed.length - 1)));
  const i = Math.floor(t);
  const f = t - i;
  return bed[i] * (1 - f) + bed[Math.min(bed.length - 1, i + 1)] * f;
}

function bedSlope(x) {
  const dx = Math.max(6, W / Math.max(1, bed.length - 1));
  return (bedY(x + dx) - bedY(x - dx)) / (2 * dx);
}

function bedNormal(x) {
  const s = bedSlope(x);
  const inv = 1 / Math.hypot(s, 1);
  return { x: s * inv, y: -inv };
}

function signedBedDistance(p) {
  const s = bedSlope(p.x);
  return (bedY(p.x) - p.y) / Math.hypot(s, 1);
}

function setBedAt(x, y, radius = 88) {
  x = Math.max(wallLeft(), Math.min(wallRight(), x));
  const targetY = Math.max(H * 0.2, Math.min(H - 30, y));
  const left = wallLeft();
  const right = wallRight();
  const edgeBlend = Math.max(radius * 0.65, wallSpacing * 4);
  for (let i = 0; i < bed.length; i += 1) {
    const bx = (i / (bed.length - 1)) * W;
    if (bx < left - edgeBlend || bx > right + edgeBlend) continue;
    const w = Math.max(0, 1 - Math.abs(bx - x) / radius);
    if (w > 0) {
      const desired = bed[i] * (1 - w * 0.16) + targetY * w * 0.16;
      const delta = Math.max(-7, Math.min(7, desired - bed[i]));
      bed[i] += delta;
    }
  }
  smoothBedAround(x, radius * 1.35);
  rebuildWallParticles();
  reprojectParticlesAfterBedEdit();
}

function smoothBedAround(x, radius) {
  if (bed.length < 3) return;
  const next = bed.slice();
  const leftLimit = wallLeft() - Math.max(radius * 0.55, wallSpacing * 3);
  const rightLimit = wallRight() + Math.max(radius * 0.55, wallSpacing * 3);
  for (let i = 1; i < bed.length - 1; i += 1) {
    const bx = (i / (bed.length - 1)) * W;
    if (bx < leftLimit || bx > rightLimit) continue;
    const local = Math.max(0, 1 - Math.abs(bx - x) / radius);
    if (local <= 0) continue;
    const averaged = bed[i - 1] * 0.25 + bed[i] * 0.5 + bed[i + 1] * 0.25;
    next[i] = bed[i] * (1 - local * 0.34) + averaged * local * 0.34;
  }
  bed = next;
}

function addWallParticle(x, y, nx, ny, vx = 0, vy = 0, kind = "wall") {
  wallParticles.push({
    x,
    y,
    oldX: x,
    oldY: y,
    vx,
    vy,
    rho: restDensity,
    nearRho: 0,
    p: 0,
    nearP: 0,
    speed: 0,
    nx,
    ny,
    kind,
    fixed: true
  });
}

function rebuildWallParticles() {
  wallParticles.length = 0;
  if (mode !== "tank" || !W || !H || bed.length < 2) return;

  const left = wallLeft();
  const right = wallRight();
  const staticLeft = staticWallLeft();
  const top = H * 0.12;
  const addBedRow = (offset) => {
    for (let x = left; x < Math.min(staticLeft, right); x += wallSpacing) {
      const n = bedNormal(x);
      addWallParticle(x - n.x * offset, bedY(x) - n.y * offset, n.x, n.y);
    }
    const start = Math.max(left, staticLeft);
    const firstStatic = staticLeft + Math.ceil((start - staticLeft) / wallSpacing) * wallSpacing;
    for (let x = firstStatic; x <= right + 0.1; x += wallSpacing) {
      const n = bedNormal(x);
      addWallParticle(x - n.x * offset, bedY(x) - n.y * offset, n.x, n.y);
    }
  };

  addBedRow(0);
  addBedRow(wallSpacing * 0.78);

  const leftBottom = bedY(left);
  const rightBottom = bedY(right);
  for (let y = top; y <= leftBottom; y += wallSpacing) {
    addWallParticle(left, y, 1, 0, waveMakerVx, 0, "wavemaker");
    addWallParticle(left - wallSpacing * 0.78, y, 1, 0, waveMakerVx, 0, "wavemaker");
  }
  for (let y = top; y <= rightBottom; y += wallSpacing) {
    addWallParticle(right, y, -1, 0);
    addWallParticle(right + wallSpacing * 0.78, y, -1, 0);
  }
}

function addParticle(x, y, vx = 0, vy = 0) {
  if (particles.length >= maxParticles) return;
  const left = wallLeft();
  const right = wallRight();
  x = Math.max(left + particleRadius, Math.min(right - particleRadius, x));
  y = Math.max(18, Math.min(bedY(x) - particleRadius, y));
  particles.push({ x, y, oldX: x, oldY: y, vx, vy, rho: restDensity, nearRho: 0, p: 0, nearP: 0, speed: 0 });
}

function addBlob(x, y, rows = 4, cols = 5) {
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      addParticle(x + (i - cols / 2) * spacing, y + j * spacing, (Math.random() - 0.5) * 22, 25);
    }
  }
}

function seedTank() {
  particles.length = 0;
  updateWaveMakerState(performance.now() / 1000);
  rebuildWallParticles();
  const left = wallLeft() + spacing * 1.1;
  const right = wallRight() - spacing * 1.5;
  const top = H * 0.58;
  const bottom = H * 0.84;
  const cols = Math.max(12, Math.floor((right - left) / spacing));
  const rows = Math.max(5, Math.floor((bottom - top) / spacing));
  const stride = Math.max(1, Math.ceil((cols * rows) / initialParticleTarget()));
  let k = 0;
  for (let j = 0; j < rows; j += 1) {
    const y = top + j * spacing;
    for (let i = 0; i < cols; i += 1) {
      if (k % stride === 0) {
        const x = left + i * spacing;
        if (y < bedY(x) - particleRadius - 2) addParticle(x, y, 0, 0);
      }
      k += 1;
    }
  }
}

function seedDamBreak() {
  particles.length = 0;
  updateWaveMakerState(performance.now() / 1000);
  rebuildWallParticles();

  const left = wallLeft() + spacing * 1.1;
  damBreakGateX = wallLeft() + (wallRight() - wallLeft()) * 0.32;
  let minBed = H;
  for (let x = left; x < damBreakGateX - spacing * 0.8; x += spacing) {
    minBed = Math.min(minBed, bedY(x));
  }
  const bottom = Math.min(H * 0.58, minBed - particleRadius * 4);
  const top = Math.max(H * 0.14, bottom - H * 0.4);
  for (let y = top; y < bottom; y += spacing) {
    for (let x = left; x < damBreakGateX - spacing * 0.8; x += spacing) {
      if (y < bedY(x) - particleRadius - 2) addParticle(x, y, 0, 0);
    }
  }
  for (const p of particles) {
    p.vx = 0;
    p.vy = 0;
    p.oldX = p.x;
    p.oldY = p.y;
    p.speed = 0;
  }
  damBreakCountdownUntil = performance.now() + 3000;
}

function rebuildGrid() {
  grid.clear();
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  for (let i = 0; i < wallParticles.length; i += 1) {
    const p = wallParticles[i];
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(~i);
  }
}

function forNeighbors(p, cb) {
  const gx = Math.floor(p.x / cell);
  const gy = Math.floor(p.y / cell);
  for (let yy = gy - 1; yy <= gy + 1; yy += 1) {
    for (let xx = gx - 1; xx <= gx + 1; xx += 1) {
      const bucket = grid.get(`${xx},${yy}`);
      if (!bucket) continue;
      for (const j of bucket) {
        if (j >= 0) cb(particles[j], j, false);
        else cb(wallParticles[~j], ~j, true);
      }
    }
  }
}

function staticWallLeft() {
  return Math.max(22, W * 0.18);
}

function wallRight() {
  return Math.min(W - 22, W * 0.82);
}

function waveAmplitudePx() {
  return Math.max(0, Number(ui.waveAmplitude.value) || 0);
}

function wavePeriodSec() {
  return Math.max(0.8, Number(ui.wavePeriod.value) || 2);
}

function updateWaveMakerState(t) {
  const base = staticWallLeft();
  const amp = waveAmplitudePx();
  const omega = (Math.PI * 2) / wavePeriodSec();
  waveMakerX = base + amp * Math.sin(t * omega);
  waveMakerVx = amp * omega * Math.cos(t * omega);
}

function wallLeft() {
  return waveMakerX || staticWallLeft();
}

function constrainPosition(p) {
  const left = wallLeft() + particleRadius;
  const right = wallRight() - particleRadius;
  p.x = Math.max(left, Math.min(right, p.x));
  p.y = Math.max(16 + particleRadius, p.y);
  for (let i = 0; i < 2; i += 1) {
    const dist = signedBedDistance(p);
    if (dist >= particleRadius) break;
    const n = bedNormal(p.x);
    const corr = particleRadius - dist;
    p.x += n.x * corr;
    p.y += n.y * corr;
    p.x = Math.max(left, Math.min(right, p.x));
    p.y = Math.max(16 + particleRadius, p.y);
  }
}

function reprojectParticlesAfterBedEdit() {
  for (const p of particles) {
    const beforeY = p.y;
    constrainPosition(p);
    if (signedBedDistance(p) <= particleRadius + 0.7) {
      p.vx *= 0.35;
      p.vy *= 0.2;
    }
    if (p.y < beforeY) {
      p.vx *= 0.55;
      p.vy = 0;
    }
    p.oldX = p.x;
    p.oldY = p.y;
  }
}

function applyPointerForce(dt) {
  if (!activePointer || editWalls) return;
  const px = activePointer.x;
  const py = activePointer.y;
  const dxm = Math.max(-28, Math.min(28, activePointer.dx));
  const dym = Math.max(-28, Math.min(28, activePointer.dy));
  for (const p of particles) {
    const dx = p.x - px;
    const dy = p.y - py;
    const r2 = dx * dx + dy * dy;
    if (r2 > 6400) continue;
    const falloff = 1 - Math.sqrt(r2) / 80;
    p.vx += dxm * 10 * falloff + dx * 0.08 * falloff;
    p.vy += dym * 10 * falloff + dy * 0.08 * falloff;
  }
  activePointer.dx *= 0.45;
  activePointer.dy *= 0.45;
}

function hasParticleTooClose(x, y, minDist) {
  const r2max = minDist * minDist;
  for (const p of particles) {
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy < r2max) return true;
  }
  return false;
}

function addParticleFromTop() {
  const x = (wallLeft() + wallRight()) * 0.5 + (Math.random() - 0.5) * spacing * 3;
  const y = H * 0.16 + Math.random() * spacing * 2;
  addParticle(x, y, (Math.random() - 0.5) * 18, 80 + Math.random() * 25);
}

function removeRandomParticle() {
  if (particles.length === 0) return;
  const i = Math.floor(Math.random() * particles.length);
  const last = particles.pop();
  if (i < particles.length && last) particles[i] = last;
}

function processParticleCountButtons(dt) {
  if (addParticlesHeld) {
    addParticleCarry += dt * particleEditRate;
    const count = Math.floor(addParticleCarry);
    addParticleCarry -= count;
    for (let i = 0; i < count; i += 1) addParticleFromTop();
  } else {
    addParticleCarry = 0;
  }

  if (removeParticlesHeld) {
    removeParticleCarry += dt * particleEditRate;
    const count = Math.floor(removeParticleCarry);
    removeParticleCarry -= count;
    for (let i = 0; i < count; i += 1) removeRandomParticle();
  } else {
    removeParticleCarry = 0;
  }
}

function autoDemoIntervalSec() {
  return Number(ui.autoDemoInterval.value) || 0;
}

function scheduleNextAutoDemo(now = performance.now()) {
  const interval = autoDemoIntervalSec();
  autoDemoNextAt = interval > 0 ? now + interval * 1000 : 0;
}

function triggerDamBreak(randomizeTerrain = false) {
  damBreakCountdownUntil = 0;
  if (randomizeTerrain) applyRandomTerrain();
  seedDamBreak();
  scheduleNextAutoDemo(performance.now());
}

function processAutoDemo(now) {
  const interval = autoDemoIntervalSec();
  if (interval <= 0) {
    autoDemoNextAt = 0;
    return;
  }
  if (!autoDemoNextAt) scheduleNextAutoDemo(now);
  if (!damBreakCountdownUntil && now >= autoDemoNextAt) {
    triggerDamBreak(ui.randomTerrain.checked);
  }
}

function viscosityScale() {
  return Math.max(0.1, Number(ui.viscosityScale.value) || 1);
}

function simulate(dt) {
  dt = Math.min(0.018, dt);
  const steps = 2;
  const sdt = dt / steps;

  for (let step = 0; step < steps; step += 1) {
    rebuildGrid();
    applyViscosity(sdt);
    smoothVelocities();
    applyPointerForce(sdt);

    for (const p of particles) {
      p.oldX = p.x;
      p.oldY = p.y;
      p.vy += gravity * sdt;
      p.vx *= 0.999;
      p.vy *= 0.999;
      p.x += p.vx * sdt;
      p.y += p.vy * sdt;
      constrainPosition(p);
    }

    for (let iter = 0; iter < 2; iter += 1) {
      rebuildGrid();
      computeDensities();
      relaxDensity();
      for (const p of particles) {
        constrainPosition(p);
      }
    }

    for (const p of particles) {
      p.vx = (p.x - p.oldX) / sdt;
      p.vy = (p.y - p.oldY) / sdt;
      applyBoundaryVelocity(p);
      p.vx *= 0.992;
      p.vy *= 0.992;
      p.speed = Math.hypot(p.vx, p.vy);
    }
  }
}

function applyViscosity(dt) {
  const visc = viscosityScale();
  if (visc <= 0) return;
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    forNeighbors(p, (q, j, isWall) => {
      if (isWall) return;
      if (!isWall && j <= i) return;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const r2 = dx * dx + dy * dy;
      if (r2 <= 0.01 || r2 > h * h) return;
      const r = Math.sqrt(r2);
      const nx = dx / r;
      const ny = dy / r;
      const u = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
      if (u <= 0) return;
      const qh = 1 - r / h;
      const impulse = dt * qh * (viscositySigma * u + viscosityBeta * u * u) * visc;
      const ix = nx * impulse * 0.5;
      const iy = ny * impulse * 0.5;
      p.vx -= ix;
      p.vy -= iy;
      q.vx += ix;
      q.vy += iy;
    });
  }
}

function smoothVelocities() {
  const visc = viscosityScale();
  if (visc <= 0) return;
  const dvx = new Array(particles.length).fill(0);
  const dvy = new Array(particles.length).fill(0);
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    forNeighbors(p, (q, j, isWall) => {
      if (isWall) return;
      if (!isWall && j <= i) return;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const r2 = dx * dx + dy * dy;
      if (r2 <= 0.01 || r2 > h * h) return;
      const w = (1 - Math.sqrt(r2) / h) * xsphViscosity * visc;
      const ix = (q.vx - p.vx) * w;
      const iy = (q.vy - p.vy) * w;
      dvx[i] += ix;
      dvy[i] += iy;
      dvx[j] -= ix;
      dvy[j] -= iy;
    });
  }
  for (let i = 0; i < particles.length; i += 1) {
    particles[i].vx += dvx[i];
    particles[i].vy += dvy[i];
  }
}

function computeDensities() {
  for (const p of particles) {
    p.rho = 0;
    p.nearRho = 0;
  }
  for (const p of wallParticles) {
    p.rho = 0;
    p.nearRho = 0;
  }
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    forNeighbors(p, (q, j, isWall) => {
      if (!isWall && j <= i) return;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const r2 = dx * dx + dy * dy;
      if (r2 <= 0.01 || r2 > h * h) return;
      const qh = 1 - Math.sqrt(r2) / h;
      const q2 = qh * qh;
      const q3 = q2 * qh;
      const wallWeight = isWall ? wallDensityWeight : 1;
      p.rho += q2 * wallWeight;
      p.nearRho += q3 * wallWeight;
      if (!isWall) {
        q.rho += q2;
        q.nearRho += q3;
      }
    });
  }
  for (const p of particles) {
    const densityError = p.rho - restDensity;
    p.p = densityError >= 0 ? densityError * stiffness : Math.max(-0.16, densityError * 0.08);
    p.nearP = p.nearRho * nearStiffness;
  }
  for (const p of wallParticles) {
    p.p = 0;
    p.nearP = 0;
  }
}

function relaxDensity() {
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    forNeighbors(p, (q, j, isWall) => {
      if (!isWall && j <= i) return;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const r2 = dx * dx + dy * dy;
      if (r2 <= 0.01 || r2 > h * h) return;
      const r = Math.sqrt(r2);
      const nx = dx / r;
      const ny = dy / r;
      const qh = 1 - r / h;
      if (isWall) {
        const corr = (Math.max(0, p.p) * qh + p.nearP * qh * qh) * 0.17 * wallRelaxScale;
        if (corr <= 0) return;
        p.x -= nx * corr;
        p.y -= ny * corr;
      } else {
        const corr = ((p.p + q.p) * qh + (p.nearP + q.nearP) * qh * qh) * 0.17;
        const cx = nx * corr;
        const cy = ny * corr;
        p.x -= cx;
        p.y -= cy;
        q.x += cx;
        q.y += cy;
      }
    });
  }
}

function applyBoundaryVelocity(p) {
  const left = wallLeft() + particleRadius + 0.1;
  const right = wallRight() - particleRadius - 0.1;
  const leftWallVx = waveMakerVx;
  if (p.x <= left && p.vx < leftWallVx) p.vx = leftWallVx;
  if (p.x >= right && p.vx > 0) p.vx = 0;
  const bedDist = signedBedDistance(p);
  if (bedDist <= particleRadius + 0.2) {
    const n = bedNormal(p.x);
    const vn = p.vx * n.x + p.vy * n.y;
    if (vn < 0) {
      p.vx -= n.x * vn;
      p.vy -= n.y * vn;
    }
  }
  if (p.y <= 16 + particleRadius + 0.1 && p.vy < 0) p.vy = 0;
}

function jet(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0, 27, 255],
    [0, 216, 255],
    [41, 255, 0],
    [255, 240, 0],
    [255, 120, 0],
    [208, 0, 0]
  ];
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return `rgb(${Math.round(stops[i][0] * (1 - f) + stops[i + 1][0] * f)},${Math.round(stops[i][1] * (1 - f) + stops[i + 1][1] * f)},${Math.round(stops[i][2] * (1 - f) + stops[i + 1][2] * f)})`;
}

function particleColor(p) {
  if (colorMode === "speed") return jet(p.speed / 560);
  return "rgba(246, 250, 255, 0.94)";
}

function drawWallParticles() {
  if (wallParticles.length === 0) return;
  for (const p of wallParticles) {
    ctx.fillStyle = p.kind === "wavemaker"
      ? "rgba(67,199,255,0.62)"
      : editWalls ? "rgba(67,199,255,0.72)" : "rgba(246,250,255,0.34)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, W < 700 ? particleRadius * 0.62 : particleRadius * 0.72, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWaveMaker() {
  const left = wallLeft();
  const top = H * 0.12;
  const bottom = bedY(left);
  ctx.fillStyle = "rgba(67,199,255,0.12)";
  ctx.fillRect(left - wallSpacing * 1.8, top, wallSpacing * 1.8, Math.max(0, bottom - top));
  ctx.strokeStyle = "rgba(67,199,255,0.68)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawBed() {
  const left = wallLeft();
  const right = wallRight();
  ctx.beginPath();
  ctx.moveTo(left, H);
  for (let i = 0; i < bed.length; i += 1) {
    const x = (i / (bed.length - 1)) * W;
    if (x < left || x > right) continue;
    ctx.lineTo(x, bed[i]);
  }
  ctx.lineTo(right, H);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = editWalls ? "rgba(67,199,255,0.8)" : "rgba(255,255,255,0.24)";
  ctx.lineWidth = editWalls ? 2 : 1;
  ctx.beginPath();
  ctx.moveTo(left, bedY(left));
  for (let i = 0; i < bed.length; i += 1) {
    const x = (i / (bed.length - 1)) * W;
    if (x > left && x < right) ctx.lineTo(x, bed[i]);
  }
  ctx.lineTo(right, bedY(right));
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.beginPath();
  ctx.moveTo(left, H * 0.12);
  ctx.lineTo(left, H);
  ctx.moveTo(right, H * 0.12);
  ctx.lineTo(right, H);
  ctx.stroke();
}

function drawWatermark() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(246,250,255,0.105)";
  ctx.font = `700 ${Math.min(168, Math.max(80, W * 0.12))}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
  ctx.fillText("HydLab", W * 0.5, H * 0.43);
  ctx.fillStyle = "rgba(246,250,255,0.085)";
  ctx.font = `500 ${Math.min(56, Math.max(30, W * 0.036))}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
  ctx.fillText("Tokyo University of Science", W * 0.5, H * 0.43 + Math.min(128, Math.max(76, W * 0.09)));
  ctx.restore();
}

function draw() {
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(67,199,255,0.025)";
  for (let y = 0; y < H; y += 44) ctx.fillRect(0, y, W, 1);
  for (let x = 0; x < W; x += 44) ctx.fillRect(x, 0, 1, H);
  drawWatermark();
  drawBed();
  drawWaveMaker();
  drawWallParticles();

  ctx.lineCap = "round";
  for (const p of particles) {
    ctx.fillStyle = particleColor(p);
    ctx.beginPath();
    ctx.arc(p.x, p.y, W < 700 ? particleRadius * 0.85 : particleRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (showVectors) {
    ctx.strokeStyle = "rgba(255,255,255,0.62)";
    ctx.lineWidth = 1;
    const step = W < 700 ? 8 : 6;
    for (let i = 0; i < particles.length; i += step) {
      const p = particles[i];
      const s = Math.min(16, p.speed * 0.035);
      if (s < 1.5) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (p.vx / (p.speed || 1)) * s, p.y + (p.vy / (p.speed || 1)) * s);
      ctx.stroke();
    }
  }

  if (editWalls) {
    ctx.fillStyle = "rgba(67,199,255,0.9)";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText("drag bottom boundary to reshape", 14, 26);
  }

  drawDamBreakCountdown(performance.now());
}

function drawDamBreakCountdown(now) {
  if (!damBreakCountdownUntil || now >= damBreakCountdownUntil) return;
  const remaining = Math.ceil((damBreakCountdownUntil - now) / 1000);
  ctx.strokeStyle = "rgba(67,199,255,0.62)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(damBreakGateX, H * 0.16);
  ctx.lineTo(damBreakGateX, bedY(damBreakGateX));
  ctx.stroke();
  ctx.fillStyle = "rgba(5,7,10,0.45)";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(246,250,255,0.96)";
  ctx.font = `700 ${Math.min(150, Math.max(72, W * 0.1))}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(remaining), W * 0.5, H * 0.42);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function frame(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  updateWaveMakerState(now / 1000);
  rebuildWallParticles();
  processParticleCountButtons(Math.min(0.05, dt));
  processAutoDemo(now);
  if (damBreakCountdownUntil && now < damBreakCountdownUntil) {
    for (const p of particles) {
      constrainPosition(p);
      p.vx = 0;
      p.vy = 0;
      p.oldX = p.x;
      p.oldY = p.y;
      p.speed = 0;
    }
  } else {
    if (damBreakCountdownUntil) damBreakCountdownUntil = 0;
    simulate(dt);
  }
  draw();
  fpsSmoother = fpsSmoother * 0.92 + (1 / Math.max(dt, 0.001)) * 0.08;
  ui.particleCount.textContent = wallParticles.length
    ? `${particles.length} water / ${wallParticles.length} wall`
    : `${particles.length} particles`;
  ui.fps.textContent = `${Math.round(fpsSmoother)} fps`;
  updateDebugMetrics(now);
  requestAnimationFrame(frame);
}

function meanMetric(items, fn) {
  if (items.length === 0) return 0;
  let total = 0;
  for (const item of items) total += fn(item);
  return total / items.length;
}

function maxMetric(items, fn) {
  let value = 0;
  for (const item of items) value = Math.max(value, fn(item));
  return value;
}

function quantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const i = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

function surfaceMetrics(left, right) {
  const bins = 18;
  const tops = [];
  const leftTops = [];
  const rightTops = [];
  const width = right - left;
  for (let i = 0; i < bins; i += 1) {
    const x0 = left + (width * i) / bins;
    const x1 = left + (width * (i + 1)) / bins;
    let top = Infinity;
    let count = 0;
    for (const p of particles) {
      if (p.x >= x0 && p.x < x1) {
        top = Math.min(top, p.y);
        count += 1;
      }
    }
    if (count > 6 && Number.isFinite(top)) {
      tops.push(top);
      if (i < bins / 3) leftTops.push(top);
      if (i >= (bins * 2) / 3) rightTops.push(top);
    }
  }
  const round = (v) => Math.round(v * 10) / 10;
  const avg = (values) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const medianTop = quantile(tops, 0.5);
  const sideHigh = particles.filter((p) => {
    const nearSide = Math.min(p.x - left, right - p.x) < sideWallBand * 1.4;
    return nearSide && medianTop && p.y < medianTop - spacing * 2.4;
  });
  return {
    surfaceBins: tops.length,
    surfaceRange: round(tops.length ? Math.max(...tops) - Math.min(...tops) : 0),
    surfaceLeftY: round(avg(leftTops)),
    surfaceRightY: round(avg(rightTops)),
    surfaceDeltaY: round(avg(rightTops) - avg(leftTops)),
    sideHighCount: sideHigh.length
  };
}

function collectDebugMetrics() {
  const left = wallLeft() + particleRadius;
  const right = wallRight() - particleRadius;
  const side = particles.filter((p) => Math.min(p.x - left, right - p.x) < sideWallBand);
  const bottom = particles.filter((p) => signedBedDistance(p) < bedBoundaryBand);
  const speed = (p) => Math.hypot(p.vx, p.vy);
  const round = (v) => Math.round(v * 10) / 10;
  const surface = surfaceMetrics(left, right);
  return {
    mode,
    particles: particles.length,
    wallParticles: wallParticles.length,
    fps: Math.round(fpsSmoother),
    sideCount: side.length,
    sideMeanVy: round(meanMetric(side, (p) => p.vy)),
    sideMeanAbsVy: round(meanMetric(side, (p) => Math.abs(p.vy))),
    sideMaxAbsVy: round(maxMetric(side, (p) => Math.abs(p.vy))),
    sideMeanSpeed: round(meanMetric(side, speed)),
    bottomCount: bottom.length,
    bottomMeanSpeed: round(meanMetric(bottom, speed)),
    bottomMaxSpeed: round(maxMetric(bottom, speed)),
    meanSpeed: round(meanMetric(particles, speed)),
    maxSpeed: round(maxMetric(particles, speed)),
    damBreakCountingDown: Boolean(damBreakCountdownUntil),
    autoDemoInterval: autoDemoIntervalSec(),
    autoDemoNextIn: autoDemoNextAt ? round(Math.max(0, (autoDemoNextAt - performance.now()) / 1000)) : 0,
    waveMakerX: round(waveMakerX),
    waveMakerVx: round(waveMakerVx),
    waveAmplitude: round(waveAmplitudePx()),
    viscosityScale: round(viscosityScale()),
    ...surface
  };
}

function updateDebugMetrics(now) {
  if (now - lastMetricsAt < 250) return;
  lastMetricsAt = now;
  document.documentElement.dataset.simMetrics = JSON.stringify(collectDebugMetrics());
}

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPoint(e);
  activePointer = { id: e.pointerId, x: p.x, y: p.y, px: p.x, py: p.y, dx: 0, dy: 0, moved: false };
  if (editWalls) setBedAt(p.x, p.y);
});

canvas.addEventListener("pointermove", (e) => {
  if (!activePointer || activePointer.id !== e.pointerId) return;
  const p = canvasPoint(e);
  activePointer.dx = p.x - activePointer.x;
  activePointer.dy = p.y - activePointer.y;
  activePointer.x = p.x;
  activePointer.y = p.y;
  activePointer.moved = activePointer.moved || Math.hypot(activePointer.dx, activePointer.dy) > 4;
  if (editWalls) setBedAt(p.x, p.y);
});

canvas.addEventListener("pointerup", (e) => {
  if (!activePointer || activePointer.id !== e.pointerId) return;
  if (!editWalls && !activePointer.moved) {
    const p = canvasPoint(e);
    addBlob(p.x, p.y, W < 700 ? 3 : 4, W < 700 ? 4 : 5);
  }
  activePointer = null;
});

canvas.addEventListener("pointercancel", () => {
  activePointer = null;
});

ui.panelToggle.addEventListener("click", () => ui.panel.classList.toggle("hidden"));
ui.closePanel.addEventListener("click", () => ui.panel.classList.add("hidden"));
ui.qrButton.addEventListener("click", () => {
  ui.qrOverlay.classList.remove("hidden");
});
ui.qrOverlay.addEventListener("click", () => {
  ui.qrOverlay.classList.add("hidden");
});

ui.damBreak.addEventListener("click", () => triggerDamBreak(false));
ui.clearWater.addEventListener("click", () => {
  damBreakCountdownUntil = 0;
  resetBed(true);
  reprojectParticlesAfterBedEdit();
  scheduleNextAutoDemo();
});

function bindHoldButton(button, setHeld) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    button.classList.add("active");
    setHeld(true);
  });
  const release = (e) => {
    if (e.pointerId !== undefined && button.hasPointerCapture(e.pointerId)) {
      button.releasePointerCapture(e.pointerId);
    }
    button.classList.remove("active");
    setHeld(false);
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
  button.addEventListener("lostpointercapture", () => {
    button.classList.remove("active");
    setHeld(false);
  });
}

bindHoldButton(ui.addParticles, (held) => {
  if (held) {
    removeParticlesHeld = false;
    ui.removeParticles.classList.remove("active");
  }
  addParticlesHeld = held;
});
bindHoldButton(ui.removeParticles, (held) => {
  if (held) {
    addParticlesHeld = false;
    ui.addParticles.classList.remove("active");
  }
  removeParticlesHeld = held;
});

function releaseParticleHoldButtons() {
  addParticlesHeld = false;
  removeParticlesHeld = false;
  ui.addParticles.classList.remove("active");
  ui.removeParticles.classList.remove("active");
}

window.addEventListener("pointerup", releaseParticleHoldButtons);
window.addEventListener("pointercancel", releaseParticleHoldButtons);
window.addEventListener("blur", releaseParticleHoldButtons);

ui.colorMode.addEventListener("change", () => {
  colorMode = ui.colorMode.value;
  ui.legendBar.className = `legend-bar ${colorMode === "white" ? "" : colorMode}`;
  ui.legendText.textContent = colorMode === "speed" ? "blue: slow, red: fast" : "white: water particles";
});
ui.showVectors.addEventListener("change", () => {
  showVectors = ui.showVectors.checked;
});
ui.editWalls.addEventListener("change", () => {
  editWalls = ui.editWalls.checked;
});
ui.autoDemoInterval.addEventListener("change", () => {
  scheduleNextAutoDemo();
});
ui.randomTerrain.addEventListener("change", () => {
  scheduleNextAutoDemo();
});
ui.viscosityScale.addEventListener("input", () => {
  ui.viscosityScaleLabel.textContent = Number(ui.viscosityScale.value).toFixed(2);
});
ui.waveAmplitude.addEventListener("input", () => {
  ui.waveAmplitudeLabel.textContent = ui.waveAmplitude.value;
});
ui.wavePeriod.addEventListener("input", () => {
  ui.wavePeriodLabel.textContent = Number(ui.wavePeriod.value).toFixed(1);
});

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);
