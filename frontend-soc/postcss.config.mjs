/**
 * Tailwind v4 via PostCSS rather than the Turbopack-only loader.
 *
 * Why: the native SWC binary on this machine is held open by another process
 * (antivirus, most likely), so Next falls back to WASM bindings — and Turbopack
 * requires native bindings while webpack runs fine on WASM. Driving Tailwind
 * through PostCSS keeps the stylesheet working on both build paths, so the
 * project is not dependent on that lock clearing.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
