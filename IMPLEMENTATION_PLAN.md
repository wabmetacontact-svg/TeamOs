# Implementation Plan — Unified Operations Platform

Sep 29, 2026 · Companion to the PRD, the System Architecture document, and the Idea/Problem/Solution note.

Those three say **what** to build, **how** it is structured, and **why** it is worth doing. This one says **in what order, with what checked at each step, and what has to be decided before anyone writes a line.**

---

## 1. What the three documents actually commit to

Stripped to the load-bearing claims:

| | Commitment |
|---|---|
| **Isolation** | Multi-tenant from line one. `tenant_id` on every table, Postgres RLS enforcing it, app role without `BYPASSRLS`. |
| **Access** | Permissions are data (`resource:action`), roles are seed data, **scope is a separate axis** from role. Enforced in the query, three layers deep, never in the interface. |
| **Spine** | Client and person each exist once. Expenses, tasks, relationships and contacts all hang off them. |
| **Money** | `BIGINT` minor units + `CHAR(3)`. `amount_base` written once, never recomputed. Book months that can be closed and reopened, with the reopening logged. |
| **History** | Append-only audit log with no UPDATE/DELETE grant. Every financial create/update/delete attributed. |
| **Shape** | One release, seven build stages, nothing live until all of it is. |
| **Stack** | React+Vite SPA, NestJS API, Postgres 16, Prisma, Redis+BullMQ, S3, self-hosted JWT, Mumbai region. |

Everything below serves those seven. Where I propose deviating, I say so explicitly and give the reason.

---

## 2. Where the documents disagree or leave a hole

This is the part worth reading twice. Each of these costs real money if it surfaces mid-build instead of now.

**a. Tasks ship in v1, but the migration table says they wait for v2.**
PRD build order puts Tasks at stage 5, in this release. The migration table says *"Task Tracker sheet → Tasks wait for the task module in v2."* Both cannot be true. My read: the **module** ships in v1, the **historical task rows** do not migrate — only team members, brands and sub-tags come across, and the team starts fresh in the new tool. That is defensible (task history has little value after the fact, unlike financial history) but it must be stated, because "tasks are in v1" and "task data is not migrating" will otherwise be discovered by somebody on launch day.

**b. Income is an open question, but the rest of the documents assume it.**
The Idea note says *"every rupee."* MonthBook tracked income. The PRD's open questions ask whether income is in scope at all, and every dashboard view listed is spend-only. This is the single decision with the widest schema blast radius — it changes whether the core table is `expenses` or a signed `transactions` ledger. Decide it before stage 4, ideally before stage 1. **My recommendation: one ledger with a `direction` (in/out).** You already run USDT income through ARC3; excluding it means the platform cannot answer "what is the net position this month", which is the question a founder actually asks.

**c. Payroll is unresolved and it is not a small flag.**
Profit-share is explicitly *"a share of client payments rather than a fixed monthly amount"* — that is a calculation over the ledger, not a category on it. If payroll is in v1, it is a module with its own schema (salary schedules, payout runs, share rules). If it is not, salaries are just expenses in the Salary category, which is what the current tool does and it works. **Recommendation: salaries as expenses in v1, profit-share as a v2 module.** Say no now rather than half-building it.

**d. Exchange rates: the document asks, and the answer shapes an integrity guarantee.**
The architecture already settles the hard part — the rate is stored on the record and the base amount is never recomputed. So the only open question is where the number comes from at entry time. **Recommendation: manual entry, with the last-used rate per currency pre-filled.** A rates API is a dependency, a failure mode and a cost for something a person types four times a month. Add it later behind the same field.

**e. Materialised views are specified before a performance problem exists.**
The architecture calls for materialised views per client per month, refreshed by a queued job, and then names the thing that breaks first: *aggregate refresh under concurrent writes.* At your volume — a few hundred expense rows a month, four users — an indexed query over the expense table returns in single-digit milliseconds. **Recommendation: build the aggregate behind a service interface, implement it as a direct query, and swap in materialised views when a measurement says to.** The interface is the part that matters; shipping the cache now buys a lag bug and nothing else. The 1.5s target should be a test in CI, not a design assumption.

**f. Virus scanning, WhatsApp and TOTP are three different sizes of work, listed as one line each.**
- TOTP 2FA for Owner/Admin: a day, worth it, keep it.
- WhatsApp notifications: needs a provider account and business verification — **a long-lead item, start the application in week one or cut it to email + in-app for v1.**
- Virus scanning uploads: meaningful ops (ClamAV container or a paid API) to protect four people uploading their own receipts. **Recommendation: enforce type and size server-side in v1, defer scanning**, and revisit if anyone outside the team ever uploads.

