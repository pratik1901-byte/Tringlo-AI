// ============================================================
// Tringlo AI — Email Layout
// ============================================================
//
// The frame every Tringlo email is built in, and the blocks they are built from.
//
// Email is not the web. The constraints this is written to:
//
//   - Outlook for Windows renders with Microsoft Word. No flexbox, no grid,
//     no max-width on divs. Layout is tables with explicit widths, and a
//     fixed 600px ghost table for Outlook alone (the `<!--[if mso]>` blocks).
//   - Gmail drops much of <head> in some clients and ignores classes it
//     cannot resolve, so every style that matters is inline. The <style>
//     block only adds progressive extras: dark mode and small-screen tweaks.
//   - Images may be blocked until the reader allows them. The one image —
//     the Tringlo AI logo in the header — travels inside the email as an
//     inline attachment rather than a link, so most clients show it at once,
//     and where they do not, its alt text reads "Tringlo AI" in the same
//     place, on the same dark band. Nothing else depends on an image.
//   - Gmail clips messages over 102 KB behind "View entire message". These
//     stay far under that; the templates test asserts it.
//
// Every dynamic value passes through `esc()` before it touches HTML. A lead
// named `<script>` arrives in the inbox as that literal text.
// ============================================================

// The Tringlo AI palette — the website's own: warm ink on cream, iris for
// accents, and the lime used once, as the rule under the logo.
export const BRAND = {
  /** Accent text and links: the website's deep iris (6.7:1 on white). */
  iris: "#3C48D9",
  /** Accent marks that are not text: bars, the "connected" segment. */
  irisBright: "#5C69F8",
  irisSoft: "#EEF0FE",
  irisInk: "#2B35A8",
  lime: "#E8F056",
  /** The header band the logo sits on. */
  band: "#171614",
  ink: "#171614",
  body: "#494640",
  // Text greys, measured against the surfaces they sit on (WCAG AA, 4.5:1):
  //   muted  #6B675F — 5.7:1 on white, 5.5:1 on the canvas
  //   faint  #78716C — 4.8:1 on white; used only on white surfaces
  //   footer #57534E / footerFaint #6B675F — on the canvas, outside the card
  muted: "#6B675F",
  faint: "#78716C",
  footer: "#57534E",
  footerFaint: "#6B675F",
  // Decorative only (bars, rules) — never text.
  decor: "#CBC6BD",
  line: "#E0DFDC",
  canvas: "#FFFCF4",
  surface: "#FFFFFF",
  soft: "#FFFCF4",
  positive: "#0F766E",
  positiveSoft: "#F0FDFA",
  warning: "#B45309",
  warningSoft: "#FFFBEB",
  negative: "#B91C1C",
  negativeSoft: "#FEF2F2",
  slate: "#64748B",
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
/** The website's headings are a serif; email cannot load its font, so this
 *  names it first and falls back to the serifs every client has. */
const SERIF = "'EB Garamond',Georgia,'Times New Roman',Times,serif";

/**
 * The header logo: the signal mark beside the Tringlo AI wordmark, drawn for
 * the dark band. Sent as an inline attachment the mailer adds whenever an
 * email refers to it, so it shows without fetching anything from the web.
 */
export const HEADER_LOGO = {
  cid: "tringlo-lockup@tringlo.ai",
  file: "public/brand/email-lockup-on-dark.png",
  width: 164,
  height: 28,
} as const;

/** Escapes text for HTML. Everything dynamic goes through this. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ------------------------------------------------------------------
// Blocks
// ------------------------------------------------------------------

/** A paragraph of body copy. `html` is trusted markup — escape before passing. */
export function paragraph(html: string, options: { muted?: boolean; size?: number; spaceAfter?: number } = {}): string {
  const color = options.muted ? BRAND.muted : BRAND.body;
  const size = options.size ?? 15;
  return `<p class="${options.muted ? "t-muted" : "t-body"}" style="margin:0 0 ${options.spaceAfter ?? 16}px;font-family:${FONT};font-size:${size}px;line-height:1.6;color:${color};">${html}</p>`;
}

/** A small uppercase label above a section. */
export function sectionLabel(text: string): string {
  return `<p class="t-muted" style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};">${esc(text)}</p>`;
}

/** Vertical space. */
export function spacer(height: number): string {
  return `<div style="height:${height}px;line-height:${height}px;font-size:0;">&nbsp;</div>`;
}

/** A hairline divider. */
export function divider(margin = 24): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${margin}px 0;"><tr><td class="b-line" style="border-top:1px solid ${BRAND.line};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

/**
 * Label/value rows.
 *
 * Rows with an empty value are dropped rather than shown as blank, so an
 * email never displays a field Tringlo has no data for.
 */
export function detailsTable(rows: Array<{ label: string; valueHtml: string | null | undefined }>): string {
  const kept = rows.filter((row) => row.valueHtml && row.valueHtml.trim());
  if (kept.length === 0) return "";
  const body = kept
    .map(
      (row, index) => `<tr>
<td class="dl-label t-muted b-line" valign="top" style="padding:12px 16px 12px 0;${index ? `border-top:1px solid ${BRAND.line};` : ""}font-family:${FONT};font-size:13px;line-height:1.5;color:${BRAND.muted};width:38%;">${esc(row.label)}</td>
<td class="t-ink b-line" valign="top" style="padding:12px 0;${index ? `border-top:1px solid ${BRAND.line};` : ""}font-family:${FONT};font-size:14px;line-height:1.5;color:${BRAND.ink};">${row.valueHtml}</td>
</tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>`;
}

/**
 * A button that works in every client, including Outlook.
 *
 * Built as a table cell with a background colour rather than a styled link,
 * because Outlook ignores padding on <a>. Corners are square in Outlook and
 * rounded everywhere else, which is the accepted trade.
 */
export function button(label: string, href: string, options: { subtle?: boolean } = {}): string {
  const bg = options.subtle ? BRAND.surface : BRAND.ink;
  const fg = options.subtle ? BRAND.ink : BRAND.canvas;
  const border = options.subtle ? BRAND.line : BRAND.ink;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${bg}" style="border-radius:6px;background:${bg};${options.subtle ? `border:1px solid ${border};` : ""}">
<a class="${options.subtle ? "t-link" : "btn"}" href="${esc(href)}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:14px;font-weight:600;line-height:20px;color:${fg};background:${bg};text-decoration:none;border-radius:6px;">${esc(label)}</a>
</td></tr></table>`;
}

/** A tinted note — for security guidance, empty states, caveats. */
export function callout(html: string, tone: "neutral" | "info" | "warning" = "neutral"): string {
  const palette = {
    neutral: { bg: BRAND.soft, border: BRAND.line, bar: BRAND.decor },
    info: { bg: BRAND.irisSoft, border: "#DCE0FD", bar: BRAND.irisBright },
    warning: { bg: BRAND.warningSoft, border: "#FDE68A", bar: BRAND.warning },
  }[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
<tr>
<td width="3" bgcolor="${palette.bar}" style="width:3px;background:${palette.bar};border-radius:3px 0 0 3px;font-size:0;line-height:0;">&nbsp;</td>
<td class="callout t-body" bgcolor="${palette.bg}" style="padding:14px 16px;background:${palette.bg};border:1px solid ${palette.border};border-left:0;border-radius:0 8px 8px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${BRAND.body};">${html}</td>
</tr></table>`;
}

/**
 * Figures as tiles, two per row.
 *
 * Two across rather than four, so the layout needs no media query to survive
 * a phone: two 250px tiles on desktop, two ~150px tiles on a narrow screen,
 * both readable.
 */
export function statTiles(
  tiles: Array<{ label: string; value: string; note?: string | null; tone?: "positive" | "negative" | "neutral" }>
): string {
  const rows: string[] = [];
  for (let i = 0; i < tiles.length; i += 2) {
    const pair = tiles.slice(i, i + 2);
    const cells = pair
      .map((tile, j) => {
        const noteColor =
          tile.tone === "positive" ? BRAND.positive : tile.tone === "negative" ? BRAND.negative : BRAND.muted;
        return `<td class="tile" width="50%" valign="top" style="padding:0 ${j === 0 ? "6px" : "0"} 0 ${j === 1 ? "6px" : "0"};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
<tr><td class="tile-inner" bgcolor="${BRAND.soft}" style="padding:16px 18px;background:${BRAND.soft};border:1px solid ${BRAND.line};border-radius:10px;">
<p class="t-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.4;color:${BRAND.muted};">${esc(tile.label)}</p>
<p class="tile-value" style="margin:6px 0 0;font-family:${SERIF};font-size:32px;font-weight:400;line-height:1.05;letter-spacing:-0.01em;color:${BRAND.ink};">${esc(tile.value)}</p>
${tile.note ? `<p class="${tile.tone === "positive" ? "t-positive" : tile.tone === "negative" ? "t-negative" : "t-muted"}" style="margin:6px 0 0;font-family:${FONT};font-size:12px;line-height:1.4;color:${noteColor};">${esc(tile.note)}</p>` : ""}
</td></tr></table>
</td>`;
      })
      .join("");
    const filler = pair.length === 1 ? `<td width="50%" style="padding-left:6px;">&nbsp;</td>` : "";
    rows.push(`<tr>${cells}${filler}</tr>`);
    if (i + 2 < tiles.length) rows.push(`<tr><td colspan="2" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`;
}

/**
 * A single stacked bar showing how calls ended, with a legend.
 *
 * Segments are table cells sized by percentage, which every client lays out
 * the same way. Zero-count outcomes are omitted from the bar but kept in the
 * legend, so the reader still sees that there were none.
 */
export function outcomeBar(segments: Array<{ label: string; count: number; color: string }>): string {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return "";

  const present = segments.filter((segment) => segment.count > 0);
  // Rounded percentages must still add to 100, or the bar leaves a gap.
  let used = 0;
  const widths = present.map((segment, index) => {
    if (index === present.length - 1) return 100 - used;
    const width = Math.max(1, Math.round((segment.count / total) * 100));
    used += width;
    return width;
  });

  const bar = present
    .map(
      (segment, index) =>
        `<td width="${widths[index]}%" bgcolor="${segment.color}" style="width:${widths[index]}%;height:10px;background:${segment.color};${
          index === 0 ? "border-radius:5px 0 0 5px;" : ""
        }${index === present.length - 1 ? "border-radius:0 5px 5px 0;" : ""}font-size:0;line-height:0;">&nbsp;</td>`
    )
    .join("");

  const legend = segments
    .map(
      (segment) => `<tr>
<td width="14" valign="middle" style="padding:5px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="8" height="8" bgcolor="${segment.color}" style="width:8px;height:8px;background:${segment.color};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td>
<td class="t-body" valign="middle" style="padding:5px 0;font-family:${FONT};font-size:13px;color:${BRAND.body};">${esc(segment.label)}</td>
<td class="t-ink" align="right" valign="middle" style="padding:5px 0;font-family:${FONT};font-size:13px;font-weight:600;color:${BRAND.ink};">${segment.count}<span class="t-muted" style="font-weight:400;color:${BRAND.faint};">&nbsp;&nbsp;${Math.round((segment.count / total) * 100)}%</span></td>
</tr>`
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>${bar}</tr></table>
${spacer(14)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${legend}</table>`;
}

/** A tel: link that reads as a phone number. */
export function phoneLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const dial = phone.replace(/[^\d+]/g, "");
  if (!dial) return esc(phone);
  return `<a class="t-link" href="tel:${esc(dial)}" style="color:${BRAND.iris};text-decoration:none;font-family:${MONO};font-size:13px;">${esc(phone)}</a>`;
}

/** Monospace text, for codes and numbers. */
export function mono(text: string, size = 13): string {
  return `<span style="font-family:${MONO};font-size:${size}px;">${esc(text)}</span>`;
}

/** A small rounded status pill. */
export function pill(text: string, tone: "on" | "off" | "positive" | "warning"): string {
  const palette = {
    on: { bg: BRAND.irisSoft, fg: BRAND.irisInk },
    positive: { bg: BRAND.positiveSoft, fg: BRAND.positive },
    warning: { bg: BRAND.warningSoft, fg: BRAND.warning },
    off: { bg: BRAND.soft, fg: BRAND.muted },
  }[tone];
  return `<span class="pill-${tone}" style="display:inline-block;padding:3px 10px;border-radius:999px;background:${palette.bg};font-family:${FONT};font-size:12px;font-weight:600;line-height:18px;color:${palette.fg};">${esc(text)}</span>`;
}

// ------------------------------------------------------------------
// Frame
// ------------------------------------------------------------------

/**
 * The header: the logo on a dark band, the context label opposite, and the
 * lime rule beneath — the same lockup and the same lime as the website.
 * If images are held back, the alt text stands in, light on the dark band.
 */
function headerBand(context: string): string {
  return `<tr><td class="band" bgcolor="${BRAND.band}" style="padding:20px 36px;background:${BRAND.band};border-radius:13px 13px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><img src="cid:${HEADER_LOGO.cid}" width="${HEADER_LOGO.width}" height="${HEADER_LOGO.height}" alt="Tringlo AI" style="display:block;width:${HEADER_LOGO.width}px;height:${HEADER_LOGO.height}px;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:16px;font-weight:600;letter-spacing:0.12em;line-height:28px;color:${BRAND.canvas};"></td>
<td align="right" valign="middle" style="font-family:${MONO};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#B5B1A8;">${esc(context)}</td>
</tr></table>
</td></tr>
<tr><td height="3" bgcolor="${BRAND.lime}" style="height:3px;background:${BRAND.lime};font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

export interface EmailFrame {
  /** Inbox preview text. Shown beside the subject; never visible in the email. */
  preheader: string;
  /** Right-hand label in the header — "Security", "Daily report". */
  context: string;
  /** Small label above the title. */
  eyebrow: string;
  title: string;
  /** Trusted HTML for the main content. */
  bodyHtml: string;
  /** Why the recipient got this, in one sentence. Plain text. */
  reason: string;
  /** Workspace name, shown in the footer when known. */
  workspace?: string | null;
}

/**
 * Wraps content in the Tringlo frame.
 *
 * Structure: cream canvas → 600px card → dark header band with the logo and
 * a context label, lime rule beneath → eyebrow, serif title, content →
 * footer outside the card. The footer says plainly why the email was sent; it offers no
 * unsubscribe link because these are transactional or opt-in-in-Settings,
 * and a link that does nothing would be worse than none.
 */
export function renderEmail(frame: EmailFrame): string {
  const year = new Date().getFullYear();
  // Padding after the preheader stops clients pulling body text into the
  // preview when the preheader is short.
  const previewPad = "&#8199;&#65279;&#847; ".repeat(60);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(frame.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  a { text-decoration:none; }
  @media screen and (max-width:620px) {
    .shell { width:100% !important; }
    .pad { padding-left:22px !important; padding-right:22px !important; }
    .title { font-size:24px !important; }
    .tile-inner { padding:14px !important; }
    .tile-value { font-size:24px !important; }
    .dl-label { width:42% !important; }
  }
  /* Dark mode. Every piece of text carries a role class (t-ink, t-body,
     t-muted, t-accent, t-link) and every line and surface one too; this
     maps each role to its dark value. Apple Mail and iOS Mail honour the
     media query; Outlook.com rewrites to [data-ogsc], hence the second set.
     The Gmail apps ignore both and invert colours on their own. */
  @media (prefers-color-scheme: dark) {
    .canvas, body { background:#0C0A09 !important; }
    .card { background:#171514 !important; border-color:#292524 !important; }
    .t-ink, .title, .tile-value, .callout strong { color:#FAFAF9 !important; }
    .t-body { color:#D6D3D1 !important; }
    .t-muted, .footer-text { color:#A8A29E !important; }
    .t-accent, .t-link { color:#A9B0FB !important; }
    .t-positive { color:#5EEAD4 !important; }
    .t-negative { color:#FCA5A5 !important; }
    .b-line { border-color:#292524 !important; }
    .tile-inner, .callout { background:#1C1917 !important; border-color:#292524 !important; }
    .pill-on { background:#23264F !important; color:#C9CEFD !important; }
    .pill-off { background:#292524 !important; color:#A8A29E !important; }
    .pill-positive { background:#042F2E !important; color:#5EEAD4 !important; }
    .pill-warning { background:#451A03 !important; color:#FCD34D !important; }
  }
  [data-ogsc] .canvas, [data-ogsc] body { background:#0C0A09 !important; }
  [data-ogsc] .card { background:#171514 !important; border-color:#292524 !important; }
  [data-ogsc] .t-ink, [data-ogsc] .title, [data-ogsc] .tile-value, [data-ogsc] .callout strong { color:#FAFAF9 !important; }
  [data-ogsc] .t-body { color:#D6D3D1 !important; }
  [data-ogsc] .t-muted, [data-ogsc] .footer-text { color:#A8A29E !important; }
  [data-ogsc] .t-accent, [data-ogsc] .t-link { color:#A9B0FB !important; }
  [data-ogsc] .t-positive { color:#5EEAD4 !important; }
  [data-ogsc] .t-negative { color:#FCA5A5 !important; }
  [data-ogsc] .b-line { border-color:#292524 !important; }
  [data-ogsc] .tile-inner, [data-ogsc] .callout { background:#1C1917 !important; border-color:#292524 !important; }
  [data-ogsc] .pill-on { background:#23264F !important; color:#C9CEFD !important; }
  [data-ogsc] .pill-off { background:#292524 !important; color:#A8A29E !important; }
  [data-ogsc] .pill-positive { background:#042F2E !important; color:#5EEAD4 !important; }
  [data-ogsc] .pill-warning { background:#451A03 !important; color:#FCD34D !important; }
</style>
</head>
<body class="canvas" style="margin:0;padding:0;background:${BRAND.canvas};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.canvas};opacity:0;">${esc(frame.preheader)}${previewPad}</div>
<table role="presentation" class="canvas" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.canvas}" style="background:${BRAND.canvas};">
<tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

<tr><td class="card" bgcolor="${BRAND.surface}" style="background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${headerBand(frame.context)}

<tr><td class="pad" style="padding:30px 36px 8px;">
<p class="t-accent" style="margin:0 0 10px;font-family:${MONO};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.iris};">${esc(frame.eyebrow)}</p>
<h1 class="title" style="margin:0 0 18px;font-family:${SERIF};font-size:32px;font-weight:400;line-height:1.15;letter-spacing:-0.01em;color:${BRAND.ink};">${esc(frame.title)}</h1>
</td></tr>

<tr><td class="pad" style="padding:0 36px 36px;">${frame.bodyHtml}</td></tr>
</table>
</td></tr>

<tr><td class="pad" style="padding:22px 36px 0;">
<p class="footer-text" style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.footer};">${esc(frame.reason)}</p>
<p class="footer-text" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.footerFaint};">Tringlo AI${frame.workspace ? ` &middot; ${esc(frame.workspace)}` : ""} &middot; &copy; ${year}</p>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
