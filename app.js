import { resolve, detect, L1, L2 } from './chains.js';

const out = document.getElementById('out');
const q = document.getElementById('q');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = a => !a ? '—' : (a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a);
const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
const num = (n, p = 4) => Number(n || 0).toLocaleString('en', { maximumFractionDigits: p });

const explorer = (layer, hash) => layer === L1
  ? `https://tzkt.io/${hash}`
  : `https://explorer.etherlink.com/tx/${hash}`;

function card(a, label) {
  if (!a || a.error) return `<div class="card"><h3>${label}</h3>
    <div class="note">${esc(a?.error || 'not found')}</div></div>`;
  const flags =
    (a.kind === 'contract' ? '<span class="badge">contract</span>' : '') +
    (a.scam ? '<span class="badge warn">flagged</span>' : '') +
    (a.alias ? `<span class="badge">${esc(a.alias)}</span>` : '');
  return `<div class="card ${a.layer}">
    <h3>${label}${flags}</h3>
    <div class="addr">${esc(a.addr)}</div>
    <div class="stats">
      <span><b>${num(a.balance)}</b> ${a.symbol}</span>
      <span><b>${num(a.txCount, 0)}</b> txs</span>
      ${a.tokenTransfers != null ? `<span><b>${num(a.tokenTransfers, 0)}</b> token xfers</span>` : ''}
    </div></div>`;
}

function row(e) {
  if (e.layer === 'BRIDGE') {
    const amt = e.amount == null
      ? `<span class="badge">${esc(e.asset)}</span>`   // FA token, decimals unresolved
      : `${num(e.amount)} XTZ`;
    return `<li class="BRIDGE">
      <span class="lyr">BRIDGE</span>
      <span class="what"><span class="k">L1 → L2 deposit</span>
        <div class="cp">${esc(short(e.l1))} → ${esc(short(e.l2))}${e.proxy ? ' (via proxy)' : ''}</div></span>
      <span><span class="amt">${amt}</span><br>
        <time>${when(e.ts)}</time></span></li>`;
  }
  const sign = e.amount ? (e.out ? '−' : '+') : '';
  const cls = e.amount ? (e.out ? 'out' : 'in') : '';
  return `<li class="${e.layer}">
    <span class="lyr">${e.layer}</span>
    <span class="what"><span class="k">${esc(e.kind)}</span>
      ${e.failed ? '<span class="fail"> failed</span>' : ''}
      <div class="cp">${esc(e.counterpartyAlias || short(e.counterparty))}</div></span>
    <span><span class="amt ${cls}">${e.amount ? sign + num(e.amount) + ' XTZ' : ''}</span><br>
      <time><a href="${explorer(e.layer, e.hash)}" target="_blank" rel="noopener">${when(e.ts)}</a></time>
    </span></li>`;
}

function render(r) {
  const originIsL1 = r.origin === L1;
  const searched = originIsL1 ? 'Tezos L1 (searched)' : 'Etherlink L2 (searched)';
  const found = originIsL1 ? 'Etherlink L2 (linked)' : 'Tezos L1 (linked)';
  const left = originIsL1 ? r.selfAcct : r.otherAcct;
  const right = originIsL1 ? r.otherAcct : r.selfAcct;

  if (!r.counterparts.length) {
    out.innerHTML = `<div class="link">${card(r.selfAcct, searched)}</div>
      <p class="note">No bridge deposits found, so this address has no counterpart we can
      prove on-chain. It may still have one — this slice only reads L1→L2 deposits.</p>
      <h2>Activity</h2><ol>${r.timeline.map(row).join('')}</ol>`;
    return;
  }

  const total = r.counterparts.reduce((s, c) => s + c.count, 0);
  const others = r.counterparts.slice(1);

  out.innerHTML = `
    <div class="link">
      ${card(left, originIsL1 ? searched : found)}
      <div class="seam"><div class="n">${total}</div>bridge<br>deposits</div>
      ${card(right, originIsL1 ? found : searched)}
    </div>

    ${others.length ? `<div class="alsofrom">
      <b>${others.length} other linked ${originIsL1 ? 'L2' : 'L1'}
      ${others.length === 1 ? 'address' : 'addresses'}</b> — the link is many-to-many, so this
      is evidence, not proof of one owner:
      ${others.map(c => `<code>${esc(short(c.addr))}</code> ×${c.count}`).join(', ')}
    </div>` : ''}

    <h2>Unified timeline — ${r.timeline.length} events, both layers</h2>
    <ol>${r.timeline.map(row).join('')}</ol>`;
}

async function go(v) {
  const det = detect(v);
  if (!det) { out.innerHTML = `<div class="err">Not a Tezos (tz1/tz2/tz3/KT1) or
    Etherlink (0x…) address.</div>`; return; }
  out.innerHTML = `<p class="note">Querying both layers…</p>`;
  try { render(await resolve(v)); }
  catch (e) { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

document.getElementById('f').addEventListener('submit', ev => {
  ev.preventDefault(); go(q.value);
});
document.querySelectorAll('.ex').forEach(b =>
  b.addEventListener('click', () => { q.value = b.dataset.a; go(b.dataset.a); }));