**g. "One release, no feedback until the end" is named as risk #2 and then adopted anyway.**
I would not argue with shipping one release. I would argue with *not using it until then.* The plan below keeps the single-release commitment but puts a **usable internal checkpoint at the end of every stage** — you personally enter real data into that module on staging the week it is finished. Same release date, and design mistakes surface in week 3 instead of week 14. This is the cheapest risk reduction available in this whole document.

**h. Smaller holes worth a sentence each.**
- No rule for what happens to open tasks when their client is archived. (Proposal: tasks stay, client shows archived, new tasks blocked.)
- Recurring expenses generate into Draft — unstated whether they generate into a *closed* month. (Proposal: skip and flag, never write to a closed month.)
- Timestamps are UTC with day-precision comparisons for lateness. Lateness *must* compare dates in the tenant's timezone or a task due "today" goes late at 05:30 IST. Small detail, guaranteed bug if missed.
- Success criteria include response-time targets with no measurement harness specified.

---

## 3. Decisions needed before stage 1

| # | Decision | Recommendation | Cost if decided late |
|---|---|---|---|
| 1 | **Stack: NestJS + React SPA, or Next.js full-stack?** | See §4 — genuine fork, your call | Total rewrite of everything built |
| 2 | Income tracked, or expenses only? | One ledger with direction | Core table reshaped, every query and dashboard touched |
| 3 | Payroll / profit-share in v1? | No — salaries are expenses; profit-share v2 | A module's worth of schema |
| 4 | Approval workflow on or off at launch? | Ship the machinery, default **off**, threshold configurable | Cheap either way — it is already a switch |
| 5 | Exchange rate source | Manual with last-used prefill | Cheap — same field either way |
| 6 | Does anyone besides you hold Finance? | — | Affects seed data only |
| 7 | Hosting provider and region | See §7 | Blocks infra work, not application work |
| 8 | Tasks history: migrate or start fresh? | Start fresh, migrate people/brands only | Migration scope |
| 9 | WhatsApp in v1? | Only if the provider application starts this week | Deadline risk at the end |

Items 2, 3 and 8 change the schema. They need answers before stage 1 is finished, not before stage 4.

---

## 4. The stack fork

The architecture document picks NestJS + a React SPA and defends it well: guards, interceptors and DI are the right primitives for permission enforcement, and the structure comes from the framework rather than from discipline. That reasoning is sound.

There is a second option worth putting next to it honestly, because a working Next.js app with the same aesthetic, the same Prisma/Postgres layer and the same money handling already exists in this repository.

| | **A — NestJS API + React SPA** (as documented) | **B — Next.js full-stack, REST under `/api/v1`** |
|---|---|---|
| Permission enforcement | Route decorators + guard; unannotated route fails closed | A `withPermission()` wrapper around every handler; ~200 lines we write once, same fail-closed property, but it is *our* discipline rather than the framework's |
| API contract | First-class, OpenAPI generated from decorators | Same routes, same OpenAPI — but server components can read the database directly, so the contract needs a rule to stop that drift |
| Codebases / deploys | Two | One |
| Reuse of what exists | UI kit and domain logic only | UI kit, domain logic, auth, money, recurrence, export, deploy pipeline |
| Hiring a backend dev later | Conventional, well-trodden | Also common, but blurs the front/back split |
| Time to stage 1 complete | Slower — two scaffolds, two deploys, CORS, token handling | Faster |

**My recommendation: B, with one rule enforced from day one — every database read and write goes through a module service that takes the scope object; no page or server component touches Prisma directly.** That rule is what NestJS gives you structurally, and it is enforceable in code review and lint without the second codebase.

**But this is your call, and there is a real argument for A**: if you expect to hand this to a hired backend developer within a year, or if integrations (not just your frontend) are a near-term plan, the separation the documents chose pays for itself. Pick A and I will build A — the plan below is stage-for-stage identical either way, only the scaffolding in stage 0 changes.

What does **not** change with this decision: Postgres with RLS, Prisma, the schema, the scope helper, the audit interceptor, minor-unit money, the migration, and every acceptance gate below.

---

## 5. What exists today, and what survives

The current app in this repository (54 files, 6 models, live and working) was built from the earlier simpler brief. Against the new documents it is a prototype — but not a wasted one.

