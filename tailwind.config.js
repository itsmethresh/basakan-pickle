/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { forest: '#0f3d2e', lime: '#c9f25b', ink: '#17302a' },
      boxShadow: { soft: '0 12px 35px rgba(15, 61, 46, 0.10)' }
    }
  },
  plugins: []
}
