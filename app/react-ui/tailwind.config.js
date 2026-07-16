/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--font-mono)'],
        sans: ['var(--font-sans)'],
      },
      fontSize: {
        'xxs': '9px',
        'xs2': '10px',
        'xs':  '11px',
        'sm':  '12px',
        'base': '13px',
        'md':  '14px',
        'lg':  '16px',
        'xl':  '18px',
        '2xl': '20px',
        '3xl': '28px',
      },
      borderRadius: {
        DEFAULT: '2px',
        'sm': '2px',
        'md': '2px',
        'lg': '2px',
        'xl': '2px',
      },
      spacing: {
        'sidebar': '240px',
        'sidebar-collapsed': '60px',
      },
    },
  },
  plugins: [],
}