| Survives largely intact | Rewritten | Deleted |
|---|---|---|
| Money in integer minor units, USDT→INR conversion | Auth (needs refresh tokens, TOTP, invite links, revocation) | Two-role RBAC (`MANAGER`/`MEMBER`) |
| Task recurrence anchored to due date, duplicate-guarded | Schema — every table gains `tenant_id` and RLS | Direct-Prisma page queries |
| Days-late vs days-overdue, the distinction and the labels | Ledger — gains book months, approvals, attachments, multi-currency columns | |
| UI kit: light SaaS aesthetic, cards, tables + mobile card layouts, forms | Clients — gains brands, contacts, custom fields, versioning | |
| CSV export shape, BOM handling, rupees-as-numbers | Dashboards — gain scope filtering and an aggregate service | |
| Deploy pipeline and Postgres/Neon setup | | |

Roughly a third of the logic transfers; none of the schema does. That is the normal ratio when a prototype meets a real specification, and it is the reason the prototype was worth building — the domain questions (how recurrence anchors, how a salary becomes an expense, what "late" means) are answered and tested.

**Recommendation: keep the current app running as the team's interim tool.** It works today. The new platform is built alongside it in a new repository, and the documents' own parallel-month plan applies: nothing is switched off until the new platform has run a full month.

---

## 6. Build plan

Eight stages. Each ends with an **acceptance gate** — a specific thing that must be demonstrably true before the next stage starts. The gates are the point; without them "done" is a feeling.

### Stage 0 — Foundation *(the stage most likely to be rushed, and the most expensive to get wrong)*

Repository, CI, Docker Compose for local Postgres and Redis, staging environment, schema test that fails any table lacking `tenant_id` + FK + RLS policy.

- `tenants`, `users`, `roles`, `permissions`, `role_permissions`, `user_client_scope`
- JWT access (15 min) + refresh (7 days, hashed, rotating, reuse invalidates the family)
- Argon2id, rate limiting per account and per IP, TOTP for Owner/Admin
- Invite flow: single-use link, 72 hours, invitee sets their own password
- The permission guard, the scope helper, the audit interceptor, the RLS transaction setting
- Seed: five default roles with their permission sets

**Acceptance gate.** A test suite proves: (1) a request with tenant A's token cannot read tenant B's row *even with the tenant filter deliberately removed from the query* — RLS catches it; (2) an un-annotated route returns 403, not 200; (3) a revoked session fails on the next request, not the next login; (4) a role change takes effect within 60 seconds; (5) out-of-scope and non-existent both return an identical 404 body.

Until that suite is green, nothing else gets built. Every later module inherits this or inherits nothing.

### Stage 1 — Clients, brands, contacts
Brands, clients, sub-tags, `client_contacts`, typed custom fields in JSONB validated against brand definitions, versioned change history, assignment-grants-scope.

**Gate.** A Manager scoped to two clients cannot retrieve a third through the list endpoint, a direct ID fetch, search, or an export — four routes, same denial. Deleting a client with financial records is refused; archiving succeeds and preserves history.

### Stage 2 — Relationships
`people` with dedupe on `(tenant_id, lower(email))`, `contexts`, `pipeline_stages`, `relationships` (unique per person per context), `activities`, stage-change history, the awareness-without-access banner.

**Gate.** One person holds an Investor and a KOL relationship simultaneously, each with its own owner and stage. A user scoped out of Investor sees the banner and cannot retrieve the underlying record through any route.

**Stage 3 — in progress.** Foundation and gate are done; the screens are not.

| Done | |
|---|---|
| Money | `lib/money.ts` — BigInt minor units throughout, string-based half-up rounding, zero-decimal currencies, Indian grouping. No float touches an amount at any point. |
| Ledger reads | `lib/transactions.ts` — one `transactionWhere`, per-client-per-month totals built only from `amountBase` |
| Writes | Create, edit, submit, approve/reject, soft delete, restore. Editing an approved row that changes the money sends it back to the queue — an approval that refers to figures nobody approved is not an approval. |
| Book months | Close and reopen. Closing records the totals as they stood, so there is something to compare against when somebody asks why a number moved. Closing over unapproved rows warns and names them. |
| The trigger | `closed_month_guard` — refuses insert, edit, month-move and soft-delete on a closed client-month, plus attachments to one. With an `app.allow_closed_month_write` escape for offboarding only. |
| Gate | **20 ledger tests green**, 153 in the suite |

All four gate proofs are met except the CSV half of reconciliation, which needs the importer:

| The plan asked for | Proved by |
|---|---|
| Per-client per-month totals match exactly | `ledger.test.ts` — a realistic February across two clients, income and spend, with a draft that must stay out |
| A write to a closed month is refused **by the database trigger** | `ledger.test.ts` — five writes straight to Postgres, bypassing every application check, each refused. Owner credentials alone do not open it. |
| An approved expense edited writes a before/after audit entry | `updated_after_approval`, with both snapshots |
| A rate change today does not move last month's figures | `ledger.test.ts` — $1,000 at 83.50 in August, at 89.00 in September; August is byte-identical afterwards |

