/**
 * 16-bit style Toronto skyline renderer.
 *
 * Everything is drawn procedurally into a low-resolution canvas (SCENE_H rows tall,
 * width follows the container's aspect ratio) and scaled up with
 * `image-rendering: pixelated`. No image assets needed.
 *
 * Animated layers: dithered sky + rotating sun rays, drifting clouds, twinkling
 * stars, birds, flickering windows, CN Tower lights, rippling water reflection,
 * sun glitter, and an island ferry.
 */

export type SkylineVariant = "sunset" | "night";

type RGB = [number, number, number];

interface Palette {
  sky: string[]; // top -> horizon
  body: "sun" | "moon";
  bodyCore: string;
  bodyRing: string;
  rays: boolean;
  starCount: number;
  starTop: number; // fraction of sky height stars may appear in
  star: [string, string];
  far: string;
  mid: string;
  near: string;
  rimMid: string;
  rimNear: string;
  windows: string[];
  windowChance: number;
  dome: [string, string, string]; // shade, body, highlight
  domeBase: string;
  domeSign: string;
  towerShaft: string;
  towerEdge: string;
  towerLine: string | null; // vertical illuminated line on the shaft
  podRing: [string, string]; // dim, bright
  antennaTop: string;
  cloud: [string, string, string]; // lit, body, shadow
  cloudAlpha: number;
  waterBase: string;
  waterTint: string;
  tintMin: number;
  tintMax: number;
  sparkle: [string, string]; // warm (glitter column), cool
  shoreLight: string;
  ferryLight: string;
  ferryBody: string;
  ferryHull: string;
  bird: string;
}

const PALETTES: Record<SkylineVariant, Palette> = {
  sunset: {
    sky: [
      "#1d1b4f", "#28245f", "#352b70", "#45327f", "#583a8c", "#6c4095",
      "#83479b", "#9c4f9c", "#b6579a", "#cd6194", "#e06e8b", "#ee8082",
      "#f6967b", "#fbae74", "#fdc874", "#fee08e",
    ],
    body: "sun",
    bodyCore: "#fff4c2",
    bodyRing: "#ffd98a",
    rays: true,
    starCount: 22,
    starTop: 0.18,
    star: ["#c9b8ff", "#8f7fd6"],
    far: "#6a4592",
    mid: "#3d2b66",
    near: "#241a42",
    rimMid: "#7e559f",
    rimNear: "#3e2c62",
    windows: ["#ffd98a", "#ffbd6b", "#ff9c72", "#ffe9b0"],
    windowChance: 0.3,
    dome: ["#3a47a8", "#5f72dc", "#a8b8ff"],
    domeBase: "#2c2150",
    domeSign: "#ff9f6b",
    towerShaft: "#2d2150",
    towerEdge: "#8d5ea6",
    towerLine: null,
    podRing: ["#a8324f", "#ff6b86"],
    antennaTop: "#ff3b5c",
    cloud: ["#ffc0a0", "#d0709a", "#8a4c96"],
    cloudAlpha: 1,
    waterBase: "#2a2058",
    waterTint: "#1a1442",
    tintMin: 0.3,
    tintMax: 0.62,
    sparkle: ["#fff0b8", "#f7a08c"],
    shoreLight: "#ffcf7a",
    ferryLight: "#ffe08a",
    ferryBody: "#e8d8f0",
    ferryHull: "#1c1436",
    bird: "#2a1d48",
  },
  night: {
    sky: [
      "#060a22", "#08102c", "#0b1536", "#0e1b42", "#11214e", "#14285a",
      "#183066", "#1d3872", "#23417d", "#2b4b87", "#355590", "#425f97",
      "#536a9c", "#6874a0",
    ],
    body: "moon",
    bodyCore: "#f4f1de",
    bodyRing: "#b9bfd8",
    rays: false,
    starCount: 140,
    starTop: 0.62,
    star: ["#ffffff", "#8fa2e0"],
    far: "#1d2a5c",
    mid: "#131c44",
    near: "#0a1030",
    rimMid: "#25356e",
    rimNear: "#141d48",
    windows: ["#ffe29a", "#ffc66e", "#ffb35c", "#a9dcff", "#ffffff"],
    windowChance: 0.52,
    dome: ["#2639b8", "#4a6bff", "#a8c0ff"],
    domeBase: "#1a1f4c",
    domeSign: "#ff6b9a",
    towerShaft: "#1b2048",
    towerEdge: "#ff4f8b",
    towerLine: "#ff8fbd",
    podRing: ["#b0305f", "#ffd0e0"],
    antennaTop: "#ff2f5e",
    cloud: ["#3c4c8a", "#2a376c", "#1d2754"],
    cloudAlpha: 0.75,
    waterBase: "#0b1236",
    waterTint: "#030720",
    tintMin: 0.28,
    tintMax: 0.62,
    sparkle: ["#e8ecff", "#ff8fc4"],
    shoreLight: "#ffd37a",
    ferryLight: "#ffe08a",
    ferryBody: "#c8d0ee",
    ferryHull: "#070b22",
    bird: "#0a1030",
  },
};

