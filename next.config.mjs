/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',

  // GitHub Pages serves a project site from /<repo>; the deploy workflow sets this
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',

  // Next.js image optimisation requires a server; disable for static export
  images: {
    unoptimized: true,
  },

  // Trailing slashes so every page resolves as index.html in its directory
  trailingSlash: true,
}

export default nextConfig
