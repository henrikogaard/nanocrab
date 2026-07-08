---
target: "https://taskekrabben.ogard.cloud:9743/ live every-surface UI audit"
total_score: 23
p0_count: 1
p1_count: 2
timestamp: 2026-07-08T21-39-00Z
slug: taskekrabben-ogard-cloud
---
Method: dual-agent (A: 019f43a4-0a29-78d3-bc50-e4eeed595d3f · B: 019f43a4-3f7a-7090-9793-69ccf7d5dfc8) plus parent authenticated live capture

# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|---:|---|
| 1 | Visibility of System Status | 3 | Strong health/status language, but too many panels compete equally. |
| 2 | Match System / Real World | 2 | Chat/Cowork/Code is useful; cockpit/runway/lane/brief terminology piles up. |
| 3 | User Control and Freedom | 2 | Many actions exist, but route sprawl makes the next safe action hard to choose. |
| 4 | Consistency and Standards | 2 | Components are consistent but over-templated into repeated cards/kickers. |
| 5 | Error Prevention | 3 | Approval and credential boundaries are visible; high-risk action hierarchy still blends with normal UI. |
| 6 | Recognition Rather Than Recall | 2 | 34 authenticated routes and dense panels create high recall burden. |
| 7 | Flexibility and Efficiency | 2 | Power users get density, but there is no dominant command/search spine in the captured shell. |
| 8 | Aesthetic and Minimalist Design | 1 | The live UI is card-dense and explanatory across most surfaces. |
| 9 | Error Recovery | 3 | Recovery/empty states exist in source and screenshots; live warnings mostly degrade cleanly. |
| 10 | Help and Documentation | 3 | Help is thorough, but itself becomes another dense surface. |
| **Total** |  | **23/40** | **Functional but overloaded.** |

# Anti-Patterns Verdict

The live UI does not fail because it is broken; it fails because it over-explains. It looks like a capable internal operations tool that has accumulated too many panels, cards, route groups, and labels. The live login is the strongest AI-generated tell: oversized mascot/logo, product-promo card, lane chips, before/after sign-in matrix, and placeholder-only form controls. Local source has already removed this, but the VPS is stale.

Deterministic scan: `node /Users/henrik/.agents/skills/impeccable/scripts/detect.mjs --json src/admin/public` returned `[]`. This means the bundled static detector did not flag local source. Browser evidence did catch deployment drift: live DOM still contains the old login promotional markup while local source/tests reject it.

Visual overlays were not injected because the CLI detector returned no findings to overlay. Browser evidence used screenshots, DOM inspection, console collection, and visible-control counts instead.

# Overall Impression

NanoCrab has a strong product model: Chat for quick thinking, Cowork for durable project context, Code for repo work, and governance surfaces for safety. The problem is that nearly every authenticated surface tries to be a dashboard, a manual, a warning system, and a launcher at once. The biggest opportunity is ruthless hierarchy: one next action per surface, with secondary detail progressively disclosed.

# What's Working

- Safety is not hidden. Approvals, audit, credentials, external writes, provider readiness, and security are visible throughout the UI.
- The shell is coherent. The same sidebar, mode switch, cards, buttons, and dark theme vocabulary make the app feel like one product.
- No horizontal overflow was detected across the authenticated desktop route sweep, and key mobile routes were responsive enough to render without obvious width breakage.

# Priority Issues

## [P0] VPS is stale relative to the current redesign work
Why it matters: The live login and Chat/Cowork start surfaces are the exact surfaces Henrik criticized, and the VPS still shows the old versions. Users judging the live app will see the AI-generated login and older Chat empty state even though local source has fixes.

Fix: Deploy the current local tree after review. Then re-run this audit against the VPS before doing further visual tuning.

Suggested command: `$impeccable audit`

## [P1] Visible-control overload across core surfaces
Why it matters: Live capture counted 210 visible controls on Messages, 216 on Audit, 283 on Skills, and 197 on Settings. Projects, Agents, and Tasks are also near or above 90. This creates decision fatigue and makes the primary task hard to identify.

Fix: Define one primary action per page, move supporting actions into contextual menus, and collapse secondary panels by default. Start with Messages, Audit, Skills, Settings, Projects, and Agents.

Suggested command: `$impeccable distill`

## [P1] Dashboard and operational pages lack a single action spine
Why it matters: Dashboard, Agents, Integrations, Credentials, and Help all present many simultaneous panels. A tired operator should see what needs attention first, why it matters, and what button to press.

Fix: Add a top-level “Next required action” pattern: status, consequence, owner/surface, and one primary action. Demote everything else into queues.

Suggested command: `$impeccable layout`

## [P2] Repeated card/kicker grammar makes the product feel generated
Why it matters: The same dark card, small accent label, metric tile, and explanatory paragraph repeats across almost every page. Consistency is good, but this much sameness removes hierarchy and creates the “AI assembled this” feel.

Fix: Create page archetypes: queue, command, settings, document/help, and detail. Each should use the same tokens but different composition rules.

Suggested command: `$impeccable polish`

## [P2] High-risk actions do not visually separate enough from ordinary setup
Why it matters: Credentials, Marketplace, Approvals, Webhooks, Code automation, and channel delivery can affect external systems. They should not feel like ordinary navigation cards.

Fix: Introduce a high-risk review component with target, scope, consequence, rollback/undo, approval state, and explicit confirm/deny actions.

Suggested command: `$impeccable harden`

## [P2] Login accessibility and trust need the deployed compact form
Why it matters: The live login uses placeholder-only username/password inputs. Assessment B found no associated label text or aria-label. The promotional content also crowds out the actual auth task.

Fix: Deploy the local compact login with explicit labels and remove the product-promo block from the live app.

Suggested command: `$impeccable clarify`

# Persona Red Flags

**Power Operator**: The density is useful, but route switching is too slow visually. A power user moving between approvals, audit, projects, and code needs command-palette-first routing and fewer panels fighting for attention.

**First-Time Admin**: The live login teaches modes, but after sign-in the route inventory explodes. Dashboard, Help, Settings, and Skills all introduce many concepts simultaneously.

**Security-Conscious Operator**: Safety concepts exist, but risk states are visually flattened into the same card/button language. Marketplace installs, credentials, webhooks, and external writes need stronger consequence framing.

# Minor Observations

- Desktop route sweep covered 34 authenticated surfaces. No horizontal overflow was detected.
- Dashboard produced repeated JetBrains Mono font decode warnings from Google Fonts. Not a UX blocker, but it weakens polish and may alter typography fallback.
- The live Chat route still shows the older starter card grid, not the cleaner local composer-first redesign.
- Help is useful but too long as a surface; it should route users into tasks faster.
- The app would benefit from `$impeccable init` later so design intent, audience, and page archetypes are durable.

# Questions to Consider

- What is the one action the dashboard should make impossible to miss?
- Which routes are truly first-class, and which should become command-palette destinations only?
- Does every page need to explain NanoCrab, or can returning operators be trusted with quieter UI?
- Which actions can change external state, and why do they look so similar to read-only navigation?
