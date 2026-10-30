import { EB_Garamond } from "next/font/google";

import { InlineScript } from "@/components/inline-script";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { BackToTop } from "@/components/site/side-rail";
import { SiteIntro } from "@/components/site/site-intro";
import { isSignedIn } from "@/lib/auth/server-session";

import "./site.css";

// Kept to one expression so it can run inline, before the first paint. A
// reload always gets the waveform — including a reload part-way through the
// greetings, since the session was marked the moment they began. Moving
// between pages of the site never reaches this script at all: it is a client
// navigation, and the layout is not rendered again.
const INTRO_SCRIPT = `(function(){var d=document.documentElement;d.classList.add('site-js');try{
var n=(performance.getEntriesByType&&performance.getEntriesByType('navigation')||[])[0];
var t=n?n.type:(performance.navigation&&performance.navigation.type===1?'reload':'navigate');
var seen=sessionStorage.getItem('tringlo.intro')==='1';
var m=t==='reload'?'reload':(t==='back_forward'||seen?'':'welcome');
if(m){d.setAttribute('data-site-intro',m);sessionStorage.setItem('tringlo.intro','1');}
}catch(e){}})();`;

// Self-hosted by next/font at build time: visitors' browsers never contact
// Google, so the font adds no third party to the privacy picture.
const garamond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-garamond",
  display: "swap",
});

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await isSignedIn();

  return (
    <div className={`site ${garamond.variable} relative flex min-h-screen w-full flex-col`}>
      {/* Runs before anything below is painted. It marks that JavaScript is
          running, so the hero can be held back for its entrance without ever
          being hidden from a browser that will not run it — and it decides
          which opening, if any, this load gets: the greetings on the first
          load of a browsing session, the waveform on a reload, and nothing at
          all once the session has already seen one. Deciding here, rather than
          in React, means the overlay is in place from the first frame. It is
          marked executable on the server and inert on the client, which is
          what keeps React quiet without changing when it runs — see
          InlineScript. */}
      <InlineScript html={INTRO_SCRIPT} />
      <SiteIntro />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader signedIn={signedIn} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <BackToTop />
    </div>
  );
}
