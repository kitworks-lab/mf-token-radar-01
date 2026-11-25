'use strict';
const R = window.RADAR, D = R.params, $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n) => n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(0) + 'K' : '$' + n;
const full = (n) => '$' + Math.round(n).toLocaleString('en-US');
const x2 = (n) => n.toFixed(2) + 'x';
const pct = (n) => n === null ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const cls = (n) => n === null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '';
const age = (d) => d === null ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd';
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const DEF = { k: D.prior_k, g: D.growth_weight, m: D.maturity_floor, c: D.chain_weight };
let P = { ...DEF };
let S = { view: 'pre', q: '', cat: '', chain: '', tier: '', pos: false, sort: 'value', detail: '', sandbox: false };

function catMult(cat) {
  const c = R.category_comps.find((x) => x.category === cat);
  if (!c) return { mult: clamp(R.global_median, D.mult_min, D.mult_max), n: 0 };
  return { mult: clamp((c.n * c.raw_median + P.k * R.global_median) / (c.n + P.k), D.mult_min, D.mult_max), n: c.n };
}
function parts(r) {
  const cm = catMult(r.category);
  const growth = 1 + (clamp(r.change_7d ?? 0, -50, 120) / 100) * P.g;
  const a = r.age_days === null ? D.unknown_age : r.age_days;
  const mat = P.m + (Math.min(a, 1095) / 1095) * (1 - P.m);
  const chain = Math.min(D.chain_cap, 1 + P.c * Math.log(Math.max(1, r.chains.length)));
  return { mult: cm.mult, n: cm.n, growth, mat, chain };
}
function computeImpliedValue(r) {
  const p = parts(r);
  const implied = Math.max(1, Math.round(r.tvl_usd * p.mult * p.growth * p.mat * p.chain));
  return { ...p, implied, low: Math.max(1, Math.round(implied * D.low)), high: Math.max(1, Math.round(implied * D.high)) };
}
let rows = [];
function recompute() {
  rows = R.rows.map((r) => ({ r, v: computeImpliedValue(r) }));
  rows.slice().sort((a, b) => b.v.implied - a.v.implied || cmp(a.r.slug, b.r.slug)).forEach((x, i) => { x.rank = i + 1; x.delta = r_rank(x.r) - (i + 1); });
}
const r_rank = (r) => r.rank;
const changed = () => P.k !== DEF.k || P.g !== DEF.g || P.m !== DEF.m || P.c !== DEF.c;

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  S = { ...S, q: h.get('search') || '', cat: h.get('category') || '', chain: h.get('chain') || '', tier: ['watchlist', 'early'].includes(h.get('tier')) ? h.get('tier') : '', pos: h.get('growth') === 'pos', view: h.get('view') === 'live' ? 'live' : 'pre', detail: h.get('detail') || '', sandbox: h.get('sandbox') === '1', sort: h.get('sort') || S.sort };
  P = { ...DEF };
  for (const key of ['k', 'g', 'm', 'c']) { const raw = h.get(key); const num = raw === null || raw === '' ? NaN : Number(raw); if (Number.isFinite(num)) P[key] = num; }
}
function writeHash() {
  const h = new URLSearchParams();
  if (S.detail) h.set('detail', S.detail);
  if (S.cat) h.set('category', S.cat);
  if (S.chain) h.set('chain', S.chain);
  if (S.tier) h.set('tier', S.tier);
  if (S.pos) h.set('growth', 'pos');
  if (S.q) h.set('search', S.q);
  if (S.view === 'live') h.set('view', 'live');
  if (S.sandbox) h.set('sandbox', '1');
  for (const key of ['k', 'g', 'm', 'c']) if (P[key] !== DEF[key]) h.set(key, String(P[key]));
  const s = h.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
}

