// ============================================================
// Tringlo AI — An inline script that runs before the first paint
// ============================================================
//
// A `<script>` rendered into the body tree is the sanctioned way to correct
// the DOM before the browser paints (see Next's "preventing flash before
// hydration" guide). React, though, warns in development whenever rendering
// produces a `<script>` tag, because on a client navigation the script is
// never re-executed.
//
// The guide's own fix, reproduced here: mark the script executable on the
// server (`text/javascript`, so the browser runs it synchronously while
// parsing the server-rendered HTML) and inert on the client (`text/plain`, so
// React is not rendering an executable script and stays quiet). It would not
// run on a client render anyway — the layout that holds it is not re-rendered
// on a soft navigation — so nothing is lost. `suppressHydrationWarning`
// absorbs the deliberate `type` mismatch between the two renders.
// ============================================================

export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
