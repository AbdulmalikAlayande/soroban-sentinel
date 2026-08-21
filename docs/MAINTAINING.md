# Maintainer Triage Guide

This guide documents how maintainers should triage issues in the Sorokeep repository, including label taxonomy, issue lifecycle, response SLAs, and handling of stale assignments.

## Label Taxonomy

### Issue Type Labels

| Label | Meaning | Usage |
|-------|---------|-------|
| `bug` | A defect in the code that causes incorrect behavior | Applied automatically by bug report template |
| `enhancement` | A new feature or improvement | Applied automatically by feature request template |
| `documentation` | Documentation-only changes (README, docs/, inline comments) | Manual application for docs-specific issues |
| `good first issue` | Suitable for new contributors, well-scoped, low complexity | Manual application after triage |
| `help wanted` | Needs contributor attention, clear requirements but unassigned | Manual application when issue is ready for pickup |
| `invalid` | Not a valid issue (duplicate, out of scope, user error) | Manual application after triage with comment explaining why |
| `question` | User seeking clarification or help, not a bug/feature | Manual application for support requests |
| `wontfix` | Valid issue but explicitly out of scope or will not be implemented | Manual application after maintainer decision |

### Workflow Labels

| Label | Meaning | Usage |
|-------|---------|-------|
| `triage` | Needs initial maintainer review and classification | Applied automatically by issue templates, removed after triage |
| `needs-discussion` | Requires maintainer alignment before implementation | Applied automatically by feature request template, removed after decision |

### Stellar Wave Program Labels

| Label | Meaning | Usage |
|-------|---------|-------|
| `stellar-wave` / `Stellar Wave` | Part of the Stellar Wave Program bounty system | Applied by maintainers to eligible issues |
| `phase-1` through `phase-15` | Wave phase number (indicates difficulty/priority tier) | Applied by maintainers, higher phases = more complex/higher value |

### Complexity Labels

| Label | Point Value | Meaning | Usage |
|-------|-------------|---------|-------|
| `complexity:trivial` | 1-2 points | Very small change, <1 hour work, low risk | Manual application for quick fixes |
| `complexity:medium` | 3-5 points | Moderate scope, 1-4 hours work, some complexity | Manual application for standard features |
| `complexity:high` | 6-10 points | Large scope, >4 hours work, high complexity or risk | Manual application for major features |

### Area Labels

| Label | Meaning | Usage |
|-------|---------|-------|
| `area:alerts` | Alert channels, delivery pipeline, retry logic | Manual application for alert-related issues |
| `area:cli` | CLI commands, argument parsing, terminal output | Manual application for CLI UX issues |
| `area:database` | SQLite schema, migrations, repositories | Manual application for db-related issues |
| `area:daemon` | Monitor cycle, polling, lifecycle management | Manual application for daemon issues |
| `area:rpc` | Stellar RPC client, transaction building, simulation | Manual application for RPC interaction issues |
| `area:extension` | TTL extension, auto-extension, restoration | Manual application for extension/restore issues |
| `area:mcp` | Model Context Protocol server, AI agent tools | Manual application for MCP-related issues |
| `area:docs` | Documentation, guides, README | Manual application for documentation issues |
| `area:ci` | GitHub Actions, CI/CD, release process | Manual application for CI/CD issues |

## Issue Lifecycle

### Standard Flow

1. **Issue Opened** → Creator uses bug report or feature request template, automatically gets `triage` label
2. **Triage** → Maintainer reviews, applies appropriate type/area/complexity labels, removes `triage`
3. **Stellar Wave Application** (if applicable) → Contributor applies via drips-wave bot comment
4. **Assignment** → Maintainer accepts application, assigns issue, sets due date based on complexity
5. **PR Linked** → Contributor opens PR, maintainer links PR to issue
6. **Review** → Maintainer reviews PR, requests changes if needed
7. **Merge** → PR merged, issue closed, points awarded (if Stellar Wave)

### Label Transitions

```
Open → [triage] → Triage Review → [type][area][complexity] → Ready for Applications
     ↓
Stellar Wave Application → [assigned] + due date → PR Opened → [in-review]
     ↓
PR Merged → Issue Closed → Points Awarded
```

## Response SLAs

### Application Review