**Stage 3 is complete.** The four that were outstanding:

*Screens* — `/ledger` (month view with totals, filters held in the URL, category breakdown), `/ledger/[id]` (entry, receipts, history), `/ledger/approvals` (oldest first, because the cost of a queue is the person waiting on it), `/ledger/months` (close and reopen per client).

*CSV import* at `/ledger/import` — a hand-written parser, because `split(",")` breaks on the first row with a quoted comma and financial data is full of them. Column mapping is guessed and shown for correction, never applied silently: a column read wrong is every row read wrong. The preview validates every row before any row is written and shows the two totals to check against the bottom of the sheet. The commit is one transaction — a half-imported month is worse than a failed import, because the failure is visible and the half is not. An import by someone who cannot approve arrives as drafts, so it cannot be used to skip the queue.

*Attachments* — S3-compatible, signed per request, five-minute expiry, uploaded browser-to-bucket. The signing is ~60 lines here rather than 15 MB of SDK. The row is written on confirmation, not on handing out the URL: an abandoned upload leaves a file nobody references, which is much better than a row pointing at a file that does not exist. Unconfigured, the panel says so and everything else works.

*Recurring* — rules produce a **Draft**, never an approved entry. A subscription whose price changed, or one cancelled last month, would otherwise keep appearing at the old figure until the year-end. Runs are idempotent per rule per month, so the button and a future cron can both fire twice without doubling anybody's rent.

**What this stage's build caught.** `tsc` and the tests were both green while two client components imported constants from `lib/transactions.ts`, which is `server-only` — that pulls the whole query module into the browser bundle. Only `next build` sees it. The fix is `lib/ledger-enums.ts`: anything both sides need lives in a file that is not server-only, so the boundary is enforced by where things are rather than by remembering. This is the third time in this project that a real defect was invisible to the type checker; the first two were scope filters that did not apply.

### Stage 3 — Expenses *(the heaviest module — budget accordingly)*
The full record, two-level category tree, `book_months` with a close trigger, configurable approval, recurring rules into Draft, CSV import with column mapping and a preview, attachments to S3 behind signed URLs, soft delete.

**Gate.** Reconciliation: a CSV of last month's real MonthBook data imports, and per-client per-month totals match the sheet **exactly**. A write to a closed month is refused by the database trigger, not only by the application. An approved expense edited writes a before/after audit entry. A rate change today does not move last month's figures.

**Stage 4 is complete.**

| Done | |
|---|---|
| Rules | `lib/task-rules.ts` — lateness, recurrence and overdue as pure date arithmetic, testable without a database |
| Reads | `lib/tasks.ts` — one `taskWhere`; a task with no client is visible to a scoped Manager, a private one only to its own people |
| Writes | Create, edit, status transitions with history, complete, verify, reassign, soft delete |
| Screens | `/tasks` with "my day" and everything, `/tasks/[id]` with the full history |
| Gate | **26 task tests green**, 230 in the suite |

| The plan asked for | Proved by |
|---|---|
| Completing late records the lateness | `tasks.test.ts` — due the 20th, completed the 27th, is seven days |
| …**and** schedules the next occurrence on the 21st, not the 28th | the same test, asserting both that it is the 21st and that it is not the 28th |
| Completing twice creates one task, not two | `nextCreated`, set in the same transaction as the successor |
| A task cannot be verified by whoever completed it | `verifyTask` refuses the assignee and whoever pressed complete; the button is not rendered for them either |

**Two things worth recording.**

The plan's prose said "records 3 days late" for a task due on the 20th completed on the 27th, which is seven. That number was mis-transcribed from the source document. The rule implemented is the general one — whole days between the two calendar dates, in the tenant's timezone, never negative — and finishing early is on time rather than negative days late, because a negative would make every team average meaningless.

**What this stage's gate caught.** Due dates were stored at midday UTC, on the reasoning that midday is the same calendar day everywhere. It is not: timezones run from UTC−12 to UTC+14, a 26-hour span, so no instant is the same date worldwide. Midday UTC reads as the *next* day in Auckland, which would have put every due date in a New Zealand workspace one day out — and nothing in the application would have said so. Due dates are now stored at midday *in the tenant's own timezone*, and the test asserts the round-trip for six zones including both extremes.

### Stage 4 — Tasks
Assignment, estimates required on creation and completion, five statuses with full history, date-only lateness in the tenant timezone, daily/weekly recurrence generating one occurrence forward, verification, private tasks, calendar and list views with Indian holidays.

**Gate.** Completing a task due on the 20th on the 27th records 3 days late **and** schedules the next occurrence on the 21st, not the 28th. Running the completion twice creates one task, not two.