function renderHead() {
  const c = R.counts;
  $('asof').textContent = 'Snapshot ' + R.as_of + ' · DefiLlama · ' + R.model_version;
  $('kpis').innerHTML = [['Watchlist', c.watchlist + '/' + c.watchlist], ['Pre-Token Scored', c.rows], ['Implied Market', usd(rows.reduce((sum, x) => sum + x.v.implied, 0))], ['Live Comps', R.live_comp_count]].map((k) => '<div><dt>' + k[0] + '</dt><dd>' + k[1] + '</dd></div>').join('');
}
function renderCats() {
  const tot = {};
  rows.forEach((x) => { tot[x.r.category] = (tot[x.r.category] || 0) + x.v.implied; });
  const top = Object.keys(tot).sort((a, b) => tot[b] - tot[a] || cmp(a, b)).slice(0, 6), max = tot[top[0]] || 1;
  $('cats').innerHTML = '<h2><span>Empirical category comps &amp; implied share</span><span>MCap/TVL · implied</span></h2>' + top.map((c) => '<button class="cbar' + (S.cat === c ? ' on' : '') + '" data-cat="' + esc(c) + '"><span class="nm">' + esc(c) + '</span><span class="tr"><i style="width:' + (tot[c] / max * 100).toFixed(1) + '%"></i></span><b>' + x2(catMult(c).mult) + '</b><span>' + usd(tot[c]) + '</span></button>').join('');
}
function renderModel() {
  $('model').innerHTML = '<h2><span>Valuation model ' + R.model_version + '</span><button class="btn' + (S.sandbox ? ' on' : '') + '" id="sbt" aria-expanded="' + S.sandbox + '">Model sandbox</button></h2><p class="formula"><b>value</b> = TVL × cat_mult × growth × maturity × chains<br>cat_mult = (n·med + ' + P.k + '·' + R.global_median.toFixed(2) + 'x) / (n + ' + P.k + '), ' + R.live_comp_count + ' live<br>growth 1+' + P.g.toFixed(2) + '·7d · maturity ' + P.m.toFixed(2) + '→1 · chains 1+' + P.c.toFixed(2) + '·ln n</p><p class="note">Rows record no token on DefiLlama; implied values are estimates, not proof that no token exists.</p>';
}
function renderSandbox() {
  const sb = $('sandbox');
  sb.hidden = !S.sandbox;
  if (!S.sandbox) return;
  const sl = [['k', 'Prior shrinkage k', 0, 20, 1], ['g', '7d growth weight', 0, 1, 0.05], ['m', 'Maturity floor', 0.3, 1, 0.05], ['c', 'Multi-chain bonus', 0, 0.1, 0.005]];
  if (!sb.firstChild) {
    sb.innerHTML = sl.map((s) => '<label>' + s[1] + '<b id="v' + s[0] + '"></b><input type="range" data-p="' + s[0] + '" min="' + s[2] + '" max="' + s[3] + '" step="' + s[4] + '"></label>').join('') + '<button class="btn" id="rst">Reset</button>';
  }
  sl.forEach((s) => { sb.querySelector('[data-p=' + s[0] + ']').value = P[s[0]]; $('v' + s[0]).textContent = s[0] === 'k' ? P.k : P[s[0]].toFixed(s[0] === 'c' ? 3 : 2); });
}
function filtered() {
  const q = S.q.toLowerCase();
  const list = rows.filter((x) => (!S.cat || x.r.category === S.cat) && (!S.chain || x.r.chains.includes(S.chain)) && (!S.tier || x.r.tier === S.tier) && (!S.pos || (x.r.change_7d ?? 0) > 0) && (!q || x.r.name.toLowerCase().includes(q) || x.r.slug.includes(q) || x.r.category.toLowerCase().includes(q)));
  const key = { value: (x) => -x.v.implied, tvl: (x) => -x.r.tvl_usd, growth: (x) => -(x.r.change_7d ?? -1e9), age: (x) => x.r.age_days ?? 1e9, capital: (x) => -x.r.farm.capital_usd, gas: (x) => x.r.farm.est_gas_usd }[S.sort] || ((x) => x.rank);
  return list.sort((a, b) => key(a) - key(b) || a.rank - b.rank);
}
function renderBar() {
  const cats = [...new Set(R.rows.map((r) => r.category))].sort(cmp), chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort(cmp);
  const opt = (v, cur, label) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
  const n = [S.q, S.cat, S.chain, S.tier, S.pos].filter(Boolean).length;
  $('bar').innerHTML = '<input type="search" id="q" placeholder="Search protocol" aria-label="Search" value="' + esc(S.q) + '"><select id="cat" aria-label="Category">' + opt('', S.cat, 'All categories') + cats.map((c) => opt(c, S.cat, c)).join('') + '</select><select id="chain" aria-label="Chain">' + opt('', S.chain, 'All chains') + chains.map((c) => opt(c, S.chain, c)).join('') + '</select><span class="seg">' + [['', 'All'], ['watchlist', 'Watchlist'], ['early', 'Early']].map((t) => '<button data-tier="' + t[0] + '" class="' + (S.tier === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</span><button class="tog' + (S.pos ? ' on' : '') + '" id="pos">7d &gt; 0</button><span class="seg">' + [['pre', 'Pre-Token Radar'], ['live', 'Live Comps']].map((t) => '<button data-view="' + t[0] + '" class="' + (S.view === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</span><select id="sort" aria-label="Sort">' + [['value', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7d growth'], ['age', 'Sort: newest'], ['capital', 'Sort: capital'], ['gas', 'Sort: gas']].map((o) => opt(o[0], S.sort, o[1])).join('') + '</select><span class="sp"></span><span class="cnt" id="cnt"></span>' + (n ? '<button class="link" id="clr">Clear ' + n + '</button>' : '');
  $('bar').classList.toggle('live', S.view === 'live');
  $('sort').hidden = $('pos').hidden = S.view === 'live';
}
function chainsText(c) { return c.length > 3 ? c.slice(0, 3).join(', ') + ' +' + (c.length - 3) : c.join(', '); }
function renderBoard() {
  const main = $('board');
  main.removeAttribute('aria-busy');
  if (S.view === 'live') return renderLive(main);
  const list = filtered();
  $('cnt').textContent = list.length + ' of ' + rows.length + ' rows';
  if (!list.length) { main.innerHTML = '<div class="empty">No protocols match these filters.</div>'; return; }
  const dirty = changed(), maxV = Math.max(...rows.map((y) => y.v.implied));
  main.innerHTML = '<table><thead><tr><th>Rank</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Cat. mult</th><th>Implied value</th><th>Farm budget</th></tr></thead><tbody>' + list.map((x) => {
    const r = x.r, v = x.v, f = r.farm, dl = dirty && x.delta ? '<span class="dl ' + (x.delta > 0 ? 'pos' : 'neg') + '">' + (x.delta > 0 ? '▲' : '▼') + Math.abs(x.delta) + '</span>' : '';
    return '<tr class="r" tabindex="0" data-slug="' + esc(r.slug) + '"><td class="rk">' + x.rank + dl + '</td><td><span class="pn">' + esc(r.name) + '</span><span class="tag' + (r.tier === 'early' ? ' early' : '') + '">' + (r.tier === 'early' ? 'EARLY' : 'WL') + '</span><span class="sub">' + esc(r.category) + ' · ' + esc(chainsText(r.chains)) + '</span></td><td class="num">' + usd(r.tvl_usd) + '</td><td class="num ' + cls(r.change_7d) + '">' + pct(r.change_7d) + '</td><td class="num">' + age(r.age_days) + '</td><td class="num">' + x2(v.mult) + '<small class="sub" style="text-align:right">' + (v.n ? 'n=' + v.n : 'prior') + '</small></td><td class="iv"><b class="num">' + full(v.implied) + '</b><div class="tr"><i style="width:' + Math.max(1, v.implied / maxV * 100).toFixed(1) + '%"></i></div><small>' + usd(v.low) + '–' + usd(v.high) + '</small></td><td class="fb">$' + f.capital_usd + ' · ~$' + f.est_gas_usd.toFixed(2) + ' gas · ' + f.hold_days + 'd<small>on ' + esc(f.chain) + '</small></td></tr>';
  }).join('') + '</tbody></table>';
}
function renderLive(main) {
  const q = S.q.toLowerCase();
  const live = R.live.filter((l) => (!S.cat || l.category === S.cat) && (!q || l.name.toLowerCase().includes(q) || (l.symbol || '').toLowerCase().includes(q)));
  const cats = R.category_comps.filter((c) => !S.cat || c.category === S.cat);
  $('cnt').textContent = live.length + ' live tokens · ' + cats.length + ' categories';
  main.innerHTML = '<h3 class="sec">Category calibration (global median ' + x2(R.global_median) + ', k=' + P.k + ')</h3><table><thead><tr><th>Category</th><th class="num">n</th><th class="num">Raw median</th><th class="num">Shrunk multiple</th><th>Top live comps</th></tr></thead><tbody>' + cats.map((c) => '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td><td class="num">' + x2(c.raw_median) + '</td><td class="num"><b>' + x2(catMult(c.category).mult) + '</b></td><td class="sub" style="max-width:520px">' + c.comps.map((p) => esc(p.symbol || p.name)).join(', ') + '</td></tr>').join('') + '</tbody></table><h3 class="sec">Live-token comparables (top ' + R.live.length + ' by market cap)</h3><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">MCap</th><th class="num">MCap/TVL</th><th class="num">7d</th></tr></thead><tbody>' + live.map((l) => '<tr><td><span class="pn">' + esc(l.name) + '</span> <span class="sub" style="display:inline">' + esc(l.symbol || '') + '</span></td><td>' + esc(l.category) + '</td><td class="num">' + usd(l.tvl_usd) + '</td><td class="num">' + usd(l.mcap_usd) + '</td><td class="num">' + x2(l.ratio) + '</td><td class="num ' + cls(l.change_7d) + '">' + pct(l.change_7d) + '</td></tr>').join('') + '</tbody></table>';
}
function step(s) {
  const m = /^(.*?)\s*Cost:\s*(.*?)\s*Time:\s*(.*)$/.exec(s);
  return m ? '<li>' + esc(m[1]) + '<span class="m"><b>Cost</b> ' + esc(m[2]) + ' · <b>Time</b> ' + esc(m[3]) + '</span></li>' : '<li>' + esc(s) + '</li>';
}
function renderDrawer() {
  const dr = $('drawer'), x = rows.find((y) => y.r.slug === S.detail);
  $('veil').hidden = dr.hidden = !x;
  if (!x) return;
  const r = x.r, v = x.v, f = r.farm, cc = R.category_comps.find((c) => c.category === r.category);
  const pos = (n) => (n / v.high * 100).toFixed(1);
  dr.innerHTML = '<div class="dh"><div><span class="rk">#' + x.rank + '</span><span class="tag' + (r.tier === 'early' ? ' early' : '') + '">' + (r.tier === 'early' ? 'EARLY' : 'WATCHLIST') + '</span><h2>' + esc(r.name) + '</h2><div class="chains">' + esc(r.category) + ' · ' + esc(r.chains.join(', ')) + '</div><span class="nt">No token on DefiLlama record</span></div><button class="x" id="cl" aria-label="Close">×</button></div>'
    + '<h3>Implied valuation</h3><table class="kv"><tr><td>TVL</td><td>' + full(r.tvl_usd) + '</td></tr><tr><td>Category multiple (' + (v.n ? 'n=' + v.n + ' live comps' : 'global prior') + ')</td><td>' + x2(v.mult) + '</td></tr><tr><td>7d momentum (' + pct(r.change_7d) + ')</td><td>×' + v.growth.toFixed(3) + '</td></tr><tr><td>Maturity (' + age(r.age_days) + ')</td><td>×' + v.mat.toFixed(3) + '</td></tr><tr><td>Chain breadth (' + r.chains.length + ')</td><td>×' + v.chain.toFixed(3) + '</td></tr><tr class="tot"><td>Base implied value</td><td>' + full(v.implied) + '</td></tr></table>'
    + '<div class="range"><i style="left:' + pos(v.low) + '%;right:0"></i><b style="left:' + pos(v.implied) + '%"></b></div><div class="rl"><span>Conservative ' + usd(v.low) + '</span><span>Base ' + usd(v.implied) + '</span><span>Bull ' + usd(v.high) + '</span></div><p class="tip">' + (changed() ? 'Sandbox parameters active; board.json holds the default model.' : 'Matches board.json to the dollar.') + '</p>'
    + '<h3>Live category comparables</h3>' + (cc ? '<table class="kv mini"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">MCap</th><th class="num">MCap/TVL</th></tr></thead><tbody>' + cc.comps.map((p) => '<tr><td style="font-family:inherit">' + esc(p.name) + ' ' + esc(p.symbol || '') + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + x2(p.ratio) + '</td></tr>').join('') + (cc.n < 3 ? '<tr class="prior"><td>Global prior anchor (n=' + R.live_comp_count + ' live)</td><td class="num">—</td><td class="num">—</td><td class="num">' + x2(R.global_median) + '</td></tr>' : '') + '</tbody></table><p class="tip">Raw median ' + x2(cc.raw_median) + ' over ' + cc.n + ' comps, shrunk to ' + x2(v.mult) + '.</p>' : '<p class="tip">No live comps in this category; the global median ' + x2(R.global_median) + ' is used.</p>')
    + '<h3>Chain-aware farm plan</h3><div class="pills"><div><small>Capital</small><b>$' + f.capital_usd + '</b></div><div><small>Est. gas</small><b>$' + f.est_gas_usd.toFixed(2) + '</b></div><div><small>Hold</small><b>' + f.hold_days + 'd</b></div><div><small>Weekly</small><b>' + f.weekly_mins + ' min</b></div></div><ol class="steps">' + r.steps.map(step).join('') + '</ol>';
  dr.querySelector('#cl').focus();
}
function render() {
  recompute();
  renderHead(); renderCats(); renderModel(); renderSandbox(); renderBar(); renderBoard(); renderDrawer();
}
function set(patch) { S = { ...S, ...patch }; writeHash(); render(); }
document.addEventListener('click', (e) => {
  const t = e.target.closest('button,tr.r,#veil');
  if (!t) return;
  if (t.dataset.cat !== undefined) set({ cat: S.cat === t.dataset.cat ? '' : t.dataset.cat });
  else if (t.id === 'sbt') set({ sandbox: !S.sandbox });
  else if (t.id === 'rst') { P = { ...DEF }; writeHash(); render(); }
  else if (t.dataset.tier !== undefined) set({ tier: t.dataset.tier });
  else if (t.dataset.view) set({ view: t.dataset.view });
  else if (t.id === 'pos') set({ pos: !S.pos });
  else if (t.id === 'clr') set({ q: '', cat: '', chain: '', tier: '', pos: false });
  else if (t.id === 'cl' || t.id === 'veil') set({ detail: '' });
  else if (t.dataset.slug) set({ detail: t.dataset.slug });
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'q') { S.q = t.value; writeHash(); renderCats(); renderBoard(); }
  else if (t.dataset.p) { P[t.dataset.p] = Number(t.value); writeHash(); render(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'cat') set({ cat: t.value });
  else if (t.id === 'chain') set({ chain: t.value });
  else if (t.id === 'sort') set({ sort: t.value });
  else if (t.id === 'q') set({});
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.detail) set({ detail: '' });
  else if (e.key === 'Enter' && e.target.dataset && e.target.dataset.slug) set({ detail: e.target.dataset.slug });
});
window.addEventListener('hashchange', () => { readHash(); render(); });
readHash();
render();
