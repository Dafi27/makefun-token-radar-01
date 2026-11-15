# Token Radar

Build the best token launch radar. The program reads a sealed snapshot of
every protocol DefiLlama tracks, ranks the ones that record no token by
what their launch would be worth, and writes a web dashboard that shows
the board, a detail view for each protocol, and the steps to farm it.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes
`board.json` and the dashboard's `data.js` into the output directory,
copies `dashboard/` and `screenshots/` there, and writes `dossier.json`.

## The model

Every row is a protocol that **records no token** in the snapshot — no
CoinGecko id and no ticker — and is not a wrapped, staked or bridged
product of a token that already trades, not a centralised exchange, and
not a versioned name. The board covers all 40 of the snapshot's
watchlist protocols, then the early finds below the $50M floor.

**Implied value = TVL × growth × age × breadth.**

- Growth: the 7-day TVL change, clamped to −60%…+120%, worth −30%…+60%.
- Age: the years since DefiLlama first tracked the protocol with no
  token recorded, up to 5 years, worth up to +30%.
- Breadth: one chain at par, +3% per further chain up to six more.

The value is this entry's own claim about what a launch would be worth
— never a prediction that a token is issued, or when. Each row carries
a 7-step farm plan with amounts, costs and time.

## The dossier

`lib/dossier.ts` builds `dossier.json` — the dashboard's screenshots
plus its source as text — in the same byte format as the kit's
`buildDossier`: the envelope is
`{"cover":0,"images":[{"base64","media_type","name","sha256"}],"schema":"makefun/dossier/v1","text":"..."}`.
It was verified locally to produce byte-identical output to the kit's
builder on the same files.

## License

MIT — see `LICENSE`.
