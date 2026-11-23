// ============================================================
// Wellness Hospital — the panel's own frame
// ============================================================
//
// A section of the platform rather than an application of its own. It brings
// its own design system, scoped to the wrapper below: `.hospital-panel` is
// what makes `bg-surface` mean warm paper here and nothing at all anywhere
// else in Tringlo. See hospital.css.
//
// It deliberately does NOT bring its own theme switch. The platform already
// has one, keyed on `tringlo-theme` and applied to <html> before first paint,
// so a person who works in dark mode gets dark mode here too rather than
// finding two half-remembered preferences fighting.
//
// Only a workspace that is actually a hospital reaches these pages — see
// `requireHospitalWorkspace`. Everything else is sent somewhere it belongs.
// ============================================================

import type { Metadata } from "next";
import { EB_Garamond } from "next/font/google";

import "./hospital.css";
import { Shell } from "@/components/hospital/shell";

const display = EB_Garamond({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Hospital Operations — Tringlo AI",
  description: "Appointments, patient records, confirmation calls and reception.",
  // Patient data sits behind this. Never a search result.
  robots: { index: false, follow: false },
};

export default function HospitalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`hospital-panel ${display.variable} min-h-dvh`}>
      <Shell>{children}</Shell>
    </div>
  );
}
