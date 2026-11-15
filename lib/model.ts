// Token Radar — the ranking model and the farm-plan generator.
//
// The model is this entry's own claim about what a pre-token protocol's
// launch would be worth. It is computed only from the sealed snapshot's
// own figures: the protocol's TVL, its seven-day growth, how long it has
// run with no token recorded, and how many chains it runs on. Nothing is
// hardcoded by name: running the program on a later snapshot ranks
// protocols that do not exist yet the same way.

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

export interface ValueFactors {
  growth: number;
  age: number;
  breadth: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  implied_value_usd: number;
  factors: ValueFactors;
  age_years: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface Board {
  as_of: string;
  rows: BoardRow[];
  watchlist_count: number;
  early_count: number;
  total_implied_usd: number;
}

// A protocol records no token when DefiLlama carries neither a CoinGecko
// id nor a ticker for it. Say that, never that it has none: the record
// is not proof.
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// A name is clean when it is not a versioned, wrapped, staked or
// exchange-branded product of something else. Those are not launches of
// their own: WBTC is Bitcoin on Ethereum, a "V2" is the same protocol
// under a new version, and a staked product is a token that already
// trades in another form.
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
const EXCHANGE_PREFIX =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

export function nameIsClean(p: SnapshotProtocol): boolean {
  return (
    !VERSION_MARKER.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

// A centralised exchange is not a protocol a reader can farm on-chain,
// so it never joins the board however large its TVL.
export function isFarmable(p: SnapshotProtocol): boolean {
  return p.category !== "CEX";
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function daysBetween(fromDay: string, toDay: string): number {
  const from = Date.parse(fromDay + "T00:00:00Z");
  const to = Date.parse(toDay + "T00:00:00Z");
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

// The implied value: TVL, tilted by the snapshot's own figures.
//
//   growth  — the 7-day TVL change, clamped to [-60, +120]%, worth
//             -30% to +60% of value (a week of fast growth is worth
//             more than a week of bleeding, but one wild week cannot
//             carry a protocol on its own).
//   age     — years since DefiLlama first tracked it with no token
//             recorded: a protocol that has run for years without
//             issuing one has more pent-up launch value, capped at
//             five years (+30%).
//   breadth — one chain is the baseline; each further chain, up to
//             six more, adds 3% (a launch reaches more users).
//
// A protocol that records a token never reaches this function: the
// board ranks launches that have not happened yet.
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
): { value: number; factors: ValueFactors; ageYears: number } {
  const growthRaw = p.change_7d === null ? 0 : p.change_7d;
  const growth = clamp(growthRaw, -60, 120);
  const growthFactor = 1 + growth / 200;
  const ageYears = p.listed_at === null ? 0 : daysBetween(p.listed_at, asOf) / 365.25;
  const ageFactor = 1 + Math.min(ageYears, 5) * 0.06;
  const breadthFactor = 1 + Math.min(Math.max(p.chains.length - 1, 0), 6) * 0.03;
  const value = Math.round(p.tvl_usd * growthFactor * ageFactor * breadthFactor);
  return { value, factors: { growth: growthFactor, age: ageFactor, breadth: breadthFactor }, ageYears };
}

// The core action for a category: what a reader actually does with the
// protocol, in one concrete step with an amount. Categories the map does
// not name fall back to the generic action, which still names the
// protocol, the chain and an amount.
const PRIMARY_ACTIONS: Record<string, string> = {
  Dexs: "Swap $25–100 on {name} on {chain}, two trades a week for four weeks; each swap costs about $0.50–3 in gas plus 0.05–0.3% in fees.",
  Lending:
    "Supply $50–200 of USDC to {name} on {chain} as collateral and borrow a small amount against it; keep the position open for at least 30 days.",
  Yield:
    "Deposit $50–200 into a {name} vault on {chain} and leave it earning for 30 days or more; check the quoted yield once a week.",
  "Yield Aggregator":
    "Route $50–200 through {name} on {chain} into its best vault and leave it for 30 days; compare the quoted APY before each deposit.",
  Derivatives:
    "Open a $25–100 position on {name} on {chain}, a small long or short, and close it after a week; repeat weekly for a month.",
  RWA: "Buy or mint $50–200 of {name}'s tokenised asset on {chain} and hold it for 30 days; read the redemption terms before you buy.",
  "Risk Curators":
    "Deposit $50–200 into a {name} vault on {chain} and keep it allocated for 30 days; read the curator's strategy note before depositing.",
  CDP: "Lock $50–200 of collateral in {name} on {chain}, mint a small amount of its stable asset, and keep the ratio above 200% for 30 days.",
  "Liquid Staking":
    "Stake $50–200 of the base asset through {name} on {chain} and hold the receipt token for 30 days; check the unstaking delay first.",
  Bridge:
    "Bridge $50–200 between chains with {name} once a week for four weeks; each crossing takes 5–20 minutes and about $1–5 in fees.",
  "Canonical Bridge":
    "Bridge $50–200 into {chain} with {name} once a week for four weeks; each crossing takes 5–20 minutes and about $1–5 in fees.",
  "Onchain Capital Allocator":
    "Allocate $50–200 through {name} on {chain} to one of its strategies and leave it for 30 days; review the strategy's past returns first.",
  "Leveraged Farming":
    "Open a $25–100 leveraged farm on {name} on {chain} at 2x or less and hold it for two weeks; watch the liquidation price daily.",
  "Uncollateralized Lending":
    "Lend $50–200 through {name} on {chain} for a 30-day term; check the borrower's history and the default rate before you commit.",
  "Basis Trading":
    "Put $50–200 into a {name} basis trade on {chain} and hold it for two weeks; the position earns while the funding rate stays positive.",
  "Liquidity Manager":
    "Deposit $50–200 into a {name}-managed pool on {chain} and leave it for 30 days; check the range it sets before depositing.",
  "Interest Rate Derivatives":
    "Buy $25–100 of fixed yield on {name} on {chain} with a 30-day maturity and hold it to expiry.",
  "Dual-Token Stablecoin":
    "Mint $50–200 of {name}'s stable asset on {chain} against collateral and hold it for 30 days; keep the collateral ratio above 200%.",
  "Liquid Restaking":
    "Restake $50–200 through {name} on {chain} and hold the receipt token for 30 days; check the withdrawal queue first.",
  Farm: "Deposit $50–200 into a {name} farm on {chain} and leave it for 30 days; harvest the rewards weekly.",
  Restaking:
    "Restake $50–200 through {name} on {chain} and hold the position for 30 days; check the operator's slashing history first.",
  "Prediction Market":
    "Place $10–50 of predictions on {name} on {chain}, two markets a week for a month; each bet costs a few cents in fees.",
  Indexes:
    "Buy $50–200 of a {name} index on {chain} and hold it for 30 days; check what the index holds before you buy.",
  "Crypto Card Issuer":
    "Order the {name} card, load it with $50–200 and spend $25 a week on it for a month; the card fee is usually $0–10.",
};

const SECONDARY_ACTIONS: Record<string, string> = {
  Dexs: "Add $50–150 of liquidity to a {name} pool on {chain} and hold the position for 30 days; check the pool's fee tier first.",
  Lending:
    "Repay part of the borrow and re-supply once a month, keeping the health factor above 2 so the position survives a sharp move.",
  Yield:
    "Move half the deposit to a second {name} vault after two weeks to show range, then consolidate before the month ends.",
  "Yield Aggregator":
    "Try a second {name} route after two weeks with $50, then keep the better-performing vault for the rest of the month.",
  Derivatives:
    "Hedge the position once with a $25 opposite trade on {name} so the account shows both sides of the market.",
  RWA: "Reinvest the first month's yield into the same {name} asset so the balance grows every month.",
  "Risk Curators":
    "Split the next deposit across two of {name}'s curators to show you read more than one strategy.",
  CDP: "Top up the collateral once after two weeks so the ratio stays comfortably above the liquidation line.",
  "Liquid Staking":
    "Use the receipt token once in a lending market on {chain} to show the stake is active, then unwind it.",
  Bridge:
    "Bridge back half the funds on a different day of the week so the crossings do not all share one timestamp.",
  "Canonical Bridge":
    "Bridge back half the funds on a different day of the week so the crossings do not all share one timestamp.",
  "Onchain Capital Allocator":
    "Rebalance once after two weeks, moving $50 to the strategy that performed best so far.",
  "Leveraged Farming":
    "Close the farm after two weeks, take the profit, and reopen at half size for a second fortnight.",
  "Prediction Market":
    "Resolve one market a week and immediately place the winnings into the next one.",
  Indexes:
    "Add $50 to the index after two weeks so the position shows two separate entries.",
};

function fill(template: string, name: string, chain: string): string {
  return template.replaceAll("{name}", name).replaceAll("{chain}", chain);
}

// Seven concrete steps for one protocol: what to do, what it costs,
// how long it takes. Every step names the protocol and its chain, so a
// plan is never a slogan that could belong to any protocol.
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains.length > 0 ? p.chains[0] : "Ethereum";
  const name = p.name;
  // Funding follows the protocol's home chain: on Ethereum the reader
  // funds a wallet directly, elsewhere they bridge in first.
  const fundStep =
    chain === "Ethereum"
      ? "Fund a fresh wallet with $50–100 of USDC on Ethereum and keep $10 aside for gas; the wallet takes 2 minutes to create."
      : `Bridge $50–100 of USDC to ${chain} and keep $10 aside for gas; the bridge takes 10–20 minutes and about $2–8 in fees.`;
  const primary =
    PRIMARY_ACTIONS[p.category ?? ""] ??
    "Use {name}'s main feature on {chain} with $25–100, twice a week for four weeks; each use costs a few dollars in gas.";
  const secondary =
    SECONDARY_ACTIONS[p.category ?? ""] ??
    "Put a further $50–150 into a second {name} feature on {chain} and hold it for 30 days to show depth of use.";
  return [
    fundStep,
    fill(primary, name, chain),
    "Repeat the core action weekly for 6–8 weeks at $25–100 a run, so the activity reads as a real user rather than one burst.",
    fill(secondary, name, chain),
    `If ${name} runs a points or quests page, open it once a week and finish every task it lists; most take 5–15 minutes and cost only gas.`,
    `Follow ${name}'s official announcements and check weekly for snapshot dates, new chains or quests; act within 48 hours of a new task.`,
    `Keep a note of each wallet, date and amount, keep $20 of gas funds on ${chain}, and never share a seed phrase or sign a blind transaction when a token is announced.`,
  ];
}

// Build the board: every watchlist protocol, then the early finds —
// pre-token protocols below the floor that are not a wrapped, staked or
// versioned product and not a centralised exchange — all ranked by the
// same implied value. The watchlist is the floor, never the ceiling.
export function buildBoard(snapshot: Snapshot): Board {
  const watchlist = new Set(snapshot.watchlist);
  const picked: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) continue;
    if (watchlist.has(p.slug)) {
      picked.push(p);
      continue;
    }
    if (p.tvl_usd >= snapshot.floor_usd) continue;
    if (!nameIsClean(p)) continue;
    if (!isFarmable(p)) continue;
    picked.push(p);
  }
  const rows: BoardRow[] = picked.map((p) => {
    const { value, factors, ageYears } = impliedValue(p, snapshot.as_of);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      implied_value_usd: value,
      factors,
      age_years: Math.round(ageYears * 100) / 100,
      watchlist: watchlist.has(p.slug),
      farm_steps: farmSteps(p),
    };
  });
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  const watchlistCount = rows.filter((r) => r.watchlist).length;
  return {
    as_of: snapshot.as_of,
    rows,
    watchlist_count: watchlistCount,
    early_count: rows.length - watchlistCount,
    total_implied_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
  };
}
