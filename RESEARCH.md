# Research notes — all verified against live mainnet, 2026-09-15

I validated every one of these with a real request before writing app code. Nothing here
is from documentation or memory.

## Data sources (both usable with no backend)
| Source | Base URL | Auth | CORS |
|---|---|---|---|
| TzKT (Tezos L1) | `https://api.tzkt.io/v1` | none | `access-control-allow-origin: *` |
| Blockscout (Etherlink L2) | `https://explorer.etherlink.com/api/v2` | none | `access-control-allow-origin: *` |

Both return `*`, so a **static page can call them directly from the browser.** This is what
makes a zero-backend build possible in the time budget, and it is why the demo can be a
single file on GitHub Pages.

Liveness check at time of writing: TzKT head level `14957495`, chain `mainnet`.
Etherlink: 53.4M blocks, 104M txs, 1.65M addresses.

## The key discovery: the L1↔L2 join key

Etherlink's smart rollup on L1 is **`sr1Ghq66tYK9y3r8CC1Tf8i8m5nxh8nTvZEf`** (TzKT alias
"Etherlink"), found via `/v1/smart_rollups`.

A bridge deposit is a transaction **to that rollup address**. Its Michelson parameter looks
like this (real, trimmed):

```json
{
  "initiator": { "address": "tz1UFH6EiW8aiUFisw7r3WBxXojUs9wULCrN" },
  "sender":    { "address": "KT1Wj8SUGmnEPFqyahHAcjcNQwe6YGhEXJb5" },
  "target":    { "address": "sr1Ghq66tYK9y3r8CC1Tf8i8m5nxh8nTvZEf", "alias": "Etherlink" },
  "parameter": { "value": { "LL": {
      "bytes":  "3276f9890df42542b006eaed2db9b07d2fad8b24",
      "ticket": { "amount": "1000000",
                  "address": "KT1CeFqjJRJPNVvhvznQrWfHad2jCiDZ6Lyj",
                  "content": { "nat": "0" } } } } }
}
```

Reading it:
- `initiator` → the **L1 identity** (the human). `sender` is just the bridge helper contract.
- `parameter.value.LL.bytes` → **20 raw bytes = the destination L2 address.**
  `3276f9…8b24` → `0x3276f9890DF42542B006eAED2db9b07D2FAD8b24`.
- `ticket.amount` → amount in mutez (`1000000` = 1.0 XTZ).
- `ticket.address` → the ticketer, i.e. *which asset*. `KT1CeFqj…` is the native XTZ
  ticketer (balance ≈ 16.5M XTZ — it is the bridge treasury).

**That single field is the join.** It is present, it is queryable, and no explorer shows it.

### Verified: the link resolves on the other side
`0x3276f9890DF42542B006eAED2db9b07D2FAD8b24` on Etherlink is a real, active EOA:
`901` transactions, `665` token transfers, balance ≈ 2.86 XTZ.

### Verified: the join works in *both* directions
- **L1 → L2:** `/v1/operations/transactions?initiator={tz1}&target=sr1Ghq…`
- **L2 → L1:** `/v1/operations/transactions?target=sr1Ghq…&parameter.LL.bytes={hex}`

TzKT supports filtering on nested Michelson parameter fields, which is what makes the
reverse direction possible. This was the single riskiest assumption in the whole build and
I tested it before committing to the idea.

### Finding that changes the product design
The reverse lookup on `0x3276f9…` returns deposits from **two different L1 addresses**:
`tz2PsYckTYsRp7gb4SZqYJXbGnWx3M5ScSbr` *and* `tz1UFH6EiW8aiUFisw7r3WBxXojUs9wULCrN`.

So the relationship is **many-to-many, not 1:1.** One L2 account can be funded by several
L1 accounts (and vice versa). The UI must therefore present linked identities as
**evidence with a count and a first/last-seen**, never as a confident "this is you".
That is a correctness point, not a cosmetic one — asserting 1:1 would be a lie.

## Known contracts
| Address | Role |
|---|---|
| `sr1Ghq66tYK9y3r8CC1Tf8i8m5nxh8nTvZEf` | Etherlink smart rollup (the L1↔L2 boundary) |
| `KT1CeFqjJRJPNVvhvznQrWfHad2jCiDZ6Lyj` | Native XTZ ticketer / bridge treasury |
| `KT1Wj8SUGmnEPFqyahHAcjcNQwe6YGhEXJb5` | Bridge helper contract (appears as `sender`) |

## Deliberately NOT researched (time)
- **Withdrawals (L2→L1).** These surface on L1 as `smart_rollup_execute_outbox_message`
  operations and need outbox-proof decoding. Real, but a different parser and a ~15-day
  challenge window to model. Cut — see rationale.
- **FA token deposits.** Same shape but a non-XTZ ticketer, so the amount needs per-token
  decimals. The parser handles the shape; only the display metadata is missing.
