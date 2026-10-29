import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MOVIES, MOVIE_ORDER, ROOM, SCREEN, type Movie } from '../lib/data';

/** Mutable per-frame state shared by the screen, its light, the beam and the dust. */
export interface ScreenSignal {
  time: number;      // trailer clock in seconds
  prev: number;      // scene index fading out
  next: number;      // scene index fading in
  mix: number;       // 0 → 1 cross-fade between them
  luma: number;      // approximate screen brightness (drives room light)
  tint: THREE.Color; // ambient colour, eased toward the current film's
}

const LOOP = 16;
const TITLE_IN = 11.5;
const BEAM_SPEED = 0.7;
const BASE_LUMA = [0.85, 0.42, 0.38]; // dune, last light, quiet place
const CURVE = 0.45;                   // screen edges bow toward the audience (m)

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** JS mirror of the shader timeline so the rect light follows fades, titles and flashes. */
export function screenLuma(scene: number, time: number) {
  const lt = time % LOOP;
  const fade = smooth(0, 0.9, lt) * (1 - smooth(LOOP - 0.9, LOOP, lt));
  const title = smooth(TITLE_IN, TITLE_IN + 1, lt) * (1 - smooth(LOOP - 1.6, LOOP - 0.9, lt));
  const flash = scene === 1 ? Math.pow(Math.max(0, Math.cos(lt * BEAM_SPEED)), 8) * 0.8 : 0;
  return (BASE_LUMA[scene] + flash) * fade * (1 - 0.7 * title) + 0.03;
}

/* ── Shaders ───────────────────────────────────────────────────────── */
const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SCREEN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPrev;
uniform float uNext;
uniform float uMix;
uniform float uIntensity;
uniform sampler2D uTitlePrev;
uniform sampler2D uTitleNext;
varying vec2 vUv;

#define LOOP ${LOOP.toFixed(1)}
#define TITLE_IN ${TITLE_IN.toFixed(1)}
#define BEAM_SPEED ${BEAM_SPEED.toFixed(2)}
#define ASPECT 2.35

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { v += amp * noise(p); p *= 2.02; amp *= 0.5; }
  return v;
}
// 1.0 below height h, soft edge s
float below(float y, float h, float s) { return 1.0 - smoothstep(h - s, h + s, y); }

/* 0 — DUNE: PART TWO · layered dunes under a low sun */
vec3 dune(vec2 uv, float t) {
  vec2 p = vec2(uv.x * ASPECT, uv.y);
  vec3 col = mix(vec3(1.0, 0.64, 0.33), vec3(0.30, 0.09, 0.05), smoothstep(0.28, 1.0, uv.y));
  vec2 sun = vec2(ASPECT * 0.66, 0.47 - t * 0.003);
  float d = length(p - sun);
  col += vec3(1.0, 0.85, 0.6) * (1.0 - smoothstep(0.075, 0.082, d));
  col += vec3(1.0, 0.55, 0.25) * exp(-d * 5.0) * 0.5;
  col += vec3(0.9, 0.5, 0.25) * 0.07 * fbm(vec2(p.x * 1.2 - t * 0.03, uv.y * 9.0));
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float drift = t * (0.015 + fi * 0.02);
    float h = 0.43 - fi * 0.085
      + 0.045 * sin(p.x * (1.1 + fi * 0.6) + fi * 2.3 + drift)
      + 0.03 * fbm(vec2(p.x * (1.6 + fi) + drift, fi * 7.0));
    float m = below(uv.y, h, 0.002 + fi * 0.0015);
    float crest = 1.0 - smoothstep(0.0, 0.022, h - uv.y);
    vec3 c = mix(vec3(0.84, 0.46, 0.22), vec3(0.15, 0.05, 0.025), fi / 3.0);
    c *= 0.72 + 0.4 * smoothstep(h - 0.18, h, uv.y);
    c += crest * vec3(1.0, 0.68, 0.38) * (0.42 - fi * 0.09);
    col = mix(col, c, m);
  }
  float sand = step(0.996, hash(floor(vec2(p.x * 260.0 + t * 30.0, uv.y * 130.0))));
  col += sand * 0.22 * (1.0 - smoothstep(0.0, 0.45, uv.y));
  return col;
}

