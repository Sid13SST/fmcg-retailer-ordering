import type { Config } from "tailwindcss";

/**
 * Design tokens. One primary colour (brand, a warm orange) for primary actions and the
 * active tab; everything else is slate. Semantic colours are used only for meaning:
 * emerald = success/saving, amber = needs attention, red = error/destructive,
 * sky = informational (pending, AI-read). Component classes live in app/globals.css.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c",
          800: "#9a3412",
        },
      },
      fontFamily: {
        // System UI stack: no web-font download on slow networks; Devanagari falls back to the OS font.
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Noto Sans", "Noto Sans Devanagari", "sans-serif"],
      },
      minHeight: { tap: "2.75rem" },
    },
  },
  plugins: [],
};

export default config;
