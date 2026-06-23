import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#8b5cf6',
          violet: '#8b5cf6',
          fuchsia: '#d946ef',
          cyan: '#22d3ee',
          green: '#14f195',
        },
      },
    },
  },
  plugins: [],
};

export default config;
