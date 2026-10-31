/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', '"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Inter Variable"', '"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        canvas: '#0a0a0a',
        surface: '#111111',
        hover: '#171717',
        active: '#1f1f1f',
        border: '#262626',
        muted: '#a1a1aa',
        foreground: '#fafafa',
      },
      spacing: {
        13: '3.25rem',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'modal-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.2s ease both',
        'fade-in': 'fade-in 0.15s ease both',
        'modal-in': 'modal-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
