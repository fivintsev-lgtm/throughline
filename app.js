import { profile, detect, L1 } from './chains.js';
import { score, classify } from './trust.js';

const out = document.getElementById('out');
const q = document.getElementById('q');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = a => !a ? '—' : (a.length > 24 ? `${a.slice(0, 12)}…${a.slice(-8)}` : a);
const n0 = n => Number(n || 0).toLocaleString('en', { maximumFractionDigits: 0 });
const usd = v => v == null ? 'unpriced' : '$' + Number(v).toLocaleString('en', { maximumFractionDigits: v < 100 ? 2 : 0 });
const ago = ts => {
  if (!ts) return 'never';
  const d = (Date.now() - new Date(ts)) / 86400000;
  if (d < 1) return 'today';
  if (d < 60) return `${Math.round(d)}d ago`;
  if (d < 730) return `${Math.round(d / 30)}mo ago`;
  return `${(d / 365).toFixed(1)}y ago`;
};
const link = (layer, addr) => layer === L1
  ? `https://tzkt.io/${addr}` : `https://explorer.etherlink.com/address/${addr}`;

function dial(total, tone) {
  const C = 2 * Math.PI * 42;
  const on = C * (total / 100);
  const col = { good: '#22c55e', warn: '#f59e0b', bad: '#f87171' }[tone];
  return `<div class="dial">
    <svg width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r="42" fill="none" stroke="#272e38" stroke-width="7"/>
      <circle cx="48" cy="48" r="42" fill="none" stroke="${col}" stroke-width="7"
        stroke-linecap="round" stroke-dasharray="${on} ${C - on}"/>
    </svg><div class="n" style="color:${col}">${total}</div></div>`;
}

function render(input, { facts, counterparts }) {
  const cls = classify(facts);
  const s = score(facts, cls.kind);

  const name = facts.contractName || facts.alias;
  const conf = cls.confidence === 'high' ? '' :
    ` <span class="chip">${cls.confidence === 'none' ? 'unclassified' : cls.confidence + ' confidence'}</span>`;

  const chips = [
    `<span class="chip ${facts.layer}">${facts.layer === L1 ? 'Tezos L1' : 'Etherlink L2'}</span>`,
    `<span class="chip">${esc(facts.kindLabel)}</span>`,
    facts.isContract
      ? (facts.verified ? '<span class="chip on">source verified</span>'
                        : '<span class="chip off">source unverified</span>')
      : '',
    facts.proxyType ? '<span class="chip off">proxy</span>' : '',
    facts.isContract
      ? (facts.txs30d > 0 ? '<span class="chip on">active</span>'
                          : '<span class="chip off">no activity in 30d</span>')
      : '',
  ].filter(Boolean).join('');

  const parts = s.parts.map(p => {
    const pct = p.informational ? 0 : Math.max(0, (p.got / (p.max || 1)) * 100);
    const val = p.informational ? 'not scored'
      : p.penalty ? `${p.got} pts` : `${p.got} / ${p.max}`;
    return `<div class="part ${p.tone}">
      <div class="prow"><span class="plabel">${esc(p.label)}</span>
        <span class="pscore">${val}</span></div>
      <p class="pnote">${esc(p.note)}</p>
      ${p.informational || p.penalty ? '' : `<div class="bar"><i style="width:${pct}%"></i></div>`}
    </div>`;
  }).join('');

  const facts_ = [
    ['Activity (30d)', facts.isContract ? n0(facts.txs30d) : n0(facts.txs30d),
      facts.txs30dApprox ? 'estimated from recent page' : (facts.isContract ? 'calls received' : 'transactions')],
    ['Lifetime txs', n0(facts.lifetimeTxs), ''],
    ['Last active', ago(facts.lastActivity), facts.isContract ? '' : 'not scored for wallets'],
    ['First seen', ago(facts.firstActivity), facts.firstActivityApprox ? 'floor — earlier history may exist' : ''],
    ['Value held', usd(facts.tvlUsd), facts.tvlPartial ? 'excludes unpriced tokens' : ''],
    ['Token positions', n0(facts.tokenPositions), ''],
  ].map(([k, v, sub]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b>
      ${sub ? `<em>${esc(sub)}</em>` : ''}</div>`).join('');

  out.innerHTML = `
    <div class="verdict ${s.band.tone}">
      ${dial(s.total, s.band.tone)}
      <div class="vhead">
        <p class="band">${s.band.label} · ${s.total}/100</p>
        <p class="what">${name ? `<b>${esc(name)}</b> — ` : ''}<b>${esc(cls.kind)}</b>${conf}
          ${cls.note ? `<br><span>${esc(cls.note)}</span>` : ''}
          ${cls.matched?.length ? `<br><span>Identified from its interface: <code>${cls.matched.slice(0, 6).map(esc).join('</code>, <code>')}</code></span>` : ''}
        </p>
        <div class="chips">${chips}</div>
        <div class="addrline"><a href="${link(facts.layer, facts.addr)}" target="_blank"
          rel="noopener">${esc(facts.addr)}</a></div>
      </div>
    </div>

    ${s.flags.length ? `<div class="flags">${s.flags.map(f =>
      `<div class="flag ${f.level}"><i>${f.level === 'critical' ? '✕' : '!'}</i>
       <span>${esc(f.text)}</span></div>`).join('')}</div>` : ''}

    <h2>Why this score</h2>
    <div class="parts">${parts}</div>

    ${s.powers.length ? `<h2>Who can change things</h2>
      <div class="powers">${s.powers.map(p => `<div class="power">
        <b>${esc(p.label)}</b> — <code>${esc(p.method)}()</code>
        <p>${esc(p.why)}</p></div>`).join('')}</div>` : ''}

    <h2>Facts</h2>
    <div class="facts">${facts_}</div>

    ${!facts.isContract ? `<h2>Cross-layer presence</h2>
      <div class="linked">${counterparts.length
        ? `${facts.bridgeDeposits} bridge ${facts.bridgeDeposits === 1 ? 'deposit' : 'deposits'}
           link this address to ${counterparts.length} address${counterparts.length === 1 ? '' : 'es'}
           on ${facts.layer === L1 ? 'Etherlink' : 'Tezos L1'}:
           ${counterparts.slice(0, 4).map(a =>
             `<code><a href="${link(facts.layer === L1 ? 'L2' : L1, a)}" target="_blank" rel="noopener">${esc(short(a))}</a></code>`).join(', ')}.
           Bridge deposits are evidence of the same user, not proof — the relationship is
           many-to-many, so treat this as a strong hint rather than an identity.`
        : `No bridge activity found, so we cannot link this address to the other layer.
           That is not suspicious on its own — most addresses never bridge.`}
      </div>` : ''}`;
}

async function go(v) {
  if (!detect(v)) {
    out.innerHTML = `<div class="err">Not a Tezos (tz1/tz2/tz3/KT1) or Etherlink (0x…) address.</div>`;
    return;
  }
  out.innerHTML = `<p class="note">Reading both layers…</p>`;
  try { render(v, await profile(v)); }
  catch (e) { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

document.getElementById('f').addEventListener('submit', e => { e.preventDefault(); go(q.value); });
document.querySelectorAll('.ex').forEach(b =>
  b.addEventListener('click', () => { q.value = b.dataset.a; go(b.dataset.a); }));
