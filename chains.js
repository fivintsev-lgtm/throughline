/* chains.js — the data layer.
 *
 * Deliberately isolated from the UI: every network call lives here, behind plain
 * functions that return normalised events. If a constraint shifts (different chain,
 * different explorer, an indexer of our own) only this file changes.
 */

export const TZKT = 'https://api.tzkt.io/v1';
export const BLOCKSCOUT = 'https://explorer.etherlink.com/api/v2';

// The L1 <-> L2 boundary. Verified via TzKT /v1/smart_rollups (alias "Etherlink").
export const ROLLUP = 'sr1Ghq66tYK9y3r8CC1Tf8i8m5nxh8nTvZEf';

// Ticketer for native XTZ. Other ticketers = FA tokens (not decoded in this slice).
const XTZ_TICKETER = 'KT1CeFqjJRJPNVvhvznQrWfHad2jCiDZ6Lyj';

export const L1 = 'L1';
export const L2 = 'L2';

/** Which keyspace does this string belong to? They are genuinely different namespaces. */
export function detect(addr) {
  const a = (addr || '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return { layer: L2, addr: a.toLowerCase() };
  if (/^(tz[123]|KT1)[0-9A-Za-z]{33}$/.test(a)) return { layer: L1, addr: a };
  return null;
}

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r.json();
}

/* ------------------------------------------------------------------ *
 * The join. This is the whole point of the tool.
 * ------------------------------------------------------------------ */

/**
 * Bridge deposits are transactions to the rollup whose Michelson parameter carries the
 * destination L2 address as 20 raw bytes. That field is the only on-chain link between
 * a tz1 identity and a 0x identity — and no explorer surfaces it.
 */
function parseDeposit(op) {
  const v = op.parameter?.value?.LL;
  if (!v?.bytes) return null;

  // Routing info is NOT always a bare 20-byte address. Observed on mainnet:
  //   40 hex chars = receiver
  //   80 hex chars = receiver + proxy contract
  //   anything else = a differently-shaped routing payload (e.g. Tezos-forged `01…`)
  // Blindly prefixing "0x" onto the whole blob invents addresses that do not exist,
  // so we take the receiver only and skip shapes we don't understand.
  const hex = v.bytes.toLowerCase();
  if (hex.length !== 40 && hex.length !== 80) return null;
  const receiver = hex.slice(0, 40);
  const proxy = hex.length === 80 ? '0x' + hex.slice(40) : null;
  const ticketer = v.ticket?.address;
  const raw = v.ticket?.amount;
  return {
    layer: 'BRIDGE',
    kind: 'Bridge deposit',
    ts: op.timestamp,
    hash: op.hash,
    l1: op.initiator?.address || op.sender?.address,
    l2: '0x' + receiver,
    proxy,
    // Native XTZ is mutez. A non-XTZ ticketer is an FA token whose decimals we
    // haven't resolved, so we say so rather than printing a wrong number.
    amount: ticketer === XTZ_TICKETER ? Number(raw) / 1e6 : null,
    asset: ticketer === XTZ_TICKETER ? 'XTZ' : 'token',
    ticketer,
  };
}

/** Deposits sent BY an L1 account. Direction: tz1 -> 0x */
export async function depositsFromL1(addr) {
  const ops = await get(
    `${TZKT}/operations/transactions?initiator=${addr}&target=${ROLLUP}` +
    `&status=applied&limit=200&sort.desc=id`
  );
  return ops.map(parseDeposit).filter(Boolean);
}

