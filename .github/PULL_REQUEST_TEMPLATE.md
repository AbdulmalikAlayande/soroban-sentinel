## What does this PR do?

<!-- One or two sentences. Link the issue this addresses, if any: Closes #123 -->

## Why?

<!-- The motivation — what problem this solves or what it enables. -->

## Does this touch secret-key handling or transaction submission?

<!-- If yes (extension.ts, channels.ts, restore, key resolution from env/AWS/Vault), say so explicitly — reviewers will scrutinize this path per SECURITY.md. -->

- [ ] Yes — see notes above
- [ ] No

## Checklist

- [ ] Tests pass (`npm test`)
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] Lint passes (`npm run lint`)
- [ ] Tests cover the new functionality (TDD preferred — see [CONTRIBUTING.md](../CONTRIBUTING.md#test-driven-development))
- [ ] No unnecessary dependencies added
- [ ] Commit messages follow [conventional format](../CONTRIBUTING.md#commits)
- [ ] No `console.log` in core logic
- [ ] ADR added if this is a significant design decision (see [docs/adr](../docs/adr))
- [ ] E2E sandbox tested, if this touches RPC or daemon behavior (see [docs/e2e-sandbox.md](../docs/e2e-sandbox.md))
