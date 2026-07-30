# Issue #385: Add lightweight update check on CLI startup

## Context & Objective

Users running an old globally-installed sorokeep have no signal they're missing bug fixes or new alert channels. A lightweight, non-blocking update check on CLI startup closes that gap the way most modern CLIs (npm, gh, etc.) do.

## Description

Currently, when users install sorokeep globally (e.g., `npm install -g sorokeep`), they have no way to know when a newer version is available. This means:

- **Missed bug fixes**: Users continue running buggy versions unaware of fixes.
- **New features hidden**: Users miss new alert channels and capabilities.
- **Security risks**: Security patches go unnoticed.

This feature is common in modern CLIs:
- `npm` shows `You should upgrade to X.Y.Z`
- `gh` shows `A newer release of gh is available`
- `docker` shows newer version notices

## Proposed Solution

Add a lightweight, non-blocking update check that:

1. **Runs on startup**: Checks for updates whenever the CLI starts
2. **Non-blocking**: Never delays CLI startup or interferes with commands
3. **Informative**: Shows a concise message when a newer version exists
4. **Respects network**: Handles offline scenarios gracefully
5. **Periodic checking**: Avoids checking every single invocation (e.g., cache for 24 hours)

## Expected Behavior

### When a newer version exists
```
$ sorokeep status

  Sorokeep v0.2.0 is outdated. Latest: v0.3.0
  Upgrade with: npm install -g sorokeep

  [current status output]
```

### When running offline
Silent check (no error, no message).

### Every 24 hours cache
Version check results are cached locally to avoid repeated network calls.

## Acceptance Criteria

- [ ] Update check runs asynchronously on CLI startup (before command execution)
- [ ] Check uses npm registry (or GitHub releases API) to determine latest version
- [ ] Output is clearly differentiated from command output
- [ ] Graceful fallback when network is unavailable or rate-limited
- [ ] Uses local cache (24h TTL) to reduce unnecessary network requests
- [ ] No update message appears within 24 hours of a previous check
- [ ] Does not block or delay the actual CLI command

## Technical Notes

- Query package registry or GitHub releases API for latest version
- Compare semver with `Installed version < Latest version`
- Cache check timestamp/result locally (e.g., `~/.sorokeep/update-check.json` or similar)
- Use async HTTP request to avoid blocking CLI startup
