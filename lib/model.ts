export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'comps-eb-v2';

export const MODEL = {
  prior_k: 6,
  growth_weight: 0.45,
  maturity_floor: 0.65,
  chain_weight: 0.04,
  chain_cap: 1.14,
  ratio_min: 0.04,
  ratio_max: 1.25,
  mult_min: 0.08,
  mult_max: 0.85,
  low: 0.65,
  high: 1.45,
  unknown_age: 365,
};
export type ModelParams = typeof MODEL;

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface CompRow {
  slug: string;
  name: string;
  symbol: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface CategoryComps {
  category: string;
  n: number;
  raw_median: number;
  shrunk_multiple: number;
  comps: CompRow[];
}

export interface FarmSummary {
  chain: string;
  capital_usd: number;
  est_gas_usd: number;
  hold_days: number;
  weekly_mins: number;
}

export interface RadarRow {
  slug: string;
  name: string;
  tier: 'watchlist' | 'early';
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  rank: number;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  cat_mult: number;
  cat_n: number;
  farm: FarmSummary;
  steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  change_7d: number | null;
}

export interface RadarData {
  model_version: string;
  as_of: string;
  source: string;
  floor_usd: number;
  params: ModelParams;
  global_median: number;
  live_comp_count: number;
  counts: { watchlist: number; early: number; rows: number; live_set: number; implied_total: number };
  category_comps: CategoryComps[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const UNCATEGORIZED = 'Uncategorized';
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const listed = Date.parse(listedAt);
  const now = Date.parse(asOf);
  if (!Number.isFinite(listed) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - listed) / DAY_MS));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

export function isCleanEarly(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

const categoryOf = (p: SnapshotProtocol): string => p.category ?? UNCATEGORIZED;

export interface Calibration {
  global_median: number;
  live_comp_count: number;
  categories: CategoryComps[];
}

export function calibrate(snapshot: Snapshot, model: ModelParams = MODEL): Calibration {
  const comps = snapshot.protocols.filter((p) => !isPreToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
  const ratioOf = (p: SnapshotProtocol): number => clamp(p.mcap_usd! / p.tvl_usd, model.ratio_min, model.ratio_max);
  const globalMedian = comps.length > 0 ? median(comps.map(ratioOf)) : 0.3;
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of comps) {
    const key = categoryOf(p);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [p]);
    else list.push(p);
  }
  const categories: CategoryComps[] = [];
  for (const [category, list] of groups) {
    const raw = median(list.map(ratioOf));
    const n = list.length;
    const shrunk = clamp((n * raw + model.prior_k * globalMedian) / (n + model.prior_k), model.mult_min, model.mult_max);
    const top = [...list].sort((a, b) => b.mcap_usd! - a.mcap_usd! || byCodeUnit(a.slug, b.slug)).slice(0, 4);
    categories.push({
      category,
      n,
      raw_median: raw,
      shrunk_multiple: shrunk,
      comps: top.map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: Math.round((p.mcap_usd! / p.tvl_usd) * 1e4) / 1e4 })),
    });
  }
  categories.sort((a, b) => b.n - a.n || byCodeUnit(a.category, b.category));
  return { global_median: globalMedian, live_comp_count: comps.length, categories };
}

export function categoryMultiple(category: string, cal: Calibration, model: ModelParams = MODEL): { mult: number; n: number } {
  const found = cal.categories.find((c) => c.category === category);
  if (found === undefined) return { mult: clamp(cal.global_median, model.mult_min, model.mult_max), n: 0 };
  return { mult: found.shrunk_multiple, n: found.n };
}

export function impliedValue(p: SnapshotProtocol, asOf: string, catMult: number, model: ModelParams = MODEL): { implied: number; low: number; high: number; age: number | null } {
  const growthPct = clamp(p.change_7d ?? 0, -50, 120);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age;
  const maturityMult = model.maturity_floor + (Math.min(ageForModel, 1095) / 1095) * (1 - model.maturity_floor);
  const chainMult = Math.min(model.chain_cap, 1 + model.chain_weight * Math.log(Math.max(1, p.chains.length)));
  const implied = Math.max(1, Math.round(p.tvl_usd * catMult * growthMult * maturityMult * chainMult));
  return { implied, low: Math.max(1, Math.round(implied * model.low)), high: Math.max(1, Math.round(implied * model.high)), age };
}

