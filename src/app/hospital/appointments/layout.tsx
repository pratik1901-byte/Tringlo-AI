import type { Metadata } from "next";

// This route's page is a client component, and a client component cannot
// export metadata. This layout carries it instead and renders the page
// untouched. Fields it does not name — the share card, the icons, the site
// name — are inherited from the root layout.
export const metadata: Metadata = {
  title: "Appointments — Hospital — Tringlo AI",
  description: "Every appointment booked, with its doctor, slot and confirmation call.",
  // Behind a sign-in and of no use in a search result.
  robots: { index: false, follow: false },
};

export default function AppointmentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
