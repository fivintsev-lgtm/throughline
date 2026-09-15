/* trust.js — classification and scoring. PURE: no network, no DOM.
 *
 * Kept free of I/O on purpose. Every verdict this tool gives is a function of a plain
 * facts object, so the scoring can be unit-tested and argued with. If you disagree with a
 * score, the weights are all right here.
 */

/* ------------------------------------------------------------------ *
 * 1. What kind of thing is this?
 * ------------------------------------------------------------------ */

// Matched against entrypoint names (L1 Michelson) and ABI function names (L2 Solidity).
// Ordered: the first archetype to clear its threshold wins, so specific beats generic.
const ARCHETYPES = [
  { kind: 'DEX aggregator / router', need: 2, hints: [
    'execute', 'multicall', 'simulate', 'swapwithoutsignature', 'updatedexes',
    'updatetokens', 'approvetokens', 'route', 'swapexactinput', 'exactinput'] },
  { kind: 'DEX / AMM', need: 2, hints: [
    'swap', 'swapexacttokens', 'swaptokens', 'add_liquidity', 'remove_liquidity',
    'addliquidity', 'removeliquidity', 'tokentotez', 'teztotoken', 'tokentotoken',
    'exchange', 'getreserves', 'skim', 'sync', 'burn', 'mintliquidity'] },
  { kind: 'Lending market', need: 2, hints: [
    'borrow', 'repay', 'repayborrow', 'liquidate', 'liquidateborrow', 'supply',
    'redeem', 'collateral', 'mintdebt', 'accrueinterest', 'exchangerate'] },
  { kind: 'NFT marketplace', need: 2, hints: [
    'ask', 'offer', 'fulfill_ask', 'fulfill_offer', 'retract_ask', 'bid', 'auction',
    'listing', 'collect', 'buy', 'makeoffer', 'acceptoffer'] },
  { kind: 'Staking / farm', need: 2, hints: [
    'stake', 'unstake', 'withdrawstake', 'harvest', 'claimrewards', 'claim',
    'getreward', 'farm', 'deposit', 'compound'] },
  { kind: 'Bridge', need: 2, hints: [
    'deposit', 'withdraw', 'finalize', 'relay', 'outbox', 'inbox', 'bridge', 'ticket'] },
  { kind: 'Oracle', need: 2, hints: [
    'updateprice', 'setprice', 'feed', 'submitvalue', 'getprice', 'tick', 'push',
    'report', 'observe', 'latestanswer', 'latestrounddata'] },
  { kind: 'Token', need: 2, hints: [
    'transfer', 'approve', 'balance_of', 'balanceof', 'update_operators', 'totalsupply',
    'mint', 'burn', 'transferfrom', 'allowance'] },
];

// Entrypoints that hand someone unilateral power. These are the real risk surface.
const ADMIN_POWERS = [
  { re: /^(upgrade|update_?lambda|setlambda|updatecontract|setimplementation)$/i,
    label: 'Code can be replaced', weight: 3,
    why: 'An admin can swap the contract’s logic, so today’s audit says nothing about tomorrow’s behaviour.' },
  { re: /^(withdrawtokens?|withdrawall|sweep|drain|rescue\w*|emergencywithdraw)$/i,
    label: 'Admin can move funds out', weight: 3,
    why: 'There is a path for a privileged account to remove assets from the contract.' },
  { re: /^(setadmin|transferownership|setowner|changeadmin|confirmadmin|updateadmin)$/i,
    label: 'Ownership transferable', weight: 1,
    why: 'Control can move to another account.' },
  { re: /^(setpaused|pause|unpause|toggle_?pause|setstopped)$/i,
    label: 'Can be paused', weight: 1,
    why: 'An admin can halt the contract, which may lock your funds in place temporarily.' },
  { re: /^(updatewhitelist|setwhitelist|blacklist|setblacklist|freeze)$/i,
    label: 'Address gating', weight: 2,
    why: 'The operator can allow or block specific addresses.' },
  { re: /^(mint|setminter)$/i,
    label: 'Supply can be minted', weight: 2,
    why: 'New units can be created, which dilutes holders.' },
];

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '');

