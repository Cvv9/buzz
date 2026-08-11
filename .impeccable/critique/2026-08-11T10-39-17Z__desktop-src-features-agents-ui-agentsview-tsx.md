---
target: Buzz Agents roster and Workflows information architecture
total_score: 23
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-08-11T10-39-17Z
slug: desktop-src-features-agents-ui-agentsview-tsx
---
Method: dual-agent (A: agents_ui_review · B: agents_ui_detector)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2 | The roster does not show current work, last activity, failures, token use, or cost. |
| 2 | Match System / Real World | 3 | Names and roles are readable, but runtime/config language leaks through and naming is inconsistent. |
| 3 | User Control and Freedom | 3 | Drill-in and lifecycle controls exist; fleet-level operating controls are limited. |
| 4 | Consistency and Standards | 3 | Shared list patterns are sound, but role, access, and runtime identity are mixed. |
| 5 | Error Prevention | 2 | No visible budget guardrails or explanation when cost telemetry is unavailable. |
| 6 | Recognition Rather Than Recall | 2 | Users must open agents one by one to learn what they are doing. |
| 7 | Flexibility and Efficiency | 2 | There is no useful fleet scan, sort, filter, or usage comparison. |
| 8 | Aesthetic and Minimalist Design | 3 | The presentation is calm, but equal-weight rows create a directory rather than an operations view. |
| 9 | Error Recovery | 2 | Failures and recovery actions are not surfaced clearly at roster level. |
| 10 | Help and Documentation | 1 | The view does not explain permissions, usage visibility, or which agent to use. |
| **Total** |  | **23/40** | **Acceptable — significant improvement needed** |

## Design Specificity Verdict

The surface is moderately authored for Buzz: persona art, names, roles, and access labels give it character, but its interaction model is still category-interchangeable with a generic team directory. Buzz's distinctive value is agent work, tool use, approvals, and outcomes; none of that is visible in the roster.

The deterministic detector returned zero findings for `AgentsView.tsx`, with no false positives. Manual rendered inspection caught issues outside the detector's narrow rules: the custom/unknown-agent disclosure lacks `aria-expanded`, the new-agent action is visually reduced to an unlabeled plus card, and hosted discovery appears before the user's managed-agent library.

No reliable user-visible overlay was produced. The browser evaluation surface was read-only, so script injection was unavailable; the E2E mock at 1280×900 and 650×900 was used as the fallback visual signal. Both layouts rendered without horizontal overflow.

## Overall Impression

The roster is clean and personable, but it makes the user investigate instead of operate. The biggest opportunity is to turn Agents into a fleet-status surface while keeping detailed tool activity and usage in each agent's profile.

## What's Working

- Persona names, art, roles, and access labels make the roster human-readable.
- Full-width hosted rows are semantic buttons, and the compact action menu has a useful accessible label.
- The responsive layout behaves deliberately at narrow widths and does not introduce horizontal overflow.

## Priority Issues

### [P1] Agents is a directory, not a fleet operations surface

**Why it matters:** Users cannot answer “Who is working, what are they doing, and who needs attention?” without opening every agent.

**Fix:** Add a fleet summary and one operational line per agent: `Working · Searching procurement notices`, `Idle · 14m`, `Needs attention · MCP authentication failed`. Keep full tool inputs/results in the detail panel.

**Suggested command:** `$impeccable shape`

### [P1] Token and cost telemetry is collected but invisible

**Why it matters:** Owners cannot understand consumption or spot expensive/failed runs, even though kind 44200 already carries per-turn and cumulative token counts plus optional provider-reported USD cost.

**Fix:** Add a Usage tab/detail section with time range, model, input/output/cache tokens, duration, action count, failures, and actual-versus-estimated cost labels. Put only a compact “Today” summary on the roster header. Respect owner encryption; do not imply spend visibility for shared agents without an authorized aggregate feed.

**Suggested command:** `$impeccable clarify`

### [P1] Creation hierarchy and disclosure state are weak

**Why it matters:** A populated hosted roster pushes the user's own agent library and creation action below the fold. The plus-only creation card lacks visible text, and the custom/unknown-agent disclosure does not expose `aria-expanded`.

**Fix:** Add visible `My agents` and `New agent` labels, place creation alongside the managed-agent section, and add the missing disclosure state semantics.

**Suggested command:** `$impeccable harden`

### [P2] Workflows needs a clearer operational/configuration boundary

**Why it matters:** Moving the entire workflow surface into Settings would bury run history, approvals, creation, and manual triggers. Leaving defaults and credentials mixed with operations would be equally confusing.

**Fix:** Keep Agents and Workflows as primary destinations grouped under `Automation`. Put provider/model defaults, credentials, permissions, safety policies, and budget alerts in Settings.

**Suggested command:** `$impeccable layout`

### [P2] Display identity and runtime identity can disagree

**Why it matters:** The roster says Sylar while the deployed Chief-of-Staff runtime still publishes Kunkka. That inconsistency leaks into prompts, workflows, logs, and failure messages and makes operators unsure which agent actually ran.

**Fix:** Make Sylar the canonical runtime/profile/workflow name, retain Kunkka only as a temporary lookup alias, and migrate cached/profile presentation events by pubkey.

**Suggested command:** `$impeccable polish`

## Persona Red Flags

**Alex (Power User):** Cannot scan active agents, failures, last action, tokens, or cost; comparison requires repeated drill-in. No sort/filter by status, recent activity, or spend.

**Jordan (First-Timer):** Sees many personas but no guidance about whom to ask, why access differs, or what `Admins only` means operationally. The plus-only creation action is easy to miss.

**Sam (Accessibility-Dependent):** The custom/unknown-agent disclosure does not announce expanded state, and critical operating state is absent as concise text that could be announced on change.

## Minor Observations

- Keep raw tool payloads out of the roster; show a human-readable action label and expose full evidence in detail.
- The 28×28 team overflow control is small for touch, although acceptable for a mouse-first desktop surface.
- Make the selected sidebar destination more visually unmistakable.

## Questions to Consider

- Should the roster optimize first for daily operations (`working`, `blocked`, `idle`) or governance (`cost`, `permissions`, `budgets`)?
- Should shared-agent usage remain owner-private, or should admins receive an explicitly authorized aggregate billing feed?
- Is `Automation` the intended umbrella for both Agents and Workflows, with configuration split into Settings?
