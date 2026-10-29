import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { MOVIES, SCREEN } from '../lib/data';
import { useBooking } from '../lib/store';
import { useReducedMotion } from '../lib/useMedia';
import { Auditorium } from './Auditorium';
import { CameraRig } from './CameraRig';
import { CinemaScreen, screenLuma, type ScreenSignal } from './CinemaScreen';
import { Seats } from './Seats';

RectAreaLightUniformsLib.init();

const BG = '#060508';
const WHITE = new THREE.Color(1, 1, 1);

export function Experience() {
  const movieId = useBooking((s) => s.movieId);
  const reduced = useReducedMotion();
  const setDpr = useThree((s) => s.setDpr);
  const [ao, setAo] = useState(true);
  const rect = useRef<THREE.RectAreaLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);

  const signal = useMemo<ScreenSignal>(() => {
    const m = MOVIES[useBooking.getState().movieId];
    return { time: 0, prev: m.scene, next: m.scene, mix: 1, luma: 0, tint: new THREE.Color(m.ambient) };
  }, []);
  const tintGoal = useMemo(() => new THREE.Color(), []);

  // Film change → cross-fade the trailer; the tint eases in the frame loop below.
  useEffect(() => {
    const scene = MOVIES[movieId].scene;
    if (scene === signal.next) return;
    signal.prev = signal.mix >= 0.5 ? signal.next : signal.prev;
    signal.next = scene;
    signal.mix = 0;
  }, [movieId, signal]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    signal.time += dt;
    signal.mix = Math.min(1, signal.mix + dt / 0.9);
    tintGoal.set(MOVIES[movieId].ambient);
    signal.tint.lerp(tintGoal, 1 - Math.exp(-dt * 2.2));
    signal.luma = THREE.MathUtils.lerp(
      screenLuma(signal.prev, signal.time),
      screenLuma(signal.next, signal.time),
      signal.mix,
    );
    if (rect.current) {
      rect.current.color.copy(signal.tint).lerp(WHITE, 0.35);
      rect.current.intensity = 1.2 + 6 * signal.luma;
    }
    if (hemi.current) {
      hemi.current.color.copy(signal.tint);
      hemi.current.intensity = 0.06 + 0.14 * signal.luma;
    }
  }, -1); // run before consumers read the signal

  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 24, 62]} />
      <PerformanceMonitor
        onDecline={() => { setDpr(1); setAo(false); }}
        onIncline={() => setDpr(Math.min(2, window.devicePixelRatio))}
      />

      <ambientLight intensity={0.35} color="#3b2d3a" />
      <hemisphereLight ref={hemi} args={['#ffffff', '#0a0608', 0.1]} />
      {/* The screen itself is the key light. RectAreaLight emits along local −Z, so flip it to face the seats. */}
      <rectAreaLight
        ref={rect}
        width={SCREEN.width}
        height={SCREEN.height}
        position={[0, SCREEN.y, SCREEN.z + 0.06]}
        rotation={[0, Math.PI, 0]}
        intensity={4}
      />

      <CinemaScreen signal={signal} />
      <Auditorium signal={signal} reduced={reduced} />
      <Seats reduced={reduced} />
      <CameraRig reduced={reduced} />
      <PostFX ao={ao} />
    </>
  );
}

/** Ambient occlusion is the first thing dropped if the frame rate struggles. */
function PostFX({ ao }: { ao: boolean }) {
  return ao ? (
    <EffectComposer multisampling={4}>
      <N8AO halfRes screenSpaceRadius aoRadius={26} distanceFalloff={0.5} intensity={2.2} />
      <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.25} />
      <Vignette offset={0.24} darkness={0.72} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  ) : (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.25} />
      <Vignette offset={0.24} darkness={0.72} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
