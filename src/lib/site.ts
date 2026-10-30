// ============================================================
// Public website — facts about the business
// ============================================================
//
// Everything the public site and legal pages say about who runs this service
// comes from here, so it is changed in one place.
//
// Values in square brackets are deliberately unfilled. They are legal facts —
// registered name, address, grievance contact — that must come from the
// business, not be guessed. Pages render them visibly as "to be confirmed"
// so an unfinished page can never pass as a finished one.
// ============================================================

export const SITE = {
  /** The product name used across the public site. */
  name: "Tringlo AI",
  /** Registered legal entity that operates the service. */
  legalName: "Avinyeaconnect Technologies Pvt Ltd",
  /** Registered office address. */
  address: "#224, 3rd Floor, Ranka Junction, 80/3, K R Puram, Bengaluru 560016",
  /** Where general and privacy questions go. */
  contactEmail: "info@avinyeaconnect.com",
  /** Published number for calls about the service. */
  phone: "+91 78920 29031",
  /** The company's own website. */
  website: "www.avinyeaconnect.com",
  /** DPDP Act: the person who answers questions about personal data. */
  grievanceOfficer: "[Name, designation]",
  grievanceEmail: "[grievance@your-domain]",
  /** Governing law and courts for the Terms. */
  jurisdiction: "[City], India",
  /** Last review of the legal pages (ISO date). */
  legalUpdated: "2026-09-26",
} as const;

/** True for a value that still needs the business to fill it in. */
export function isPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value.trim());
}

export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/refunds", label: "Refunds & Cancellation" },
] as const;
