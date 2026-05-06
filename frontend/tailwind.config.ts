import type { Config } from "tailwindcss";

const config: Config = {
  // Class-based dark mode lets us toggle the `.dark` class on <html> from JS.
  // The pre-paint script in app/layout.tsx applies the correct class before
  // first render based on localStorage / system preference.
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
export default config;