/** Scene height in art pixels. Width is derived from the container aspect ratio. */
export const SCENE_H = 200;
const HZ = 140; // horizon / waterline row
const WATER_H = SCENE_H - HZ;
const REFLECT_K = 1.55; // how many sky rows each water row covers

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

function hexToRgb(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

interface Win { x: number; y: number; c: string; on: boolean }
interface Blinker { x: number; y: number; phase: number; color: string }
interface Cloud { sprite: HTMLCanvasElement; x: number; y: number; speed: number }
interface Star { x: number; y: number; phase: number; speed: number; bright: boolean }
interface Sparkle { x: number; d: number; len: number; phase: number; speed: number; warm: boolean }

interface World {
  W: number;
  pal: Palette;
  skyRgb: RGB[];
  bodyCoreRgb: RGB;
  bodyRingRgb: RGB;
  towerX: number;
  podRingY: number;
  antennaTopY: number;
  body: { x: number; y: number; r: number };
  skyline: HTMLCanvasElement;
  windows: Win[];
  blinkers: Blinker[];
  shoreLights: number[];
  clouds: Cloud[];
  stars: Star[];
  sparkles: Sparkle[];
  angle: Float32Array;
  dist: Float32Array;
  skyImage: ImageData;
  scene: HTMLCanvasElement;
  sceneCtx: CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------

function buildWorld(W: number, variant: SkylineVariant, seed: number): World {
  const pal = PALETTES[variant];
  const rng = mulberry32(seed);
  const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));

  const towerX = Math.round(W * 0.55);
  const domeCX = towerX - 40;
  const domeR = 22;
  const downtownStart = towerX + 8;
  const downtownEnd = Math.min(W - 10, towerX + Math.max(110, Math.round(W * 0.32)));
  const body =
    pal.body === "sun"
      ? { x: Math.max(30, Math.round(towerX - W * 0.27)), y: HZ - 44, r: 13 }
      : { x: Math.max(24, Math.round(W * 0.16)), y: 30, r: 7 };

  const skyline = makeCanvas(W, HZ);
  const g = skyline.getContext("2d")!;
  const fill = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };

  const windows: Win[] = [];
  const blinkers: Blinker[] = [];
  const pickWindow = () => pal.windows[Math.floor(rng() * pal.windows.length)];

  type Layer = "far" | "mid" | "near";

  const heightFor = (layer: Layer, x: number): number => {
    // Dip the skyline under the setting sun so it peeks through
    const sunGap = pal.body === "sun" ? Math.max(0, 1 - Math.abs(x - body.x) / 24) : 0;
    if (sunGap > 0 && layer !== "near") return Math.round(heightFor2(layer, x) * (1 - sunGap * 0.55));
    return heightFor2(layer, x);
  };
  const heightFor2 = (layer: Layer, x: number): number => {
    const inDowntown = x >= downtownStart && x <= downtownEnd;
    const nearDome = x > domeCX - domeR - 6 && x < towerX - 3;
    if (layer === "far") {
      if (inDowntown) return ri(45, 92);
      if (x < domeCX - domeR) return ri(28, 58);
      return ri(22, 48);
    }
    if (layer === "mid") {
      if (nearDome) return ri(5, 12);
      if (inDowntown) {
        const centre = 1 - Math.abs((x - (downtownStart + downtownEnd) / 2) / ((downtownEnd - downtownStart) / 2));
        return ri(26, 48) + Math.round(centre * ri(10, 42));
      }
      if (x < domeCX - domeR) return ri(16, 46);
      return ri(14, 38);
    }
    return ri(3, 11);
  };

  const drawBuilding = (layer: Layer, x: number, w: number, h: number) => {
    const color = layer === "far" ? pal.far : layer === "mid" ? pal.mid : pal.near;
    const rim = layer === "mid" ? pal.rimMid : layer === "near" ? pal.rimNear : null;
    const top = HZ - h;
    fill(x, top, w, h, color);

    // Roof variations
    const roll = rng();
    if (roll < 0.16 && w >= 6) {
      const sw = Math.max(2, w - ri(3, 5));
      const sh = ri(2, 5);
      fill(x + Math.floor((w - sw) / 2), top - sh, sw, sh, color);
    } else if (roll < 0.32 && layer !== "near") {
      const ah = ri(3, 10);
      const ax = x + Math.floor(w / 2);
      fill(ax, top - ah, 1, ah, color);
      if (layer === "mid" && rng() < 0.6) blinkers.push({ x: ax, y: top - ah - 1, phase: rng() * 6, color: pal.antennaTop });
    } else if (roll < 0.42 && w >= 5) {
      const rise = ri(2, 5);
      for (let i = 0; i < w; i++) {
        const hh = Math.round((i / (w - 1)) * rise);
        fill(x + i, top - hh, 1, hh, color);
      }
    }

    // Rim light on the sun-facing (left) edge and roof
    if (rim) {
      fill(x, top, 1, h, rim);
      fill(x, top, w, 1, rim);
    }

    // Windows
    if (layer === "far") {
      if (variant === "night") {
        for (let wy = top + 3; wy < HZ - 2; wy += 4)
          for (let wx = x + 1; wx < x + w - 1; wx += 3)
            if (rng() < 0.12) windows.push({ x: wx, y: wy, c: pal.rimMid, on: true });
      }
      return;
    }
    if (w < 3) return;
    const style = rng();
    if (style < 0.12) return; // dark building
    const stepY = layer === "near" ? 2 : 3;
    const stripes = style > 0.85; // vertical lit stripes
    const chance = pal.windowChance * (style < 0.4 ? 0.5 : 1);
    for (let wy = top + 2; wy < HZ - 1; wy += stepY) {
      for (let wx = x + 1; wx < x + w - 1; wx += 2) {
        if (stripes ? (wx - x) % 4 === 1 : rng() < chance) {
          windows.push({ x: wx, y: wy, c: pickWindow(), on: rng() < 0.92 });
        }
      }
    }
  };

  const drawCrane = (x: number, baseTop: number) => {
    const mastH = ri(12, 20);
    const jib = ri(10, 16);
    const topY = baseTop - mastH;
    fill(x, topY, 1, mastH, pal.mid);
    fill(x - 3, topY, jib + 3, 1, pal.mid);
    fill(x - 3, topY + 1, 2, 2, pal.mid); // counterweight
    for (let i = 2; i < jib; i += 3) fill(x + i, topY + 1, 1, 1, pal.mid);
    blinkers.push({ x: x + jib - 1, y: topY - 1, phase: rng() * 6, color: pal.antennaTop });
  };

  const layerPass = (layer: Layer) => {
    let x = -ri(0, 6);
    while (x < W) {
      const w = layer === "near" ? ri(5, 14) : layer === "far" ? ri(5, 12) : ri(5, 13);
      const skipDome = (layer === "near" || layer === "mid") && x + w > domeCX - domeR - 3 && x < domeCX + domeR + 3;
      if (!skipDome) {
        const h = heightFor(layer, x + w / 2);
        drawBuilding(layer, x, w, h);
        if (layer === "mid" && x > downtownStart && x < downtownEnd && rng() < 0.06) drawCrane(x + Math.floor(w / 2), HZ - h);
      }
      x += w + (layer === "far" ? ri(-1, 1) : ri(0, 2));
    }
  };

  // Far haze layer
  layerPass("far");

  // --- CN Tower -----------------------------------------------------------
  const podY = HZ - 86; // main pod centre row
  const antennaTopY = 14;
  // Shaft (tapering legs)
  for (let y = podY + 5; y < HZ; y++) {
    const t = (y - (podY + 5)) / (HZ - (podY + 5));
    const hw = Math.round(1.5 + t * 3.2);
    fill(towerX - hw, y, hw * 2 + 1, 1, pal.towerShaft);
    fill(towerX - hw, y, 1, 1, pal.towerEdge);
  }
  if (pal.towerLine) fill(towerX, podY + 5, 1, HZ - podY - 5, pal.towerLine);
  // Main pod
  const podRows: [number, number, string][] = [
    [-4, 3, pal.towerShaft],
    [-3, 5, pal.towerShaft],
    [-2, 7, pal.towerShaft],
    [-1, 8, pal.towerShaft],
    [0, 8, pal.podRing[0]], // ring light row (animated)
    [1, 7, pal.towerShaft],
    [2, 7, pal.windows[0]], // observation deck glow
    [3, 5, pal.towerShaft],
    [4, 3, pal.towerShaft],
  ];
  for (const [dy, hw, c] of podRows) {
    fill(towerX - hw, podY + dy, hw * 2 + 1, 1, c);
    fill(towerX - hw, podY + dy, 1, 1, pal.towerEdge);
  }
  // Upper shaft + SkyPod
  fill(towerX - 1, podY - 22, 3, 18, pal.towerShaft);
  fill(towerX - 1, podY - 22, 1, 18, pal.towerEdge);
  fill(towerX - 2, podY - 25, 5, 3, pal.towerShaft);
  fill(towerX - 2, podY - 24, 5, 1, pal.windows[1]);
  // Antenna
  fill(towerX, antennaTopY, 1, podY - 25 - antennaTopY, pal.towerShaft);
  fill(towerX - 1, podY - 35, 3, 10, pal.towerShaft);
  if (pal.towerLine) fill(towerX, antennaTopY + 4, 1, podY - 29 - antennaTopY, pal.towerLine);

  // --- Rogers Centre dome ------------------------------------------------
  const baseTop = HZ - 9;
  fill(domeCX - domeR - 3, baseTop, domeR * 2 + 7, 9, pal.domeBase);
  for (let x = domeCX - domeR; x <= domeCX + domeR; x += 3) fill(x, baseTop + 3, 2, 1, pal.domeSign);
  for (let dx = -domeR; dx <= domeR; dx++) {
    const h = Math.round(13 * Math.sqrt(1 - (dx / (domeR + 0.5)) ** 2));
    const x = domeCX + dx;
    fill(x, baseTop - h, 1, h, pal.dome[1]);
    fill(x, baseTop - h, 1, 1, pal.dome[2]); // lit rim
    if (h > 2) fill(x, baseTop - 2, 1, 2, pal.dome[0]);
    if ((dx + domeR) % 8 === 0 && h > 1) fill(x, baseTop - h + 1, 1, h - 1, pal.dome[0]); // panel seams
  }
  fill(domeCX - 10, baseTop - 12, 6, 1, pal.dome[2]); // specular streak

  // Mid + near layers sit in front of the tower base
  layerPass("mid");
  layerPass("near");

  // Shoreline lights along the water's edge
  const shoreLights: number[] = [];
  for (let x = 1; x < W; x += ri(3, 9)) shoreLights.push(x);

  // --- Sky body (sun / moon) ----------------------------------------------
  const angle = new Float32Array(W * HZ);
  const dist = new Float32Array(W * HZ);
  for (let y = 0; y < HZ; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dx = x - body.x;
      const dy = y - body.y;
      angle[i] = Math.atan2(dy, dx);
      dist[i] = Math.sqrt(dx * dx + dy * dy);
    }
  }

  // --- Clouds --------------------------------------------------------------
  const clouds: Cloud[] = [];
  const cloudCount = Math.max(4, Math.round(W / 70));
  for (let i = 0; i < cloudCount; i++) {
    const cw = ri(26, 60);
    const ch = ri(10, 16);
    clouds.push({
      sprite: makeCloudSprite(cw, ch, pal, rng),
      x: rng() * (W + 60),
      y: ri(14, 78),
      speed: 0.6 + rng() * 1.6,
    });
  }
  clouds.sort((a, b) => a.speed - b.speed);

  // --- Stars -----------------------------------------------------------------
  const stars: Star[] = [];
  const starCount = Math.round(pal.starCount * (W / 360));
  for (let i = 0; i < starCount; i++) {
    stars.push({
      x: ri(0, W - 1),
      y: ri(0, Math.floor(HZ * pal.starTop)),
      phase: rng() * Math.PI * 2,
      speed: 0.8 + rng() * 2.5,
      bright: rng() < 0.25,
    });
  }

  // --- Water sparkles ------------------------------------------------------
  const sparkles: Sparkle[] = [];
  const sparkCount = Math.round(W * 0.22);
  for (let i = 0; i < sparkCount; i++) {
    const d = ri(1, WATER_H - 2);
    const glitter = rng() < 0.45;
    const spread = 4 + d * 0.9;
    const x = glitter ? Math.round(body.x + (rng() + rng() + rng() - 1.5) * spread * 1.4) : ri(0, W - 1);
    sparkles.push({
      x,
      d,
      len: ri(1, glitter ? 5 : 3) + (d > 30 ? 1 : 0),
      phase: rng() * Math.PI * 2,
      speed: 1 + rng() * 2.5,
      warm: glitter,
    });
  }

  const scene = makeCanvas(W, HZ);
  const sceneCtx = scene.getContext("2d")!;

  return {
    W,
    pal,
    skyRgb: pal.sky.map(hexToRgb),
    bodyCoreRgb: hexToRgb(pal.bodyCore),
    bodyRingRgb: hexToRgb(pal.bodyRing),
    towerX,
    podRingY: podY,
    antennaTopY,
    body,
    skyline,
    windows,
    blinkers,
    shoreLights,
    clouds,
    stars,
    sparkles,
    angle,
    dist,
    skyImage: sceneCtx.createImageData(W, HZ),
    scene,
    sceneCtx,
  };
}