| Complexity | Target Response Time |
|------------|---------------------|
| `complexity:trivial` | 48 hours |
| `complexity:medium` | 72 hours |
| `complexity:high` | 5 business days |

Maintainers should review drips-wave bot applications within the target window. If unable to review within SLA, add a comment with expected review date.

### PR Review

| Complexity | Target First Review |
|------------|---------------------|
| `complexity:trivial` | 24 hours after PR opened |
| `complexity:medium` | 48 hours after PR opened |
| `complexity:high` | 3 business days after PR opened |

### Follow-up Reviews

After requesting changes, maintainers should review updated PRs within:
- 48 hours for trivial/medium complexity
- 3 business days for high complexity

## Stale Assignment Handling

### Due Date Policy

Due dates are set based on complexity when assigning issues:
- `complexity:trivial`: 7 days from assignment
- `complexity:medium`: 14 days from assignment
- `complexity:high`: 21 days from assignment

### Stale Assignment Procedure

If an assignee goes stale past the due date without activity:

1. **Warning Comment** (3 days past due)
   - Comment on the issue tagging the assignee
   - Ask for status update or intention to continue
   - Set a 7-day response deadline

2. **Unassign and Re-open** (10 days past due, no response)
   - Remove assignee
   - Remove `assigned` label
   - Add comment explaining the unassignment (neutral tone)
   - Re-open the issue for new applications
   - **Do not close the issue** unless it's explicitly invalid

3. **Closed-without-shipped Scenario** (Issue #186 precedent)
   - If an issue was closed with an accepted application but no linked PR and no implementation:
     - Re-open the issue
     - Remove the previous assignee
     - Add comment explaining the situation
     - Make the issue available for new applications
     - Document the incident in internal notes for pattern tracking

### Example Stale Assignment Comment

```
@assignee — this issue was assigned on [date] with a due date of [due date]. 
It's now [days] days past due with no activity. Please respond by [response deadline] 
with:
- A status update if you're still working on it, or
- Confirmation that you're unassigning so someone else can pick it up

If no response is received by [response deadline], the issue will be unassigned 
and re-opened for new applications.
```

## Triage Checklist

When triaging new issues:

- [ ] Remove `triage` label
- [ ] Apply appropriate type label (`bug`, `enhancement`, `documentation`, `question`, `invalid`, `wontfix`)
- [ ] Apply area label if applicable (`area:*`)
- [ ] Apply complexity label if applicable (`complexity:*`)
- [ ] Apply `good first issue` if suitable for new contributors
- [ ] Apply `help wanted` if ready for pickup and needs contributor
- [ ] For `invalid` or `wontfix`: add comment explaining why
- [ ] For `question`: consider converting to discussion or answering directly
- [ ] For Stellar Wave issues: apply `stellar-wave` and appropriate phase label

## Assignment Checklist

When accepting a drips-wave application:

- [ ] Assign the issue to the applicant
- [ ] Add `assigned` label
- [ ] Set due date based on complexity (7/14/21 days)
- [ ] Comment with assignment confirmation and due date
- [ ] Link to relevant documentation (CONTRIBUTING.md, ARCHITECTURE.md)
- [ ] For complex issues: suggest breaking into smaller PRs if applicable

## PR Review Checklist

When reviewing a PR:

- [ ] Verify tests pass (`npm test`)
- [ ] Verify type check passes (`npx tsc --noEmit`)
- [ ] Verify lint passes (`npm run lint`)
- [ ] Check test coverage for new functionality
- [ ] Verify no unnecessary dependencies added
- [ ] Check commit message format
- [ ] Verify code matches project style conventions
- [ ] Check for `console.log` in core logic
- [ ] Verify ADR created if making significant design decision
- [ ] Add `in-review` label during review
- [ ] Remove `in-review` label after merge/close

## Issue Closure

Close issues when:

- PR is merged and linked to the issue
- Issue is marked `invalid` or `wontfix` with explanation
- Issue is a duplicate (reference the original)

**Never close an issue** that has an accepted application without:
1. A linked and merged PR, OR
2. Explicitly marking it `invalid`/`wontfix` with explanation

## References

- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contributor guidelines
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [Issue #186](https://github.com/AbdulmalikAlayande/sorokeep/issues/186) - Precedent for closed-without-shipped handling
