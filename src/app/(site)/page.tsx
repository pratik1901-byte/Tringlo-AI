import type { Metadata } from "next";

import { CallingModes } from "@/components/site/calling-modes";
import { Closing, Faq } from "@/components/site/faq";
import { Hero } from "@/components/site/hero";
import { Outcomes } from "@/components/site/outcomes";
import { Platform } from "@/components/site/platform";
import { SectionRail } from "@/components/site/side-rail";
import { Statement } from "@/components/site/statement";
import { Story } from "@/components/site/story";
import { UseCases } from "@/components/site/use-cases";
import { isSignedIn } from "@/lib/auth/server-session";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: `${SITE.name} — AI voice agents that call, listen and follow through`,
  description:
    "Tringlo runs AI voice agents that call your leads one at a time or as scheduled campaigns, hold the conversation, and turn every call into an outcome, a transcript and a follow-up.",
  openGraph: {
    title: `${SITE.name} — AI voice agents that call, listen and follow through`,
    description:
      "Single calls, scheduled campaigns and an optional inbound line — with the outcome, transcript, recording and follow-up of every call kept for you.",
    siteName: SITE.name,
    type: "website",
  },
};

/**
 * The page tells one story, in order:
 *
 *   what Tringlo is        → Hero, Statement
 *   how it works           → Story (the scroll-driven loop)
 *   the two ways to call   → CallingModes
 *   what a call leaves     → Outcomes
 *   where it is used       → UseCases
 *   everything else        → Platform
 *   questions, then begin  → Faq, Closing
 */
export default async function LandingPage() {
  const signedIn = await isSignedIn();

  return (
    <>
      <SectionRail />
      <Hero signedIn={signedIn} />
      <Statement />
      <Story />
      <CallingModes />
      <Outcomes />
      <UseCases />
      <Platform />
      <Faq />
      <Closing signedIn={signedIn} />
    </>
  );
}
