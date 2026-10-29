# LUMIERE - 3D Cinema Seat POV Booking Application

LUMIERE is an interactive 3D cinema booking application built with React, Three.js, React Three Fiber, Tailwind CSS, and Zustand. It allows moviegoers to inspect the auditorium and sit in any seat before purchasing, experiencing the exact perspective, sightline score, and screen coverage in real time.

---

## Overview

Traditional cinema booking platforms rely on static 2D seat grids that fail to convey actual viewing angles, screen elevation, or obstruction. LUMIERE solves this by providing a digital twin of an auditorium with full 3D seat exploration. Every seat in the hall can be selected to trigger a smooth camera flight to that exact seated eye position, allowing users to look around and verify the experience before completing their reservation.

---

## Key Features

- **Interactive 3D Auditorium:** Fully modeled room featuring tiered seating risers, standard velvet seats, VIP loungers with brass accents, side acoustic panels with wall sconces, carpeted aisle step lights, and a realistic projector beam with drifting dust motes.
- **Seat Point-of-View (POV) Flights:** Quadratic Bezier camera flight paths that lift up over seatbacks to land smoothly in any chosen seat. Once seated, users can pan and look around within natural head-rotation constraints.
- **Procedural Screen Shader Trailers:** Real-time procedural GLSL shaders simulating full cinematic trailers for multiple titles (Dune: Part Two, The Last Light, and A Quiet Place) mapped to curved screen geometry.
- **Synchronized Environmental Lighting:** The auditorium key lighting, projector beam color, wall wash intensity, and dust particles continuously sample screen luminance and film palette in real time.
- **Sightline Quality Gauge:** Live mathematical evaluation calculating viewing distance, horizontal field of view (FOV), off-axis angle, and vertical elevation angle with classification scores (Reference, Excellent, Great, Good, Limited).
- **Accessible Dual-Path Booking:** A synchronized 2D seat map grid alongside the 3D viewport, featuring full roving-focus keyboard navigation (arrow keys, Enter, Space), screen-reader live announcements, and high-contrast indicators.
- **Responsive HUD and Film Carousel:** Floating glass controls for film selection, session dates, formats (IMAX, Dolby Atmos, VIP, Standard), camera angle presets, and checkout workflows.
- **Performance and Accessibility Adaptations:** Automatic performance degradation (disabling ambient occlusion and scaling DPR during frame drops), support for prefers-reduced-motion (instant cuts rather than camera flights), and prefers-reduced-transparency.

---

## Tech Stack

- **Core:** React 18, TypeScript, Vite
- **3D Graphics & Shaders:** Three.js, @react-three/fiber, @react-three/drei, GLSL
- **Post-Processing:** @react-three/postprocessing, postprocessing (Bloom, N8AO, ToneMapping, Vignette)
- **Camera & Animation:** camera-controls, GSAP
- **State Management:** Zustand
- **Styling:** Tailwind CSS, PostCSS, Autoprefixer

---

## Project Structure

```text
lumiere/
├── index.html              # HTML entry point and web font links
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite build configuration
├── tailwind.config.js      # Color tokens, typography, and theme setup
├── postcss.config.js       # PostCSS plugins
├── src/
│   ├── main.tsx            # React application mount
│   ├── App.tsx             # Root layout with 3D canvas and booking sidebar
│   ├── index.css           # Tailwind base layers, glassmorphism, focus styles
│   ├── lib/
│   │   ├── data.ts         # Cinema geometry, films, seat coordinates, sightlines
│   │   ├── store.ts        # Zustand booking state and pricing calculations
│   │   └── useMedia.ts     # Media query and accessibility hooks
│   ├── scene/
│   │   ├── Experience.tsx   # Scene root, lighting, post-processing stack
│   │   ├── Auditorium.tsx   # Architectural shell, tiers, sconces, projector
│   │   ├── CinemaScreen.tsx # Curved screen, GLSL shader trailers, title cards
│   │   ├── Seats.tsx        # Instanced standard and VIP seating, hitboxes
│   │   └── CameraRig.tsx    # Camera flights, look-around controls, view presets
│   └── ui/
│       ├── Overlay.tsx      # Masthead, sightline gauge, film carousel, camera bar
│       └── Sidebar.tsx      # Date picker, showtimes, 2D seat map, checkout dialog
```

---

## Getting Started

### Prerequisites

- Node.js (v18.0.0 or higher recommended)
- npm, pnpm, or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/itsmesyaam/3D-Cinema-Seat-POV-Booking-App.git
   cd 3D-Cinema-Seat-POV-Booking-App
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to the printed local address (default: `http://localhost:5173`).

---

## Building for Production

To produce an optimized production bundle:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

---

## Navigation and Controls

- **Overview Mode:**
  - Left click + drag: Orbit around the auditorium.
  - Mouse wheel / pinch: Zoom in and out.
  - Left click on any seat: Select seat and fly to its point of view.
- **Seat POV Mode:**
  - Left click + drag: Look around the cinema from the seated eye line.
  - Escape key or "Reset View" button: Return to the high overview.
- **Keyboard Navigation:**
  - Arrow keys: Navigate through the 2D seat map, camera views, and film carousel.
  - Enter / Space: Select or toggle a seat.
  - Escape: Close dialogs or return to overview.

---

## License

This project is licensed under the MIT License.
