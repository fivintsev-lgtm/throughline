# Throughline — rationale

**Problem space 2:** answering an on-chain question that's tedious today.

## The problem
"What happened to the funds I moved?" and "what has this address been doing across L1 and
Etherlink?" are the two questions a Tezos user cannot answer today without manual work.

The reason is sharper than "explorers are per-layer". It's this:

> **There is no such thing as "this address" across the two layers.**
> Tezos L1 identities are base58 (`tz1`/`tz2`/`KT1`). Etherlink L2 identities are 20-byte
> EVM (`0x…`). Different keyspaces. The same human has two unrelated identities and
> nothing on either explorer connects them.

TzKT sees L1 and stops at the rollup boundary. Blockscout sees L2 and starts after it.
The user's own history is cut in half with no seam. Today you reconcile it by hand,
by timestamp and amount, across two tabs.

The only on-chain join key is the **bridge deposit** — and it sits inside a Michelson
parameter as a raw byte blob that no UI decodes.

**So this is a join, not another explorer.** That reframe is the whole idea.

## Who it's for
In order of pain: (1) a user who bridged and thinks funds are lost — the highest-anxiety,
highest-support-cost moment in the ecosystem; (2) support and community teams answering
that ticket; (3) analysts and BD who currently cannot say how many L1 users became
Etherlink users, because nobody can join the two sides.

## Why it matters
Etherlink's growth story depends on L1 users crossing over. Right now **nobody can measure
that crossing**, because the join doesn't exist in any tool. The same missing primitive
that makes a user anxious makes the funnel unmeasurable. Fix it once, get both.

## The single key assumption
**That the bridge deposit is a good enough identity link to be useful, even though it is
not proof of ownership.**

It is explicitly many-to-many — I verified one L2 address funded by three different L1
addresses, and one L1 address depositing to four different L2 addresses. So the product
must present linked identities as *evidence with a count and a date range*, never as
"this is you". The UI does exactly that, and names the ambiguity on screen.
If that framing doesn't survive contact with users, the idea needs rethinking.

## What it delivers
- **Support cost ↓.** The "where are my funds" ticket becomes a link, not an investigation.
- **The missing funnel metric.** L1→L2 user conversion becomes countable for the first
  time: how many unique L1 addresses ever bridged, how many stayed, how much followed them.
  That is a BD and ecosystem-growth number nobody currently has.
- **Distribution wedge.** The join is the hard part and it's reusable — wallets, support
  tooling and dashboards all need the same primitive.

## How I'd validate it cheaply, for real
1. **Cheapest, this week:** take the last ~50 "where are my funds / bridge" questions from
   Discord and support, run each address through this tool, and count how many are answered
   outright. That's a real hit-rate on real demand, and it costs an afternoon. If it's
   below ~50%, my framing of the problem is wrong.
2. **Next:** run the aggregate once over all deposits to the rollup and see whether L1→L2
   conversion is a number anyone reacts to. If ecosystem/BD don't care, the second value
   prop dies and this stays a support tool.
3. **Only then** consider whether it's a product or a feature inside an existing explorer.
   Honestly, the likeliest good outcome is that TzKT or Blockscout should ship this join,
   and the fastest route to impact is a PR to them, not a startup.

## What I deliberately left out, and why
| Cut | Why | What would change my mind |
|---|---|---|
| **Withdrawals (L2→L1)** | Needs outbox-proof decoding plus the ~15-day challenge window. A different parser and a different mental model — that's the *next* slice, not this one. | It's half of "what happened to my funds". This is the first thing I'd build next. |
| **FA token amounts** | Non-XTZ ticketers need per-token decimals. The parser handles the shape; the display says `token` rather than printing a number I can't verify. | Wrong numbers are worse than absent ones, so this stays until decimals are resolved properly. |
| **Pagination beyond 200 deposits / 25 txs per layer** | A recency window answers the actual question. Full history is a scale problem, not an insight problem. | Users asking about deposits older than the window. |
| **Any backend, DB, or indexer** | Both explorers send `access-control-allow-origin: *`, so a static page can query them directly. Zero infra, deploys anywhere. | Rate limits, or aggregate queries — the funnel metric above genuinely needs an indexer. |
| **Visual polish** | The brief scores thinking over artefact and caps at 60 minutes. | — |

## Honest state
Working thin slice, real mainnet data, both directions verified. Not a product.
The riskiest thing here is the assumption above, not the code.
