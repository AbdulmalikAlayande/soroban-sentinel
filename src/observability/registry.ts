/**
 * Central setup point for prom-client metrics exposed by sorokeep's
 * `/metrics` endpoint (the HTTP surface landed in phase-7's first issue).
 *
 * Importing this module registers every `sorokeep_*` metric on
 * prom-client's default `register`. Each per-metric file in
 * `metrics/` is a side-effecting import below — the issue contract
 * intentionally keeps this list trivial so adding a new metric in a
 * future PR is exactly one new import + its registration line.
 *
 * A `/metrics` handler should respond with `register.metrics()` to make
 * the gauges scrapeable.
 */

// Single side-effecting import: importing ttl.js registers the
// sorokeep_entry_ttl_remaining_ledgers gauge on prom-client's default
// register.
import "./metrics/ttl.js";

// Re-export prom-client's default register so callers (tests, future
// `/metrics` handler) have a single, well-known entry point.
// NOTE: Intentionally minimal — issue #331 contract is "one import + one
// registration line". Future phase-7 metric issues each add exactly one
// new side-effecting import line below; reach for `register` from
// `prom-client` directly outside this file.
export { register } from "prom-client";
