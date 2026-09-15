# Throughline — rationale

Paste any wallet or contract, Tezos L1 or Etherlink L2, into one box. Get a trust read,
what the contract actually is, and what happened to funds you bridged.

**Problem.** Two questions have no good answer today: *"is this dApp safe and still alive?"*
and *"where are the funds I moved?"* Explorers are per-layer, and reading them takes
expertise the person asking doesn't have.

**For whom.** Anyone about to interact with an address they were handed — a dApp link or a
counterparty. Then support teams triaging "is this a scam?" and "where's my money?"

**Why it matters.** Both are the highest-anxiety moments in the ecosystem, and both are
where users quit. Etherlink's growth depends on L1 users crossing over; the same missing
primitive that makes them anxious also makes the funnel unmeasurable.

**The insight it's built on.** Wallets and contracts must be scored on different axes,
because the same signal inverts. A wallet idle 200 days is cold storage — reported, never
scored. A contract idle 30 days has no users, because a contract can't act on its own.
A Tezos oracle with **4.1M lifetime calls and zero in 30 days** has been dead since March;
any lifetime-volume score rates it highly. Same for liquidity: pools and lending markets
should hold value, but routers and marketplaces hold nothing *by design*, so TVL is scored
only where custody applies.

**Key assumption (the one to attack).** That behavioural signals — liveness, depth, operator
power, track record — proxy everyday risk better than code analysis, for this user. The tool
never reads contract logic. It bets most real loss is mundane: dead protocols, empty pools,
admins who can rug. If losses are dominated by code-level exploits, this is the wrong tool.

**What it delivers.**
- **Retention** — users rugged in week one don't come back.
- **Support deflection** — "is this legit / where are my funds" becomes a link.
- **An ecosystem metric nobody has** — score every contract on both layers and you get a live
  protocol census: how many are actually alive, how much value sits in abandoned ones.

**How I'd validate it cheaply.**
1. Run it over every contract named in Discord scam reports from the last 3 months. What share
   scores below 50? Real hit-rate, real incidents, one afternoon. Under ~60% and the bet is wrong.
2. Run it over the 50 most-used legitimate contracts. If reputable protocols land in "Avoid"
   because of admin powers, my weighting is miscalibrated — better learned from data than argued.
3. Only then: put it behind one link in a support channel and count unprompted uses.

**Deliberately left out.**
- **Reading contract logic.** An audit isn't a 60-minute job and a shallow one is worse than
  none — it implies a guarantee the tool can't make.
- **Withdrawals (L2→L1).** Half of "where are my funds", and the half where people panic.
  Needs outbox-proof decoding and the ~15-day challenge window. First thing I'd build next.
- **Following proxies.** We flag a proxy but don't follow it, so classification is honestly
  marked low-confidence. A correctness gap, not a missing feature.
- **L1 token pricing.** TzKT gives no token prices, so unpriced positions are excluded and
  labelled. Wrong numbers are worse than absent ones.

**Honest state.** Working thin slice on live mainnet, 23 scoring tests passing offline.
Scoring is pure and isolated in `trust.js` so the weights are arguable rather than buried —
I expect them to be wrong in places and wanted them cheap to change. **Heuristics, not an
audit:** a good score is not a recommendation, and the UI says so.

One caveat I'd raise before anyone ranks on this: L1 has no source-verification concept, so
L1 contracts structurally cap lower on transparency than L2 ones. The scores aren't yet fair
to compare across layers.
