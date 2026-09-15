# Throughline

**One user, two layers.** Paste a Tezos L1 address or an Etherlink L2 address and get the
other half of the story — the linked identity on the opposite layer, and a single merged
timeline of both.

Built in 60 minutes as a take-home exercise. Working thin slice, live mainnet data.

## The idea in one paragraph

There is no such thing as "this address" across Tezos L1 and Etherlink. L1 identities are
base58 (`tz1`/`KT1`), L2 identities are 20-byte EVM (`0x…`) — different keyspaces. TzKT sees
L1 and stops at the rollup boundary; Blockscout sees L2 and starts after it. So a user's own
history is split in half with no seam, and today you reconcile it by hand across two tabs.

The only on-chain link is the **bridge deposit**, which carries the destination L2 address as
raw bytes inside a Michelson parameter — a field no explorer decodes. Throughline decodes it
and joins the two sides.

**This is a join, not another explorer.**

## Run it

No build step, no dependencies, no API keys.

```bash
python3 -m http.server 8777
# open http://127.0.0.1:8777
```

(It must be served rather than opened as a `file://` URL, because it uses ES modules.)

Try `tz1UFH6EiW8aiUFisw7r3WBxXojUs9wULCrN` (L1) or
`0x3276f9890DF42542B006eAED2db9b07D2FAD8b24` (L2) — they resolve to each other.

## How the join works

The Etherlink smart rollup on L1 is `sr1Ghq66tYK9y3r8CC1Tf8i8m5nxh8nTvZEf`. A deposit is a
transaction to it whose parameter looks like:

```json
{ "initiator": { "address": "tz1UFH6E…" },
  "parameter": { "value": { "LL": {
      "bytes": "3276f9890df42542b006eaed2db9b07d2fad8b24",
      "ticket": { "amount": "1000000", "address": "KT1CeFqj…" } } } } }
```

`initiator` is the L1 identity. `bytes` is the L2 address. That one field is the join.

Both directions work:

| Direction | Query |
|---|---|
| L1 → L2 | `/v1/operations/transactions?initiator={tz1}&target={rollup}` |
| L2 → L1 | `/v1/operations/transactions?target={rollup}&parameter.LL.bytes={hex}` |

### Two things that only show up against real data

**Routing info is variable-length.** It is not always a bare 20-byte address — mainnet also
carries 40-byte (receiver + proxy) and other shapes. Blindly prefixing `0x` onto the blob
invents addresses that don't exist; on one test address that turned 4 real counterparts into
19 fake ones. We take the first 20 bytes and skip shapes we don't recognise.

**The link is many-to-many.** One L2 address can be funded by several L1 addresses and vice
versa. So the UI shows linked identities as *evidence* — with a deposit count and date range
— and never claims "this is you". Asserting a 1:1 identity would be a lie.

## Architecture

```
index.html   markup
style.css    styles
app.js       rendering only
chains.js    every network call, behind plain functions returning normalised events
```

`chains.js` is deliberately the only file that knows about TzKT or Blockscout, so swapping a
data source or adding a chain doesn't touch the UI.

## Scope

**In:** L1→L2 deposit linking (both lookup directions), per-layer balances and counts,
merged cross-layer timeline, many-to-many disclosure.

**Out, deliberately:** L2→L1 withdrawals (needs outbox-proof decoding and the ~15-day
challenge window), FA token amounts (needs per-token decimals — shown as `token` rather than
a number I can't verify), deep pagination, and any backend. Reasoning in `../02-RATIONALE.md`.
