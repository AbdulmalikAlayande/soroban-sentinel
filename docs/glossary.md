# Soroban & Stellar TTL Glossary

This glossary defines the Soroban-specific and Stellar-specific terminology used throughout Sorokeep's documentation.

### Archival
The process where a ledger entry is removed from the active Stellar ledger because its Time-To-Live (TTL) expired. Archived data is not permanently deleted, but it cannot be accessed or used by smart contracts until it is restored. [Learn more](https://developers.stellar.org/docs/state-archival)

### Channel Account
An auxiliary Stellar account used specifically to submit transactions without blocking the main account. In automated systems like Sorokeep, channel accounts allow multiple TTL extension transactions to be submitted concurrently. [Learn more](https://developers.stellar.org/docs/learn/glossary#channel-accounts)

### ExtendFootprintTTLOp
A Stellar network operation used to increase the Time-To-Live (TTL) of specific ledger entries by paying a rent fee. This operation is how you keep contract data alive before it reaches expiration. [Learn more](https://developers.stellar.org/docs/state-archival#extending-the-ttl-of-an-entry)

### Footprint
The complete set of ledger entries that a Soroban smart contract reads or writes during a single transaction. Transactions must declare their footprint upfront so the network can safely execute them in parallel. [Learn more](https://developers.stellar.org/docs/learn/smart-contract-internals/fees#footprint)

### Instance Storage
Storage tied directly to a specific Soroban smart contract instance. If a contract's instance storage expires and is archived, the contract itself becomes unusable until the instance is restored. [Learn more](https://developers.stellar.org/docs/learn/smart-contract-internals/storage)

### Ledger Entry
A discrete piece of state stored on the Stellar blockchain, such as an account balance, a smart contract instance, or contract data. Every ledger entry has a limited lifespan and must be maintained to avoid archival. [Learn more](https://developers.stellar.org/docs/state-archival)

### Persistent Storage
Storage used by a smart contract to save state that must be kept indefinitely, such as user balances or admin configurations. Like all Soroban state, persistent storage requires regular rent payments to avoid being archived. [Learn more](https://developers.stellar.org/docs/learn/smart-contract-internals/storage)

### Rent
The fee paid in XLM to the Stellar network to keep a ledger entry alive and prevent its Time-To-Live (TTL) from reaching zero. Paying rent essentially buys more time for the data to remain on the active ledger. [Learn more](https://developers.stellar.org/docs/state-archival)

### RestoreFootprintOp
A Stellar network operation used to recover a ledger entry that has already been archived. Running this operation restores the data to the active ledger and sets a new Time-To-Live (TTL) for it. [Learn more](https://developers.stellar.org/docs/state-archival#restoring-an-archived-entry)

### Sequence Number
A unique, increasing number assigned to every transaction submitted by a Stellar account, ensuring transactions are processed in the correct order. Using channel accounts helps avoid sequence number bottlenecks when submitting multiple transactions simultaneously. [Learn more](https://developers.stellar.org/docs/learn/glossary#sequence-number)

### Temporary Storage
Storage meant for short-lived data that is cheaper to write but cannot be restored once its Time-To-Live (TTL) expires. This is ideal for temporary calculations or time-limited authorizations where data loss is acceptable after expiration. [Learn more](https://developers.stellar.org/docs/learn/smart-contract-internals/storage)

### TTL (Time-To-Live)
The number of ledgers remaining before a specific ledger entry expires and is archived. Developers or users must periodically extend the TTL to keep their contract state accessible. [Learn more](https://developers.stellar.org/docs/state-archival)

### WASM Entry
The ledger entry that contains the actual compiled WebAssembly (WASM) code of a deployed Soroban smart contract. Multiple contract instances can share the same WASM entry, but if it expires, all contracts relying on it will stop functioning. [Learn more](https://developers.stellar.org/docs/state-archival)
