import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f2f6fc',
          100: '#e2ebf7',
          200: '#c3d5ee',
          300: '#93b4df',
          400: '#5b8bca',
          500: '#356bb0',
          600: '#245393',
          700: '#1d4277',
          800: '#16325a',
          900: '#0e2340',
          950: '#081527',
        },
        gold: {
          50: '#fdf9ec',
          100: '#faf0cd',
          200: '#f4df9d',
          300: '#edc862',
          400: '#e7b53c',
          500: '#d4af37',
          600: '#b8860b',
          700: '#93660d',
          800: '#7a5212',
          900: '#684414',
        },
        brand: {
          navy: '#0e2340',
          navyDark: '#081527',
          gold: '#d4af37',
          grey: '#f4f6f9',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(14 35 64 / 0.04), 0 4px 16px -4px rgb(14 35 64 / 0.08)',
        pop: '0 12px 40px -8px rgb(8 21 39 / 0.25)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out',
        'slide-up': 'slide-up .25s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
