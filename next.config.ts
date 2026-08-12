import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma"],

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