**Stage 5 is complete.**

| Done | |
|---|---|
| Aggregate service | `lib/dashboard.ts` — five views, each taking a Scope, composed by *reach* rather than by role name so a renamed or invented role still gets the right thing |
| Dashboard | `/dashboard` — money with month-on-month, category breakdown, per client, who is carrying what, pipelines, stale relationships, an as-of stamp |
| Export | `/api/ledger/export` — streamed, keyset-paginated, formula-injection guarded, with a hard cap that explains itself |
| Gate | **15 dashboard tests and 8 export tests green**, 253 in the suite |

| The plan asked for | Proved by |
|---|---|
| Two users see different totals for the same month, both provably correct | `dashboard.test.ts` — the figures are written out by hand in the fixture, and the test asserts the difference between the two views is *exactly* the third client |
| Dashboard p95 under 1.5s | asserted against a budget derived from the measured round trip; see below |
| A 10,000-row export under 30s | `export.test.ts` builds a real 10,000-row month and pages through all of it |

**Two measurements that changed the code.**

The obvious optimisation was one transaction for the whole dashboard instead of twenty per-query ones. Measured, it was **nearly twice as slow**: queries inside an interactive transaction share a connection and stop running in parallel. From this laptop to Neon in Singapore, twenty trivial queries cost 750 ms in parallel and 1,485 ms in sequence. The views run in parallel, and there is a test asserting parallel beats serial so nobody re-applies the optimisation.

The 1.5s wall-clock budget, taken literally, measures the *network*: the median round trip from here is 74 ms, so twenty parallel queries cost ~750 ms before a row is read, while a Vercel function in Neon's region sees 1–3 ms. The test therefore asserts a budget of forty round trips — the thing this code controls, and the same number wherever it runs — and applies the literal 1.5s only when the round trip is under 10 ms. That is stricter than a hard-coded number, not looser: it fails if somebody puts a query inside a loop, which a generous absolute budget would hide.

**One deviation, stated.** The plan asks for "async exports above a row threshold". Async means a queue, a worker and somewhere to put the file — three pieces of infrastructure this deployment does not have. Streaming solves the same problem (flat memory, bytes immediately) with none of the parts, and the export is capped with a message rather than dying halfway and leaving a truncated file nobody can tell is truncated. If exports ever need to outlive a request, the queue goes in then.

### Stage 5 — Dashboards, reporting, exports
The five core views, per-role composition, filters persisted per user, aggregate service (direct queries behind the interface), async exports above a row threshold, as-of timestamps.

**Gate.** Two users legitimately see different totals for the same month, and both are provably correct against a hand-computed figure. Dashboard p95 under 1.5s and a 10,000-row export under 30s, measured by a test, not by feel.

**Stage 6 is complete.**

| Done | |
|---|---|
| Audit search | `lib/audit.ts` + `/audit` — filter by who, what, which resource and when; every entry expands to show what changed |
| Notifications | `lib/notifications.ts` — queue, widening retry, per-user channel preferences, a bell rendered from the layout rather than polled |
| Search | `lib/search.ts` + `/search` — five entity types, one box, every branch reusing its own module's scope fragment |
| Gate | **18 audit tests, 19 notification tests, 12 search tests green**, 302 in the suite |

**The audit gate, and why it was answered differently.** The plan says to verify coverage "by replaying the test suite and asserting the log's row count". Taken literally that counts the *harness*: most suites build fixtures through the raw client, not through `defineAction`, so the rows would be mostly setup. What answers the question properly is stricter — read the source of every action and assert that each one which writes also audits, that each entry names a resource type and id, and that anything changing an existing row records a `before` as well as an `after`. A missing audit entry is invisible by nature: nothing errors, nothing looks wrong, and the change simply is not there when somebody asks in six months. This fails the gate before it can become that.

Writing it surfaced the limit of reading source, too. The first version keyed off permission names and flagged three reads that sit behind write permissions (`previewImport`, `mergePreview`, `requestUploadUrl`) and six creations under `edit` permissions. Detecting real writes from the body fixed most of it; the five that remain are an update or delete incidental to a creation, and each is an entry in a five-line allowlist with the reason written beside it. It also found one genuine gap: `closeBookMonth` recorded no `before`, so a month that had been explicitly reopened and one that had never been touched closed identically in the log.

**The notification rule, in one sentence.** A notification that cannot be delivered must not undo the thing it was about. An expense was approved; whether the email provider is up has nothing to do with that. `notify` never throws, delivery is a separate pass, and one bad address marks one row failed while the rest go — because a loop that throws on the first bad recipient is how one wrong email address stops a whole workspace's notifications.

