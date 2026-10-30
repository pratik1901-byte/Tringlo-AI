# One account, many workspaces

Refactor of login, signup and workspace access. The account is now the
authentication identity; the workspace remains the data boundary.

---

## 1. The audit, as it stood

**Existing account model.** `User { id, tenantId, email, name, passwordHash,
role, … }`. One row per person, with `tenantId` pinning that person to exactly
one workspace.

**Existing workspace model.** `Tenant { id, name, createdAt }`, with every
business record carrying a `tenantId` — leads, calls, campaigns, customers,
memory, provider configs, inbound settings, webhook logs.

**How ownership was represented.** Only by `User.tenantId`. There was no
membership concept, no role per workspace, and no way to express "this person
may open that workspace".

**How the active workspace was selected.** It was not. `requireAuth` ended with
`tenantId: user.tenantId` — one line, in `src/lib/auth/guard.ts`. `Session`
already carried a `tenantId` field, but nothing read it for scoping.

**What enforced one workspace per account.** Two places, and only two:

1. `guard.ts` — the line above.
2. `bootstrap/route.ts` — `if (findUserByEmail(email)) return 409 email_taken`,
   which made a second workspace for the same person impossible.

This was the happy finding: because every one of the ~60 protected routes
already takes `auth.tenantId` and filters by it, changing *what that resolves
to* makes the whole application multi-workspace without touching the routes.

**Proposed migration.** Add a membership collection; give every existing user a
membership in the workspace already on their record; read the active workspace
from the session, checked against a membership on every request.

**Risks identified.** Three, all now handled: existing sessions must keep
working (they do — their `tenantId` is the workspace the migration grants);
`deleteTenant` deleted users by `tenantId` and would have deleted an account
that owns other workspaces (fixed); and a stale client cache could show the
previous workspace after a switch (cleared on entry).

---

## 2. The new model

```
User Account ──┬── Membership(owner) ── TenWeb
               ├── Membership(owner) ── BrightPath Logistics
               └── Membership(owner) ── AvinyeaConnect
```

```ts
WorkspaceMembership {
  id, userId, tenantId,
  role: "owner" | "admin" | "member",
  status: "active" | "revoked",
  createdAt, createdBy, lastAccessedAt
}
```

Stored in the existing JSON database as a `memberships` collection — no new
database technology. `grantMembership` is idempotent on `(userId, tenantId)`,
so the same person cannot be added to the same workspace twice. `User.tenantId`
is kept as the record of where an account began; it no longer grants anything.

## 3. Signup

A new account still signs up with name, email and password, and the password
policy, hashing and email verification are untouched. Creating the first
workspace now also records a membership, with the creator as owner.

An **already authenticated** account creating another workspace reuses that
account: same id, same email, same password hash. The duplicate-email 409 now
fires only when the email belongs to a *different* account. The new workspace
gets its own tenant, its own provider configuration and its own profile —
nothing is copied from an existing one — and the session opens it on success.

## 4. Login

Signing in authenticates the account and returns the workspaces it may open.
The session is created with **no workspace open** when there is a choice to
make, and with the single workspace already open when there is not. One
workspace goes straight to the dashboard; several go to the selector.

## 5. The workspace selector

`/workspaces` — "Choose your workspace". Each card shows the company name,
generated initials, industry where known, the caller's role, and when it was
last opened. Search appears above four workspaces. The page also carries the
account's name and email, sign out, and **Create new workspace**.

It lists only workspaces with an active membership. A workspace the account
cannot open is not named, not counted, and its id does not appear in the
payload.

## 6. Confirming access

Selecting a workspace asks for the **account** password. There is no workspace
password, no second credential and nothing per-workspace stored to check
against — `POST /api/workspaces/{id}/enter` re-verifies the account with the
existing `verifyPassword`, then checks the membership, then moves the session.

The password is verified even when the membership is missing, and both
failures return the same 401 and the same words — "That did not work. Check
your password and try again." — so this cannot be used to discover which
workspaces exist. Attempts are rate-limited per account (10 per 5 minutes). No
password material is returned to the client.

## 7. Switching

The sidebar carries a workspace switcher showing the open workspace and leading
to the selector. Switching requires the same confirmation, verifies membership
server-side, moves the session, clears browser-held workspace state, refreshes
the account state and navigates to the new workspace's dashboard. Subsequent
API requests resolve to the new workspace because `requireAuth` reads it from
the session each time.

## 8. Authorization

```
Authenticated account → active membership → resource.tenantId matches → allow
```

`requireAuth` now resolves the workspace from the session and **re-checks the
membership on every request**. A session holding a workspace the account does
not belong to is refused outright: there is no fallback to a default workspace
and none to `user.tenantId`. A client-supplied workspace id is worth nothing
until `findMembership` returns it. `requireAuthAccount` exists for the two
places that must work before a workspace is open — listing workspaces and
opening one.

## 9. Isolation

Unchanged, and re-verified: every business collection is still scoped by
`tenantId`, and switching changes which one. Each workspace keeps its own
provider configuration, Sarvam agent and version, inbound deployment, webhook
token, customers, memory and campaigns. The Sarvam architecture is untouched —
one organisation, one Sarvam workspace, one shared key, several agents.

## 10. Migration

Runs at startup through the existing idempotent `runStartupMigrations`, and
**has been run against the live database**:

```
MIGRATED_MEMBERSHIPS granted=2 existing=0

pratikg2309@gmail.com    → AvinyeaConnect   owner  active
gaonkarppg2512@gmail.com → Avinyeaconnect1  owner  active
```

