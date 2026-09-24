import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dialo AI",
  description:
    "Place real outbound sales calls with an AI voice agent, and see the transcript, outcome and follow-up for every one.",
};

/**
 * Viewport for phones.
 *
 * `viewportFit: "cover"` lets the layout reach under the notch and home
 * indicator, which is what makes `env(safe-area-inset-*)` report real values
 * for the bottom tab bar. `interactiveWidget` makes the on-screen keyboard
 * resize the layout rather than cover the field being typed into.
 *
 * Pinch-zoom is deliberately left enabled. Disabling it is a common way to
 * stop iOS zooming into inputs, and it takes zoom away from everyone who
 * needs it; the 16px phone form controls in globals.css solve the same
 * problem without that cost.
 *
 * The theme colour tints the phone browser's own chrome to match the page.
 * It has no effect on a desktop browser.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F2EF" },
    { media: "(prefers-color-scheme: dark)", color: "#090807" },
  ],
};

/**
 * Applies the saved theme before the first paint.
 *
 * Toggling the class from an effect instead would render one frame in the wrong
 * theme on every page load.
 */
const THEME_BOOTSTRAP = `(function(){try{var s=localStorage.getItem("dialo-theme");var d=s==="dark"||(!s&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