**One bug the tests found.** `unreadCount` counted in-app rows; `markRead` marked every channel, including email. `readAt` on an email row is a claim nothing here can make — nothing knows whether an inbox was opened — and the badge and the clear-all disagreed by exactly the email rows.

**Two boundary bugs the type checker and the build both missed.**

Three constants were exported from `"use server"` modules — `BRAND_COLORS`, `CLIENT_STATUSES`, `ACTIVITY_TYPES`. Such a module may export only async functions; anything else becomes a server-action reference at build time, so a client component importing it gets a function-shaped stub. `tsc` sees the declared type and is satisfied, `next build` succeeds, and the page throws `X.map is not a function` in the browser. Only one of the three had ever been clicked. They now live in `lib/ui-enums.ts`, and `tests/module-boundaries.test.ts` reads the source and fails if a `"use server"` module exports a value or a `"use client"` module imports a `server-only` one.

And the suite itself turned out to be flaky for a reason unrelated to the code: run beside `next dev`, it failed six tests and took 79 minutes instead of 5. The dev server holds a Prisma pool, Neon's free tier caps connections, and the suite starved itself — every failure was a timeout wearing a different hat. `tests/support/setup.ts` now bounds the suite's pool and lets it wait rather than fail. That kind of flakiness is worth fixing rather than re-running: a suite that fails for the wrong reason is one people stop reading.

### Stage 6 — Audit, notifications, search
Audit search UI, notification queue with retry and per-user channel preferences, cross-entity scoped search.

**Gate.** Every mutation from stages 1–5 appears in the audit log with actor, before and after — verified by replaying the test suite and asserting the log's row count and content. A failing notification provider does not block the action that triggered it.

### Stage 7 — Migration and cutover
Import scripts, the unplaceable-row report, reconciliation, parallel running.

**Gate.** Totals per client per month match the source sheets exactly. Historical expenses import as Approved **flagged as inferred**. One full month runs in parallel with the new platform as the system of record before the sheets go read-only.

---

## 7. Infrastructure sequence

Provision only when a stage needs it, so nothing is paid for or maintained before it earns its place.

| Needed by | What | Note |
|---|---|---|
| Stage 0 | Postgres 16 (managed, Mumbai), staging + production | The one non-negotiable spend |
| Stage 0 | CI: lint, typecheck, tests against throwaway Postgres | Includes the RLS schema test |
| Stage 3 | S3-compatible object storage | Receipts; signed URLs only |
| Stage 5 | Redis | Async exports first, cache second |
| Stage 6 | Email provider; WhatsApp **only if** the account was applied for in week one | |
| Pre-launch | Penetration test, backup restore rehearsal | An untested backup is not a backup |

On provider: the architecture says *"containers on a managed platform, Mumbai region."* Railway, Render and Fly all qualify; a managed Postgres in `ap-south-1` plus containers is the shape. The $60–120/month estimate is realistic and is dominated by the database. Decide the provider before stage 0 ends, because CI deploy targets depend on it.

---

## 8. Honest sizing

Assuming I build it with you reviewing between stages:

| Stage | Sessions | Notes |
|---|---|---|
| 0 Foundation | 5–7 | The security suite is most of it |
| 1 Clients | 3–4 | |
| 2 Relationships | 3–4 | |
| 3 Expenses | 7–9 | Import, attachments and close logic each cost more than they look |
| 4 Tasks | 4–5 | Most logic already proven in the prototype |
| 5 Dashboards | 3–4 | |
| 6 Audit, notifications, search | 3–4 | |
| 7 Migration | 2–3 | Plus a calendar month of parallel running |
| **Total** | **30–40 sessions** | |

At a few sessions a week that is **roughly 3 months to cutover**, of which the last month is parallel running. Intensive, it compresses to 5–6 weeks of building plus the parallel month. Treat these as budgets to test against, not predictions — the same standard the architecture document applies to its own latency targets.

The number that should worry you is not the total; it is stage 3. Expense import against inconsistent sheet data is where estimates go wrong, and the architecture document says so too.

---

## 9. Risks, and what in this plan actually addresses them

| Risk (from the Idea note) | What this plan does about it |
|---|---|
| Five modules, one release, no feedback until the end | Same release, but you use each module on staging the week it passes its gate |
| Scope | Gates are binary and written before the stage starts; §3 kills payroll and rate APIs now rather than at stage 6 |
| Migration surprises | Reconciliation is stage 3's gate, not stage 7's discovery — a real month of data imports early |
| Maintenance forever | Fewer moving parts by default: no cache until measured, no scanner until needed, one codebase if you pick B |
| The problem shrinks | Honest check at the end of stage 3 — if the expense module alone removes the pain, stages 5–6 can be re-scoped |