/* 1 — THE LAST LIGHT · a lighthouse sweeping a dark sea */
vec3 lastLight(vec2 uv, float t) {
  vec2 p = vec2(uv.x * ASPECT, uv.y);
  const float HZ = 0.34;
  vec3 col = mix(vec3(0.10, 0.14, 0.26), vec3(0.01, 0.015, 0.04), smoothstep(HZ, 1.0, uv.y));
  col += vec3(0.95, 0.58, 0.32) * exp(-max(uv.y - HZ, 0.0) * 16.0) * 0.55;
  vec2 sc = floor(p * 160.0);
  float star = step(0.996, hash(sc)) * smoothstep(HZ + 0.15, 0.9, uv.y);
  col += star * (0.55 + 0.45 * sin(t * 3.0 + hash(sc + 3.1) * 40.0)) * 0.85;
  float cloud = smoothstep(0.55, 0.85, fbm(vec2(p.x * 1.4 + t * 0.015, uv.y * 3.5)));
  col = mix(col, col * 0.5 + vec3(0.015, 0.02, 0.035), cloud * smoothstep(HZ + 0.05, 0.8, uv.y));

  vec2 lamp = vec2(ASPECT * 0.24, 0.585);
  float a = t * BEAM_SPEED;
  float s = sin(a);
  float flash = pow(max(cos(a), 0.0), 8.0);
  vec2 dir = normalize(vec2(s >= 0.0 ? 1.0 : -1.0, -0.035));
  vec2 v = p - lamp;
  float along = dot(v, dir);
  float across = abs(dir.x * v.y - dir.y * v.x);
  float reach = 0.05 + 1.9 * abs(s);
  float beam = step(0.0, along)
    * (1.0 - smoothstep(0.0, 0.008 + along * 0.07, across))
    * (1.0 - smoothstep(0.0, reach, along));
  vec3 warm = vec3(1.0, 0.9, 0.7);

  if (uv.y < HZ) {
    float depth = (HZ - uv.y) / HZ;
    vec3 sea = mix(vec3(0.05, 0.08, 0.14), vec3(0.01, 0.02, 0.04), depth);
    float w = noise(vec2(p.x * 14.0 + t * 0.3, uv.y * 90.0 - t * 1.2));
    float glint = smoothstep(0.62, 0.9, w);
    sea += vec3(0.9, 0.6, 0.35) * glint * exp(-depth * 4.0) * 0.35;
    sea += warm * glint * exp(-abs(p.x - lamp.x) * 7.0) * (0.15 + flash) * 0.6;
    col = sea;
  }
  col += warm * beam * 0.75;

  float k = 1.0 - smoothstep(ASPECT * 0.14, ASPECT * 0.44, p.x);
  float cliffH = mix(HZ - 0.03, 0.52, k) + 0.014 * fbm(vec2(p.x * 8.0, 3.0));
  float cliff = below(uv.y, cliffH, 0.002) * (1.0 - smoothstep(ASPECT * 0.43, ASPECT * 0.46, p.x));
  float towerW = 0.016 + (lamp.y - uv.y) * 0.05;
  float tower = step(abs(p.x - lamp.x), towerW) * step(uv.y, lamp.y - 0.012) * step(0.45, uv.y);
  col = mix(col, vec3(0.012, 0.014, 0.02), clamp(cliff + tower, 0.0, 1.0));
  float ld = length(v);
  col += warm * (exp(-ld * 45.0) * 1.6 + flash * exp(-ld * 5.0) * 1.1);
  return col;
}