interface GasTier {
  label: string;
  setup: number;
  weekly: number;
  claim: number;
}

const ULTRA: GasTier = { label: 'ultra-low-fee', setup: 0.05, weekly: 0.02, claim: 0.02 };
const FAST: GasTier = { label: 'low-fee L2/fast-EVM', setup: 0.45, weekly: 0.2, claim: 0.25 };
const MID: GasTier = { label: 'mid-fee', setup: 2.5, weekly: 1.2, claim: 1.5 };
const ETH: GasTier = { label: 'Ethereum L1', setup: 14, weekly: 6.5, claim: 9 };
const DEFAULT_TIER: GasTier = { label: 'standard-fee', setup: 1.5, weekly: 0.6, claim: 0.8 };

const GAS_TIERS = new Map<string, GasTier>();
const tierList: [GasTier, string[]][] = [
  [ULTRA, ['Solana', 'Sui', 'Aptos', 'Near', 'Sei', 'Stellar', 'TON']],
  [FAST, ['Base', 'Arbitrum', 'Optimism', 'Polygon', 'Ink', 'Monad', 'Unichain', 'Scroll', 'Linea', 'zkSync Era', 'Blast', 'Mantle', 'Avalanche', 'Binance', 'Berachain', 'Hyperliquid L1', 'Katana', 'Plasma', 'Corn', 'Sonic', 'Flare', 'Citrea', 'Arbitrum Nova', 'Mode', 'Taiko', 'Abstract', 'World Chain', 'Gnosis', 'xDai', 'Celo', 'Fantom', 'opBNB', 'Op_Bnb']],
  [MID, ['Tron', 'Bitcoin', 'Bittensor', 'Cardano', 'Rootstock', 'RSK', 'Stacks', 'Core', 'CORE']],
  [ETH, ['Ethereum']],
];
for (const [tier, names] of tierList) for (const name of names) GAS_TIERS.set(name.toLowerCase(), tier);

const gasTier = (chain: string): GasTier => GAS_TIERS.get(chain.toLowerCase()) ?? DEFAULT_TIER;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const money = (n: number): string => `$${n.toFixed(2)}`;

function holdDaysFor(age: number | null): number {
  const effective = age ?? MODEL.unknown_age;
  return effective < 120 ? 60 : effective < 365 ? 45 : 30;
}

function capitalFor(tvl: number, change: number | null): number {
  if (change !== null && change <= -10) return 100;
  return tvl >= 1e9 ? 400 : tvl >= 2.5e8 ? 250 : tvl >= 5e7 ? 150 : 100;
}

function gasEstimate(tier: GasTier, hold: number): number {
  return round2(tier.setup + tier.weekly * Math.ceil(hold / 7) + tier.claim);
}

export function preferredChain(chains: string[]): string {
  if (chains.length === 0) return 'Ethereum';
  let best = chains[0]!;
  for (const chain of chains) if (gasTier(chain).setup < gasTier(best).setup) best = chain;
  return best;
}

interface CategoryPlan {
  mins: number;
  entry: (cap: number, name: string) => string;
  repeat: (name: string) => string;
  extra: (name: string) => string;
}

