# Login, workspace selection and multi-workspace creation — fixes

---

## 1. Why entering a workspace asked for the password again

**It was deliberate, and it was my doing.** The previous brief asked for it in
so many words — "I want the user to select a workspace and confirm access
before entering it… Confirm account password" — so I built a confirmation step
into `POST /api/workspaces/{id}/enter` and a password dialog into the selector.

It was not a bug in session handling, the guards, a redirect or membership
validation. It was a requirement that has now been reversed, so it is gone.

Signing in is what proves who you are. Choosing which of your own companies to
look at is not a second security boundary, so entry now asks for nothing — while
still checking, every time, that the account actually holds a membership in the
workspace it names.

## 2. Why creating another workspace failed

Two causes, both real:

**The route bounced.** "Create new workspace" pointed at `/login?mode=signup`.
The app shell redirects a signed-in visitor away from `/login` to `/dashboard`,
and with no workspace open it then redirects to `/workspaces` — so the click
went selector → login → dashboard → selector. The wizard was unreachable while
signed in.

**The endpoint was the wrong one.** The wizard posted to
`/api/auth/bootstrap`, which creates a *first account*: restricted to the server
machine or an internal secret, and it requires a valid email and a password
passing the policy. An already signed-in person has both and should be asked for
neither.

The fix follows the brief's own guidance: a separate, properly authenticated
endpoint rather than loosening the privileged one. `POST /api/workspaces`
verifies the session, validates the company and provider configuration, creates
the workspace, grants the creator ownership, saves the workspace-specific
provider settings, returns the new id and opens it on the session.
`/api/auth/bootstrap` is back to first-run only, with its restrictions intact —
I reverted the bypass I had added to it yesterday.

**The owner is the authenticated account and nothing else.** No user id is read
from the body; a request naming someone else as owner is ignored, which is
tested.

## 3. The flow now

```
Account login
     └─> Choose your workspace          (always, even with one workspace)
            ├─> Open workspace  ──> Dashboard        (no password)
            └─> + Create New Workspace ──> wizard ──> new workspace's dashboard
```

The selector is never skipped. Login creates a session with **no workspace
open**, and `requireAuth` no longer silently opens the only one — where you are
is always something you chose.

## 4. The selector

`/workspaces` — "Choose your workspace", "Select the company workspace you want
to access." Each card carries the company name, generated initials, industry
where known, the caller's role, and when it was last opened, with a spinner on
the card being opened. Search appears above four workspaces. Account name,
email and sign-out sit in the header; **+ Create New Workspace** below the list.

Cards are built from real authorized records. There are no demo workspaces, no
invented metrics and no decorative content; a company with no logo gets initials
from its actual name.

## 5. Creating a workspace

`/workspaces/new` hosts the same three-step wizard. Step 1 becomes **account
context**: it shows which account will own the workspace and asks only for the
workspace name — no second email, no second password, no second account. Steps
2 and 3 (Company, Voice Provider) are unchanged, including the Sarvam example
imports and the validation.

The new workspace gets its own company profile, provider configuration, webhook
token and empty leads, calls, customers and memory. Nothing is copied from
another workspace, and inbound stays off until switched on.

## 6. Membership and authorization

Unchanged from yesterday's model and still enforced on every request:

```
Authenticated account → active membership → resource.tenantId matches → allow
```

A workspace id from the browser is worth nothing until `findMembership` returns
it. Knowing a name, an id or a URL grants nothing. There is no fallback to
TenWeb or any other default. A refusal is a 403 with one wording that reveals
nothing about what exists.

## 7. Database

**No migration was needed**, and none was run. The `memberships` collection and
its idempotent migration already existed from yesterday and had already been
applied to the live database. No account, workspace, password or business
record was touched by this work.

## 8. Files changed

| File | Change |
| --- | --- |
| `src/app/api/workspaces/[id]/enter/route.ts` | Password confirmation removed; membership check kept; refusal now 403 with neutral wording; rate limit raised to 120/5min since switching is ordinary. |
| `src/app/api/workspaces/route.ts` | New authenticated `POST` that creates a workspace, grants ownership and opens it. |
| `src/lib/workspaces/create.ts` (new) | Shared creation: reads the form, validates it, creates the tenant, membership, profile, provider config and inbound draft, and rolls back on failure. |
| `src/app/api/auth/bootstrap/route.ts` | Restored to first-run only; uses no authenticated bypass. |
| `src/lib/auth/guard.ts` | No longer auto-opens a single workspace. |
| `src/app/api/auth/login/route.ts` | Session starts with no workspace open. |
| `src/app/login/page.tsx` | Always routes to the selector. |
| `src/app/workspaces/page.tsx` | Password dialog removed; cards open directly; errors shown inline; create goes to `/workspaces/new`. |
| `src/app/workspaces/new/page.tsx` (new) | The wizard for a signed-in account. |
| `src/components/auth/create-workspace-form.tsx` | `account` prop turns step 1 into account context; custom back/submit labels. |
| `src/components/layout/app-shell.tsx` | `/workspaces/new` is an account-level path. |
| `tests/test-multi-workspace.mts` | Updated for passwordless entry; creation, ownership, safe failure and bootstrap protection added. |

## 9. Tests

Isolated temporary databases, mocked provider requests, no real calls. The live
database's timestamp was checked as unchanged after every run.

| Suite | Result |
| --- | --- |
| `test-multi-workspace` | **90/90** |
| `test-customer-name` | 64/64 |
| `test-provider-editing` | 103/103 |
| `test-snippet-import` | 59/59 |
| `test-batch-campaign` | 71/71 |
| `test-multitenant` | 69/69 |
| `test-hook` | 20/20 |
| `test-workspace` | 17/17 |
| Browser walk of the whole flow | **27/27** |

`tsc` clean, `eslint` clean, `next build` compiles.

All twenty listed items are covered. The browser walk is the one that answers
the complaints directly: it signs in with a real password, lands on the
selector, opens TenWeb **without being asked for a password**, switches to the
other workspace from the sidebar **without being asked again**, clicks Create
New Workspace and reaches the wizard rather than the login page, finds it asking
for no second email or password, completes it, lands in the new workspace, and
finds it listed in the selector afterwards with its own company profile and its
own provider configuration — not TenWeb's.

It ran against a **copy** of the live database on a separate port.

## 10. Existing data

Untouched, verified after the work:

- Workspaces: AvinyeaConnect, Avinyeaconnect1 — same ids
- Accounts: both, same passwords, same memberships
- 15 leads, 26 calls, 34 memory items, 1 campaign, 16 follow-ups
- Provider configs: `Conversatio-834500dd-d3c1 v4` and `2nd-workspa-4613bf8b-a9ba v2`
- Inbound deployment `Dialo-AI-fd26d0df-ceb7`, still enabled
- No QA artefact reached the live database

The Sarvam architecture is unchanged: one organisation, one Sarvam workspace,
one shared key, several agents. **No real phone call was placed and no live
Sarvam agent, version or deployment was modified.**

## 11. Remaining limitations

1. **Inviting other people is still not built.** The model has roles and
   revocation; there is no invitation flow, so each workspace has one member.
2. **The Account Center still does not list workspaces.** The selector does,
   reachable from the sidebar switcher.
3. **The switcher is a link to the selector**, not an inline dropdown. It takes
   one extra page, which also makes "which company am I in" explicit.
4. **One process per database.** Unchanged.
