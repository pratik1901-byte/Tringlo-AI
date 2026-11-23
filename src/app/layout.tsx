import type { Metadata, Viewport } from "next";
import { EB_Garamond, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { siteUrl } from "@/lib/site-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The brand's serif — the website's headings — for page titles and headline
// figures in the app, so the product and the website speak in one voice.
const garamond = EB_Garamond({
  variable: "--font-garamond",
  subsets: ["latin"],
  display: "swap",
});

const DESCRIPTION =
  "Place real outbound sales calls with an AI voice agent, and see the transcript, outcome and follow-up for every one.";

/**
 * Metadata every page inherits.
 *
 * A page or layout deeper in the tree exports its own `metadata` object (or a
 * `generateMetadata` function when the values depend on data), and only the
 * fields it names are replaced — everything here carries on. There is no title
 * template on purpose: the pages that set a title already end it with the
 * product's name, and a template would say the name twice.
 *
 * The icons and the share card are deliberately not listed: Next picks up
 * icon.svg, favicon.ico, apple-icon.png, opengraph-image.png and
 * twitter-image.png from this folder by their file names and writes the tags
 * itself, with a content hash, so a changed logo is never served stale.
 */
export const metadata: Metadata = {
  // Absolute URLs for the share card and canonical links; robots.ts and
  // sitemap.ts resolve against the same value.
  metadataBase: new URL(siteUrl()),
  title: "Tringlo AI",
  description: DESCRIPTION,
  applicationName: "Tringlo AI",
  openGraph: {
    type: "website",
    siteName: "Tringlo AI",
    title: "Tringlo AI",
    description: DESCRIPTION,
    url: "/",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tringlo AI",
    description: DESCRIPTION,
  },
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
    { media: "(prefers-color-scheme: light)", color: "#F5F2EA" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0A09" },
  ],
};

/**
 * Applies the saved theme before the first paint.
 *
 * Toggling the class from an effect instead would render one frame in the wrong
 * theme on every page load. A saved choice wins; with none, the system's
 * preference decides. A choice saved under the product's old name is carried
 * over once, so nobody's setting resets.
 */
const THEME_BOOTSTRAP = `(function(){try{var k="tringlo-theme",s=localStorage.getItem(k);if(!s){s=localStorage.getItem("tringlo-theme");if(s){localStorage.setItem(k,s);localStorage.removeItem("tringlo-theme");}}var d=s==="dark"||(!s&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

/**
 * Development only: stops React's DevTools timing from crashing the page on
 * some phones.
 *
 * React 19's development build records every component render with
 * `performance.measure(name, { start, end })`, without error handling. On
 * some mobile browsers the start time it passes is negative, the browser
 * throws "cannot have a negative time stamp", and Next's error overlay covers
 * the page. The production build makes no such calls, so this never ships.
 *
 * Only that one error is swallowed — the cost is a missing entry in a
 * DevTools timeline. Any other error from `measure` is re-thrown.
 */
const DEV_MEASURE_GUARD = `(function(){try{var p=window.performance;if(!p||!p.measure||p.__tringloGuard)return;var m=p.measure.bind(p);p.measure=function(){try{return m.apply(null,arguments)}catch(e){if(e&&/negative time ?stamp/i.test(String(e.message)))return undefined;throw e}};p.__tringloGuard=true}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${garamond.variable} h-full antialiased`}
    >
      <head>
        {/* Before React loads, so its first render is already covered. */}
        {process.env.NODE_ENV !== "production" && (
          <script dangerouslySetInnerHTML={{ __html: DEV_MEASURE_GUARD }} />
        )}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
