import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PRICES, SEATS, SEAT_BY_ID, TIER_LABEL, seatLabel, usd, type Seat } from '../lib/data';
import { useBooking } from '../lib/store';
import { useCoarsePointer } from '../lib/useMedia';

/* Each tier gets its own instanced meshes; SLOT maps seat.index to its instance within them. */
const STD = SEATS.filter((s) => s.tier === 'standard');
const VIP = SEATS.filter((s) => s.tier === 'vip');
const SLOT = new Int32Array(SEATS.length);
STD.forEach((s, i) => { SLOT[s.index] = i; });
VIP.forEach((s, i) => { SLOT[s.index] = i; });

/* Seat state colours. One colour, one meaning: red = free, grey = taken, crimson = yours. */
const C_AVAIL = new THREE.Color('#9E1B24');
const C_HOVER = new THREE.Color('#C8323E');
const C_TAKEN = new THREE.Color('#2A2628');
const C_SELECT = new THREE.Color('#E0283A');

/* ── Geometry ───────────────────────────────────────────────────────── */
type Part = [geometry: THREE.BufferGeometry, x: number, y: number, z: number, tiltX?: number];
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, r);
const sbox = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const pair = (make: () => THREE.BufferGeometry, x: number, y: number, z: number): Part[] => [
  [make(), -x, y, z],
  [make(), x, y, z],
];

function merge(parts: Part[]) {
  const list = parts.map(([g, x, y, z, tilt = 0]) => g.rotateX(tilt).translate(x, y, z));
  const merged = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  if (!merged) throw new Error('Seat geometry merge failed');
  return merged;
}

// Footprint stays within 0.53 m forward and 0.45 m back of the seat origin, so it fits its step.
// Armrests are 6 cm wide at ±0.31 m, so neighbours touch without overlapping.
const stdVelvet = () => merge([
  [rbox(0.54, 0.14, 0.52, 0.05), 0, 0.45, -0.03],          // cushion
  [rbox(0.56, 0.66, 0.13, 0.05), 0, 0.86, 0.27, 0.16],     // backrest
]);
const stdFrame = () => merge([
  ...pair(() => rbox(0.06, 0.07, 0.5, 0.025), 0.31, 0.66, 0),
  ...pair(() => sbox(0.05, 0.62, 0.4), 0.31, 0.31, 0.05),
  [sbox(0.36, 0.38, 0.28), 0, 0.19, 0.06],                 // pedestal
  [rbox(0.56, 0.6, 0.04, 0.015), 0, 0.84, 0.355, 0.16],    // hard back shell
]);
const vipVelvet = () => merge([
  [rbox(0.54, 0.18, 0.6, 0.06), 0, 0.42, -0.05],           // deep cushion
  [rbox(0.56, 0.74, 0.18, 0.07), 0, 0.84, 0.22, 0.3],      // reclined back
  [rbox(0.42, 0.17, 0.12, 0.05), 0, 1.14, 0.17, 0.3],      // headrest pillow
  [rbox(0.5, 0.08, 0.32, 0.03), 0, 0.3, -0.38, -0.35],     // raised leg rest
]);
const vipFrame = () => merge([
  ...pair(() => rbox(0.06, 0.09, 0.62, 0.025), 0.31, 0.62, -0.02),
  ...pair(() => sbox(0.05, 0.58, 0.56), 0.31, 0.29, -0.02),
  [sbox(0.42, 0.34, 0.5), 0, 0.17, 0],
  [rbox(0.56, 0.7, 0.04, 0.015), 0, 0.81, 0.325, 0.3],
]);
const vipBrass = () => merge([
  ...pair(() => sbox(0.062, 0.095, 0.02), 0.31, 0.62, -0.335), // armrest caps
  [sbox(0.3, 0.018, 0.01), 0, 1.04, 0.423, 0.3],                // trim on the back shell
]);

/* ── Materials ──────────────────────────────────────────────────────── */
/** Velvet: per-instance colour drives diffuse, sheen tint and an emissive glow (aGlow). */
function velvetMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.8,
    sheen: 1,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color('#ffffff'),
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\n  material.sheenColor *= clamp(vColor * 2.2, 0.0, 1.0);\n#endif',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor * vGlow;',
      );
  };
  return mat;
}

function haloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/* ── Component ──────────────────────────────────────────────────────── */
export function Seats({ reduced }: { reduced: boolean }) {
  const gl = useThree((s) => s.gl);
  const toggleSeat = useBooking((s) => s.toggleSeat);
  const setHovered = useBooking((s) => s.setHovered);

  const res = useMemo(() => {
    const stdV = stdVelvet();
    const vipV = vipVelvet();
    stdV.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(STD.length), 1));
    vipV.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(VIP.length), 1));
    const haloMap = haloTexture();
    return {
      haloMap,
      geo: {
        stdV, vipV,
        stdF: stdFrame(), vipF: vipFrame(), vipB: vipBrass(),
        hit: new THREE.BoxGeometry(0.64, 1.25, 0.9).translate(0, 0.625, 0),
        halo: new THREE.PlaneGeometry(1, 0.9).rotateX(-Math.PI / 2),
      },
      mat: {
        velvet: velvetMaterial(),
        frame: new THREE.MeshStandardMaterial({ color: '#1a1719', roughness: 0.55, metalness: 0.25 }),
        brass: new THREE.MeshStandardMaterial({ color: '#b08a4e', roughness: 0.32, metalness: 0.85 }),
        halo: new THREE.MeshBasicMaterial({
          map: haloMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }),
        // Invisible picking volume: draws nothing, but still raycasts.
        hit: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
      },
    };
  }, []);
  useEffect(
    () => () => {
      Object.values(res.geo).forEach((g) => g.dispose());
      Object.values(res.mat).forEach((m) => m.dispose());
      res.haloMap.dispose();
    },
    [res],
  );

  const stdV = useRef<THREE.InstancedMesh>(null);
  const stdF = useRef<THREE.InstancedMesh>(null);
  const vipV = useRef<THREE.InstancedMesh>(null);
  const vipF = useRef<THREE.InstancedMesh>(null);
  const vipB = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.InstancedMesh>(null);
  const hit = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const meshes = [stdV, stdF, vipV, vipF, vipB, halo, hit].map((r) => r.current);
    if (meshes.some((m) => !m)) return;
    const [sv, sf, vv, vf, vb, hl, ht] = meshes as THREE.InstancedMesh[];
    const o = new THREE.Object3D();
    const place = (s: Seat, lift = 0) => {
      o.position.set(s.position[0], s.position[1] + lift, s.position[2]);
      o.rotation.set(0, s.yaw, 0);
      o.updateMatrix();
      return o.matrix;
    };
    STD.forEach((s, i) => {
      const m = place(s);
      sv.setMatrixAt(i, m);
      sf.setMatrixAt(i, m);
      sv.setColorAt(i, C_AVAIL);
    });
    VIP.forEach((s, i) => {
      const m = place(s);
      vv.setMatrixAt(i, m);
      vf.setMatrixAt(i, m);
      vb.setMatrixAt(i, m);
      vv.setColorAt(i, C_AVAIL);
    });
    const black = new THREE.Color(0, 0, 0);
    SEATS.forEach((s) => {
      ht.setMatrixAt(s.index, place(s));
      hl.setMatrixAt(s.index, place(s, 0.012));
      hl.setColorAt(s.index, black);
    });
    for (const m of meshes as THREE.InstancedMesh[]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, []);

  /* Eased per-seat state: r, g, b, glow, halo. */
  const cur = useMemo(() => new Float32Array(SEATS.length * 5), []);
  const primed = useRef(false);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const sv = stdV.current;
    const vv = vipV.current;
    const hl = halo.current;
    if (!sv || !vv || !hl) return;

    const s = useBooking.getState();
    const k = reduced || !primed.current ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 12);
    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 3);
    let dirty = !primed.current;
    primed.current = true;

    const ease = (i: number, goal: number) => {
      const d = goal - cur[i];
      if (Math.abs(d) > 1e-4) { cur[i] += d * k; dirty = true; } else cur[i] = goal;
    };

    for (const seat of SEATS) {
      const sel = s.selected.includes(seat.id);
      const taken = !sel && s.occupied.has(seat.id);
      const hov = s.hovered === seat.id && !taken;
      const col = sel ? C_SELECT : taken ? C_TAKEN : hov ? C_HOVER : C_AVAIL;
      const glow = sel ? 2.2 + (s.activeSeat === seat.id ? 0.8 * pulse : 0) + (hov ? 0.3 : 0) : hov ? 0.35 : 0;
      const ring = sel ? 4.5 : hov ? 1 : 0;
      const o = seat.index * 5;
      ease(o, col.r);
      ease(o + 1, col.g);
      ease(o + 2, col.b);
      ease(o + 3, glow);
      ease(o + 4, ring);
    }
    if (!dirty) return;

    const sGlow = sv.geometry.getAttribute('aGlow') as THREE.InstancedBufferAttribute;
    const vGlow = vv.geometry.getAttribute('aGlow') as THREE.InstancedBufferAttribute;
    for (const seat of SEATS) {
      const o = seat.index * 5;
      const slot = SLOT[seat.index];
      const vip = seat.tier === 'vip';
      tmp.setRGB(cur[o], cur[o + 1], cur[o + 2]);
      (vip ? vv : sv).setColorAt(slot, tmp);
      (vip ? vGlow : sGlow).setX(slot, cur[o + 3]);
      hl.setColorAt(seat.index, tmp.multiplyScalar(cur[o + 4]));
    }
    sv.instanceColor!.needsUpdate = true;
    vv.instanceColor!.needsUpdate = true;
    hl.instanceColor!.needsUpdate = true;
    sGlow.needsUpdate = true;
    vGlow.needsUpdate = true;
  });

  /* Picking: instanceId on the hit mesh === seat.index. */
  const idOf = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.instanceId === undefined ? null : SEATS[e.instanceId]?.id ?? null;

  const onHover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = idOf(e);
    if (!id) return;
    setHovered(id);
    gl.domElement.style.cursor = useBooking.getState().occupied.has(id) ? 'not-allowed' : 'pointer';
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    const id = idOf(e);
    if (id && useBooking.getState().hovered === id) setHovered(null);
    gl.domElement.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 6) return; // a drag to look around, not a click
    const id = idOf(e);
    if (id) toggleSeat(id);
  };
  useEffect(() => () => { gl.domElement.style.cursor = ''; }, [gl]);

  return (
    <group>
      <instancedMesh ref={stdV} args={[res.geo.stdV, res.mat.velvet, STD.length]} />
      <instancedMesh ref={stdF} args={[res.geo.stdF, res.mat.frame, STD.length]} />
      <instancedMesh ref={vipV} args={[res.geo.vipV, res.mat.velvet, VIP.length]} />
      <instancedMesh ref={vipF} args={[res.geo.vipF, res.mat.frame, VIP.length]} />
      <instancedMesh ref={vipB} args={[res.geo.vipB, res.mat.brass, VIP.length]} />
      <instancedMesh ref={halo} args={[res.geo.halo, res.mat.halo, SEATS.length]} renderOrder={1} />
      <instancedMesh
        ref={hit}
        args={[res.geo.hit, res.mat.hit, SEATS.length]}
        onPointerOver={onHover}
        onPointerMove={onHover}
        onPointerOut={onOut}
        onClick={onClick}
      />
      <SeatTooltip />
    </group>
  );
}

