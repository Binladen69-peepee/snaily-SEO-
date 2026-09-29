import type { Metadata } from "next";
import { Poppins, Rubik } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

import "./globals.css";

/** Clean SaaS sans close to KeySearch’s UI type. */
const poppins = Poppins({
  subsets: ["latin"],
  // Medium through Bold — headings carry weight, body stays at 500.
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

/**
 * Rubik, for the navigation chrome.
 *
 * Poppins is a good page face and a poor 13px one. Its letterforms are
 * near-perfect circles with a single-storey `a`, which is handsome at heading
 * sizes and turns to mush in a dense bar of nav labels — "Competitive Analysis"
 * at 13px was already being truncated, and the round shapes made the truncation
 * harder to read rather than easier.
 *
 * Rubik is narrower for the same x-height, has a double-storey `a` and wider
 * apertures, so it holds up at small sizes and buys back a little width. It is
 * scoped to the bar rather than swapped in globally: the page content is set in
 * Poppins and reads well, and changing it is a separate decision from this one.
 */
const rubik = Rubik({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-rubik",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Snaily SEO",
    template: "%s",
  },
  description:
    "Self-hosted keyword research, site auditing and content intelligence.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${poppins.variable} ${rubik.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-svh bg-background font-sans text-foreground antialiased"
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster
            position="top-center"
            richColors
            closeButton
            duration={4000}
            toastOptions={{
              classNames: {
                toast: "text-sm max-w-[calc(100vw-1.5rem)]",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
