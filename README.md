# Throughline

**Is this safe, and is it still alive?** Paste any wallet or contract from **Tezos L1** or
**Etherlink L2** into one box. Get a trust score, a plain-language reason for every point,
and a read on what the contract actually *is* — DEX, lending market, NFT marketplace, oracle.

Live mainnet data. No backend, no API keys, no build step.

```bash
python3 -m http.server 8777   # then open http://127.0.0.1:8777
node test.mjs                 # 23 scoring tests, no network needed
```

(Must be served, not opened as `file://` — it uses ES modules.)

## The idea: wallets and contracts are not the same animal

Most "address checker" tools run one scoring model over everything. That is wrong, and it
is wrong in a way that actively misleads people. **Silence means opposite things for the
two.**

| Signal | Wallet | Contract |
|---|---|---|
| Nothing for 200 days | **Normal.** Cold storage looks exactly like this. Not scored. | **Severe.** A contract can't act on its own — no calls means no users. |
| Empty balance | Weak signal | Severe *if* it should custody funds |
| Huge lifetime tx count | Good | **Nearly meaningless on its own** — see below |
| Unverified source | N/A | Major |
| Admin can upgrade | N/A | Major |

A wallet is a person who may simply be doing nothing. A contract is a service, and a
service with no users is dead. So Throughline scores them on different axes entirely, and
for wallets it prints dormancy as a fact while explicitly **refusing to score it**.

Real case the tool catches: a Tezos oracle with **4.1M lifetime calls** and **zero in the
last 30 days**. Any lifetime-volume-based score rates it highly. It has been dead since March.

## Liquidity is judged against custody, not blindly

You asked for TVL to count, and it does — but applying it uniformly was the most misleading
bug in the first cut of the scorer. A **pool, lending market, farm or bridge** should hold
value; thin reserves there are a genuine warning about slippage and solvency. A **router,
marketplace or oracle** passes value straight through and holds nothing by design.

3Route v4 — a live DEX aggregator with ~7,900 calls a month — holds zero XTZ. Scoring it
on TVL punished correct behaviour. Now liquidity is scored only for custodial archetypes
and reported as context for everything else.

L2 holdings are priced for real (Blockscout returns a per-token `exchange_rate`). On L1 only
the XTZ leg can be priced, so unpriced token positions are **excluded and labelled**, never
guessed at.

## What the score is made of

**Contracts** — Liveness 35 · Liquidity 25 *(custodial only)* · Transparency 20 ·
Track record 20 · minus up to 25 for admin powers.

**Wallets** — History 40 · Holdings 25 · Ecosystem footprint 35. Dormancy: reported, never scored.

Scores are normalised over the categories that actually applied, so skipping an
inapplicable one rescales rather than silently capping the ceiling. Hard flags (scam label,
contract dead 30d) override the arithmetic and cap the result at 35.

## "Who can change things"

Classification reads entrypoint names (L1 Michelson) and ABI function names (L2 Solidity).
The same read exposes the real risk surface — privileged functions:

`upgrade` / `updateContract` → code can be replaced, so today's audit says nothing about
tomorrow. `withdrawTokens` / `sweep` → an admin can move funds out. `setAdmin`, `pause`,
`updateWhitelist`, `mint` → operator control.

Being upgradeable is not proof of bad intent — plenty of good protocols are — but it means
your risk includes trusting the operator, not just the code. The tool says exactly that.

## Cross-layer

For wallets, Throughline also links the two layers. L1 identities are base58 (`tz1`/`KT1`),
L2 are 20-byte EVM (`0x…`) — different keyspaces, so "the same address" doesn't exist across
them. The only on-chain join is the bridge deposit to rollup
`sr1Ghq66tYK9y3r8CC1Tf8i8m5nxh8nTvZEf`, which carries the destination L2 address as raw bytes
in a Michelson parameter that no explorer decodes. Having verifiably used both layers is
strong evidence a wallet isn't disposable, so it feeds the footprint score.

That link is **many-to-many** (one L2 address here is funded by three different L1 addresses),
so it is presented as evidence, never as "this is you".

## Architecture

```
chains.js   every network call; the only file that knows TzKT or Blockscout exist
trust.js    classification + scoring. PURE — no network, no DOM, fully testable
test.mjs    23 tests pinning the judgement calls
app.js      rendering only
```

`trust.js` is pure on purpose: every verdict is a function of a plain facts object, so the
scoring can be unit-tested and argued with rather than taken on faith.

## Limits — read these

- **Heuristics, not an audit.** A good score is not a recommendation. This measures
  liveness, depth, transparency and operator power — not whether the code is correct.
- Reputable protocols get penalised for admin powers they may use responsibly. Deliberate:
  the tool reports the capability, and says plainly that capability ≠ intent.
- L1 has no source-verification concept, so L1 contracts cap lower on transparency than L2
  ones. That asymmetry is real, not a bug, but it makes cross-layer score comparison unfair.
- L2 activity counts come from one page of recent transactions and are **estimates**,
  labelled as such in the UI. L1 counts are exact.
- No price impact, holder concentration, or token-approval risk. See `RATIONALE.md`.
