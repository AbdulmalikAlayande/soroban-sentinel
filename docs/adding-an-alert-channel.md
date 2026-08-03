# Adding a New Alert Channel

Sorokeep ships five alert channels (webhook, Slack, Discord, Telegram, PagerDuty). Adding a sixth doesn't require touching the dispatcher, the CLI's `--type` validation, or the database schema — you implement one file and register it.

This is a worked example adding a hypothetical **Matrix** channel.

## 1. Implement the sender

Create `src/alerts/matrix.ts`. It only needs to satisfy the `AlertChannel` interface from `alerts/types.ts`:

```ts
export interface AlertChannel {
    send(target: string, event: AlertEvent, secret?: string | null): Promise<void>;
}
```

```ts
// src/alerts/matrix.ts
import type { AlertEvent } from "./types.js";
import { getLogger } from "../logging/index.js";

const logger = getLogger().child({ component: "MatrixHandler" });

export async function sendMatrixAlert(roomId: string, event: AlertEvent): Promise<void> {
    logger.debug(`Sending Matrix alert to ${roomId}`, { type: event.type, contractId: event.contractId });

    // Build whatever payload your channel needs from `event` (an AlertEvent —
    // see alerts/types.ts for the full discriminated union: TTL threshold
    // crossings, resource alerts, and state changes).

    const response = await fetch(`https://matrix.example.org/rooms/${roomId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `Sorokeep alert: ${event.type}` }),
    });

    if (!response.ok) {
        throw new Error(`Matrix delivery failed: HTTP ${response.status}`);
    }
}
```

Throw on failure — the dispatcher's retry logic (`alerts/dispatcher.ts`) catches it, increments `retry_count`, and retries on the next daemon cycle. Don't swallow errors here.

Look at `alerts/webhook.ts` or `alerts/pagerduty.ts` for the timeout/AbortController pattern the built-ins use — it's not required, but it's the established convention for anything making an HTTP call.

## 2. Register a `ChannelDefinition`


Add your channel to `src/alerts/builtins.ts` if it's shipping in sorokeep itself, or register it from your own application's startup code if you're embedding sorokeep as a library (`import { registerAlertChannel } from "sorokeep"` — see `src/lib.ts`).

Add your channel to `src/alerts/builtins.ts` if it's shipping in sorokeep itself, register it from your own application's startup code if you're embedding sorokeep as a library (`import { registerAlertChannel } from "sorokeep"` — see `src/lib.ts`), or publish it as an external npm package and load it with `--channel-plugin`.


```ts
import { registerAlertChannel } from "./registry.js";
import { sendMatrixAlert } from "./matrix.js";

registerAlertChannel({
    name: "matrix",
    channel: { send: (target, event) => sendMatrixAlert(target, event) },
    targetOption: "url",
    missingTargetError: "Error: --url is required when --type is matrix.",
    supportsSigning: false,
});
```

Field-by-field:

| Field | Meaning |
|---|---|
| `name` | The value users pass to `--type` and what gets stored in `channel_type`. Must be unique — `registerAlertChannel` throws if the name is already taken. |
| `channel` | Your `AlertChannel` implementation. |
| `targetOption` | Which `alerts add` CLI flag supplies `channel_target` — one of `"url"`, `"channel"`, or `"routingKey"` (the three flags the CLI already exposes). If your channel needs a genuinely new kind of identifier, that's a CLI change — open an issue first. |
| `missingTargetError` | Exact message printed when that flag is omitted. Write the whole sentence — it's shown as-is, not templated. |
| `supportsSigning` | `true` only if this channel should get an auto-generated HMAC `webhook_secret` (like the built-in `webhook` channel does). Almost always `false` for anything that isn't a raw webhook URL. |

If you added it to `builtins.ts`, that's it — `registerBuiltinChannels()` is called once (idempotently) from both `dispatcher.ts` and `commands/alerts.ts`, so your channel is live everywhere.


## 3. What you did *not* need to touch

## 3. External plugin package convention

If you want a channel to be installable without changing sorokeep's source, publish a package whose default export is a registration function. The CLI loads it with `--channel-plugin <package>` and passes in sorokeep's public `registerAlertChannel` function.

```ts
// package entrypoint, e.g. src/index.ts in your npm package
export default function registerMatrixChannel(
    registerAlertChannel: typeof import("sorokeep").registerAlertChannel,
): void {
    registerAlertChannel({
        name: "matrix",
        channel: { send: (target, event) => sendMatrixAlert(target, event) },
        targetOption: "url",
        missingTargetError: "Error: --url is required when --type is matrix.",
        supportsSigning: false,
    });
}
```

Minimal package metadata:

```json
{
  "name": "sorokeep-alert-channel-matrix",
  "type": "module",
  "exports": "./dist/index.js"
}
```

Example CLI usage after `npm install` or a local link:

```bash
sorokeep --channel-plugin sorokeep-alert-channel-matrix alerts add \
  --contract <contractId> \
  --type matrix \
  --url '!room:example.org' \
  --threshold 1000
```

`--channel-plugin` is repeatable and applies before any command runs, so it also works with long-running processes such as `sorokeep daemon`. An invalid or missing plugin package prints a clear error and exits non-zero rather than silently no-op'ing.

## 4. What you did *not* need to touch


- `alerts/dispatcher.ts` — its default channel map is built from the registry (`listAlertChannels()`), not a hardcoded object.
- `commands/alerts.ts` — `alerts add --type matrix ...` resolves your `ChannelDefinition` from the registry; the target flag, error message, and signing behavior all come from what you registered.
- `db/schema.sql` — `channel_type` is a plain `TEXT` column with a non-empty check, not a fixed SQL enum. No migration needed.


## 4. Tests

## 5. Tests


### Contract test suite (recommended first test)

Sorokeep ships a reusable contract test in `tests/alerts/channel-contract.ts`. It verifies that your channel satisfies the `AlertChannel` interface mechanically:

- `send()` returns a `Promise`.
- A network failure causes `send()` to reject (not resolve silently).
- The channel does not throw for any of the four `AlertEvent` variants (`threshold_crossed`, `alert_resolved`, `resource_alert`, `state_changed`).

Call it once per channel, passing a factory for your `AlertChannel` implementation and a callback that stubs your network layer to fail:

```ts
import { runChannelContractTests } from "./channel-contract.js";

describe("Matrix (contract)", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        const okResponse = new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
        vi.stubGlobal("fetch", mockFetch.mockResolvedValue(okResponse));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    runChannelContractTests(
        "matrix",
        () => ({ send: (target, event) => sendMatrixAlert(target, event) }),
        () => { mockFetch.mockRejectedValue(new Error("ECONNREFUSED")); },
    );
});
```

Running the contract suite against a broken channel (e.g. one that swallows network errors) will fail, giving you confidence your implementation is correct before writing any channel-specific tests.

### Channel-specific tests

Follow the pattern in `tests/alerts/builtins.test.ts`: mock the underlying module (e.g. `vi.mock("../../src/alerts/matrix.js", ...)`), then assert the registered `channel.send` delegates to it with the right arguments. Add a contract-shaped test the way `tests/db/repositories.test.ts`'s `"accepts discord as a valid channel_type"` tests do, if your channel needs any DB-level exercise beyond what's already generic.

Per [CONTRIBUTING.md](../CONTRIBUTING.md#test-driven-development), write the test first.


## 5. Docs

## 6. Docs

Add your channel to the table in `README.md`'s Alerting section, and to `sorokeep alerts add`'s `--type` help text in the same file.
