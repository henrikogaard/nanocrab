# Focus Stack Foundation Design QA

Date: 2026-07-20  
Scope: issue #158, Slice 1 shell foundation and audited route polish

## Visual source and implementation evidence

- Approved source: `/Users/henrik/.codex/worktrees/nanocrab-ui-roadmap-plan/docs/superpowers/specs/assets/2026-07-20-nanocrab-focus-stack.png` (`1487x1058`).
- Implementation root: `artifacts/admin-workspace-qa/task4-final/`.
- Machine-readable result: `artifacts/admin-workspace-qa/task4-final/summary.json`.
- Full same-canvas comparison: `artifacts/admin-workspace-qa/task4-final/comparison-full.png`.
- Shell-focused comparison: `artifacts/admin-workspace-qa/task4-final/comparison-shell-focus.png`.
- Primary-work/action comparison: `artifacts/admin-workspace-qa/task4-final/comparison-content-focus.png`.
- Comparison composition: `artifacts/admin-workspace-qa/task4-final/comparison.html`.

The same-canvas comparison normalizes the approved source and the rendered
Reports inspector-open state to `1440x1000`. The two focused comparisons isolate
the shell/inspector and primary action hierarchy so typography, column widths,
selected-state contrast, and control density can be judged at a readable scale.

## Viewports and states

The final browser pass covers seven direct routes at all three viewports:

| Viewport        | Size        | Routes and interaction states                                                                                                       |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Desktop         | `1440x1000` | Today, Reports, Source Collections, Tasks, Sessions, Developer Hub, Security; Today and Reports with inspector and More open states |
| Tablet boundary | `768x1000`  | Same seven routes and the same Today/Reports interaction states                                                                     |
| Mobile          | `390x844`   | Same seven routes and the same Today/Reports interaction states, including the four-action bottom bar                               |

Stable screenshots use names such as `desktop-reports.png`,
`desktop-reports-inspector-open.png`, `tablet-source-collections.png`, and
`mobile-security.png` beneath the implementation root. The final run completed
21 of 21 route/viewport cases, captured 33 screenshots, exercised six
interaction cases, and reported zero issues.

## Comparison assessment

| Surface                 | Assessment                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typography              | The implementation follows the target's compact sans-serif hierarchy and uses the existing product font stack. Headings, route cues, labels, and monospace status metadata remain readable without introducing a new font dependency. |
| Spacing and layout      | Rail, context, canvas, and inspector proportions follow the source direction. The canvas keeps a clear primary-work region; dense cards use consistent gaps and no audited viewport has document-level horizontal overflow.           |
| Colors and tokens       | Existing dark surfaces, borders, muted text, and cyan accent tokens reproduce the target hierarchy. Selected modes, primary review actions, focus rings, and warning/error states remain distinct.                                    |
| Logo and icons          | The existing NanoCrab brand mark and product icon family are retained. No placeholder, emoji, ASCII, or invented image asset was added.                                                                                               |
| Copy and content        | Route labels are human-facing, including `Project chat`. Reports emphasize operator attention and approvals; source, task, session, developer, and security copy stays within existing API/product behavior.                          |
| States and interactions | Inspector and More are mutually exclusive, open controls expose live `aria-expanded`, close returns focus, and the inspector supports `Escape`. Today controls synchronize even when mounted after an already-open More drawer.       |
| Accessibility           | Every audited visible control has an accessible name, exactly one visible/runtime `main` exists, keyboard focus is visible, and route-selected controls agree with the current context.                                               |
| Responsive behavior     | Desktop uses all four shell layers; the tablet boundary collapses safely; mobile uses a four-action bottom bar and bottom-sheet inspector. DevHub stats and lanes reduce to two readable columns rather than four cramped columns.    |

## Findings and patches

| Severity     | Finding                                                                                                       | Patch and final evidence                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1           | Direct Sessions could inherit the default Chat state rather than show its Code route context.                 | The shell distinguishes an explicit persisted choice from fallback state. A direct Sessions link now defaults to Code and still preserves an explicitly selected Chat, Cowork, or Code session context. Browser coverage passes at all three viewports. |
| P1           | Sessions summary controls used mismatched classes, exposing browser-default white blocks and weak hierarchy.  | Session command/stat classes and styles now align, including type controls, labels, contrast, hover, and focus states.                                                                                                                                  |
| P1           | Developer Hub lane buttons could inherit low-contrast/default button typography.                              | Lane cards explicitly use product text color and font, with product hover/focus treatment.                                                                                                                                                              |
| P1           | Security route/check/form groups collapsed into dense flex layouts at narrow widths.                          | Security trust routes and checks use responsive card grids; the allowlist field has an explicit label.                                                                                                                                                  |
| P2           | Report action cards were tall and visually equal, obscuring the approval priority.                            | Actions are compact and full-span where needed; **Review approvals** is the cyan primary action.                                                                                                                                                        |
| P2           | Source Collections retry rendered as a browser-default button.                                                | The retry action now uses existing compact ghost-button classes and keeps its loading/disabled behavior.                                                                                                                                                |
| P2           | Several Report, Tasks, and Security form controls lacked sufficient accessible names.                         | Explicit labels were associated with the affected fields and verified by the rendered QA name audit.                                                                                                                                                    |
| P2           | Four Developer Hub lanes remained cramped in one row at `390px` because a later desktop rule won the cascade. | A post-component responsive rule uses two columns at `<=768px`; the final mobile capture is readable and has no overflow.                                                                                                                               |
| P3, resolved | A Today More control mounted after the drawer opened could expose stale `aria-expanded`.                      | Newly rendered controls are resynchronized with the live drawer state; the open-before-render regression passes.                                                                                                                                        |
| P3, resolved | `project-chat` could expose an internal route ID/generic icon.                                                | Navigation metadata now uses `Project chat` and the existing chat icon family.                                                                                                                                                                          |

## Residual P3 differences

- The approved concept uses slightly richer tonal depth and shadow texture than
  the production token set. The implementation keeps existing tokens to avoid a
  broad visual-system change in the shell-foundation slice.
- The source inspector depicts a denser live production timeline. Slice 1 uses
  existing route context, metrics, and alerts because unified-session behavior
  and new backend data are intentionally outside this issue.

These are intentional directional differences, not actionable correctness or
usability defects. No P0, P1, or P2 finding remains in the final rendered pass.

final result: passed
