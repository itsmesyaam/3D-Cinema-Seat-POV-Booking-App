import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import gsap from 'gsap';
import * as THREE from 'three';
import { CAMERA_PRESETS, SCREEN_CENTER, SEAT_BY_ID, seatEye, type Vec3, type ViewKey } from '../lib/data';
import { useBooking } from '../lib/store';

/** 'orbit' circles the room from above; 'look' turns your head in place from a fixed eye point. */
type Mode = 'orbit' | 'look';
interface Pose { eye: THREE.Vector3; look: THREE.Vector3; mode: Mode }
interface Flight {
  t: number;
  p0: THREE.Vector3; mid: THREE.Vector3; p1: THREE.Vector3;
  yaw0: number; turn: number; pitch0: number; pitch1: number;
}

const LOOK_EPS = 0.01; // camera sits 1 cm behind its pivot, so rotating feels like turning your head
const TAU = Math.PI * 2;
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);

export function poseFor(view: ViewKey, povSeat: string | null): Pose {
  if (view === 'overview') {
    const p = CAMERA_PRESETS.overview;
    return { eye: v3(p.position), look: v3(p.target), mode: 'orbit' };
  }
  if (view === 'stage') {
    const p = CAMERA_PRESETS.stage;
    return { eye: v3(p.position), look: v3(p.target), mode: 'look' };
  }
  const seat = povSeat ? SEAT_BY_ID.get(povSeat) : undefined;
  if (!seat) return poseFor('overview', null);
  return { eye: v3(seatEye(seat)), look: v3(SCREEN_CENTER), mode: 'look' };
}

/** Clear limits so a programmatic move is never clamped by the previous mode. */
function unlock(c: CameraControlsImpl) {
  c.minDistance = Number.EPSILON;
  c.maxDistance = Infinity;
  c.minAzimuthAngle = -Infinity;
  c.maxAzimuthAngle = Infinity;
  c.minPolarAngle = 0;
  c.maxPolarAngle = Math.PI;
}

/** Limits are set around the angles the camera actually landed on, which avoids ±π wrap surprises. */
function applyMode(c: CameraControlsImpl, mode: Mode) {
  const { ACTION } = CameraControlsImpl;
  const az = c.azimuthAngle;
  const po = c.polarAngle;
  if (mode === 'look') {
    c.minDistance = c.maxDistance = c.distance;
    c.minAzimuthAngle = az - 1.05; // about ±60° left and right
    c.maxAzimuthAngle = az + 1.05;
    c.minPolarAngle = Math.max(0.1, po - 0.5);
    c.maxPolarAngle = Math.min(Math.PI - 0.1, po + 0.45);
    c.azimuthRotateSpeed = -0.3; // negative = grab-the-world, like Street View
    c.polarRotateSpeed = -0.3;
    c.mouseButtons.left = ACTION.ROTATE;
    c.mouseButtons.middle = ACTION.NONE;
    c.mouseButtons.right = ACTION.NONE;
    c.mouseButtons.wheel = ACTION.NONE;
    c.touches.one = ACTION.TOUCH_ROTATE;
    c.touches.two = ACTION.NONE;
    c.touches.three = ACTION.NONE;
  } else {
    c.minDistance = 9;
    c.maxDistance = 28;
    c.minAzimuthAngle = az - 0.6;
    c.maxAzimuthAngle = az + 0.6;
    c.minPolarAngle = 0.4;
    c.maxPolarAngle = 1.3;
    c.azimuthRotateSpeed = 0.5;
    c.polarRotateSpeed = 0.5;
    c.mouseButtons.left = ACTION.ROTATE;
    c.mouseButtons.middle = ACTION.DOLLY;
    c.mouseButtons.right = ACTION.NONE;
    c.mouseButtons.wheel = ACTION.DOLLY;
    c.touches.one = ACTION.TOUCH_ROTATE;
    c.touches.two = ACTION.TOUCH_DOLLY;
    c.touches.three = ACTION.NONE;
  }
  c.enabled = true;
}