export function classify(facts) {
  const { isContract, methods = [], alias, contractName, proxyType } = facts;
  if (!isContract) return { kind: 'Wallet', confidence: 'certain', matched: [] };

  const set = methods.map(norm);
  let best = null;
  for (const a of ARCHETYPES) {
    const matched = a.hints.filter(h => set.includes(norm(h)));
    if (matched.length >= a.need && (!best || matched.length > best.matched.length)) {
      best = { kind: a.kind, matched };
    }
  }

  // A proxy forwards calls, so its own ABI says little about what it actually does.
  if (!best && (proxyType || /proxy/i.test(contractName || ''))) {
    return { kind: 'Proxy contract', confidence: 'low', matched: [],
             note: 'Behaviour lives in the implementation contract, not here.' };
  }
  if (!best) {
    // Fall back to the human-given name rather than pretending we know nothing.
    const n = contractName || alias || '';
    // Word boundaries matter here: an earlier version matched "dex" inside "Index"
    // and labelled a price oracle a DEX.
    const W = re => new RegExp(`(^|[^a-z])${re}([^a-z]|$)`, 'i').test(n);
    if (W('oracle') || W('feed'))             return { kind: 'Oracle', confidence: 'low', matched: [], note: 'From its name only.' };
    if (W('dex') || W('swap') || W('router') || W('amm') || W('pool'))
                                              return { kind: 'DEX / AMM', confidence: 'low', matched: [], note: 'From its name only.' };
    if (W('lend') || W('loan') || W('vault')) return { kind: 'Lending market', confidence: 'low', matched: [], note: 'From its name only.' };
    if (W('farm') || W('stake') || W('staking')) return { kind: 'Staking / farm', confidence: 'low', matched: [], note: 'From its name only.' };
    if (W('nft') || W('marketplace'))         return { kind: 'NFT marketplace', confidence: 'low', matched: [], note: 'From its name only.' };
    return { kind: 'Contract (unclassified)', confidence: 'none', matched: [],
             note: methods.length ? 'No archetype matched its interface.' : 'No interface available to read.' };
  }
  return { kind: best.kind, confidence: best.matched.length >= 3 ? 'high' : 'medium', matched: best.matched };
}

