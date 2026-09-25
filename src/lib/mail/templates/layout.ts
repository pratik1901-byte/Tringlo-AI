// ============================================================
// Dialo AI — Email Layout
// ============================================================
//
// The frame every Dialo email is built in, and the blocks they are built from.
//
// Email is not the web. The constraints this is written to:
//
//   - Outlook for Windows renders with Microsoft Word. No flexbox, no grid,
//     no max-width on divs. Layout is tables with explicit widths, and a
//     fixed 600px ghost table for Outlook alone (the `<!--[if mso]>` blocks).
//   - Gmail drops much of <head> in some clients and ignores classes it
//     cannot resolve, so every style that matters is inline. The <style>
//     block only adds progressive extras: dark mode and small-screen tweaks.
//   - Images are blocked by default in Gmail and Outlook. There are none.
//     The brand mark is a waveform drawn from table cells — the same motif
//     as the sign-in screen — so the email is branded before anything loads.
//   - Gmail clips messages over 102 KB behind "View entire message". These
//     stay far under that; the templates test asserts it.
//
// Every dynamic value passes through `esc()` before it touches HTML. A lead
// named `<script>` arrives in the inbox as that literal text.
// ============================================================

export const BRAND = {
  indigo: "#4F46E5",
  indigoSoft: "#EEF2FF",
  indigoInk: "#3730A3",
  ink: "#1C1917",
  body: "#44403C",
  // Text greys, measured against the surfaces they sit on (WCAG AA, 4.5:1):
  //   muted  #6B6560 — 5.6:1 on white, 5.1:1 on the canvas
  //   faint  #78716C — 4.8:1 on white; used only on white surfaces
  //   footer #57534E / footerFaint #6B6560 — on the canvas, outside the card
  muted: "#6B6560",
  faint: "#78716C",
  footer: "#57534E",
  footerFaint: "#6B6560",
  // Decorative only (bars, rules) — never text.
  decor: "#A8A29E",
  line: "#E7E5E4",
  canvas: "#F4F3F0",
  surface: "#FFFFFF",
  soft: "#FAFAF9",
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
 * email never displays a field Dialo has no data for.
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
  const bg = options.subtle ? BRAND.surface : BRAND.indigo;
  const fg = options.subtle ? BRAND.indigoInk : "#FFFFFF";
  const border = options.subtle ? BRAND.line : BRAND.indigo;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${bg}" style="border-radius:8px;background:${bg};${options.subtle ? `border:1px solid ${border};` : ""}">
<a class="${options.subtle ? "t-link" : "btn"}" href="${esc(href)}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:14px;font-weight:600;line-height:20px;color:${fg};background:${bg};text-decoration:none;border-radius:8px;">${esc(label)}</a>
</td></tr></table>`;
}

/** A tinted note — for security guidance, empty states, caveats. */
export function callout(html: string, tone: "neutral" | "info" | "warning" = "neutral"): string {
  const palette = {
    neutral: { bg: BRAND.soft, border: BRAND.line, bar: BRAND.decor },
    info: { bg: BRAND.indigoSoft, border: "#E0E7FF", bar: BRAND.indigo },
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
<p class="tile-value" style="margin:6px 0 0;font-family:${FONT};font-size:28px;font-weight:700;line-height:1.1;letter-spacing:-0.02em;color:${BRAND.ink};">${esc(tile.value)}</p>
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
  return `<a class="t-link" href="tel:${esc(dial)}" style="color:${BRAND.indigo};text-decoration:none;font-family:${MONO};font-size:13px;">${esc(phone)}</a>`;
}

/** Monospace text, for codes and numbers. */
export function mono(text: string, size = 13): string {
  return `<span style="font-family:${MONO};font-size:${size}px;">${esc(text)}</span>`;
}

/** A small rounded status pill. */
export function pill(text: string, tone: "on" | "off" | "positive" | "warning"): string {
  const palette = {
    on: { bg: BRAND.indigoSoft, fg: BRAND.indigoInk },
    positive: { bg: BRAND.positiveSoft, fg: BRAND.positive },
    warning: { bg: BRAND.warningSoft, fg: BRAND.warning },
    off: { bg: BRAND.soft, fg: BRAND.muted },
  }[tone];
  return `<span class="pill-${tone}" style="display:inline-block;padding:3px 10px;border-radius:999px;background:${palette.bg};font-family:${FONT};font-size:12px;font-weight:600;line-height:18px;color:${palette.fg};">${esc(text)}</span>`;
}

// ------------------------------------------------------------------
// Frame
// ------------------------------------------------------------------

/** The waveform mark, drawn from table cells so it renders with images off. */
function brandMark(): string {
  const heights = [6, 12, 18, 10, 14, 7];
  const bars = heights
    .map(
      (height) =>
        `<td valign="bottom" style="padding:0 1px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="3" height="${height}" bgcolor="${BRAND.indigo}" style="width:3px;height:${height}px;background:${BRAND.indigo};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="bottom" style="padding:0 10px 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" height="18"><tr>${bars}</tr></table></td>
<td class="t-ink" valign="middle" style="font-family:${FONT};font-size:16px;font-weight:700;letter-spacing:-0.01em;color:${BRAND.ink};">Dialo<span class="t-accent" style="color:${BRAND.indigo};">&nbsp;AI</span></td>
</tr></table>`;
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
 * Wraps content in the Dialo frame.
 *
 * Structure: canvas → 600px card with an indigo top rule → header with the
 * mark and a context label → eyebrow, title, content → footer outside the
 * card. The footer says plainly why the email was sent; it offers no
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
    .t-accent, .t-link { color:#A5B4FC !important; }
    .t-positive { color:#5EEAD4 !important; }
    .t-negative { color:#FCA5A5 !important; }
    .b-line { border-color:#292524 !important; }
    .tile-inner, .callout { background:#1C1917 !important; border-color:#292524 !important; }
    .pill-on { background:#272449 !important; color:#C7D2FE !important; }
    .pill-off { background:#292524 !important; color:#A8A29E !important; }
    .pill-positive { background:#042F2E !important; color:#5EEAD4 !important; }
    .pill-warning { background:#451A03 !important; color:#FCD34D !important; }
  }
  [data-ogsc] .canvas, [data-ogsc] body { background:#0C0A09 !important; }
  [data-ogsc] .card { background:#171514 !important; border-color:#292524 !important; }
  [data-ogsc] .t-ink, [data-ogsc] .title, [data-ogsc] .tile-value, [data-ogsc] .callout strong { color:#FAFAF9 !important; }
  [data-ogsc] .t-body { color:#D6D3D1 !important; }
  [data-ogsc] .t-muted, [data-ogsc] .footer-text { color:#A8A29E !important; }
  [data-ogsc] .t-accent, [data-ogsc] .t-link { color:#A5B4FC !important; }
  [data-ogsc] .t-positive { color:#5EEAD4 !important; }
  [data-ogsc] .t-negative { color:#FCA5A5 !important; }
  [data-ogsc] .b-line { border-color:#292524 !important; }
  [data-ogsc] .tile-inner, [data-ogsc] .callout { background:#1C1917 !important; border-color:#292524 !important; }
  [data-ogsc] .pill-on { background:#272449 !important; color:#C7D2FE !important; }
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
<tr><td height="4" bgcolor="${BRAND.indigo}" style="height:4px;background:${BRAND.indigo};border-radius:13px 13px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>

<tr><td class="pad" style="padding:24px 36px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle">${brandMark()}</td>
<td class="t-muted" align="right" valign="middle" style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.faint};">${esc(frame.context)}</td>
</tr></table>
</td></tr>

<tr><td class="pad" style="padding:28px 36px 8px;">
<p class="t-accent" style="margin:0 0 8px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.indigo};">${esc(frame.eyebrow)}</p>
<h1 class="title" style="margin:0 0 18px;font-family:${FONT};font-size:26px;font-weight:700;line-height:1.25;letter-spacing:-0.02em;color:${BRAND.ink};">${esc(frame.title)}</h1>
</td></tr>

<tr><td class="pad" style="padding:0 36px 36px;">${frame.bodyHtml}</td></tr>
</table>
</td></tr>

<tr><td class="pad" style="padding:22px 36px 0;">
<p class="footer-text" style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.footer};">${esc(frame.reason)}</p>
<p class="footer-text" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.footerFaint};">Dialo AI${frame.workspace ? ` &middot; ${esc(frame.workspace)}` : ""} &middot; &copy; ${year}</p>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