const PLANS: Record<string, CategoryPlan> = {
  'risk curators': { mins: 12, entry: (c, n) => `Deposit $${c} of a major stablecoin into one of ${n}'s curated vaults, the one with the deepest liquidity`, repeat: (n) => `Check the vault's utilisation and curator allocation on ${n} and top up or rebalance`, extra: (n) => `Hold a second vault from a different ${n} curator to log activity across two risk profiles` },
  'onchain capital allocator': { mins: 12, entry: (c, n) => `Deposit $${c} of stablecoins into the ${n} allocator vault with the largest TVL`, repeat: (n) => `Review ${n}'s allocation breakdown and confirm your shares still accrue`, extra: (n) => `Move a small slice between two ${n} strategies to record allocator interactions` },
  cdp: { mins: 15, entry: (c, n) => `Lock $${c} of accepted collateral in ${n} and mint stablecoin at a collateral ratio above 250%`, repeat: (n) => `Check the ${n} vault health factor and repay or add collateral to stay above 250%`, extra: (n) => `Deposit minted stablecoin into ${n}'s savings or stability module for a second touchpoint` },
  dexs: { mins: 20, entry: (c, n) => `Seed $${c} as liquidity in ${n}'s deepest stable or blue-chip pool`, repeat: (n) => `Swap about $25 through ${n} twice and re-centre or compound the LP position`, extra: (n) => `Add a second pool on ${n} so the wallet shows more than one LP position` },
  lending: { mins: 12, entry: (c, n) => `Supply $${c} to the ${n} market with the highest TVL and borrow about 30% against it`, repeat: (n) => `Check the ${n} health factor, repay part of the loan and re-supply interest`, extra: (n) => `Borrow and repay a second asset on ${n} to log both sides of the market` },
  rwa: { mins: 10, entry: (c, n) => `Complete ${n}'s eligibility step and subscribe $${c} to its tokenised treasury or credit product`, repeat: (n) => `Verify the ${n} NAV or yield accrual and keep the position funded`, extra: (n) => `Redeem a small slice through ${n} to test the exit path before the full redemption` },
  yield: { mins: 12, entry: (c, n) => `Deposit $${c} into ${n}'s largest single-asset yield strategy`, repeat: (n) => `Harvest or compound ${n} rewards and compare the live yield with the position`, extra: (n) => `Split a small slice into a second ${n} strategy to show distinct usage` },
  'yield aggregator': { mins: 12, entry: (c, n) => `Deposit $${c} into the ${n} vault with the highest TVL and lowest fee`, repeat: (n) => `Check the ${n} vault share price and harvest history`, extra: (n) => `Switch a small slice to a second ${n} vault to log a strategy change` },
  derivatives: { mins: 25, entry: (c, n) => `Post $${c} as margin on ${n} and open a small long with leverage at or below 2x`, repeat: (n) => `Open and close a $25 position on ${n} and keep margin above 50% of the requirement`, extra: (n) => `Add ${n} liquidity or vault exposure with a small slice, if offered, for a second activity type` },
  'basis trading': { mins: 15, entry: (c, n) => `Deposit $${c} into the ${n} delta-neutral vault or tokenised basis product`, repeat: (n) => `Track the ${n} funding or basis yield and confirm the hedge is intact`, extra: (n) => `Request a partial withdrawal from ${n} to measure the redemption queue` },
  'collateral markets': { mins: 12, entry: (c, n) => `Post $${c} of eligible collateral on ${n} and open the smallest borrow it permits`, repeat: (n) => `Verify ${n} collateral health and repay interest`, extra: (n) => `Swap collateral type once on ${n} to log a second action` },
  restaking: { mins: 12, entry: (c, n) => `Deposit $${c} of the supported asset into ${n} and delegate to an operator`, repeat: (n) => `Check ${n} operator performance and pending rewards`, extra: (n) => `Re-delegate a small share on ${n} to a second operator to log a change` },
  'prediction market': { mins: 15, entry: (c, n) => `Fund ${n} with $${c} in its trading asset and buy small positions in 5 liquid markets`, repeat: (n) => `Trade at least one $10 position on ${n} and review open markets`, extra: (n) => `Provide liquidity on one ${n} market for a different activity type` },
  insurance: { mins: 10, entry: (c, n) => `Buy $${c} of cover or underwrite capital through ${n}`, repeat: (n) => `Check ${n} cover status and premium accrual`, extra: (n) => `Vote or stake in one ${n} claims or risk decision if governance allows it` },
  payments: { mins: 10, entry: (c, n) => `Send and receive $${c} total through ${n} across 5 small payments`, repeat: (n) => `Make two small ${n} payments and check the balance`, extra: (n) => `Try a second ${n} feature such as a card, invoice or recurring payment` },
  'governance incentives': { mins: 10, entry: (c, n) => `Lock $${c} of the supported asset in ${n} to earn voting power`, repeat: (n) => `Vote on live ${n} gauges or proposals`, extra: (n) => `Delegate or re-point ${n} votes once to show governance activity` },
  'stablecoin wrapper': { mins: 8, entry: (c, n) => `Wrap $${c} of stablecoin through ${n} and hold the wrapped form`, repeat: (n) => `Check the ${n} peg and wrapper reserves`, extra: (n) => `Use the ${n} wrapped asset in one integrated venue` },
  chain: { mins: 20, entry: (c, n) => `Bridge $${c} to the ${n} network and use two or three of its leading apps`, repeat: (n) => `Do 3 small transactions across different ${n} apps`, extra: (n) => `Provide liquidity or lend on a native ${n} app for a second type of activity` },
  cedefi: { mins: 10, entry: (c, n) => `Open the ${n} account, finish KYC if asked, and deposit $${c}`, repeat: (n) => `Check ${n} balances and yields and confirm withdrawals work`, extra: (n) => `Use a second ${n} product to show usage beyond a single deposit` },
  'staking pool': { mins: 8, entry: (c, n) => `Stake $${c} in the ${n} pool with the longest operating record`, repeat: (n) => `Check ${n} accrued rewards and validator or pool performance`, extra: (n) => `Restake a small portion of ${n} rewards to log a compounding action` },
};
const ALIASES: Record<string, string> = {
  perpetuals: 'derivatives',
  options: 'derivatives',
  'options vault': 'derivatives',
  synthetics: 'derivatives',
  'interest rate derivatives': 'derivatives',
  'leveraged farming': 'yield',
  farm: 'yield',
  'liquidity manager': 'dexs',
  'cdp manager': 'cdp',
  'uncollateralized lending': 'lending',
  'collateral management': 'collateral markets',
  'anchor btc': 'staking pool',
};
const DEFAULT_PLAN: CategoryPlan = {
  mins: 12,
  entry: (c, n) => `Deposit or use $${c} in ${n}'s core product after reading its docs for any limits`,
  repeat: (n) => `Use a core ${n} feature once and re-check balances`,
  extra: (n) => `Try a second ${n} feature so the wallet shows more than one kind of activity`,
};