function makeCloudSprite(w: number, h: number, pal: Palette, rng: () => number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = c.getContext("2d")!;
  const puffs: { x: number; y: number; r: number }[] = [];
  const n = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const mid = 1 - Math.abs(i / (n - 1) - 0.5) * 2; // bigger puffs toward the centre
    const r = Math.max(2.2, h * (0.22 + mid * 0.38 + rng() * 0.12));
    const x = r + (i / (n - 1)) * (w - 2 * r) + (rng() - 0.5) * 3;
    puffs.push({ x, y: h - 2 - r * 0.55, r });
  }
  const baseL = puffs[0].x;
  const baseR = puffs[n - 1].x;
  const inside = (x: number, y: number) =>
    y >= 0 &&
    y < h - 1 &&
    ((y >= h - 4 && x >= baseL && x <= baseR) || puffs.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 <= p.r * p.r));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      let col = pal.cloud[1];
      if (!inside(x, y - 1) || !inside(x - 1, y - 1)) col = pal.cloud[0];
      else if (y >= h - 3 || !inside(x, y + 2)) col = pal.cloud[2];
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// Per-frame rendering
// ---------------------------------------------------------------------------

const BIRD_FRAMES = [
  ["x...x", ".x.x.", "..x.."],
  [".....", "xx.xx", "..x.."],
];

