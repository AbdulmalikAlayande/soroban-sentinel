# OpenZeppelin Soroban Starter Template

This template provides a minimal, working Soroban smart contract using the [OpenZeppelin Stellar Contracts](https://docs.openzeppelin.com/stellar-contracts) library (specifically, `Ownable`), along with a pre-configured `sorokeep` setup.

Sorokeep helps you monitor your deployed contract and automatically bump its TTL (Time-To-Live) on the Stellar network so it doesn't get archived.

## 1. Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)
- [Sorokeep](https://github.com/stellar/sorokeep) (Installed globally or via npm)

## 2. Build the Contract

```bash
cargo build --target wasm32-unknown-unknown --release
```

## 3. Deploy to Testnet

Make sure your Soroban CLI is configured for Testnet and you have an identity.

```bash
soroban keys generate --network testnet my-key
```

Deploy the contract:

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/openzeppelin_starter.wasm \
  --source my-key \
  --network testnet
```

Take note of the output **Contract ID** (e.g., `C...`).

## 4. Sorokeep Configuration

Edit the `sorokeep.config.yaml` file to use your deployed Contract ID.

```yaml
network: testnet
contracts:
  - id: YOUR_CONTRACT_ID
    # TTL thresholds
    thresholds:
      watch: 7d
      guard: 14d
```

## 5. Using Sorokeep

### Watch

To check the current TTL status of your contract without modifying it:

```bash
sorokeep watch --config sorokeep.config.yaml
```

### Guard

To actively monitor and automatically extend the TTL when it falls below the `guard` threshold:

```bash
sorokeep guard --config sorokeep.config.yaml
```

## 6. GitHub Actions (CI)

This template includes a `.github/workflows/sorokeep-check.yml` workflow which uses the `sorokeep check` action to verify TTLs as part of your CI/CD pipeline.