function planFor(category: string): CategoryPlan {
  const key = category.toLowerCase();
  return PLANS[ALIASES[key] ?? key] ?? DEFAULT_PLAN;
}

const compactUsd = (n: number): string => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${(n / 1e3).toFixed(0)}K`);

export function farmPlan(p: SnapshotProtocol, age: number | null): { summary: FarmSummary; steps: string[] } {
  const chain = preferredChain(p.chains);
  const tier = gasTier(chain);
  const hold = holdDaysFor(age);
  const capital = capitalFor(p.tvl_usd, p.change_7d);
  const gas = gasEstimate(tier, hold);
  const plan = planFor(categoryOf(p));
  const weeks = Math.ceil(hold / 7);
  let route = `Use ${chain} (${tier.label}) as the farming chain for ${p.name}`;
  if (p.chains.includes('Ethereum') && chain !== 'Ethereum') {
    const saved = round2(gasEstimate(ETH, hold) - gas);
    route += `; it also lists Ethereum, and ${chain} saves about ${money(saved)} in gas over ${hold} days`;
  } else if (p.chains.length > 1) route += ` (cheapest of its ${p.chains.length} listed chains)`;
  const change = p.change_7d;
  const ageText = age === null ? 'listing age unknown, treated as 365d' : `listed ${age}d`;
  let momentum: string;
  if (change !== null && change >= 15) momentum = `TVL is up ${change.toFixed(1)}% in 7d, so inflows are accelerating; keep the ${hold}-day window and do not chase above $${capital}`;
  else if (change !== null && change <= -10) momentum = `TVL fell ${Math.abs(change).toFixed(1)}% in 7d, an outflow risk; size is held at the $${capital} minimum tier and re-checked weekly`;
  else momentum = `TVL moved ${change === null ? 'n/a' : `${change.toFixed(1)}%`} in 7d, a steady base; hold ${hold} days (${ageText}) and re-check TVL weekly on DefiLlama`;
  const steps = [
    `${route}. Fund a fresh wallet with native gas. Cost: ${money(tier.setup)} setup gas. Time: 15 min.`,
    `${plan.entry(capital, p.name)}. Cost: $${capital} capital at risk, ${money(tier.weekly)} gas. Time: 20 min.`,
    `${plan.repeat(p.name)} once a week for ${weeks} weeks. Cost: ${money(tier.weekly)} gas per week. Time: ${plan.mins} min per week.`,
    `${momentum}. Cost: $0. Time: 5 min per week.`,
    `${plan.extra(p.name)}. Cost: ${money(tier.weekly)} gas. Time: 10 min.`,
    `At day ${hold}, withdraw from ${p.name} and claim anything it distributes; total gas about ${money(gas)} on ${compactUsd(p.tvl_usd)} TVL. Cost: ${money(tier.claim)} claim gas. Time: 15 min.`,
  ];
  return { summary: { chain, capital_usd: capital, est_gas_usd: gas, hold_days: hold, weekly_mins: plan.mins }, steps };
}

export function selectUniverse(snapshot: Snapshot): { protocol: SnapshotProtocol; tier: 'watchlist' | 'early' }[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, 'watchlist' | 'early'>();
  for (const slug of snapshot.watchlist) if (bySlug.has(slug)) chosen.set(slug, 'watchlist');
  for (const p of snapshot.protocols) if (!chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isCleanEarly(p)) chosen.set(p.slug, 'early');
  if (chosen.size < 100) {
    const rest = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isPreToken(p) && p.category !== 'CEX').sort((a, b) => b.tvl_usd - a.tvl_usd || byCodeUnit(a.slug, b.slug));
    for (const p of rest) {
      if (chosen.size >= 100) break;
      chosen.set(p.slug, 'early');
    }
  }
  return [...chosen].map(([slug, tier]) => ({ protocol: bySlug.get(slug)!, tier }));
}

export function buildRadar(snapshot: Snapshot, model: ModelParams = MODEL): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot, model);
  const scored = selectUniverse(snapshot).map(({ protocol, tier }) => {
    const { mult, n } = categoryMultiple(categoryOf(protocol), cal, model);
    const value = impliedValue(protocol, snapshot.as_of, mult, model);
    const farm = farmPlan(protocol, value.age);
    return { protocol, tier, mult, n, value, farm };
  });
  scored.sort((a, b) => b.value.implied - a.value.implied || byCodeUnit(a.protocol.slug, b.protocol.slug));
  const rows: RadarRow[] = scored.map((s, i) => ({
    slug: s.protocol.slug,
    name: s.protocol.name,
    tier: s.tier,
    category: categoryOf(s.protocol),
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    age_days: s.value.age,
    rank: i + 1,
    implied_value_usd: s.value.implied,
    low_usd: s.value.low,
    high_usd: s.value.high,
    cat_mult: s.mult,
    cat_n: s.n,
    farm: s.farm.summary,
    steps: s.farm.steps,
  }));
  const board: BoardRow[] = rows.map((r) => ({ slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd, farm_steps: r.steps }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || byCodeUnit(a.slug, b.slug))
    .slice(0, 80)
    .map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: categoryOf(p), tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd ?? 0, ratio: p.tvl_usd > 0 ? Math.round(((p.mcap_usd ?? 0) / p.tvl_usd) * 1e4) / 1e4 : 0, change_7d: p.change_7d }));
  const radar: RadarData = {
    model_version: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    params: model,
    global_median: cal.global_median,
    live_comp_count: cal.live_comp_count,
    counts: {
      watchlist: rows.filter((r) => r.tier === 'watchlist').length,
      early: rows.filter((r) => r.tier === 'early').length,
      rows: rows.length,
      live_set: live.length,
      implied_total: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
    },
    category_comps: cal.categories,
    rows,
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Partial<Snapshot>;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new SnapshotError('snapshot needs as_of, protocols and watchlist');
  const protocols = raw.protocols.map((p) => ({ ...p, chains: Array.isArray(p.chains) ? p.chains : [], tvl_usd: Number(p.tvl_usd) || 0 }));
  protocols.sort((a, b) => byCodeUnit(a.slug, b.slug));
  return { as_of: raw.as_of, source: String(raw.source ?? ''), floor_usd: Number(raw.floor_usd) || 0, protocols, watchlist: raw.watchlist };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, not 100 to 4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
    if (r.name.trim() === '') return `${r.slug} has no name`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length !== 6) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim() !== s || s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
