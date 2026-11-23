import type { Metadata } from "next";

// This route's page is a client component, and a client component cannot
// export metadata. This layout carries it instead and renders the page
// untouched. Fields it does not name — the share card, the icons, the site
// name — are inherited from the root layout.
export const metadata: Metadata = {
  title: "Leads — Tringlo AI",
  description: "The people to call, their details and the history of every call placed to them.",
  // Behind a sign-in and of no use in a search result.
  robots: { index: false, follow: false },
};

export default function LeadsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
