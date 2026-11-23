import type { Metadata } from "next";

// This route's page is a client component, and a client component cannot
// export metadata. This layout carries it instead and renders the page
// untouched. Fields it does not name — the share card, the icons, the site
// name — are inherited from the root layout.
export const metadata: Metadata = {
  title: "Maya — Hospital — Tringlo AI",
  description: "The hospital's voice agent: what she can do on a call, and the tools she uses to do it.",
  // Behind a sign-in and of no use in a search result.
  robots: { index: false, follow: false },
};

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
