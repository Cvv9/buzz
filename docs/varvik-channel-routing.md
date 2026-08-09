# VarVik channel and agent routing

This is the routing contract for the production Buzz workspace. Automation and
agents should post to the narrowest matching channel and must not use
`operations` as a general-purpose destination.

## Channel scopes

| Section | Channel | Intended scope |
|---|---|---|
| Personal Projects | `aaral-pms`, `atelier-crm`, `bidwave`, `project-dukaan`, `ummidvar`, `varvik-suite` | Execution, decisions, and evidence belonging to that product only. |
| Command Center | `agent-lab` | Agent experiments, evaluations, prompts, and access design. |
| Command Center | `brief-varun` | Varun's private brief and personal-assistant output. |
| Command Center | `github-events` | Raw repository and CI events; actionable failures may be summarized in `operations`. |
| Command Center | `operations` | BAU service health, incidents, deployments, backups, capacity, and operational follow-up only. |
| Command Center | `security` | Vulnerabilities, threat findings, access reviews, and remediation. |
| Command Center | `sylars-control` | Task approvals, execution status, steering, and control-plane events. |
| Command Center | `watchdog-alerts` | Raw uptime and observability alerts; incidents are summarized in `operations`. |
| Oralens Healthcare | `arogyalens`, `arogyasync`, `luxysmile`, `orascan-h` | Product-specific healthcare work and decisions. |
| VarVik Technologies | `ashrayu-media`, `fzine`, `hrr-capital`, `nuve`, `vakeelos`, `varvik-website`, `zup-coffee` | Product-specific company work and decisions. |
| Shared work | `client-delivery` | Delivery milestones, handoffs, client-visible risks, and acceptance. |
| Shared work | `customer-support` | Customer questions, issue themes, and escalations. |
| Shared work | `engineering` | Cross-project architecture, standards, platform work, and engineering practice. |
| Shared work | `opportunities` | Ranked opportunity pipeline, grants, tenders, and partnerships. |
| Shared work | `people-support` | Access-controlled people support; never public personnel discussion. |
| Shared work | `portfolio` | Cross-project prioritization, investment, dependencies, and resource allocation. |
| Shared work | `product-development` | Discovery, roadmap hypotheses, experiments, and reusable product practice. |
| Shared work | `renderboard` | Renderboard-specific execution and decisions. |
| Shared work | `Welcome` | Workspace onboarding and navigation. |
| Factory OS | `factoryos` | Factory OS-specific execution and decisions. |
| General | `general` | Company-wide conversation with no narrower home. |
| General | `market-intelligence` | Requested market, competitor, customer, and industry research. |
| General | `team-introductions` | Opt-in introductions, welcomes, rituals, and verified celebrations. |
| General | `tech-radar` | Scheduled Trend Radar briefings synthesized only from subscribed topics. |

## Agent routing

| Agent | Primary channels | Runtime resources |
|---|---|---|
| Project Brain | Product channels, `engineering`, `portfolio` | Project Intelligence, read-only. |
| Market Intelligence | `market-intelligence` | Sylars MarketIntelligence tasks and public research. |
| People & Culture | `Welcome`, `team-introductions` | Buzz member directory and channel context. |
| Founder Chief of Staff | `portfolio`, `sylars-control`, private founder context | Sylars task control and Buzz portfolio context. |
| Operations Desk | `operations`, with inputs from `watchdog-alerts`, `github-events`, and `security` | Watchdog/observability alerts, CI/deployment signals, Sylars incident-task status. |
| Opportunity Scout | `opportunities`, `market-intelligence`, `portfolio` | Sylars MarketIntelligence tasks and public research. |
| Bid & Partnerships Desk | `opportunities`, `bidwave`, `client-delivery` | Sylars research/task status and BidWave channel context. |
| GTM & Customer Discovery | `product-development`, `customer-support`, `market-intelligence`, relevant product channels | Sylars MarketIntelligence tasks and authorized Buzz channel context. |
| Personal assistants | Their owner's private `brief-*` channel only | Only explicitly connected personal sources. |

## Enforcement notes

- Buzz channel membership is the enforceable in-workspace access boundary and
  can be administered from the web Agents page.
- The `resources` profile field is runtime-declared metadata. Editing public
  presentation must never grant an external credential or integration.
- Trend Radar requires `AUTOMATION_TREND_RADAR_BUZZ_WEBHOOK_URL` attached to
  `tech-radar`; it does not fall back to the operational-alert webhook.
- Keep raw event channels separate from summary/decision channels. For example,
  `watchdog-alerts` holds raw signals while `operations` holds deduplicated,
  actionable incident context.