const FERRY = [
  "....bbbb......",
  "..bbbbbbbbb...",
  ".blblblblblbb.",
  "hhhhhhhhhhhhhh",
  ".hhhhhhhhhhhh.",
];

function drawSky(w: World, t: number) {
  const { W, skyRgb, angle, dist, body, pal } = w;
  const data = w.skyImage.data;
  const n = skyRgb.length - 1;
  const rayCount = 11;
  const rayReach = W * 0.6;
  for (let y = 0; y < HZ; y++) {
    const base = (y / (HZ - 1)) * n;
    const brow = (y & 3) * 4;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const d = dist[i];
      const o = i * 4;
      let rgb: RGB;
      if (d <= body.r) {
        // Retro stripes through the lower half of the sun
        if (pal.body === "sun" && y > body.y + 3 && (y - body.y) % 4 === 0) {
          rgb = skyRgb[n];
        } else if (pal.body === "moon" && ((x === body.x - 2 && y === body.y - 1) || (x === body.x + 2 && y === body.y + 2) || (x === body.x + 1 && y === body.y - 3))) {
          rgb = w.bodyRingRgb;
        } else {
          rgb = w.bodyCoreRgb;
        }
      } else if (d <= body.r + 1.3) {
        rgb = w.bodyRingRgb;
      } else {
        let boost = 0;
        if (pal.rays) {
          const a = angle[i];
          let ray = Math.sin(a * rayCount + t * 0.3) * 0.5 + 0.5;
          ray = ray * ray * ray * ray;
          let ray2 = Math.sin(a * 7 - t * 0.19) * 0.5 + 0.5;
          ray2 = ray2 * ray2 * ray2 * ray2 * ray2 * ray2;
          const fall = Math.max(0, 1 - d / rayReach);
          const pulse = 0.85 + Math.sin(t * 0.9) * 0.15;
          boost = (ray * 2.6 + ray2 * 1.4) * fall * fall * pulse + Math.max(0, 1 - d / 46) * 3.2;
        } else {
          boost = Math.max(0, 1 - d / 26) * 2.2;
        }
        let idx = Math.floor(base + boost + BAYER4[brow + (x & 3)]);
        if (idx > n) idx = n;
        rgb = skyRgb[idx];
      }
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  }
  w.sceneCtx.putImageData(w.skyImage, 0, 0);
}