/* ── Floating tooltip: hovered seat first, otherwise the pinned one ─── */
function SeatTooltip() {
  const coarse = useCoarsePointer();
  const id = useBooking((s) => s.hovered ?? s.activeSeat);
  const occupied = useBooking((s) => s.occupied);
  const selected = useBooking((s) => s.selected);
  // No tooltip for the seat the camera is sitting in.
  const seated = useBooking((s) => (s.view === 'overview' || s.view === 'stage' ? null : s.povSeat));

  const seat = id ? SEAT_BY_ID.get(id) : undefined;
  if (!seat || seat.id === seated) return null;

  const isSel = selected.includes(seat.id);
  const taken = !isSel && occupied.has(seat.id);
  const price = `${TIER_LABEL[seat.tier]} · ${usd(PRICES[seat.tier])}`;
  const detail = isSel ? `Selected · ${price}` : taken ? 'Taken' : `${price} · ${coarse ? 'Tap' : 'Click'} to select`;
  const dot = isSel
    ? 'bg-crimson shadow-[0_0_10px_#E0283A]'
    : taken
      ? 'seat-taken bg-[#2A2628] ring-1 ring-white/25'
      : 'border border-seat bg-velvet';

  return (
    <Html
      position={[seat.position[0], seat.position[1] + (seat.tier === 'vip' ? 1.62 : 1.5), seat.position[2]]}
      center
      zIndexRange={[30, 10]}
      pointerEvents="none"
    >
      <div
        aria-hidden="true"
        className="glass pointer-events-none flex select-none items-center gap-2.5 whitespace-nowrap rounded-xl py-2 pl-2.5 pr-3.5"
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
        <div className="leading-tight">
          <div className="font-mono text-[13px] font-medium text-paper">{seatLabel(seat)}</div>
          <div className="mt-0.5 text-[11px] text-fog">{detail}</div>
        </div>
      </div>
    </Html>
  );
}
