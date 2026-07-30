#!/usr/bin/env bash
# scripts/demo.sh
# ─────────────────────────────────────────────────────────────────────────────
# Deterministic Quick Start demo for Sorokeep.
#
# Runs the exact same sequence shown in README.md's Quick Start block against
# a real testnet contract (the XLM Native SAC — always live, always has a TTL).
#
# Usage:
#   bash scripts/demo.sh
#
# Record with asciinema:
#   asciinema rec -c "bash scripts/demo.sh" docs/demo.cast
#
# Convert to SVG for embedding in README:
#   svg-term --in docs/demo.cast --out docs/demo.svg --window --no-cursor
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
# XLM Native Token (Stellar Asset Contract) — always deployed on testnet.
CONTRACT_ID="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
NETWORK="testnet"
WEBHOOK_URL="https://webhook.site/00000000-0000-0000-0000-000000000000"
TTL_THRESHOLD=20000

# Typing delay (seconds) between commands — creates a realistic feel.
TYPE_DELAY=0.8

# ── Helpers ───────────────────────────────────────────────────────────────────
pause() { sleep "${TYPE_DELAY}"; }

print_cmd() {
    echo ""
    # Print the $ prompt + command in bold green so it stands out in recordings.
    printf '\033[1;32m$ %s\033[0m\n' "$*"
    sleep 0.4
}

run() {
    print_cmd "$*"
    eval "$*"
    pause
}

banner() {
    echo ""
    printf '\033[1;36m%s\033[0m\n' "━━━  $*  ━━━"
    echo ""
    sleep 0.6
}

# ── Resolve sorokeep binary ───────────────────────────────────────────────────
# Support running from source (npx tsx) or from a globally linked build.
if command -v sorokeep &>/dev/null; then
    SK="sorokeep"
elif [ -f "$(pwd)/src/index.ts" ]; then
    SK="npx tsx src/index.ts"
else
    echo "Error: sorokeep not found. Run 'npm link' or execute from the project root." >&2
    exit 1
fi

# ── Demo ──────────────────────────────────────────────────────────────────────
clear

banner "Sorokeep — Quick Start Demo"

echo "  Soroban state expires. Sorokeep monitors it for you."
echo ""
sleep 1

# Step 1 — Register
banner "Step 1: Register a contract for monitoring"
run "$SK watch $CONTRACT_ID --network $NETWORK --name 'XLM Native Token'"

# Step 2 — Status
banner "Step 2: Check its current TTL health"
run "$SK status $CONTRACT_ID"

# Step 3 — Add a webhook alert
banner "Step 3: Set up a webhook alert (TTL < $TTL_THRESHOLD ledgers)"
run "$SK alerts add --contract $CONTRACT_ID --type webhook --url $WEBHOOK_URL --threshold $TTL_THRESHOLD"

# Step 4 — List configured alerts
banner "Step 4: Verify the alert was saved"
run "$SK alerts list --contract $CONTRACT_ID"

# Done
echo ""
printf '\033[1;32m✔ Demo complete.\033[0m\n'
echo ""
echo "  Next steps:"
echo "    sorokeep daemon --network $NETWORK   # start the monitoring daemon"
echo "    sorokeep guard  $CONTRACT_ID          # configure auto-extension"
echo ""
