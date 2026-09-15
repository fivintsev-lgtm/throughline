# Throughline — rationale

**Problem space 5:** knowing what's safe and what's live. (Started in space 2 — the
cross-layer identity join survives as one signal inside this.)

## The problem
Before using an Etherlink dApp or sending to an address, a user wants a fast read on
"is this legit, is it active, what am I risking?" Today that means opening two different
explorers, knowing which fields matter, and knowing what a normal value looks like. Every
part of that assumes expertise the person asking does not have.

## Who it's for
Someone about to interact with an address they were given — a dApp contract from a link, or
a counterparty wallet. Then: support teams triaging "is this a scam?", and anyone doing
light diligence who is not a Solidity reader.

## The insight this is built on
**A wallet and a contract must be scored on different axes, because the same signal means
opposite things.**

Most address checkers run one model over everything. Silence is the clearest case: a wallet
idle for 200 days is cold storage — completely normal, and Throughline prints it as a fact
while explicitly refusing to score it. A contract idle for 30 days has no users, because a
contract cannot act on its own. Same signal, opposite verdicts.

The case that proves it: a Tezos oracle with **4.1M lifetime calls and zero in the last 30
days**. Any score built on lifetime volume rates it highly. It has been dead since March.

A second, sharper version of the same mistake nearly shipped in my own scorer: I penalised
a live DEX **aggregator** for holding no funds. Routers, marketplaces and oracles pass value
through and hold nothing *by design*. So liquidity is now scored only for archetypes that
should custody funds — pools, lending markets, farms, bridges — and reported as context
otherwise. **Applying TVL uniformly punishes correct behaviour.**

## The single key assumption
**That behavioural signals — liveness, depth, operator power, track record — are a more
useful proxy for everyday risk than code analysis, for the person actually asking.**

The tool never reads contract logic. It cannot detect a clever exploit or a malicious
implementation behind a proxy. It bets that most real-world loss comes from mundane
things — dead protocols, empty pools, contracts whose admin can rug — and that those are
cheap to measure. If real losses are dominated by code-level exploits, this is the wrong tool.

## What it delivers
- **Fewer avoidable losses**, which is retention. Users who get rugged in week one don't return.
- **Support deflection.** "Is this legit?" becomes a link.
- **A live protocol census.** Scoring every contract on both layers produces something
  nobody has: how many Etherlink protocols are actually alive, and how much value sits in
  abandoned ones. That is an ecosystem-health metric for BD and grants.
- **Distribution wedge.** Wallets and explorers all want a pre-transaction risk read.

## How I'd validate it cheaply, for real
1. **This week:** run the tool over every contract flagged in Discord scam reports in the
   last 3 months. What share does it rate below 50? That's a real hit-rate on real
   incidents, costing an afternoon. Below ~60% and the behavioural bet is wrong.
2. **Control for false positives:** run it over the 50 most-used legitimate contracts on
   both layers. If reputable protocols land in "Avoid" because of admin powers, the
   weighting is miscalibrated and I'd rather learn that from data than argue about it.
3. **Then demand:** put it behind one link in a support channel and count unprompted uses.
4. Only then ask whether it's a product or a feature inside a wallet.

## What I deliberately left out, and why
| Cut | Why | What would change my mind |
|---|---|---|
| **Reading contract logic** | An audit is not a 60-minute job, and a shallow one is worse than none — it would imply a guarantee the tool can't make. | Step 1 above showing losses are code-level, not behavioural. |
| **Proxy implementations** | We detect and flag a proxy but don't follow it. Behaviour lives in the implementation, so the classification is honestly marked low-confidence. | This is the top of the next-slice list — it's a correctness gap, not a missing feature. |
| **Holder concentration / token approvals** | Both are real risk. Neither fits the time. | — |
| **L1 token pricing** | TzKT gives no token prices, so only the XTZ leg is priced. Unpriced positions are excluded and labelled rather than guessed at. | Wrong numbers are worse than absent ones. |
| **Exact L2 activity counts** | Blockscout paginates; we estimate from one page and say so in the UI. | Trivial to fix with an indexer, not worth it for a thin slice. |
| **Cross-layer score comparison** | L1 has no source-verification concept, so L1 contracts structurally cap lower on transparency than L2 ones. | The asymmetry is real, but it makes the two layers' scores unfair to compare, and I'd want a per-layer normalisation before anyone ranks on this. |

## Honest state
Working thin slice on live mainnet data, 23 scoring tests passing offline. The scoring is
pure and isolated in `trust.js` so the weights are arguable rather than buried — I expect
them to be wrong in places and wanted them cheap to change. **Heuristics, not an audit:**
a good score is not a recommendation, and the UI says so.
