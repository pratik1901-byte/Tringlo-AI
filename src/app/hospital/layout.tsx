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
import { EB_Garamond, Inter } from "next/font/google";

import "./hospital.css";
import { Shell } from "@/components/hospital/shell";

const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = EB_Garamond({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Hospital Operations — Tringlo AI",
  description: "Appointments, patient records, confirmation calls and reception.",
};

export default function HospitalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`hospital-panel ${body.variable} ${display.variable} min-h-dvh`}>
      <Shell>{children}</Shell>
    </div>
  );
}
