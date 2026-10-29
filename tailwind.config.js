/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0B0E',     // panel surface
        paper: '#F2F0EC',   // primary text      ~17:1 on ink
        fog: '#A19D97',     // secondary text    7.3:1 on ink
        mute: '#8A857F',    // tertiary text     5.4:1 on ink
        velvet: '#9E1B24',  // seat fabric (fills only, 2.5:1, never text)
        seat: '#C8323E',    // seat outline      3.7:1 on ink (UI component ≥ 3:1)
        crimson: '#E0283A', // selection         4.2:1 on ink; white on it 4.6:1
        brass: '#C8A165',   // VIP lounger       8.2:1 on ink
      },
      fontFamily: {
        display: ['"Bodoni Moda"', 'Didot', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