export function adminPowers(methods = []) {
  const found = [];
  for (const p of ADMIN_POWERS) {
    const hit = methods.find(m => p.re.test(String(m)));
    if (hit) found.push({ ...p, method: hit });
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * 2. Scoring — deliberately different for wallets and contracts
 * ------------------------------------------------------------------ */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Does this archetype legitimately custody funds?
 * A pool, a lending market or a farm should hold value — thin reserves there are a real
 * warning. A router, marketplace or oracle passes value straight through and holds
 * nothing by design, so scoring it on TVL would punish correct behaviour. Getting this
 * wrong was the most misleading bug in the first cut of this scorer.
 */
const CUSTODIAL = new Set(['DEX / AMM', 'Lending market', 'Staking / farm', 'Bridge', 'Token']);
const custodies = kind => CUSTODIAL.has(kind);
const days = ts => ts ? (Date.now() - new Date(ts)) / 86400000 : Infinity;

/**
 * A contract earns trust by being ALIVE, LIQUID, READABLE and UNPRIVILEGED.
 * Silence is the strongest negative signal there is: a contract does nothing on its own,
 * so no calls in 30 days means no users.
 */
function scoreContract(f, kind) {
  const s = [];
  const holdsFunds = custodies(kind);
  const idle = days(f.lastActivity);
  const recent = f.txs30d;

  // -- Liveness, 35 --------------------------------------------------
  let live, liveNote;
  if (recent === 0 || idle > 90) {
    live = 0;
    liveNote = `No calls in 30 days (last activity ${isFinite(idle) ? Math.round(idle) + ' days ago' : 'never'}). For a contract this is the dead-or-abandoned signal — contracts do not idle by choice, they idle because nobody is using them.`;
  } else if (recent < 10) {
    live = 8;  liveNote = `Only ${recent} calls in 30 days. Barely used.`;
  } else if (recent < 100) {
    live = 18; liveNote = `${recent} calls in 30 days. Modest but real usage.`;
  } else if (recent < 2000) {
    live = 28; liveNote = `${recent.toLocaleString()} calls in 30 days. Healthy usage.`;
  } else {
    live = 35; liveNote = `${recent.toLocaleString()} calls in 30 days. Heavily used.`;
  }
  s.push({ label: 'Liveness', got: live, max: 35, note: liveNote,
           tone: live >= 28 ? 'good' : live >= 8 ? 'warn' : 'bad' });

  // -- Liquidity, 25 -------------------------------------------------
  const usd = f.tvlUsd;
  if (!holdsFunds) {
    s.push({ label: 'Liquidity held', got: null, max: null, informational: true,
      note: `Holds ${usd == null ? 'an unpriced amount' : '~$' + Math.round(usd).toLocaleString()}. Not scored — a ${kind.toLowerCase()} routes value rather than custodying it, so an empty balance is what correct behaviour looks like here. TVL is only counted against pools, lending markets, farms and bridges.`,
      tone: 'info' });
  } else {
  let liq, liqNote;
  if (usd == null) {
    liq = 8; liqNote = 'Holdings could not be priced, so depth is unknown. Treated as neutral rather than guessed.';
  } else if (usd < 1_000) {
    liq = 2;  liqNote = `Holds ~$${Math.round(usd).toLocaleString()}. Too thin to trade against without heavy slippage.`;
  } else if (usd < 50_000) {
    liq = 10; liqNote = `Holds ~$${Math.round(usd).toLocaleString()}. Shallow — fine for small amounts only.`;
  } else if (usd < 1_000_000) {
    liq = 19; liqNote = `Holds ~$${Math.round(usd).toLocaleString()}. Reasonable depth.`;
  } else {
    liq = 25; liqNote = `Holds ~$${Math.round(usd).toLocaleString()}. Deep.`;
  }
  if (f.tvlPartial && usd != null) liqNote += ' Unpriced token positions excluded, so the real figure is higher.';
  s.push({ label: 'Liquidity held', got: liq, max: 25, note: liqNote,
           tone: liq >= 19 ? 'good' : liq >= 10 ? 'warn' : 'bad' });
  }

  // -- Transparency, 20 ----------------------------------------------
  let tr = 0, trNote;
  if (f.verified)      { tr = 20; trNote = 'Source code is verified on the explorer — you can read what it does.'; }
  else if (f.alias)    { tr = 14; trNote = `Indexer labels this "${f.alias}", so it is a recognised project, though source is not verified here.`; }
  else if (f.methods?.length) { tr = 8; trNote = 'Interface is readable, but the source code is not verified.'; }
  else                 { tr = 0;  trNote = 'Unverified and no readable interface. You cannot tell what this does.'; }
  s.push({ label: 'Transparency', got: tr, max: 20, note: trNote,
           tone: tr >= 14 ? 'good' : tr >= 8 ? 'warn' : 'bad' });

  // -- Track record, 20 ----------------------------------------------
  const age = days(f.firstActivity);
  let rec = 0;
  if (age > 365) rec += 10; else if (age > 90) rec += 7; else if (age > 30) rec += 4;
  const lt = f.lifetimeTxs || 0;
  if (lt > 100_000) rec += 10; else if (lt > 10_000) rec += 7; else if (lt > 500) rec += 4; else if (lt > 50) rec += 2;
  s.push({ label: 'Track record', got: rec, max: 20,
           note: `Deployed ${isFinite(age) ? Math.round(age) + ' days ago' : 'at an unknown time'}, ${lt.toLocaleString()} calls all-time.`,
           tone: rec >= 14 ? 'good' : rec >= 6 ? 'warn' : 'bad' });

  // -- Admin power penalty --------------------------------------------
  const powers = adminPowers(f.methods);
  const pen = clamp(powers.reduce((a, p) => a + p.weight, 0) * 3, 0, 25);
  if (pen) {
    s.push({ label: 'Admin powers', got: -pen, max: 0, penalty: true,
             note: `${powers.length} privileged ${powers.length === 1 ? 'function' : 'functions'} in the interface: ${powers.map(p => p.method).join(', ')}. Being upgradeable or pausable is not proof of bad intent — plenty of good protocols are — but it means your risk includes trusting the operator, not just the code.`,
             tone: pen >= 12 ? 'bad' : 'warn' });
  }
  return { parts: s, powers };
}

/**
 * A wallet is a different animal. It cannot act on its own, so idleness proves nothing —
 * a cold wallet untouched for two years is healthy, not dead. What matters instead is
 * whether there is a real history behind it or whether it appeared yesterday.
 */
function scoreWallet(f) {
  const s = [];
  const age = days(f.firstActivity);
  const idle = days(f.lastActivity);

  // -- History, 40 ---------------------------------------------------
  let hist = 0, hNote;
  if (age > 730)      { hist = 25; hNote = `First seen ${Math.round(age / 365 * 10) / 10} years ago.`; }
  else if (age > 365) { hist = 20; hNote = `First seen about a year ago.`; }
  else if (age > 90)  { hist = 14; hNote = `First seen ${Math.round(age)} days ago.`; }
  else if (age > 7)   { hist = 7;  hNote = `Only ${Math.round(age)} days old.`; }
  else                { hist = 0;  hNote = `Brand new — created ${isFinite(age) ? Math.round(age) + ' days' : 'moments'} ago. A fresh address has no reputation to lose, which is the common shape of a throwaway.`; }
  const lt = f.lifetimeTxs || 0;
  const bonus = lt > 1000 ? 15 : lt > 100 ? 11 : lt > 20 ? 7 : lt > 3 ? 3 : 0;
  hist += bonus;
  s.push({ label: 'History', got: hist, max: 40, note: `${hNote} ${lt.toLocaleString()} transactions all-time.`,
           tone: hist >= 28 ? 'good' : hist >= 12 ? 'warn' : 'bad' });

  // -- Dormancy: reported, NOT scored ---------------------------------
  s.push({ label: 'Dormancy', got: null, max: null, informational: true,
           note: isFinite(idle)
             ? `Last active ${Math.round(idle)} days ago. Not scored — for a wallet, sitting still is normal. Cold storage looks exactly like this, so silence here is not evidence of anything.`
             : 'No activity recorded.',
           tone: 'info' });

  // -- Holdings, 25 ---------------------------------------------------
  const usd = f.tvlUsd;
  let hold, holdNote;
  if (usd == null)            { hold = 8;  holdNote = 'Holdings could not be priced.'; }
  else if (usd < 1)           { hold = 0;  holdNote = 'Effectively empty.'; }
  else if (usd < 100)         { hold = 8;  holdNote = `Holds ~$${usd.toFixed(2)}.`; }
  else if (usd < 10_000)      { hold = 18; holdNote = `Holds ~$${Math.round(usd).toLocaleString()}.`; }
  else                        { hold = 25; holdNote = `Holds ~$${Math.round(usd).toLocaleString()}.`; }
  s.push({ label: 'Holdings', got: hold, max: 25, note: holdNote + ' Balance is weak evidence on its own, but an empty brand-new address is the classic disposable.',
           tone: hold >= 18 ? 'good' : hold >= 8 ? 'warn' : 'bad' });

  // -- Ecosystem footprint, 35 ----------------------------------------
  let eco = 0; const bits = [];
  if (f.bridgeDeposits > 0) {
    eco += 20;
    bits.push(`${f.bridgeDeposits} bridge ${f.bridgeDeposits === 1 ? 'deposit' : 'deposits'} between L1 and L2 — this address has verifiably used both layers, which a disposable address almost never does`);
  }
  if (f.tokenPositions > 5)      { eco += 10; bits.push(`holds ${f.tokenPositions} distinct token positions`); }
  else if (f.tokenPositions > 0) { eco += 5;  bits.push(`holds ${f.tokenPositions} token ${f.tokenPositions === 1 ? 'position' : 'positions'}`); }
  if (f.counterparties > 10)     { eco += 5;  bits.push(`interacted with ${f.counterparties}+ distinct addresses`); }
  s.push({ label: 'Ecosystem footprint', got: clamp(eco, 0, 35), max: 35,
           note: bits.length ? bits.join('; ') + '.' : 'No bridge activity, tokens, or breadth of counterparties found.',
           tone: eco >= 20 ? 'good' : eco > 0 ? 'warn' : 'bad' });

  return { parts: s, powers: [] };
}

export function score(facts, kind) {
  const { parts, powers } = facts.isContract ? scoreContract(facts, kind || '') : scoreWallet(facts);

  // Normalise over the categories that actually applied, so skipping an inapplicable one
  // (e.g. liquidity for a router) rescales rather than silently capping the ceiling.
  const pos = parts.filter(p => !p.informational && !p.penalty);
  const maxAvail = pos.reduce((a, p) => a + p.max, 0) || 1;
  const earned = pos.reduce((a, p) => a + p.got, 0);
  const penalty = parts.filter(p => p.penalty).reduce((a, p) => a - p.got, 0);
  const total = clamp(Math.round((earned / maxAvail) * 100 - penalty), 0, 100);

  // Hard flags override the arithmetic. A scam label is not something to average away.
  const flags = [];
  if (facts.scam) flags.push({ level: 'critical', text: 'Flagged as a scam by the explorer. Do not interact.' });
  if (facts.isContract && facts.txs30d === 0)
    flags.push({ level: 'critical', text: 'No activity in 30 days — treat as abandoned until proven otherwise.' });
  if (!facts.isContract && days(facts.firstActivity) < 7)
    flags.push({ level: 'warn', text: 'Address is less than a week old.' });
  if (facts.isContract && !facts.verified && !facts.alias)
    flags.push({ level: 'warn', text: 'Unverified source and no known project label.' });

  const capped = flags.some(f => f.level === 'critical') ? Math.min(total, 35) : total;

  const band =
    capped >= 75 ? { label: 'Looks solid',        tone: 'good' } :
    capped >= 50 ? { label: 'Mixed — read below', tone: 'warn' } :
    capped >= 25 ? { label: 'Weak',               tone: 'bad'  } :
                   { label: 'Avoid',              tone: 'bad'  };

  return { total: capped, raw: total, band, parts, flags, powers };
}
