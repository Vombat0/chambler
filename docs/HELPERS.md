# Game-pack helpers (optional)

Pure logic for pack authors. No DOM, no 3D, no runtime dependencies: every module
runs unchanged in the browser and on the server. Import from `@chambler/helpers`
(`packages/helpers/dist`).
Packs declare helpers in `manifest.json`; the engine loads the matching module and
passes the declared `config` through.

```json
"helpers": [
  { "type": "dice", "config": { "sides": 6 } },
  { "type": "money", "config": { "currency": "TRY", "denominations": [1, 5, 10, 50, 100, 500] } },
  { "type": "score", "config": { "min": 0, "max": 100 } },
  { "type": "turn", "config": { "maxPlayers": 8 } }
]
```

## dice

`parseNotation(text)` → `{ notation, count, sides, keep?, modifier, mult, table }`.
Grammar: `NdM` + optional `khN`/`klN` + optional `±N` + optional `xN`.
`d66` is the two-d6 hundreds table (11..66); `1d66` is a real 66-sided die.
`roll(notation, { seed? })` → `{ total, dice: [{ sides, value, kept }], modifier, mult, notation }`
with `total = (sum(kept) + modifier) * mult`.

`createRng(seed)` → `() => number` (sfc32); `secureSeed()` uses `crypto.getRandomValues`.
Errors are `DiceError` with `code` + `message`: `INVALID_NOTATION`, `COUNT_RANGE`,
`SIDES_RANGE`, `KEEP_RANGE`, `MODIFIER_RANGE`, `MULT_RANGE`, `SEED_INVALID`, `NO_CRYPTO`.

## money

All amounts are **integer minor units**; floats are rejected. `Bank` keeps
accounts, a vault and an audit log.

- `new Bank({ vault, players, denominations, currency })`
- `pay(from, to, amount, reason?)` / `transfer(...)`: players cannot go negative
  (`INSUFFICIENT_FUNDS`); the bank may overdraw once, then `isBankrupt` and
  further payouts throw `BANKRUPT`.
- `mint(amount, to, reason?)` credits a player and the vault;
  `redeem(amount, from, reason?)` burns both.
- `balanceOf(id)`, `totalSupply()`, `log` (entries: `seq`, `kind`, `from`, `to`, `amount`, `reason`, `balances`; `seq` is the logical clock).

`makeChange(amount, stock)` is a pure bounded DP (not greedy), so limited stock
is handled exactly; returns `{ ok: true, coins, total }` or
`{ ok: false, code, message }`. Denominations come from the pack.

## score

`new Scoreboard({ players, min?, max? })`; `add(player, delta, { round?, reason? })`
and `set(player, value, ...)` clamp to the limits and return the applied delta.
`deltasForRound(round)`, `scoreOf(player)`, `undo()` (last change), `ranking()`
→ `[{ player, score, rank, tied }]` with competition ranking (1, 1, 3).
`toJSON()` / `Scoreboard.fromJSON()` round-trip the whole board.

## turn

`new TurnOrder({ players, direction? })`, up to 8 players. `current()`, `next()`,
`reverse()`, `skip(player?)` (loses their next turn), `extra()` (one repeat),
`eliminate(player)` (advances if it was their turn), `activePlayers()`, `round`
(increments on every wrap). `toJSON()` / `TurnOrder.fromJSON()`.

## Determinism and hidden information

- A roll is a pure function of `(notation, seed)`. Clients and server sharing the
  seed get identical results; store the seed with the action for replay.
- Money, score and turn state are deterministic: replaying the same operations
  rebuilds the same state. Persist the operation list, not just the snapshot.
- **Hidden information:** a roll is private to its owner until broadcast. Only the
  owner sends the result (or seed); the server must not leak seeds or rolls to
  other players. Anyone who knows the seed can predict the roll, so reveal it last.
