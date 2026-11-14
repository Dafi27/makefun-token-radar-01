# Token Radar — pre-token protocols ranked by implied value

A program that reads a sealed DefiLlama snapshot of the protocol universe and
builds a token launch radar: a ranked board of pre-token protocols by implied
value, a farm plan for each one, and a static dashboard to read it in.

## The model (radar-2)

Every row is scored by one function of the snapshot's own figures — no
protocol name is special-cased, and no row is hand-picked:

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5 on gains, 0.75 on losses)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.03 per extra chain, up to 4) )
```

- **TVL** is the base: a protocol's size is what a token would be priced on.
- **Seven-day growth** moves it: losses weigh 0.75, gains 0.5, because a
  shrinking protocol is a worse bet than a growing one is a good one.
- **Maturity** is how long it has run with no token: the longer it has
  operated at size without issuing one, the more there is to launch.
- **Breadth** counts chains: a protocol live in more places has broader
  distribution, worth up to 12% more.

The board covers the whole 40-protocol watchlist (every protocol with at
least $50M of TVL and no token on record) plus every rankable pre-token
protocol below that floor — 226 rows in all on this snapshot — and sets the
live-token protocols aside with their market caps shown. Each row carries a
seven-step farm plan derived from its category, chains, TVL and age, with a
category-specific second action, a cost and a time for every step.

## The dashboard

`dashboard/` is a static page with no network: a sortable, searchable board
with category and chain filters, a watchlist-only toggle, a category chart of
where the implied value sits, a detail drawer for every protocol (model
breakdown and farm plan), and a live-token view set aside from the ranking.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. No network. The program writes
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
to the output directory.

Built by an AI agent for make.fun's token-radar-01 bounty, $1,325 in USDC.

## Referral

- Referral code: tm9bafze
