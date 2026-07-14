# Control Plane Roadmap Batch - Design Spec

> **Implementation status (2026-07-14):** This is the approved historical
> design for the roadmap batch implemented by [PR #136](https://github.com/henrikogaard/nanocrab/pull/136),
> which is now merged. Issues #128 and #130-#135 were delivered and closed.
> Signal verification issue #94 was closed as deferred/not planned after the
> live inbound-delivery boundary could not be validated. Devin runner issue
> #129 was not delivered by PR #136 and remains open. The sections below
> preserve the pre-implementation plan rather than serving as current status.

## Overview

Complete the recommended post-control-plane roadmap as one reviewable delivery
batch. The implementation worker uses one isolated Git worktree, one named
branch, serial issue-sized work packages, and one pull request to `main`.

GitHub Issues and the NanoCrab GitHub Project remain the work-tracking source of
truth. Existing issue #94 is retained. Before editing product code, the worker
creates one issue for every missing roadmap item, adds each issue to the Project,
and moves an item to `In progress` only when its work package begins.

This is a delivery batch, not a license for a broad rewrite. Each package must
make the smallest complete change that satisfies its issue, use existing
NanoCrab patterns, and pass an explicit checkpoint before the next package.

## Goals

- Preserve live acceptance evidence for the completed AI coding control plane.
- Verify the merged Signal fixes against a live configured runtime when one is
  available, without manufacturing evidence when it is not.
- Make Pi, Devin, and Mistral Vibe usable coding-runner runtimes rather than
  discovery-only entries.
- Restore and enforce a clean lint baseline.
- Finish persistent terminal-session behavior using the existing terminal
  architecture and prior design as inputs, after auditing what is already live.
- Improve in-app discovery of existing high-value capabilities.
- Let report jobs collect and preserve structured source evidence.
- Add an approval-first learning loop that proposes memories or skill drafts
  from completed runs without installing or activating them automatically.
- Update operator, capability, security, and roadmap documentation to describe
  only behavior verified in the batch.

## Non-Goals

- Deploying NanoCrab, changing versions, merging the PR, or releasing software.
- Replacing the existing provider router, coding-job engine, control-plane
  domain, terminal stack, report pipeline, memory review, or Skill Factory.
- Adding new messaging channels or new model providers.
- Automatically accepting learning proposals, changing GitHub workflow state
  without decision gates, or silently falling back for write-capable work.
- Claiming live Signal or bot-channel success when credentials, devices, or a
  configured runtime are unavailable.
- Unrelated refactors or wholesale redesign of the admin dashboard.

## Approved Delivery Shape

| Concern | Decision |
| --- | --- |
| Implementation model | Qwen 3.6, with a bounded written handoff |
| Repository isolation | One clean worktree created from current `origin/main` |
| Branch and integration | One named feature branch and one PR targeting `main` |
| Work decomposition | Serial issue-sized packages with separate checkpoints |
| Git history | One focused commit per issue where practical |
| Test discipline | Red-green-refactor for behavioral changes |
| Tracking | Create missing issues first; retain and reference #94 |
| Project status | `In progress` at package start, `In review` when its evidence is in the PR |
| Live evidence | Preserve actual observations; unavailable checks remain explicitly open |
| Final authority | Human reviews and merges; the worker never deploys or releases |

## Work Packages

### 1. Control-Plane Live Acceptance

Create a hardening issue that reconciles the acceptance criteria of the closed
control-plane epic and its end-to-end proof. Exercise the real admin UI in a
browser, create or use a clearly marked test issue in the configured GitHub
Project, and verify the decision-gated Planning to Implement to Review flow.
Confirm the visible agent, CLI, model, run, decision, branch, PR, and evidence
states. Test channel commands only through channels that are live and safely
configured. Record unavailable channel checks rather than treating injected
integration tests as live proof. Avoid leaving test issues, runs, or Project
items in misleading production states.

### 2. Signal Live Runtime - Existing Issue #94

Read #94 and test its exact acceptance criteria against the live Signal daemon
when configured. Preserve daemon health, receive, send, attachment, and status
evidence required by the issue, redacting phone numbers, tokens, message
contents, and other private data. If a live runtime or human recipient is
unavailable, run the full safe automated suite and leave the issue open with a
precise blocker and reproduction checklist. This package may be evidence-only;
code changes are made only for a reproducible defect and must begin with a
failing test.

### 3. Pi Coding-Runner Adapter

Promote the existing Pi runtime registry entry from probe-only to an executable
coding runtime. Add a narrow adapter that maps NanoCrab's coding-job contract to
the installed Pi CLI, including non-interactive invocation, prompt delivery,
working directory, output capture, exit/cancellation behavior, and runtime
health. Capabilities must reflect demonstrated behavior, not assumed parity
with Claude, Codex, or OpenCode. Raw credentials must not enter the worktree or
container.

### 4. Devin Coding-Runner Adapter

Add a Devin adapter behind the same coding-runner interface. Make session or
job identity, model selection, output normalization, terminal states, timeout,
and cancellation explicit. If the installed Devin CLI is remote-session based,
encapsulate that lifecycle rather than emulating a local process contract.
Automated tests use a fake transport or executable; they must not consume a
paid session or require network access.

### 5. Mistral Vibe Coding-Runner Adapter

Map the logical `mistral` runtime to the installed `vibe` executable through an
explicit adapter. Cover argument construction, non-interactive behavior,
working-directory isolation, model selection when supported, output and error
normalization, cancellation, and health probing. Keep the logical runtime id
stable in profiles, audit records, UI, and persisted runs.

### 6. Clean Lint Baseline

Inventory every current lint failure on the batch base commit and classify it
as configuration drift, generated/vendor surface, or product-code defect. Fix
the smallest legitimate set without drive-by formatting. `npm run lint` must
pass, and CI must enforce that result. Formatting, typecheck, tests, and build
must remain green.

### 7. Persistent Terminal Sessions

Audit the current terminal implementation against the existing terminal design
and plan before editing; do not reimplement already-shipped behavior. Complete
the remaining persistence, reconnect, transcript/history, search, lifecycle,
and bounded-retention gaps using the existing admin WebSocket and route
patterns. Session files are local runtime state, protected against traversal,
bounded by size/retention, and never committed. Verify backend behavior with
tests and the rendered terminal flow in a browser.

### 8. Capability Discoverability

Make the existing product modes and high-value surfaces easier to find without
adding redundant pages. Use the current shell-navigation metadata, route
registry, mode model, and design tokens. Add contextual navigation or a
capability finder that routes operators to canonical existing pages. Include
keyboard, focus, narrow-width, empty, and unavailable states. Verify rendered
navigation and prevent broken or unmounted routes with automated coverage.

### 9. Report Source Collection

Complete structured source collection for reports through the existing report,
research, connector, artifact, and approval boundaries. A report run records
the requested source scopes, collection status, provenance, failures, and
citation-ready source ledger. Partial collection is visible and does not become
silent success. External reads and writes retain existing credential-proxy and
approval policies. Cover mixed success, unavailable connectors, cancellation,
and artifact linkage.

### 10. Reviewable Learning Loop

Add a post-run action that derives a proposed memory or proposed skill draft
from eligible completed runs. The operator sees the source run, extracted
lesson, proposed scope, sensitivity, confidence, validation result, and diff
before approval. Reuse the existing memory proposal and Skill Factory review
queues. No proposal becomes active or installed automatically. Do not learn
from failed, cancelled, private, secret-bearing, or ineligible runs by default;
redaction and source attribution are mandatory.

## Architecture And Boundaries

The batch extends existing interfaces rather than introducing a second control
plane:

- Runtime adapters implement the current coding-runner contract and register
  through the existing runtime registry.
- GitHub Project reads and transitions continue through the existing sync and
  decision services. Browser and channel surfaces call shared control-plane
  commands rather than embedding workflow logic.
- Terminal persistence remains behind the current admin WebSocket/session API.
- Report collection composes existing research, connector, credential-proxy,
  artifact, and approval services.
- Learning proposals terminate at existing review queues and never bypass
  memory or skill governance.
- Discoverability changes route to canonical pages registered by the admin
  plugin and navigation systems.

Each new unit must expose a narrow interface, have one clear responsibility,
and be testable with injected process, transport, GitHub, connector, or storage
dependencies. No automated test may depend on a live paid provider, personal
chat recipient, or production GitHub mutation.

## Execution And Checkpoints

The worker must execute packages serially in the order above. For each package:

1. Read its issue, relevant docs, tests, and implementation surface.
2. Record the package's allowed files and success criteria.
3. Move only that issue to `In progress`.
4. Write a failing behavioral test, or record why the package is manual or
   documentation-only.
5. Verify the expected red failure.
6. Implement the smallest passing change and verify green.
7. Run focused tests plus affected typecheck/build/browser checks.
8. Update relevant docs and preserve manual or live evidence.
9. Commit only the package's paths with the issue number in the message.
10. Move the issue to `In review` only when its PR-linked evidence is complete.

A failed checkpoint stops the batch. The worker records the failure and leaves
the worktree intact; it must not skip ahead and conceal a broken intermediate
state.

## GitHub Issue And PR Policy

Before product edits, create missing issues with concise acceptance criteria,
dependencies, verification, and suitable priority/area/type labels. Add them to
the NanoCrab Project. Do not duplicate #94 or recreate closed control-plane
issues merely to change their history; the new live-acceptance issue links the
closed epic and documents the evidence gap.

The final PR:

- targets `main` and links every issue;
- uses closing keywords only for issues whose acceptance criteria are actually
  satisfied by code and preserved evidence;
- summarizes each work package and its focused commits;
- includes red/green test evidence, browser QA, live checks, and skipped checks;
- calls out unavailable credentials, external signoff, residual risk, and any
  issue intentionally left open;
- contains no secrets, personal message content, generated runtime state, or
  raw command dumps.

One PR does not imply one indivisible diff. Reviewers must be able to inspect
and revert each package independently by focused commit and file boundary.

## Error Handling And Safety

- Treat missing executables, authentication failures, provider exhaustion,
  unsupported flags, and transport failures as distinct operator-visible
  states.
- Never silently switch a write-capable run to another runtime or model.
- Preserve cancellation and timeout semantics across all adapters.
- Reject path traversal, unregistered repositories, invalid session ids,
  unsupported source scopes, and ineligible learning sources.
- Redact secrets and private identifiers from logs, evidence, tests, issues,
  and PR text.
- Do not close issues whose remaining acceptance depends on a live device,
  production credential, subjective QA, or human recipient.

## Verification Strategy

Every behavioral package follows TDD. At minimum, final verification includes:

- focused tests for each changed service, route, adapter, and UI module;
- control-plane integration tests;
- channel command and Signal automated tests;
- runtime-adapter contract tests using injected fakes;
- terminal persistence, retention, reconnect, and path-safety tests;
- report collection and learning-governance tests;
- route/navigation regression tests;
- `npm run lint`;
- the repository formatting check;
- the repository typecheck command;
- `npm test`;
- `npm run build`;
- browser QA of Control Plane, Terminal, discoverability, Reports, and proposal
  review surfaces;
- live GitHub Project and Signal evidence only where safely configured.

The handoff must tell the worker to discover exact script names from
`package.json` instead of inventing commands. Final status must distinguish
automated green checks, observed browser behavior, observed live integrations,
and checks blocked by external state.

## Completion Criteria

The batch is ready for human review only when:

- all missing roadmap issues exist and are linked from the PR;
- every implemented package has focused commits and verification evidence;
- runtime adapters expose only capabilities proven by contract tests;
- lint, formatting, typecheck, tests, and build pass;
- the changed web surfaces have current browser evidence;
- docs and capability/roadmap status match verified behavior;
- the branch is pushed and one PR to `main` exists;
- satisfied issues are `In review`, while externally blocked issues remain open
  with precise blockers;
- the worktree is clean after the final commit; and
- no deploy, merge, release, or version change has occurred.