/* 2 — A QUIET PLACE · moonlit farm, one lit window, swaying grass */
vec3 quiet(vec2 uv, float t) {
  vec2 p = vec2(uv.x * ASPECT, uv.y);
  vec3 col = mix(vec3(0.24, 0.31, 0.29), vec3(0.03, 0.05, 0.05), smoothstep(0.3, 1.0, uv.y));
  float md = length(p - vec2(ASPECT * 0.76, 0.75));
  col += vec3(0.88, 0.94, 0.9) * (1.0 - smoothstep(0.052, 0.058, md));
  col += vec3(0.45, 0.55, 0.5) * exp(-md * 4.5) * 0.45;
  float cloud = smoothstep(0.5, 0.8, fbm(vec2(p.x * 1.3 + t * 0.02, uv.y * 3.0)));
  col = mix(col, col * 0.5, cloud * smoothstep(0.42, 0.9, uv.y));
  float tree = 0.42 + 0.035 * fbm(vec2(p.x * 7.0, 2.0)) + 0.02 * sin(p.x * 2.2);
  col = mix(col, vec3(0.05, 0.075, 0.07), below(uv.y, tree, 0.003));

  vec2 h = p - vec2(ASPECT * 0.38, 0.40);
  float body = step(abs(h.x), 0.13) * step(h.y, 0.085) * step(-0.05, h.y);
  float roof = step(abs(h.x), 0.15) * step(0.08, h.y) * step(h.y, 0.085 + (0.15 - abs(h.x)) * 0.6);
  float silo = max(step(abs(h.x - 0.25), 0.035) * step(h.y, 0.16) * step(-0.05, h.y),
                   step(length(vec2(h.x - 0.25, h.y - 0.16)), 0.035));
  col = mix(col, vec3(0.022, 0.032, 0.032), clamp(body + roof + silo, 0.0, 1.0));
  float flick = 0.7 + 0.3 * noise(vec2(t * 3.0, 1.0));
  vec2 wv = h - vec2(-0.05, 0.035);
  float win = step(abs(wv.x), 0.018) * step(abs(wv.y), 0.016);
  col += vec3(1.0, 0.62, 0.28) * win * flick * 1.3;
  col += vec3(1.0, 0.6, 0.3) * exp(-length(wv) * 18.0) * 0.16 * flick;

  float fogN = fbm(vec2(p.x * 1.2 - t * 0.05, uv.y * 5.0));
  col = mix(col, vec3(0.32, 0.4, 0.37), (1.0 - smoothstep(0.18, 0.46, uv.y)) * (0.22 + 0.3 * fogN));
  float sway = 0.014 * sin(t * 0.9 + p.x * 1.7);
  float blades = pow(abs(sin((p.x + sway) * 46.0)), 0.6);
  float g = 0.15 + 0.07 * blades * (0.6 + 0.4 * noise(vec2(p.x * 9.0, 0.0)))
          + 0.03 * noise(vec2(p.x * 4.0, t * 0.1));
  col = mix(col, vec3(0.012, 0.022, 0.018), below(uv.y, g, 0.004));
  return col;
}

vec3 sceneColor(float id, vec2 uv, float t) {
  if (id < 0.5) return dune(uv, t);
  if (id < 1.5) return lastLight(uv, t);
  return quiet(uv, t);
}

void main() {
  float lt = mod(uTime, LOOP);
  vec2 uv = (vUv - 0.5) * (1.0 - 0.05 * lt / LOOP) + 0.5;          // slow push-in
  vec3 col = sceneColor(uNext, uv, lt);
  if (uMix < 1.0) col = mix(sceneColor(uPrev, uv, lt), col, uMix);

  float fade = smoothstep(0.0, 0.9, lt) * (1.0 - smoothstep(LOOP - 0.9, LOOP, lt));
  float title = smoothstep(TITLE_IN, TITLE_IN + 1.0, lt) * (1.0 - smoothstep(LOOP - 1.6, LOOP - 0.9, lt));

  col += (hash(vUv * 900.0 + fract(uTime * 13.7)) - 0.5) * 0.035;   // film grain
  vec2 q = (vUv - 0.5) * vec2(1.1, 1.5);
  col *= 1.0 - dot(q, q) * 0.8;                                      // lens vignette
  col = pow(max(col, vec3(0.0)), vec3(2.2));                         // display → linear

  col *= mix(1.0, 0.25, title);
  vec4 tx = mix(texture2D(uTitlePrev, vUv), texture2D(uTitleNext, vUv), uMix);
  col += tx.rgb * tx.a * title * 1.3;

  gl_FragColor = vec4(col * fade * uIntensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const HALO_VERT = /* glsl */ `
uniform vec2 uSize;
varying vec2 vPos;
void main() {
  vPos = (uv - 0.5) * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform vec2 uRect;
uniform vec3 uColor;
uniform float uLuma;
varying vec2 vPos;
void main() {
  float d = length(max(abs(vPos) - uRect, 0.0));   // metres outside the screen frame
  gl_FragColor = vec4(uColor * exp(-d * 1.1) * uLuma * 0.22, 1.0);
}`;

/* ── Title cards (original typography, drawn once per film) ─────────── */
function spaced(
  ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number,
  size: number, family: string, tracking: number, maxWidth: number,
) {
  const chars = [...text];
  const widthAt = (s: number) => {
    ctx.font = `500 ${s}px ${family}`;
    return chars.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + tracking * (s / size) * (chars.length - 1);
  };
  const natural = widthAt(size);
  const s = natural > maxWidth ? size * (maxWidth / natural) : size;
  const total = widthAt(s);
  const track = tracking * (s / size);
  ctx.textAlign = 'left';
  let x = cx - total / 2;
  for (const ch of chars) {
    ctx.fillText(ch, x, cy);
    x += ctx.measureText(ch).width + track;
  }
}

const SERIF = '"Bodoni Moda", Didot, Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

function makeTitle(movie: Movie) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = Math.round(2048 / 2.35);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(242, 240, 236, 0.7)';
    spaced(ctx, 'NOW SHOWING AT LUMIÈRE', w / 2, h * 0.34, 30, MONO, 12, w * 0.8);
    ctx.fillStyle = '#F6EFE3';
    spaced(ctx, movie.title.toUpperCase(), w / 2, h * 0.5, 172, SERIF, 16, w * 0.8);
    ctx.fillStyle = 'rgba(242, 240, 236, 0.55)';
    spaced(ctx, `${movie.genres.join('  ·  ').toUpperCase()}   ·   ${movie.rating}`, w / 2, h * 0.65, 30, MONO, 10, w * 0.8);
    texture.needsUpdate = true;
  };
  draw();
  return { texture, draw };
}

