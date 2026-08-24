import type { NextConfig } from "next";

/**
 * Tools that used to live under /keywords/… and /competitors/… and now have a
 * top-level page each.
 *
 * These run before routing, which matters for the keyword ones: without them
 * /keywords/difficulty would fall through to the /keywords/[keyword] detail
 * page and try to research a keyword called "difficulty".
 */
const MOVED_TOOLS: Record<string, string> = {
  "/keywords/difficulty": "/difficulty",
  "/keywords/brainstorm": "/brainstorm",
  "/keywords/bulk": "/bulk-check",
  "/keywords/lists": "/keyword-lists",
  "/keywords/deep-dive": "/keywords",
  "/competitors/backlinks": "/backlinks",
  "/competitors/organic": "/organic-keywords",
  "/competitors/gap": "/competitor-gap",
  "/competitors/url-metrics": "/url-metrics",
};

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma"],

  // 307 rather than 308: a permanent redirect is cached by the browser
  // indefinitely, which is painful to undo if any of these paths move again.
  redirects: () =>
    Promise.resolve(
      Object.entries(MOVED_TOOLS).map(([source, destination]) => ({
        source,
        destination,
        permanent: false,
      })),
    ),

  // Locally, dev and production builds use separate output folders so running
  // `npm run build` never corrupts a running `npm run dev` server.
  //
  // Vercel's builder only looks for `.next`, so a custom distDir there fails
  // with "No Output Directory found" — keep the default when VERCEL is set.
  distDir: process.env.VERCEL
    ? ".next"
    : process.env.NODE_ENV === "production"
      ? ".next-build"
      : ".next",
};

export default nextConfig;