One risk the documents do not name: **the prototype in this repository is live and useful, and the team may settle into it.** That is fine while it stays a stopgap and dangerous if it quietly becomes the answer. Keep it, but do not add features to it after stage 1 begins.

---

## 10. Progress

**Decided (29 Sep):** Next.js in this repository · income in the ledger, one table with a direction · every module in scope · schema built once with all of it visible.

**Stage 0 — in progress.**

| Done | |
|---|---|
| Schema | 25 tenant-owned tables plus `tenants` and the `permissions` catalogue, designed in one pass across every module |
| Isolation | RLS enabled **and forced** on all 25, policy comparing `tenantId` to a transaction-local setting |
| App role | `teamos_app`, no BYPASSRLS, no ownership, no UPDATE/DELETE on `audit_log` |
| Audit log | Append-only by trigger, with one explicit `app.allow_audit_purge` escape for tenant offboarding |
| Permissions | 41-key catalogue; five default roles seeded as data |
| Accounts | The four existing users restored with their original password hashes — first by age becomes Owner, the rest Admin |
| Auth | Argon2id, with bcrypt hashes upgraded silently on the owner's next login — nobody is asked to reset a password |
| Sessions | A row in the database checked on every request, not a token trusted until it expires |
| Request layer | `defineAction`, which does not compile without naming the permission it requires, and buffers audit entries until the action succeeds |
| Invitations | Single-use link, 72 hours, invitee sets their own password; only the token's SHA-256 is stored |
| Two-factor | TOTP with ten recovery codes, required for Owner and Admin, enforced by redirect *and* by refusal in `defineAction` |
| Screens | People (invite, role, deactivate) and Security (two-step, recovery codes, where you are signed in) |
| Gate | **71 tests green** — 8 isolation and audit, 7 structural, 10 access, 9 action wrapper, 16 invitations, 21 two-factor. Run `npm run gate`. |

**What the gate caught, and it is the reason the gate exists.** RLS was enabled, forced, and policied correctly — and isolating nothing, because Neon's default role carries `BYPASSRLS`, which beats `FORCE`. Every isolation test failed on the first run. Without a test that deliberately queries with no tenant filter, this would have shipped looking completely correct. The fix is the two-role split the architecture already required.

**The five gate proofs, and where each one lives.**

| The plan asked for | Proved by |
|---|---|
| Tenant A cannot read tenant B *with the filter removed* | `tenancy.test.ts` — a `findMany()` with no `where` at all |
| An un-annotated route returns 403, not 200 | `action.test.ts` — `permission` is a required field, so it is a compile error rather than a runtime check; the `@ts-expect-error` fails typecheck if that ever weakens |
| A revoked session fails on the next request | `access.test.ts` — the session lookup `getScope()` performs returns nothing the moment `revokedAt` is set, with no new login |
| A role change takes effect within 60 seconds | `access.test.ts` — on the *next* resolution, because permissions are read per request rather than baked into a token. Zero seconds, not sixty |
| Out-of-scope and non-existent return an identical 404 | `access.test.ts` and `action.test.ts` — same error class, same message, byte-identical JSON |

Run all of it with `npm run gate` (typecheck, lint, tests).

**A deliberate deviation, recorded.** The architecture doc asks for 15-minute access tokens with rotating refresh tokens. This uses a session row checked on every request instead. It buys the same thing more directly: revocation is effective immediately rather than whenever a token happens to expire, and a role change needs no refresh cycle to be seen. The cost is a database read per request, which this application makes anyway.

**Stage 0 is complete.**

**Stage 1 — in progress.**

| Done | |
|---|---|
| Read layer | `lib/clients.ts` — list, search, get by id, export and the two derived reads all descend from one `clientWhere(scope)`. Four routes, one answer. |
| Custom fields | Typed definitions on the brand, values on the client, validated against the brand on every write; unknown keys dropped rather than stored |
| History | Read from the audit log rather than a second table, so a change cannot exist in one place and not the other |
| Assignment | Granting a client is the grant, effective on that person's next request |
| Archive vs delete | Archive always available; delete refused while anything is attached, and it says what |
| Screens | Clients list with URL-held filters and CSV export, client detail with details, contacts, team, history and the archive/delete panel |
| Gate | **22 client tests green** — four routes proved separately, plus filters, custom fields and assignment. 93 in the suite. |

**What this stage's gate caught.** `clientWhere` spread the caller's conditions over the scope filter. `clientIdScope` produces `{ id: { in: [...] } }`; a fetch by id passes `{ id }`; the spread replaced the scope's key outright. So `getClient` returned **any** client in the tenant, while the list, the search and the export stayed correct — because none of them passes an `id`. Three routes green, one wide open, and the open one is the route a URL reaches directly. The fix nests the scope filter inside `AND`, where a caller's condition has no key to collide with. It has a named regression test.

