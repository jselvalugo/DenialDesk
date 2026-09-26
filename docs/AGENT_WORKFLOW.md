# How we build DenialDesk with agents

## The loop
```
Human: roadmap item ──► spec-writer ──► Human approves spec
                                           │
                        architect ◄────────┘  (plan, threat model, ADR if needed)
                           │
      builder  +  florida-rules-engine  +  edi-x12-specialist
      (one branch, one PR, tests included; each owns its part of the plan)
                           │
      reviewer  +  security-reviewer  +  compliance-checker   (read-only, on the PR)
                           │
                  Human reviews and merges ──► next item
```

The two points where a human steps in (approving the spec and merging) are deliberate. Agents are fast
at writing code and weak at deciding *what* should exist. No agent merges or deploys (R-15.5).

## Roles (defined in `.claude/agents/`)
| Agent | Does | Doesn't | Model |
|---|---|---|---|
| `spec-writer` | Turns a roadmap item into a spec with requirement IDs and acceptance criteria | Write code | sonnet |
| `architect` | Plans files/data model, writes ADRs and threat models | Implement | opus |
| `builder` | Implements backend, frontend, and IaC for one approved spec, with tests and docs | Encode legal rules or X12 | sonnet |
| `florida-rules-engine` | Encodes legal deadlines, rates, thresholds as versioned rules with boundary tests | Invent values or clear ⚠️ VERIFY | opus |
| `edi-x12-specialist` | X12 parsing/generation and clearinghouse integration | Guess at implementation-guide rules | sonnet |
| `reviewer` | Correctness, tests, spec and requirement-ID gaps | Edit files | opus |
| `security-reviewer` | Security review against REQUIREMENTS §7 | Edit files | opus |
| `compliance-checker` | HIPAA, Florida law, SOC 2 control mapping | Edit files or give legal advice | opus |

In a Claude Code session, call one by name: *"use the spec-writer agent for
'Payer master with regulatory-regime tags'"*.

### How this maps to REQUIREMENTS §15.1
The requirements list 11 roles. We run 8 agents to keep handoffs and context small:
- `solution-architect` → `architect`
- `backend-engineer`, `frontend-engineer`, `devops-infrastructure`, `technical-writer` → `builder`
- `qa-test-engineer` → tests are written by the agent that writes the code; `reviewer` checks them
- `hipaa-compliance-reviewer` + `soc2-evidence-auditor` → `compliance-checker` (it reports the
  SOC 2 controls touched; the PR description records them as evidence)
- `security-reviewer`, `florida-rules-engine`, `edi-x12-specialist` → unchanged

Split a merged role back out when its workload justifies it (e.g. a dedicated
`soc2-evidence-auditor` when SOC 2 readiness work starts in Phase 0).

## Running work in parallel
- Only parallelize items that don't touch the same files (e.g. synthetic data
  generator and the CI setup).
- One cloud session or git worktree per item, each on its own branch.
- A GitHub issue per item is the unit of assignment; the issue links its spec.

## Definition of done
See `CLAUDE.md`. In short: requirement IDs cited, acceptance criteria checked, tests pass in CI,
lint/typecheck clean, no blocking findings from the three reviewer agents, roadmap checkbox
ticked, human approval.