/** Deposits sent TO an L2 account. Direction: 0x -> tz1 (the reverse lookup). */
export async function depositsToL2(addr) {
  const hex = addr.replace(/^0x/, '').toLowerCase();
  const ops = await get(
    `${TZKT}/operations/transactions?target=${ROLLUP}&parameter.LL.bytes=${hex}` +
    `&status=applied&limit=200&sort.desc=id`
  );
  return ops.map(parseDeposit).filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Per-layer activity
 * ------------------------------------------------------------------ */

export async function l1Account(addr) {
  const a = await get(`${TZKT}/accounts/${addr}`);
  return {
    layer: L1, addr,
    balance: (a.balance || 0) / 1e6,
    symbol: 'XTZ',
    txCount: a.numTransactions ?? 0,
    firstSeen: a.firstActivityTime,
    lastSeen: a.lastActivityTime,
    kind: a.type === 'contract' ? 'contract' : 'account',
    alias: a.alias || null,
  };
}

export async function l1Activity(addr, limit = 25) {
  const ops = await get(
    `${TZKT}/accounts/${addr}/operations?type=transaction&limit=${limit}`
  );
  return ops.map(op => {
    const out = op.sender?.address === addr;
    return {
      layer: L1,
      kind: op.parameter?.entrypoint ? `call: ${op.parameter.entrypoint}` : (out ? 'sent' : 'received'),
      ts: op.timestamp,
      hash: op.hash,
      counterparty: out ? op.target?.address : op.sender?.address,
      counterpartyAlias: (out ? op.target?.alias : op.sender?.alias) || null,
      amount: (op.amount || 0) / 1e6,
      asset: 'XTZ',
      out,
      failed: op.status !== 'applied',
      toRollup: op.target?.address === ROLLUP,
    };
  });
}

export async function l2Account(addr) {
  const [a, c] = await Promise.all([
    get(`${BLOCKSCOUT}/addresses/${addr}`),
    get(`${BLOCKSCOUT}/addresses/${addr}/counters`).catch(() => ({})),
  ]);
  return {
    layer: L2, addr,
    balance: Number(a.coin_balance || 0) / 1e18,
    symbol: 'XTZ',
    txCount: Number(c.transactions_count || 0),
    tokenTransfers: Number(c.token_transfers_count || 0),
    kind: a.is_contract ? 'contract' : 'account',
    alias: a.name || null,
    verified: !!a.is_verified,
    scam: !!a.is_scam,
  };
}

export async function l2Activity(addr) {
  const d = await get(`${BLOCKSCOUT}/addresses/${addr}/transactions`);
  const lower = addr.toLowerCase();
  return (d.items || []).slice(0, 25).map(t => {
    const out = (t.from?.hash || '').toLowerCase() === lower;
    const cp = out ? t.to : t.from;
    return {
      layer: L2,
      kind: t.method || (out ? 'sent' : 'received'),
      ts: t.timestamp,
      hash: t.hash,
      counterparty: cp?.hash,
      counterpartyAlias: cp?.name || null,
      amount: Number(t.value || 0) / 1e18,
      asset: 'XTZ',
      out,
      failed: t.status === 'error',
    };
  });
}

/* ------------------------------------------------------------------ *
 * Resolve one input into a cross-layer picture.
 * ------------------------------------------------------------------ */

/** Collapse deposits into counterpart identities, with evidence attached. */
function summariseCounterparts(deposits, field) {
  const by = new Map();
  for (const d of deposits) {
    const k = d[field];
    if (!k) continue;
    const e = by.get(k) || { addr: k, count: 0, total: 0, unpriced: 0, first: d.ts, last: d.ts };
    e.count++;
    if (d.amount == null) e.unpriced++; else e.total += d.amount;
    if (d.ts < e.first) e.first = d.ts;
    if (d.ts > e.last) e.last = d.ts;
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

export async function resolve(input) {
  const det = detect(input);
  if (!det) throw new Error('Not a Tezos (tz1/tz2/tz3/KT1) or Etherlink (0x…) address.');

  const origin = det.layer;
  const deposits = origin === L1 ? await depositsFromL1(det.addr) : await depositsToL2(det.addr);
  const counterparts = summariseCounterparts(deposits, origin === L1 ? 'l2' : 'l1');

  // The strongest counterpart is the one we expand. Others are reported, not merged —
  // the relationship is many-to-many and pretending otherwise would be wrong.
  const primary = counterparts[0]?.addr || null;

  const self = origin === L1 ? l1Account(det.addr) : l2Account(det.addr);
  const selfActs = origin === L1 ? l1Activity(det.addr) : l2Activity(det.addr);
  const other = primary ? (origin === L1 ? l2Account(primary) : l1Account(primary)) : null;
  const otherActs = primary ? (origin === L1 ? l2Activity(primary) : l1Activity(primary)) : null;

  const [selfAcct, selfEvents, otherAcct, otherEvents] = await Promise.all([
    self.catch(e => ({ error: e.message })),
    selfActs.catch(() => []),
    other ? other.catch(e => ({ error: e.message })) : null,
    otherActs ? otherActs.catch(() => []) : [],
  ]);

  const timeline = [...selfEvents, ...otherEvents, ...deposits]
    .filter(e => e.ts)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));

  return { origin, input: det.addr, selfAcct, otherAcct, counterparts, deposits, timeline };
}

/* ================================================================== *
 * Trust profile: gather the FACTS for one address, on either layer.
 * Scoring lives in trust.js and never touches the network.
 * ================================================================== */

const DAY = 86400000;
const iso = d => new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');

/** XTZ/USD, straight from the indexer's own quote. */
async function xtzUsd() {
  try { return (await get(`${TZKT}/head`)).quoteUsd || 0; } catch { return 0; }
}

async function l1Profile(addr) {
  const since = iso(Date.now() - 30 * DAY);
  const [acct, rate] = await Promise.all([get(`${TZKT}/accounts/${addr}`), xtzUsd()]);
  const isContract = acct.type === 'contract';

  const [entrypoints, txs30d, tokens] = await Promise.all([
    isContract
      ? get(`${TZKT}/contracts/${addr}/entrypoints?select=name`).catch(() => [])
      : Promise.resolve([]),
    get(`${TZKT}/operations/transactions/count?target=${addr}&timestamp.ge=${since}`).catch(() => 0),
    get(`${TZKT}/tokens/balances?account=${addr}&limit=200&select=balance,token`).catch(() => []),
  ]);

  const xtz = (acct.balance || 0) / 1e6;
  // TzKT does not price tokens, so only the XTZ leg is priced. We say so rather than
  // inventing a TVL — an unpriced position is excluded, never guessed at.
  const tokenPositions = tokens.filter(t => Number(t.balance) > 0).length;

  return {
    layer: L1, addr, isContract,
    kindLabel: isContract ? 'contract' : (acct.type === 'delegate' ? 'wallet (baker)' : 'wallet'),
    alias: acct.alias || null,
    contractName: acct.alias || null,
    methods: entrypoints.map(e => e.name).filter(Boolean),
    verified: false,               // TzKT has no source-verification concept
    scam: false,
    proxyType: null,
    balance: xtz, symbol: 'XTZ',
    tvlUsd: rate ? xtz * rate : null,
    tvlPartial: tokenPositions > 0,
    tokenPositions,
    lifetimeTxs: acct.numTransactions || 0,
    txs30d: Number(txs30d) || 0,
    firstActivity: acct.firstActivityTime,
    lastActivity: acct.lastActivityTime,
    counterparties: null,
  };
}

async function l2Profile(addr) {
  const [acct, counters] = await Promise.all([
    get(`${BLOCKSCOUT}/addresses/${addr}`),
    get(`${BLOCKSCOUT}/addresses/${addr}/counters`).catch(() => ({})),
  ]);
  const isContract = !!acct.is_contract;

  const [sc, toks, txs] = await Promise.all([
    isContract ? get(`${BLOCKSCOUT}/smart-contracts/${addr}`).catch(() => null) : null,
    get(`${BLOCKSCOUT}/addresses/${addr}/token-balances`).catch(() => []),
    get(`${BLOCKSCOUT}/addresses/${addr}/transactions`).catch(() => ({ items: [] })),
  ]);

  const methods = (sc?.abi || [])
    .filter(x => x.type === 'function')
    .map(x => x.name).filter(Boolean);

  const xtz = Number(acct.coin_balance || 0) / 1e18;
  const rate = Number(acct.exchange_rate || 0);
  let usd = rate ? xtz * rate : 0;
  let unpriced = 0, positions = 0;

  // Blockscout DOES give an exchange_rate per token, so L2 holdings can be priced for real.
  for (const t of (Array.isArray(toks) ? toks : toks.items || [])) {
    const v = Number(t.value || 0);
    if (!v) continue;
    positions++;
    const dec = Number(t.token?.decimals ?? 18);
    const r = Number(t.token?.exchange_rate || 0);
    if (r) usd += (v / 10 ** dec) * r; else unpriced++;
  }

  // Liveness window: count how many of the recent transactions fall inside 30 days.
  const items = txs.items || [];
  const cutoff = Date.now() - 30 * DAY;
  const inWindow = items.filter(t => new Date(t.timestamp) >= cutoff).length;
  // One page only; if the whole page is recent, real volume is higher than we can see.
  const txs30d = inWindow === items.length && items.length > 0 ? items.length * 10 : inWindow;

  const first = items.length ? items[items.length - 1].timestamp : null;
  const last = items.length ? items[0].timestamp : null;
  const cps = new Set();
  for (const t of items) { if (t.to?.hash) cps.add(t.to.hash); if (t.from?.hash) cps.add(t.from.hash); }

  return {
    layer: L2, addr, isContract,
    kindLabel: isContract ? 'contract' : 'wallet',
    alias: acct.name || null,
    contractName: sc?.name || acct.name || null,
    methods,
    verified: !!(sc?.verified_at || acct.is_verified),
    scam: !!acct.is_scam,
    proxyType: acct.proxy_type || sc?.proxy_type || null,
    balance: xtz, symbol: 'XTZ',
    tvlUsd: usd,
    tvlPartial: unpriced > 0,
    tokenPositions: positions,
    lifetimeTxs: Number(counters.transactions_count || items.length || 0),
    txs30d,
    // Blockscout gives no creation date for EOAs, so "first seen" is a floor, not a fact.
    firstActivity: acct.creation_transaction_hash ? null : first,
    firstActivityApprox: !acct.creation_transaction_hash,
    lastActivity: last,
    counterparties: cps.size,
    txs30dApprox: inWindow === items.length && items.length > 0,
  };
}

/** One address in, full fact sheet out — plus the cross-layer link where one exists. */
export async function profile(input) {
  const det = detect(input);
  if (!det) throw new Error('Not a Tezos (tz1/tz2/tz3/KT1) or Etherlink (0x…) address.');

  const facts = det.layer === L1 ? await l1Profile(det.addr) : await l2Profile(det.addr);

  // Reuse the bridge join: cross-layer presence is real evidence for a wallet.
  let counterparts = [];
  if (!facts.isContract) {
    try {
      const deps = det.layer === L1 ? await depositsFromL1(det.addr) : await depositsToL2(det.addr);
      facts.bridgeDeposits = deps.length;
      const key = det.layer === L1 ? 'l2' : 'l1';
      counterparts = [...new Set(deps.map(d => d[key]).filter(Boolean))];
    } catch { facts.bridgeDeposits = 0; }
  } else {
    facts.bridgeDeposits = 0;
  }

  return { facts, counterparts };
}

/* ================================================================== *
 * "What happened to the funds I moved?"
 *
 * A deposit is credited on L2 as a plain transfer from the protocol address
 * 0x…FEeD. Matching an L1 deposit to its L2 credit by (destination, amount, time)
 * turns "did my money arrive?" into a yes/no with a latency, instead of two tabs
 * and a squint. Measured latency on mainnet is consistently 13–14 seconds.
 * ================================================================== */

export const L2_MINTER = '0x000000000000000000000000000000000000feed';

/** Recent inbound credits from the bridge, across a few pages. */
async function bridgeCredits(l2addr, pages = 3) {
  const seen = [];
  let url = `${BLOCKSCOUT}/addresses/${l2addr}/transactions`;
  for (let i = 0; i < pages; i++) {
    let d;
    try { d = await get(url); } catch { break; }
    for (const t of d.items || []) {
      if (((t.from?.hash) || '').toLowerCase() === L2_MINTER) {
        seen.push({ ts: new Date(t.timestamp), amount: Number(t.value || 0) / 1e18, hash: t.hash });
      }
    }
    const np = d.next_page_params;
    if (!np) break;
    url = `${BLOCKSCOUT}/addresses/${l2addr}/transactions?` +
          new URLSearchParams(Object.entries(np).filter(([, v]) => v != null)).toString();
  }
  return seen;
}

/**
 * Trace every L1→L2 deposit for an address and say what became of it.
 *
 * The important distinction is between "we checked and it did not arrive" and
 * "we cannot see far enough back to tell". Reporting the second as the first would
 * tell someone their money is gone when it is not — so unconfirmable deposits are
 * labelled `unknown`, never `missing`.
 */
export async function traceFunds(input) {
  const det = detect(input);
  if (!det) throw new Error('Not a Tezos or Etherlink address.');

  const deposits = det.layer === L1
    ? await depositsFromL1(det.addr)
    : await depositsToL2(det.addr);
  if (!deposits.length) return { origin: det.layer, addr: det.addr, moves: [], horizon: null };

  // Group by destination so we only pull each L2 account's credits once.
  const byDest = new Map();
  for (const d of deposits) {
    if (!byDest.has(d.l2)) byDest.set(d.l2, []);
    byDest.get(d.l2).push(d);
  }

  const moves = [];
  let horizon = null;                       // oldest L2 credit we can actually see
  for (const [dest, list] of byDest) {
    const credits = await bridgeCredits(dest);
    const used = new Set();
    const oldest = credits.length ? new Date(Math.min(...credits.map(c => +c.ts))) : null;
    if (oldest && (!horizon || oldest < horizon)) horizon = oldest;

    for (const d of list) {
      const t0 = new Date(d.ts);
      // Same destination, same amount, credited after the deposit and within an hour.
      // Each credit can only settle one deposit, so repeated identical amounts don't
      // all match the same arrival.
      const i = credits.findIndex((c, idx) =>
        !used.has(idx) && Math.abs(c.amount - (d.amount ?? -1)) < 1e-9 &&
        c.ts >= t0 && (c.ts - t0) < 3600e3);

      if (i >= 0) {
        used.add(i);
        moves.push({ ...d, status: 'arrived', latencySec: Math.round((credits[i].ts - t0) / 1000),
                     creditHash: credits[i].hash });
      } else if (d.amount == null) {
        moves.push({ ...d, status: 'unknown',
                     reason: 'Token deposit — we do not resolve this token’s decimals, so we cannot match it by amount.' });
      } else if (!credits.length) {
        // No visible credits at all for this destination means we have NO evidence,
        // which is not the same as evidence of absence. Calling this "missing" would
        // tell someone their funds vanished on the strength of nothing.
        moves.push({ ...d, status: 'unknown',
                     reason: 'No bridge credits visible for the destination address, so there is nothing to match against either way.' });
      } else if (d.proxy) {
        moves.push({ ...d, status: 'unknown',
                     reason: 'Routed via a proxy, so the credit lands somewhere other than the receiver and cannot be matched by amount.' });
      } else if (oldest && t0 < oldest) {
        moves.push({ ...d, status: 'unknown',
                     reason: 'Older than the L2 history we can read here, so arrival cannot be confirmed either way.' });
      } else if ((Date.now() - t0) < 10 * 60 * 1000) {
        moves.push({ ...d, status: 'pending',
                     reason: 'Sent within the last few minutes. Deposits normally land in about 15 seconds.' });
      } else {
        moves.push({ ...d, status: 'missing',
                     reason: 'No matching credit on L2, and we can see far enough back to expect one.' });
      }
    }
  }
  moves.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return { origin: det.layer, addr: det.addr, moves, horizon };
}
