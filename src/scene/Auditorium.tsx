import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AISLE_X, ROOM, ROW, ROWS, SCREEN, STAGE_EDGE, rowFloor, rowZ } from '../lib/data';
import type { ScreenSignal } from './CinemaScreen';

/* ── Room constants ─────────────────────────────────────────────────── */
export const STAGE_H = 0.75;
const W = ROOM.halfWidth * 2;
const LEN = ROOM.back - ROOM.front;
const MID_Z = (ROOM.front + ROOM.back) / 2;
const LAST = ROWS.length - 1;
const SIDES = [-1, 1] as const;
const WHITE = new THREE.Color(1, 1, 1);

/** Each tier starts 0.55 m ahead of its row line, so every seat sits fully on its own step. */
export const riserFront = (r: number) => rowZ(r) - 0.55;
const tierBack = (r: number) => (r === LAST ? ROOM.back : riserFront(r + 1));

/** Floor height at any z: stage, front aisle, or stepped tier. */
export function floorAt(z: number) {
  if (z < STAGE_EDGE) return STAGE_H;
  for (let r = LAST; r >= 0; r--) if (z >= riserFront(r)) return rowFloor(r);
  return 0;
}

/* Side walls: two fabric panels, then a sconce slot, repeating front to back. */
const PANEL_W = 1.5;
const PANEL_D = 0.07;
const PANEL_GAP = 0.08;
const SCONCE_SLOT = 0.62;
const BAYS = (() => {
  const panels: { z: number; w: number }[] = [];
  const sconces: number[] = [];
  let z = -10.7;
  while (z + PANEL_W < ROOM.back - 0.25) {
    panels.push({ z: z + PANEL_W / 2, w: PANEL_W });
    z += PANEL_W;
    if (panels.length % 2 === 0) {
      sconces.push(z + SCONCE_SLOT / 2);
      z += SCONCE_SLOT;
    } else z += PANEL_GAP;
  }
  return { panels, sconces }; // 11 panels and 5 sconces per side
})();

/* Aisle strips sit 0.43 m either side of each aisle centre line. */
const AISLE_HALF = 0.43;
const GLOW_W = AISLE_HALF * 2 + 0.6;

/* Projector: lens in the booth port on the back wall, beam ends just in front of the screen. */
const LENS = new THREE.Vector3(0, 7.6, ROOM.back - 0.04);
const LENS_HW = 0.1;
const LENS_HH = LENS_HW / 2.35;
const BEAM_Z = SCREEN.z + 0.05;
const DUST = 900;

/* ── Materials ──────────────────────────────────────────────────────── */
function makeMaterials() {
  return {
    carpet: new THREE.MeshStandardMaterial({ color: '#170b0f', roughness: 1 }),
    stage: new THREE.MeshStandardMaterial({ color: '#0c0b0e', roughness: 0.3, metalness: 0.05 }),
    wall: new THREE.MeshStandardMaterial({ color: '#0d0b0f', roughness: 0.95 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#070609', roughness: 1 }),
    panel: new THREE.MeshStandardMaterial({ color: '#1b1519', roughness: 0.92 }),
    brass: new THREE.MeshStandardMaterial({ color: '#7d5f34', roughness: 0.38, metalness: 0.7 }),
    // Linear HDR colours (> 1) so the bloom pass picks them up.
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.25, 0.5) }),
    sconce: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.0, 0.95) }),
    cove: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.38, 0.16) }),
    glass: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.024, 0.03) }),
    lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) }),
  };
}
type Mats = ReturnType<typeof makeMaterials>;

/* ── Shaders ────────────────────────────────────────────────────────── */
const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}`;

/** Light pool a sconce throws up and down the wall, with a bright core along the bar. */
const WASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float pool = exp(-(q.x * q.x * 5.0 + q.y * q.y * 2.2));
  float core = exp(-(q.x * q.x * 70.0 + q.y * q.y * 3.5)) * 0.7;
  float edge = (1.0 - smoothstep(0.75, 1.0, abs(q.x))) * (1.0 - smoothstep(0.7, 1.0, abs(q.y)));
  gl_FragColor = vec4(uColor * (pool + core) * edge * uStrength, 1.0);
}`;

