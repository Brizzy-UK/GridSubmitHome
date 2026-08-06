/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './*.html',
    './**/*.html',
    './api/**/*.js',
    '!./node_modules/**',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