That is twice now that the failure was a correct-looking filter quietly not applying, and both times only a test that queried *as the restricted user* found it. Reviewing the query text would not have.

**Stage 1 is complete.** Brands are now created and their field definitions edited from `/brands`, with a key and a type locked once they exist — renaming a key orphans every stored value and changing a type makes every stored value the wrong shape, and neither errors, so both are refused on the server and explained in the form. Sub-tags stayed free text, with a scoped suggestion list so `Internal` and `internal` stop diverging.

**Stage 2 — in progress.**

| Done | |
|---|---|
| Context scope | A second axis on `Scope`, separate from client. A Manager who runs two clients may still be trusted with the whole KOL pipeline; a Finance lead who sees every client's money has no reason to read investor conversations. Deriving one from the other forces a wrong answer on one of them. |
| Person dedupe | `UNIQUE (tenantId, lower(email)) WHERE email IS NOT NULL AND deletedAt IS NULL` — an expression index Prisma cannot declare, so it is written by hand in the migration |
| Read layer | `lib/relationships.ts` — board, person summary, directory, pipeline summary, all descending from one scoped `where` |
| The banner | `hiddenCount` and nothing else: enough to stop a second cold approach, never enough to learn what the first one is about |
| Screens | `/pipelines` board with per-stage counts and values, `/people` directory, person page with relationships, activity log and the banner |
| Naming | The members page moved to `/team`. The `people` table is external humans — investors, KOLs, client contacts — and `/people` is theirs. Two lists that are not the same list should not share a word. |
| Gate | **18 relationship tests green**, 123 in the suite |

**What this stage's gate caught — the same bug, a third time.** `pipelineSummary` was written as `{ id: contextId, ...contextIdScope(scope) }`. The scope's `id` key overwrote the caller's, so asking for a pipeline you may not see returned the first one you may — not a refusal, not an empty result, but *a different pipeline's numbers under the name you asked for*. It is now a `contextWhere` function rather than a line anyone can write again, matching `clientWhere`.

Three times the failure has been a correct-looking filter quietly not applying, and three times only a test that queried *as the restricted user* found it. That is now the rule for every new read function.

**Stage 2 is complete.** The three that were outstanding:

*Pipeline configuration* at `/pipelines/manage` — contexts and their stages are created and reordered from the UI. Removing a stage that relationships sit on is refused rather than cascaded: moving them somewhere nobody chose would leave each of those relationships with a stage history that lies.

*Access* is now set in one place, on `/team`, covering both axes together. It replaces rather than diffs, because the form sends the whole intended set and a diff would need the same replace to be correct anyway. An Owner cannot be narrowed — there would be nobody left able to widen them again.

*Merge* folds a duplicate person into a kept one. Two decisions worth recording. The write runs unscoped by context while the *display* stays scoped, because the duplicate may hold a relationship in a pipeline the merger cannot see, and leaving it behind would strand it on a retired row. And a collision — both rows holding a relationship in the same pipeline — is refused rather than resolved, because one of them has a stage history the other does not and picking for the user would discard it silently. The email hand-over releases before it claims; doing it the other way round hits the unique index, and there is a test whose passing *is* that proof.

**A second thing the gate caught.** Invitations did not work at all on the first run, and the reason was structural rather than careless: row-level security needs a tenant, and the only thing that names the tenant is the token being looked up. Every invitation link was dead on arrival, and nothing but a test that actually resolved a token would have shown it. The fix is a second policy on `invitations` that makes a row readable to whoever can name its token hash — narrow enough to be worth writing down, so it has five tests of its own and a structural test that fails if any third policy ever appears anywhere.

**What two-factor cost, and where.** Three things are easy to get wrong here and invisible when you do, so each has a test: a code replayed inside its own thirty seconds (closed by storing the accepted time step), a recovery code spent twice (closed by removing it in the same statement that checks it is still there), and a half-authenticated challenge token passing as a session (closed by signing the two with different claim shapes, and refusing either in the other's place).

The interim app's screens were removed once the schema changed — they are in git at `5393452` and each is rebuilt properly in stages 1–5. Recover any of them for reference with `git checkout 5393452 -- <path>`.

## 11. One thing outstanding outside the code

Vercel's `DATABASE_URL` must be the `teamos_app` connection string, not the Neon owner's. The owner role carries `BYPASSRLS`; pointed at it, production has no tenant isolation at all and every test in this repository still passes, because the tests run against whatever `DATABASE_URL` says. Generate it with `npm run db:app-role` and paste the result into the Vercel project's environment variables.