function renderFrame(ctx: CanvasRenderingContext2D, w: World, t: number) {
  const { W, pal, sceneCtx: g } = w;

  // 1. Sky
  drawSky(w, t);

  // 2. Stars
  for (const s of w.stars) {
    const v = Math.sin(t * s.speed + s.phase);
    if (v < -0.4) continue;
    g.fillStyle = v > 0.6 || s.bright ? pal.star[0] : pal.star[1];
    g.fillRect(s.x, s.y, 1, 1);
    if (s.bright && v > 0.92) {
      g.fillStyle = pal.star[1];
      g.fillRect(s.x - 1, s.y, 1, 1);
      g.fillRect(s.x + 1, s.y, 1, 1);
      g.fillRect(s.x, s.y - 1, 1, 1);
      g.fillRect(s.x, s.y + 1, 1, 1);
    }
  }

  // 3. Clouds (parallax drift)
  g.globalAlpha = pal.cloudAlpha;
  for (const c of w.clouds) {
    const span = W + c.sprite.width;
    const x = Math.floor(((c.x + t * c.speed) % span + span) % span) - c.sprite.width;
    g.drawImage(c.sprite, x, c.y);
  }
  g.globalAlpha = 1;

  // 4. Birds (a small flock every 28s)
  const flockT = t % 28;
  if (flockT < 16) {
    const fx = -12 + (flockT / 16) * (W + 24);
    const fy = 44 + Math.sin(t * 0.7) * 4;
    const flock = [[0, 0], [-7, 4], [-6, -5], [-14, 7], [-13, -2]];
    g.fillStyle = pal.bird;
    flock.forEach(([ox, oy], i) => {
      const frame = BIRD_FRAMES[(Math.floor(t * 5) + i) % 2];
      const bx = Math.round(fx + ox);
      const by = Math.round(fy + oy + Math.sin(t * 2 + i) * 1);
      frame.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) if (row[rx] === "x") g.fillRect(bx + rx, by + ry, 1, 1);
      });
    });
  }

  // 5. Skyline
  g.drawImage(w.skyline, 0, 0);

  // 6. Windows (with occasional flicker)
  for (let k = 0; k < 3; k++) {
    if (Math.random() < 0.5 && w.windows.length) {
      const win = w.windows[Math.floor(Math.random() * w.windows.length)];
      win.on = !win.on;
    }
  }
  for (const win of w.windows) {
    if (!win.on) continue;
    g.fillStyle = win.c;
    g.fillRect(win.x, win.y, 1, 1);
  }

  // 7. Tower + crane lights
  const step = Math.floor(t * 9);
  for (let i = -8; i <= 8; i++) {
    g.fillStyle = (i + 16 + step) % 4 === 0 ? pal.podRing[1] : pal.podRing[0];
    g.fillRect(w.towerX + i, w.podRingY, 1, 1);
  }
  if ((t * 1.1) % 1 < 0.55) {
    g.fillStyle = pal.antennaTop;
    g.fillRect(w.towerX, w.antennaTopY - 1, 1, 2);
  }
  for (const b of w.blinkers) {
    if (Math.sin(t * 2.2 + b.phase) > 0.2) {
      g.fillStyle = b.color;
      g.fillRect(b.x, b.y, 1, 1);
    }
  }

  // 8. Compose sky/skyline onto the output
  ctx.drawImage(w.scene, 0, 0);

  // 9. Water: per-row rippled reflection
  ctx.fillStyle = pal.waterBase;
  ctx.fillRect(0, HZ, W, WATER_H);
  for (let d = 0; d < WATER_H; d++) {
    const y = HZ + d;
    let sy = HZ - 1 - Math.floor(d * REFLECT_K);
    if (sy < 0) sy = 0;
    const amp = 0.25 + d * 0.038;
    const off = Math.round(Math.sin(t * 1.8 + d * 0.62) * amp + Math.sin(t * 0.85 - d * 0.21) * 0.6);
    ctx.drawImage(w.scene, 0, sy, W, 1, off, y, W, 1);
    if (off > 0) ctx.drawImage(w.scene, 0, sy, 1, 1, 0, y, off, 1);
    else if (off < 0) ctx.drawImage(w.scene, W - 1, sy, 1, 1, W + off, y, -off, 1);
  }
  // Depth tint + moving dark swell lines
  ctx.fillStyle = pal.waterTint;
  for (let d = 0; d < WATER_H; d++) {
    const swell = Math.sin(d * 1.15 - t * 2.1) > 0.93 ? 0.1 : 0;
    ctx.globalAlpha = Math.min(0.9, pal.tintMin + (d / WATER_H) * (pal.tintMax - pal.tintMin) + swell);
    ctx.fillRect(0, HZ + d, W, 1);
  }
  ctx.globalAlpha = 1;

  // Shoreline
  ctx.fillStyle = pal.near;
  ctx.fillRect(0, HZ, W, 1);
  ctx.fillStyle = pal.shoreLight;
  for (const x of w.shoreLights) ctx.fillRect(x, HZ, 1, 1);

  // Sparkles / sun glitter
  for (const s of w.sparkles) {
    const v = Math.sin(t * s.speed + s.phase);
    if (v < 0.5) continue;
    const len = v > 0.8 ? s.len : Math.max(1, s.len - 2);
    const x = Math.round(s.x + Math.sin(t * 0.6 + s.phase) * 1.5);
    ctx.fillStyle = s.warm ? pal.sparkle[0] : pal.sparkle[1];
    ctx.fillRect(x - (len >> 1), HZ + 1 + s.d, len, 1);
  }

  // 10. Island ferry crossing
  const ferrySpeed = 4;
  const ferryLoop = W + 260;
  const fx = Math.floor((t * ferrySpeed) % ferryLoop) - 20;
  if (fx > -20 && fx < W + 2) {
    const fy = HZ + 9 + Math.round(Math.sin(t * 1.6) * 0.6);
    FERRY.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === ".") continue;
        ctx.fillStyle = ch === "b" ? pal.ferryBody : ch === "l" ? pal.ferryLight : pal.ferryHull;
        ctx.fillRect(fx + rx, fy + ry, 1, 1);
      }
    });
    // wake
    ctx.fillStyle = pal.sparkle[1];
    for (let i = 1; i < 10; i += 2) {
      if (Math.sin(t * 6 + i) > -0.2) ctx.fillRect(fx - i * 2, fy + 4 + (i > 5 ? 1 : 0), 2, 1);
    }
    // reflected lights
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = pal.ferryLight;
    for (let rx = 2; rx < 12; rx += 2) ctx.fillRect(fx + rx + (Math.sin(t * 3 + rx) > 0 ? 1 : 0), fy + 7, 1, 1);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SkylineRenderer {
  /** Resize to the container's CSS size; regenerates the world if width changes. */
  resize(cssWidth: number, cssHeight: number): void;
  /** Draw a frame at time `t` (seconds). */
  render(t: number): void;
}

export function createSkylineRenderer(
  canvas: HTMLCanvasElement,
  options: { variant?: SkylineVariant; seed?: number } = {},
): SkylineRenderer {
  const variant = options.variant ?? "sunset";
  const seed = options.seed ?? 416;
  const ctx = canvas.getContext("2d")!;
  let world: World | null = null;

  return {
    resize(cssWidth, cssHeight) {
      if (cssWidth <= 0 || cssHeight <= 0) return;
      const W = Math.max(220, Math.round((SCENE_H * cssWidth) / cssHeight));
      if (world && world.W === W) return;
      canvas.width = W;
      canvas.height = SCENE_H;
      ctx.imageSmoothingEnabled = false;
      world = buildWorld(W, variant, seed);
    },
    render(t) {
      if (world) renderFrame(ctx, world, t);
    },
  };
}
