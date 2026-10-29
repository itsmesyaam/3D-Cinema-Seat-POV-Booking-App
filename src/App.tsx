import { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Experience } from './scene/Experience';
import { Overlay } from './ui/Overlay';
import { Sidebar } from './ui/Sidebar';
import { useBooking } from './lib/store';

export default function App() {
  const setHovered = useBooking((s) => s.setHovered);

  // Esc returns to the overview from any camera, unless the checkout dialog owns Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const s = useBooking.getState();
      if (s.checkoutOpen || s.view === 'overview') return;
      s.goTo('overview');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-dvh w-full flex-col bg-ink text-paper lg:h-dvh lg:flex-row lg:overflow-hidden">
      <main className="relative h-[62vh] min-h-[460px] w-full lg:h-full lg:min-h-0 lg:flex-1">
        <div
          className="absolute inset-0"
          role="img"
          aria-label="Interactive 3D auditorium. Keyboard users can choose seats from the seat map in the booking panel."
        >
          <Canvas
            dpr={[1, 2]}
            camera={{ fov: 45, near: 0.05, far: 120, position: [0, 15, 25] }}
            gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
            onPointerMissed={() => setHovered(null)}
          >
            <Suspense fallback={null}>
              <Experience />
            </Suspense>
          </Canvas>
        </div>
        <Overlay />
      </main>
      <Sidebar />
    </div>
  );
}
