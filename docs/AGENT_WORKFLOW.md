# How we build DenialDesk with agents

## The loop
```
Human: roadmap item ──► spec-writer ──► Human approves spec
                                           │
                        architect ◄────────┘  (plan + ADR if needed)
                           │
                        builder  (one branch, one PR, tests included)
                           │
                        reviewer + compliance-checker  (on the PR)
                           │
                        Human merges ──► next item
```

The two points where a human steps in (approving the spec and merging) are deliberate. Agents are fast
at writing code and weak at deciding *what* should exist.

## Roles (defined in `.claude/agents/`)
| Agent | Does | Doesn't |
|---|---|---|
| `spec-writer` | Turns a roadmap item into a spec with acceptance criteria | Write code |
| `architect` | Plans files/data model, writes ADRs | Implement |
| `builder` | Implements one approved spec on its own branch, with tests | Change scope |
| `reviewer` | Reviews a diff for bugs, missing tests, spec gaps | Rewrite the PR |
| `compliance-checker` | Scans diffs for PHI leaks, logging, auth, audit gaps | Approve features |

In a Claude Code session, call one by name: *"use the spec-writer agent for
'Denial data model + CSV import'"*.

## Running work in parallel
- Only parallelize items that don't touch the same files (e.g. synthetic data
  generator and the CI setup).
- One cloud session or git worktree per item, each on its own branch.
- A GitHub issue per item is the unit of assignment; the issue links its spec.

## Definition of done
- Acceptance criteria in the spec all checked
- Tests pass in CI; lint/typecheck clean
- Reviewer and compliance-checker have no open blocking findings
- Roadmap checkbox ticked