Each account received exactly the workspace already on its record — the access
it already had, written down. No workspace was recreated, no password reset, no
record reassigned, and nobody was granted access to a workspace they could not
already reach. Running it again grants nothing. An account whose workspace is
missing is reported and skipped rather than guessed at.

Live data after migration: 2 workspaces, 2 accounts, 15 leads, 26 calls, 34
memory items, 1 campaign, both provider configurations intact
(`Conversatio-834500dd-d3c1` and `2nd-workspa-4613bf8b-a9ba`), both sessions
still valid. A backup was taken first.

## 11. Files changed

| File | Change |
| --- | --- |
| `src/lib/types.ts` | `WorkspaceMembership`. |
| `src/lib/db/index.ts` | `memberships` collection; `grantMembership`, `findMembership`, `membershipsForUser`, `membershipsForTenant`, `touchMembership`, `setSessionTenant`, `migrateMemberships`; `deleteTenant` made safe for accounts owning several workspaces. |
| `src/lib/db/migrations.ts` | Runs the membership migration at startup. |
| `src/lib/auth/guard.ts` | Split into `requireAuthAccount` (identity) and `requireAuth` (identity + verified workspace); `AuthSuccess` gained `role`; new `no_workspace` rejection; `toPublicUser` reports the open workspace. |
| `src/app/api/auth/login/route.ts` | Returns the account's workspaces; opens one only when there is one. |
| `src/app/api/auth/me/route.ts` | Account-level, so an account with no workspace open is not mistaken for signed out. |
| `src/app/api/auth/bootstrap/route.ts` | An authenticated account may add workspaces; reuses the account; grants ownership; opens the new workspace. |
| `src/app/api/workspaces/route.ts` (new) | Lists only authorised workspaces. |
| `src/app/api/workspaces/[id]/enter/route.ts` (new) | Password confirmation, membership check, session switch. |
| `src/app/workspaces/page.tsx` (new) | The selector. |
| `src/components/layout/app-shell.tsx` | Renders the selector without workspace chrome; routes there when none is open. |
| `src/components/layout/sidebar.tsx` | Workspace switcher. |
| `src/lib/store.ts`, `src/lib/use-dialo-data.ts` | Track the open workspace; a `no_workspace` 401 sends to the selector rather than signing out. |
| `src/app/login/page.tsx` | Routes by workspace count. |
| `tests/test-multi-workspace.mts` (new) | 68 checks. |
| `tests/test-{multitenant,workspace,provider-editing}.mts` | Fixtures grant the membership they imply. |

## 12. Tests

Isolated temporary databases, mocked provider requests, no real calls. The live
database's timestamp was checked as unchanged after every run.

| Suite | Result |
| --- | --- |
| `test-multi-workspace` (new) | **68/68** |
| `test-customer-name` | 64/64 |
| `test-provider-editing` | 103/103 |
| `test-snippet-import` | 59/59 |
| `test-batch-campaign` | 71/71 |
| `test-multitenant` | 69/69 |
| `test-hook` | 20/20 |
| `test-workspace` | 17/17 |
| Browser walk of the selector | **15/15** |

`tsc` clean, `eslint` clean (two pre-existing warnings), `next build` compiles.

All twenty listed items are covered: one account creating several workspaces;
no duplicated email or membership; the password staying account-level; the
creator becoming owner; the selector listing all and only authorised
workspaces; selection verifying membership; confirmation using account
authentication; entry refused without membership; a modified workspace id
getting nowhere; switching changing the server-side context; API requests
following the selected workspace; memory and RAG staying isolated; TenWeb's and
BrightPath's settings and data unchanged; existing sessions and passwords still
working; workspace ids and records intact; unauthenticated requests refused;
invalid passwords rejected; repeated failures rate-limited; no provider secret
reaching the browser.

The browser walk drove the real page against a **copy** of the live database on
a separate port: the selector listed both workspaces by company name with role
and industry, a wrong password was refused generically and opened nothing, the
correct one opened the chosen workspace and landed on its dashboard, and the
sidebar named it. No webhook token or password hash appeared in the page.

## 13. Two bugs this work found and fixed

**`/api/auth/me` required a workspace.** With none open, the app concluded the
person was signed out and bounced them to the login page — they could never
reach the selector. It is now account-level.

**The selector navigated before refreshing account state**, so the shell still
believed no workspace was open and sent the person straight back. It now
re-asks the server before leaving.

Both were caught by driving the real UI, not by the unit suites.

## 14. Remaining limitations

1. **Inviting other people to a workspace is not built.** The model supports
   it — `role` has `admin` and `member`, `status` has `revoked` — but there is
   no invitation flow, so in practice each workspace still has one member.
2. **The account page does not yet list accessible workspaces.** The selector
   does, and is reachable from the sidebar; the Account Center still shows
   name, email and password only.
3. **Confirmation is asked on every entry**, with no "recently confirmed"
   window. Safe, but it will feel repetitive for someone switching often.
4. **Creating a workspace while signed in still opens the three-step wizard
   via `/login?mode=signup`**, which asks for account details it then ignores
   in favour of the signed-in account. It works, but the first step is
   redundant for an authenticated user and deserves tightening.
5. **One process per database.** Unchanged.

## 15. A note on the brief

Section 11 asks that the **Dummy** workspace remain an independent workspace.
It no longer exists: you asked me to delete it yesterday as a test workspace,
and it was removed then, with backups. I have not recreated it. TenWeb,
BrightPath and their configurations are untouched.

No real phone call was placed, no Sarvam agent prompt or version was changed,
and no live deployment was modified.