/* ── Component ─────────────────────────────────────────────────────── */
export function CinemaScreen({ signal }: { signal: ScreenSignal }) {
  const titles = useMemo(() => {
    const list: ReturnType<typeof makeTitle>[] = [];
    MOVIE_ORDER.forEach((id) => { list[MOVIES[id].scene] = makeTitle(MOVIES[id]); });
    return list;
  }, []);

  // Redraw once the webfonts arrive so the cards use Bodoni Moda, not the fallback.
  useEffect(() => {
    let alive = true;
    Promise.all([document.fonts.load(`500 172px ${SERIF}`), document.fonts.load(`500 30px ${MONO}`)])
      .then(() => { if (alive) titles.forEach((t) => t.draw()); })
      .catch(() => {});
    return () => {
      alive = false;
      titles.forEach((t) => t.texture.dispose());
    };
  }, [titles]);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SCREEN.width, SCREEN.height, 64, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) / (SCREEN.width / 2);
      pos.setZ(i, nx * nx * CURVE);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPrev: { value: signal.prev },
      uNext: { value: signal.next },
      uMix: { value: 1 },
      uIntensity: { value: 1.35 },
      uTitlePrev: { value: titles[signal.prev].texture },
      uTitleNext: { value: titles[signal.next].texture },
    },
    vertexShader: SCREEN_VERT,
    fragmentShader: SCREEN_FRAG,
    toneMapped: false,
  }), [signal, titles]);

  const haloW = ROOM.halfWidth * 2 - 0.2;
  const haloH = (ROOM.ceiling - SCREEN.y) * 2 - 0.2;
  const halo = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: new THREE.Vector2(haloW, haloH) },
      uRect: { value: new THREE.Vector2(SCREEN.width / 2 + 0.3, SCREEN.height / 2 + 0.25) },
      uColor: { value: new THREE.Color() },
      uLuma: { value: 0 },
    },
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), [haloW, haloH]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); halo.dispose(); }, [geometry, material, halo]);

  useFrame(() => {
    const u = material.uniforms;
    u.uTime.value = signal.time;
    u.uPrev.value = signal.prev;
    u.uNext.value = signal.next;
    u.uMix.value = signal.mix;
    u.uTitlePrev.value = titles[signal.prev].texture;
    u.uTitleNext.value = titles[signal.next].texture;
    (halo.uniforms.uColor.value as THREE.Color).copy(signal.tint);
    halo.uniforms.uLuma.value = signal.luma;
  });

  return (
    <group>
      {/* light spill on the front wall */}
      <mesh position={[0, SCREEN.y, ROOM.front + 0.02]} material={halo}>
        <planeGeometry args={[haloW, haloH]} />
      </mesh>
      {/* black velvet masking frame */}
      <mesh position={[0, SCREEN.y, SCREEN.z - 0.04]}>
        <planeGeometry args={[SCREEN.width + 0.6, SCREEN.height + 0.5]} />
        <meshBasicMaterial color="#020203" />
      </mesh>
      <mesh geometry={geometry} material={material} position={[0, SCREEN.y, SCREEN.z]} />
    </group>
  );
}