/** Warm spill on the carpet either side of each aisle. */
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float x = (vUv.x - 0.5) * ${GLOW_W.toFixed(3)};        // metres from aisle centre
  float d = abs(abs(x) - ${AISLE_HALF.toFixed(3)});      // metres from the nearest strip
  float g = exp(-d * d * 90.0);
  g *= smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
  gl_FragColor = vec4(uColor * g, 1.0);
}`;

const NOISE = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

const BEAM_VERT = /* glsl */ `
attribute vec2 aUq;
attribute float aT;
varying vec2 vUq;
varying float vT;
varying vec3 vWorld;
void main() {
  vUq = aUq;
  vT = aT;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uLuma;
uniform float uTime;
uniform float uStrength;
varying vec2 vUq;
varying float vT;
varying vec3 vWorld;
${NOISE}
void main() {
  float u = clamp(vUq.x / vUq.y, 0.0, 1.0);              // projective, so it's exact across each trapezoid face
  float across = pow(sin(3.14159265 * u), 1.6);          // soft beam edges
  float along = smoothstep(0.0, 0.03, vT) * (1.0 - smoothstep(0.9, 1.0, vT)) * mix(1.5, 0.3, vT);
  float smoke = noise(vec2(vWorld.x * 0.35 + uTime * 0.05, vWorld.y * 0.6 + vWorld.z * 0.15 - uTime * 0.03));
  smoke = 0.35 + 0.65 * smoke * (0.6 + 0.4 * noise(vWorld.xz * 1.1 + uTime * 0.07));
  gl_FragColor = vec4(uColor * across * along * smoke * (0.2 + uLuma) * uStrength, 1.0);
}`;

const DUST_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uPx;
varying float vTwinkle;
void main() {
  float s = aSeed * 6.2831853;
  vec3 p = position + vec3(
    sin(uTime * 0.11 + s * 3.0),
    sin(uTime * 0.07 + s * 5.0),
    cos(uTime * 0.09 + s * 7.0)) * 0.18;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uPx / -mv.z);
  vTwinkle = 0.5 + 0.5 * sin(uTime * (0.5 + aSeed) + s * 11.0);
}`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uLuma;
varying float vTwinkle;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(uColor * (1.0 - d) * vTwinkle * (0.12 + uLuma) * 0.7, 1.0);
}`;

/* ── Geometry builders ──────────────────────────────────────────────── */
function curtainGeometry(width: number, height: number) {
  const g = new THREE.PlaneGeometry(width, height, 96, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / width + 0.5;
    pos.setZ(i, 0.07 * Math.sin(u * Math.PI * 14) + 0.025 * Math.sin(u * Math.PI * 34 + 1.3));
  }
  g.computeVertexNormals();
  return g;
}

/** Open pyramid from the lens to the screen. Each face carries (u·q, q) for distortion-free edge fades. */
function beamGeometry() {
  const hw = SCREEN.width / 2;
  const hh = SCREEN.height / 2;
  const lens = [[-LENS_HW, -LENS_HH], [LENS_HW, -LENS_HH], [LENS_HW, LENS_HH], [-LENS_HW, LENS_HH]];
  const scr = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const pos: number[] = [];
  const uq: number[] = [];
  const t: number[] = [];
  const index: number[] = [];
  for (let f = 0; f < 4; f++) {
    const a = f;
    const b = (f + 1) % 4;
    const horizontal = f % 2 === 0;
    const qL = horizontal ? LENS_HW * 2 : LENS_HH * 2;
    const qS = horizontal ? hw * 2 : hh * 2;
    const base = pos.length / 3;
    pos.push(
      LENS.x + lens[a][0], LENS.y + lens[a][1], LENS.z,
      LENS.x + lens[b][0], LENS.y + lens[b][1], LENS.z,
      scr[a][0], SCREEN.y + scr[a][1], BEAM_Z,
      scr[b][0], SCREEN.y + scr[b][1], BEAM_Z,
    );
    uq.push(0, qL, qL, qL, 0, qS, qS, qS);
    t.push(0, 0, 1, 1);
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUq', new THREE.Float32BufferAttribute(uq, 2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** Dust motes scattered through the beam volume, biased toward the wider screen end. */
function dustGeometry() {
  const hw = SCREEN.width / 2;
  const hh = SCREEN.height / 2;
  const pos = new Float32Array(DUST * 3);
  const seed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    const t = 0.12 + 0.83 * Math.sqrt(Math.random());
    const u = (Math.random() * 2 - 1) * 0.92;
    const v = (Math.random() * 2 - 1) * 0.9;
    const lx = LENS.x + u * LENS_HW;
    const ly = LENS.y + v * LENS_HH;
    pos[i * 3] = lx + (u * hw - lx) * t;
    pos[i * 3 + 1] = ly + (SCREEN.y + v * hh - ly) * t;
    pos[i * 3 + 2] = LENS.z + (BEAM_Z - LENS.z) * t;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.computeBoundingSphere();
  return g;
}

/* ── Root ───────────────────────────────────────────────────────────── */
export function Auditorium({ signal, reduced }: { signal: ScreenSignal; reduced: boolean }) {
  const m = useMemo(makeMaterials, []);
  useEffect(() => () => Object.values(m).forEach((mat) => mat.dispose()), [m]);

  return (
    <group>
      <Shell m={m} />
      <Curtains />
      <WallBays m={m} />
      <AisleLights m={m} />
      <ProjectorBeam m={m} signal={signal} reduced={reduced} />
    </group>
  );
}

/* ── Floor, tiers, stage, walls, ceiling ────────────────────────────── */
function Shell({ m }: { m: Mats }) {
  return (
    <group>
      {/* Front aisle and base floor */}
      <mesh material={m.carpet} rotation-x={-Math.PI / 2} position={[0, 0, (STAGE_EDGE + ROOM.back) / 2]}>
        <planeGeometry args={[W, ROOM.back - STAGE_EDGE]} />
      </mesh>

      {/* Stepped tiers (row A sits on the base floor) */}
      {ROWS.map((row, r) => {
        if (r === 0) return null;
        const h = rowFloor(r);
        const z0 = riserFront(r);
        const z1 = tierBack(r);
        return (
          <mesh key={row} material={m.carpet} position={[0, h / 2, (z0 + z1) / 2]}>
            <boxGeometry args={[W, h, z1 - z0]} />
          </mesh>
        );
      })}

      {/* Glossy black stage with a warm lip light */}
      <mesh material={m.stage} position={[0, STAGE_H / 2, (ROOM.front + STAGE_EDGE) / 2]}>
        <boxGeometry args={[W, STAGE_H, STAGE_EDGE - ROOM.front]} />
      </mesh>
      <mesh material={m.led} position={[0, STAGE_H - 0.03, STAGE_EDGE - 0.012]}>
        <boxGeometry args={[W - 0.4, 0.018, 0.02]} />
      </mesh>

      {/* Inward-facing walls and ceiling (single-sided, so the overview camera sees through them) */}
      <mesh material={m.wall} position={[-ROOM.halfWidth, ROOM.ceiling / 2, MID_Z]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[LEN, ROOM.ceiling]} />
      </mesh>
      <mesh material={m.wall} position={[ROOM.halfWidth, ROOM.ceiling / 2, MID_Z]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[LEN, ROOM.ceiling]} />
      </mesh>
      <mesh material={m.wall} position={[0, ROOM.ceiling / 2, ROOM.front]}>
        <planeGeometry args={[W, ROOM.ceiling]} />
      </mesh>
      <mesh material={m.wall} position={[0, ROOM.ceiling / 2, ROOM.back]} rotation-y={Math.PI}>
        <planeGeometry args={[W, ROOM.ceiling]} />
      </mesh>
      <mesh material={m.ceiling} position={[0, ROOM.ceiling, MID_Z]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[W, LEN]} />
      </mesh>

      {/* Cove line where the walls meet the ceiling */}
      {SIDES.map((s) => (
        <mesh key={s} material={m.cove} position={[s * (ROOM.halfWidth - 0.03), ROOM.ceiling - 0.1, MID_Z]}>
          <boxGeometry args={[0.03, 0.025, LEN]} />
        </mesh>
      ))}
      <mesh material={m.cove} position={[0, ROOM.ceiling - 0.1, ROOM.back - 0.03]}>
        <boxGeometry args={[W, 0.025, 0.03]} />
      </mesh>
    </group>
  );
}

/* ── Velvet curtains either side of the screen ──────────────────────── */
function Curtains() {
  const width = ROOM.halfWidth - SCREEN.width / 2 - 0.08;
  const height = ROOM.ceiling - STAGE_H;
  const geometry = useMemo(() => curtainGeometry(width, height), [width, height]);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#3a0a11',
        roughness: 0.88,
        sheen: 1,
        sheenRoughness: 0.42,
        sheenColor: new THREE.Color('#ff5f6b'),
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  const x = ROOM.halfWidth - width / 2;
  const y = (ROOM.ceiling + STAGE_H) / 2;
  const z = SCREEN.z + 0.42;
  return (
    <group>
      <mesh geometry={geometry} material={material} position={[-x, y, z]} />
      <mesh geometry={geometry} material={material} position={[x, y, z]} scale-x={-1} />
    </group>
  );
}

/* ── Acoustic panels and sconces ────────────────────────────────────── */
function WallBays({ m }: { m: Mats }) {
  const panels = useRef<THREE.InstancedMesh>(null);
  const wash = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(1.0, 0.55, 0.22) }, uStrength: { value: 0.5 } },
        vertexShader: UV_VERT,
        fragmentShader: WASH_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(() => () => wash.dispose(), [wash]);

  useLayoutEffect(() => {
    const mesh = panels.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const top = ROOM.ceiling - 0.75;
    let i = 0;
    for (const side of SIDES) {
      for (const p of BAYS.panels) {
        const bottom = Math.max(floorAt(p.z - p.w / 2), floorAt(p.z + p.w / 2)) + 0.5;
        o.position.set(side * (ROOM.halfWidth - PANEL_D / 2), (top + bottom) / 2, p.z);
        o.scale.set(PANEL_D, top - bottom, p.w);
        o.updateMatrix();
        mesh.setMatrixAt(i++, o.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);

  return (
    <group>
      <instancedMesh ref={panels} args={[undefined, undefined, BAYS.panels.length * 2]} material={m.panel}>
        <boxGeometry />
      </instancedMesh>
      {SIDES.flatMap((side) =>
        BAYS.sconces.map((z) => <Sconce key={`${side}:${z}`} side={side} z={z} m={m} wash={wash} />),
      )}
    </group>
  );
}

function Sconce({ side, z, m, wash }: { side: -1 | 1; z: number; m: Mats; wash: THREE.Material }) {
  // Rotate so local +z points into the room, whichever wall this is on.
  return (
    <group position={[side * ROOM.halfWidth, floorAt(z) + 2.5, z]} rotation-y={side < 0 ? Math.PI / 2 : -Math.PI / 2}>
      <mesh material={m.brass} position={[0, 0, 0.015]}>
        <boxGeometry args={[0.16, 1.56, 0.03]} />
      </mesh>
      <mesh material={m.sconce} position={[0, 0, 0.05]}>
        <boxGeometry args={[0.05, 1.32, 0.05]} />
      </mesh>
      <mesh material={wash} position={[0, 0, 0.09]}>
        <planeGeometry args={[1.6, 3.8]} />
      </mesh>
      <pointLight position={[0, 0, 0.45]} color="#ffb06a" intensity={3.5} distance={5} decay={2} />
    </group>
  );
}

/* ── Aisle strips, step lights and their floor glow ─────────────────── */
function AisleLights({ m }: { m: Mats }) {
  const leds = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const ledCount = AISLE_X.length * (ROWS.length * 2 + LAST);
  const poolCount = AISLE_X.length * ROWS.length;

  const glow = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0.35, 0.17, 0.06) } },
        vertexShader: UV_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [],
  );
  useEffect(() => () => glow.dispose(), [glow]);

  useLayoutEffect(() => {
    const strip = leds.current;
    const pool = pools.current;
    if (!strip || !pool) return;
    const o = new THREE.Object3D();
    let i = 0;
    let j = 0;
    for (const x of AISLE_X) {
      for (let r = 0; r < ROWS.length; r++) {
        const y = rowFloor(r);
        const z0 = riserFront(r);
        const zc = z0 + ROW.pitch / 2;

        // Two floor strips running front to back along the aisle edges.
        o.rotation.set(0, 0, 0);
        for (const s of SIDES) {
          o.position.set(x + s * AISLE_HALF, y + 0.006, zc);
          o.scale.set(0.022, 0.012, ROW.pitch - 0.1);
          o.updateMatrix();
          strip.setMatrixAt(i++, o.matrix);
        }
        // Step light on the riser face, just under the nosing.
        if (r > 0) {
          o.position.set(x, y - 0.065, z0 - 0.011);
          o.scale.set(AISLE_HALF * 1.3, 0.02, 0.02);
          o.updateMatrix();
          strip.setMatrixAt(i++, o.matrix);
        }
        // Glow decal lying on the tread.
        o.position.set(x, y + 0.004, zc);
        o.rotation.set(-Math.PI / 2, 0, 0);
        o.scale.set(1, 1, 1);
        o.updateMatrix();
        pool.setMatrixAt(j++, o.matrix);
      }
    }
    strip.instanceMatrix.needsUpdate = true;
    pool.instanceMatrix.needsUpdate = true;
    strip.computeBoundingSphere();
    pool.computeBoundingSphere();
  }, []);

  return (
    <group>
      <instancedMesh ref={leds} args={[undefined, undefined, ledCount]} material={m.led}>
        <boxGeometry />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, poolCount]} material={glow} renderOrder={1}>
        <planeGeometry args={[GLOW_W, ROW.pitch]} />
      </instancedMesh>
    </group>
  );
}

/* ── Projector beam, booth port and dust ────────────────────────────── */
function ProjectorBeam({ m, signal, reduced }: { m: Mats; signal: ScreenSignal; reduced: boolean }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const clock = useRef(0);

  const beamGeo = useMemo(beamGeometry, []);
  const dustGeo = useMemo(dustGeometry, []);
  const beamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uLuma: { value: 0 },
          uTime: { value: 0 },
          uStrength: { value: 0.07 },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const dustMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uLuma: { value: 0 },
          uTime: { value: 0 },
          uPx: { value: 9 },
        },
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(
    () => () => { beamGeo.dispose(); dustGeo.dispose(); beamMat.dispose(); dustMat.dispose(); },
    [beamGeo, dustGeo, beamMat, dustMat],
  );

  useFrame((_, delta) => {
    if (!reduced) clock.current += Math.min(delta, 0.1); // reduced motion freezes smoke and dust
    const b = beamMat.uniforms;
    const d = dustMat.uniforms;
    (b.uColor.value as THREE.Color).copy(signal.tint).lerp(WHITE, 0.5);
    b.uLuma.value = signal.luma;
    b.uTime.value = clock.current;
    (d.uColor.value as THREE.Color).copy(signal.tint).lerp(WHITE, 0.6);
    d.uLuma.value = signal.luma;
    d.uTime.value = clock.current;
    d.uPx.value = 9 * dpr;
    m.lens.color.copy(signal.tint).lerp(WHITE, 0.6).multiplyScalar(1.5 + 5 * signal.luma);
  });

  return (
    <group>
      <mesh material={m.glass} position={[0, LENS.y, ROOM.back - 0.01]} rotation-y={Math.PI}>
        <planeGeometry args={[1.0, 0.56]} />
      </mesh>
      <mesh material={m.lens} position={[0, LENS.y, ROOM.back - 0.02]} rotation-y={Math.PI}>
        <circleGeometry args={[0.075, 32]} />
      </mesh>
      <mesh geometry={beamGeo} material={beamMat} renderOrder={2} />
      <points geometry={dustGeo} material={dustMat} renderOrder={3} />
    </group>
  );
}
