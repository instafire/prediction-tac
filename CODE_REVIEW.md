# Code review notes (addressed)

## Contract (`PredictionPoolV3`)
| Issue | Fix |
|-------|-----|
| `claimMany` reverted entire batch if one id failed | Soft `_tryClaimOne`; skip bad markets; max 50 ids |
| `sellPosition` broken for multi-outcome | Multi path updates `multiPools` / `multiSide` |
| `cancelMarket` only binary | Multi cancel when only creator liquidity remains |
| Underflow risk on bettor counters | Guard `> 0` before decrement |
| Fresh checkout could not resolve Foundry imports | Track both Foundry dependency gitlinks at the commits pinned in `foundry.lock` |
| `solvencyCheck` omitted funds escrowed in market pools | Track outstanding market liabilities through creation, bets, sells, cancellation, refunds, and claims |
| Owner could resolve to an outcome with no winning positions | Reject unfunded winning outcomes in normal and dispute resolution paths |

**Validation:** 73 passing (`forge test`); frontend lint/build pass; `npm audit` reports zero vulnerabilities.

## Frontend
| Issue | Fix |
|-------|-----|
| Four high-severity transitive npm advisories | Apply non-breaking lockfile updates; `npm audit` now reports zero vulnerabilities |
| Frontend checks were absent from CI | Add read-only workflow for install, audit, lint, and production build |
| README allowed Node versions unsupported by Vite 8 | Require Node 20.19+ or 22.12+ in docs and `package.json` |
| Corrupt localStorage crash | `safeJsonParse` / `safeLocal*` helpers |
| `multiOdds([])` division by zero | Empty-array guard |
| Smart account used as signing `account` | Display-only `smartAccount` |
| Stale React state after TON+EVM connect | Read `selectedAddress` / `eth_accounts` after await |
| `e: any` error handling | `errMessage()` |
| Invalid ether amounts | `parseEtherSafe()` |
| XSS via oracle `href` | `safeHttpUrl()` (http/https only) |
| RPC config too loose | `URL` parse, no credentials |
| `as any` CSS vars | `delayStyle()` |
| claimMany unbounded | `chunkIds(..., 50)` |
| Tx without signer | Guard in `tx()` |
| Achievement timeout leak | clearTimeout on effect cleanup |
| Ending alerts every second | Drop `now` from effect deps |
| Demo market id `Math.max(0, ...[])` = -Infinity | Safe max when empty |

## Remaining / follow-ups
- **App.tsx size (~3k LOC)** — split into modules (markets, vault, admin, wallet) when convenient
- **Owner-resolved markets** — trust model by design; document for production
- **TAC SDK chunk ~2MB** — already lazy-loaded; further tree-shake if needed
- **No server-side auth** — client dApp; admin is contract `owner` only
