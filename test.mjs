/* Scoring tests. Pure — no network, so the judgement calls are pinned down and arguable.
 * Run: node test.mjs
 */
import { score, classify, adminPowers } from './trust.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};
const DAY = 86400000;
const base = o => ({
  isContract: true, methods: [], verified: false, scam: false, alias: null,
  contractName: null, proxyType: null, tvlUsd: 0, tvlPartial: false, tokenPositions: 0,
  lifetimeTxs: 0, txs30d: 0, bridgeDeposits: 0, counterparties: 0,
  firstActivity: new Date(Date.now() - 800 * DAY).toISOString(),
  lastActivity: new Date().toISOString(), ...o,
});
const run = f => { const c = classify(f); return { c, s: score(f, c.kind) }; };

console.log('\nThe wallet/contract asymmetry — the core claim');
{
  const idle = { firstActivity: new Date(Date.now() - 800 * DAY).toISOString(),
                 lastActivity: new Date(Date.now() - 200 * DAY).toISOString(), txs30d: 0 };
  const wallet = run(base({ ...idle, isContract: false, lifetimeTxs: 500, tvlUsd: 5000 }));
  const contract = run(base({ ...idle, lifetimeTxs: 500_000, methods: ['swap', 'add_liquidity'], tvlUsd: 5_000_000 }));
  ok('a 200-day-idle wallet is not punished for idling',
     wallet.s.total >= 50, `got ${wallet.s.total}`);
  ok('a 200-day-idle contract is punished hard, despite 500k lifetime calls and $5M TVL',
     contract.s.total < 50, `got ${contract.s.total}`);
  ok('dormancy is reported for wallets but excluded from the score',
     wallet.s.parts.some(p => p.label === 'Dormancy' && p.informational));
  ok('idle contract raises a critical flag',
     contract.s.flags.some(f => f.level === 'critical'));
}

console.log('\nLiveness beats lifetime volume');
{
  const dead = run(base({ lifetimeTxs: 4_000_000, txs30d: 0, methods: ['getPrice', 'submitValue'],
                          lastActivity: new Date(Date.now() - 190 * DAY).toISOString() }));
  const alive = run(base({ lifetimeTxs: 5_000, txs30d: 3_000, methods: ['getPrice', 'submitValue'] }));
  ok('a dead 4M-call contract scores below a live 5k-call one',
     dead.s.total < alive.s.total, `${dead.s.total} vs ${alive.s.total}`);
}

console.log('\nVerified does not mean safe');
{
  const verifiedDead = run(base({ verified: true, txs30d: 0, methods: ['swap', 'addLiquidity'],
                                  lastActivity: new Date(Date.now() - 120 * DAY).toISOString() }));
  ok('verified source cannot lift an abandoned contract out of the danger zone',
     verifiedDead.s.total < 40, `got ${verifiedDead.s.total}`);
  ok('...while still being credited full transparency',
     verifiedDead.s.parts.find(p => p.label === 'Transparency').got === 20);
}

console.log('\nLiquidity is judged against custody, not blindly');
{
  const router = run(base({ methods: ['execute', 'updateDexes', 'updateTokens'], txs30d: 8000, tvlUsd: 0 }));
  const pool = run(base({ methods: ['swap', 'add_liquidity', 'getReserves'], txs30d: 8000, tvlUsd: 0 }));
  ok('an empty router is not scored on liquidity',
     router.s.parts.some(p => p.label === 'Liquidity held' && p.informational));
  ok('an empty AMM pool IS scored on liquidity, and penalised',
     pool.s.parts.some(p => p.label === 'Liquidity held' && !p.informational && p.got <= 2));
  ok('so the empty router outscores the empty pool',
     router.s.total > pool.s.total, `${router.s.total} vs ${pool.s.total}`);
}

console.log('\nClassification');
{
  ok('router beats pool on aggregator interfaces',
     classify(base({ methods: ['execute', 'updateDexes', 'multicall'] })).kind === 'DEX aggregator / router');
  ok('NFT marketplace from ask/offer/fulfill',
     classify(base({ methods: ['ask', 'offer', 'fulfill_ask', 'retract_ask'] })).kind === 'NFT marketplace');
  ok('lending from borrow/repay/liquidate',
     classify(base({ methods: ['borrow', 'repay', 'liquidate'] })).kind === 'Lending market');
  ok('a wallet is never classified as a contract',
     classify(base({ isContract: false, methods: ['swap', 'borrow'] })).kind === 'Wallet');
  ok('"Index Oracle" is not read as a DEX (the substring "dex" lives inside "Index")',
     classify(base({ contractName: 'Ubinetic DeFi Index Oracle 2' })).kind !== 'DEX / AMM');
}

console.log('\nAdmin powers');
{
  const p = adminPowers(['upgrade', 'setAdmin', 'withdrawTokens', 'transfer']);
  ok('detects code replacement, ownership transfer and fund withdrawal', p.length === 3);
  ok('does not flag a plain transfer()', !p.some(x => x.method === 'transfer'));
  const clean = run(base({ methods: ['swap', 'add_liquidity'], txs30d: 5000, tvlUsd: 2e6 }));
  const risky = run(base({ methods: ['swap', 'add_liquidity', 'upgrade', 'withdrawTokens'], txs30d: 5000, tvlUsd: 2e6 }));
  ok('admin powers cost a contract real points',
     risky.s.total < clean.s.total, `${risky.s.total} vs ${clean.s.total}`);
}

console.log('\nHard flags override arithmetic');
{
  const scam = run(base({ scam: true, verified: true, txs30d: 50_000, tvlUsd: 9e6,
                          methods: ['swap', 'add_liquidity'] }));
  ok('a scam flag caps an otherwise perfect contract at 35',
     scam.s.total <= 35, `got ${scam.s.total}`);
}

console.log('\nWallet signals');
{
  const fresh = run(base({ isContract: false, lifetimeTxs: 1, tvlUsd: 0,
                           firstActivity: new Date(Date.now() - 2 * DAY).toISOString() }));
  const estab = run(base({ isContract: false, lifetimeTxs: 2000, tvlUsd: 50_000,
                           bridgeDeposits: 12, tokenPositions: 8, counterparties: 40 }));
  ok('a 2-day-old empty wallet scores low', fresh.s.total < 25, `got ${fresh.s.total}`);
  ok('and is flagged as new', fresh.s.flags.some(f => /less than a week/.test(f.text)));
  ok('an established cross-layer wallet scores high', estab.s.total >= 75, `got ${estab.s.total}`);
  ok('bridge history counts toward footprint',
     estab.s.parts.find(p => p.label === 'Ecosystem footprint').got > 20);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