/** Snap to a pose and hand control back to the person. */
function settle(c: CameraControlsImpl, pose: Pose) {
  unlock(c);
  if (pose.mode === 'look') {
    const dir = pose.look.clone().sub(pose.eye).normalize();
    const from = pose.eye.clone().addScaledVector(dir, -LOOK_EPS);
    c.setLookAt(from.x, from.y, from.z, pose.eye.x, pose.eye.y, pose.eye.z, false);
  } else {
    c.setLookAt(pose.eye.x, pose.eye.y, pose.eye.z, pose.look.x, pose.look.y, pose.look.z, false);
  }
  c.update(0);
  applyMode(c, pose.mode);
}

const yawOf = (f: THREE.Vector3) => Math.atan2(f.x, f.z);
const pitchOf = (f: THREE.Vector3) => Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
function shortestTurn(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

export function CameraRig({ reduced }: { reduced: boolean }) {
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const flight = useRef<Flight | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const scratch = useMemo(() => ({ p: new THREE.Vector3(), f: new THREE.Vector3() }), []);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.dollyToCursor = false;
    c.smoothTime = 0.22;
    c.draggingSmoothTime = 0.1;
    const { setFlying } = useBooking.getState();
    let tween: gsap.core.Tween | null = null;

    const fly = (pose: Pose, opts: { delay?: number; duration?: number } = {}) => {
      tween?.kill();
      flight.current = null;
      // Reduced motion: cut straight to the destination.
      if (reducedRef.current) { settle(c, pose); setFlying(false); return; }

      const p0 = camera.position.clone();
      const f0 = camera.getWorldDirection(new THREE.Vector3());
      const f1 = pose.look.clone().sub(pose.eye).normalize();
      const dist = p0.distanceTo(pose.eye);
      const angle = f0.angleTo(f1);
      if (dist < 0.02 && angle < 0.01) { settle(c, pose); setFlying(false); return; }

      // Quadratic arc lifted above both ends, so flights clear the seat backs.
      const mid = p0.clone().lerp(pose.eye, 0.5);
      mid.y = Math.max(p0.y, pose.eye.y) + THREE.MathUtils.clamp(dist * 0.18, 0.4, 3.5);

      const f: Flight = {
        t: 0, p0, mid, p1: pose.eye.clone(),
        yaw0: yawOf(f0), turn: shortestTurn(yawOf(f0), yawOf(f1)),
        pitch0: pitchOf(f0), pitch1: pitchOf(f1),
      };
      unlock(c);
      c.enabled = false;
      flight.current = f;
      setFlying(true);
      tween = gsap.to(f, {
        t: 1,
        ease: 'power2.inOut',
        delay: opts.delay ?? 0,
        duration: opts.duration ?? THREE.MathUtils.clamp(0.9 + dist * 0.06 + angle * 0.3, 1.0, 2.4),
        onComplete: () => {
          flight.current = null;
          settle(c, pose);
          setFlying(false);
        },
      });
    };

    // Opening shot: on the stage looking back at the rows, then rise to the overview.
    const { view, povSeat } = useBooking.getState();
    const start = poseFor(view, povSeat);
    if (reducedRef.current) settle(c, start);
    else {
      settle(c, poseFor('stage', null));
      fly(start, { delay: 0.6, duration: 2.8 });
    }

    const unsub = useBooking.subscribe((s, prev) => {
      if (s.flightId !== prev.flightId) fly(poseFor(s.view, s.povSeat));
    });
    return () => {
      unsub();
      tween?.kill();
      flight.current = null;
    };
  }, [camera]);

  // Position follows the arc; heading interpolates yaw and pitch separately (no roll, no flips).
  useFrame(() => {
    const f = flight.current;
    const c = controls.current;
    if (!f || !c) return;
    const t = f.t;
    const u = 1 - t;
    const p = scratch.p.set(0, 0, 0)
      .addScaledVector(f.p0, u * u)
      .addScaledVector(f.mid, 2 * u * t)
      .addScaledVector(f.p1, t * t);
    const yaw = f.yaw0 + f.turn * t;
    const pitch = f.pitch0 + (f.pitch1 - f.pitch0) * t;
    const cp = Math.cos(pitch);
    const d = scratch.f.set(cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw));
    c.setLookAt(p.x, p.y, p.z, p.x + d.x, p.y + d.y, p.z + d.z, false);
    c.update(0);
  });

  return <CameraControls ref={controls} makeDefault />;
}
