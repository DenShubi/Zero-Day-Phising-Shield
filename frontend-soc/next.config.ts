import type { NextConfig } from 'next';

/**
 * Two hosting targets are supported from one codebase:
 *
 *   - Vercel (primary, per README section 9) — the default build.
 *   - GitHub Pages — set VK_STATIC_EXPORT=1 and VK_BASE_PATH=/<repo>.
 *
 * The app is entirely client-side (no server data fetching, no route handlers),
 * so a static export is a genuine option rather than a compromise. Keeping the
 * export path working means routes must avoid dynamic segments: the forensics
 * view is /?view=forensik&insiden=<id>, not /forensics/[scanId].
 *
 * Note that static hosting does NOT remove the need for an HTTPS backend. Both
 * *.vercel.app and *.github.io are HTTPS public origins, so mixed content,
 * Private Network Access and Safari behave identically either way.
 */

const isStaticExport = process.env.VK_STATIC_EXPORT === '1';
const basePath = process.env.VK_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  ...(isStaticExport ? { output: 'export' as const } : {}),

  // A GitHub Pages project site serves from /<repo>, not from the root.
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),

  // Evidence images come from either Supabase Storage or the engine's /static
  // mount, and which one depends on runtime config — so the host is not known
  // at build time. We use plain <img>, so the optimizer is simply off.
  images: { unoptimized: true },

  // Hide the floating Next.js dev indicator so it never covers the sidebar footer.
  devIndicators: false,

  // Tailwind is wired through postcss.config.mjs so the stylesheet builds on
  // both webpack and Turbopack. See that file for why webpack is the default
  // here (`npm run build` passes --webpack).
};

export default nextConfig;
