import type { Metadata } from "next";

// This route's page is a client component, and a client component cannot
// export metadata. This layout carries it instead and renders the page
// untouched. Fields it does not name — the share card, the icons, the site
// name — are inherited from the root layout.
export const metadata: Metadata = {
  title: "Calls — Hospital — Tringlo AI",
  description: "Calls to and from the hospital, with the outcome and transcript of each.",
  // Behind a sign-in and of no use in a search result.
  robots: { index: false, follow: false },
};

export default function CallsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
