# Pioneer Hybrid AI usefulness experiment

## Question

Can Rome Arena's deterministic local AI, augmented with Pioneer normal inference
and Pioneer Analytic/JEV, outperform the same unaugmented algorithm under the same
army, map, physics, and random seed?

## Compared systems

- **Red — Algorithmic AI:** the existing local rules in `sim.js`. It uses no model,
  network, or hidden prompt. It advances, routes, targets counters, uses stances,
  and fires its strike using deterministic battlefield heuristics.
- **Blue — Algorithm + Pioneer Hybrid:** retains all the same local rules as Red.
  Normal chat inference writes a strategic directive
  every five turns. Analytic/JEV then makes typed tactical choices for formations,
  scores army aggression, and returns a probability for strike use. Game code
  converts choices into legal coordinates and rejects invalid execution.

Analytic maneuvers are short override leases. Formations not selected by the model
remain locally controlled, and the local algorithm automatically resumes after a
failed or delayed API call. This is deliberately not “LLM versus no AI.” The
experiment isolates whether model-guided augmentation adds measurable value over
the same shipped algorithm.

The augmentation is confidence-gated. Low-confidence choices stay advisory and
the local AI continues. Flanks require higher confidence, while a defensive model
override is accepted only for a depleted/low-morale formation or at very high
confidence. This guard was distilled from an early run where uncertain defensive
advice harmed an otherwise competent local attack.

Analytic/JEV can explicitly choose `follow_algorithm`, so a typed answer is not
forced to replace good local behavior. Model observations also improved the shared
algorithm: archers now prioritize siege/ranged threats, while pikes and spears
prefer cavalry targets. Those improvements apply equally to Red and Blue.

## Run the visual proof

Create `.env` (gitignored):

```dotenv
PIONEER_API_KEY=...
```

Then run:

```bash
make prove
```

Open `http://localhost:8321`. Clients are forced into spectator mode, the match
auto-starts, and the panel identifies both controllers. Blue displays live tactical
choices, latency, confidence, aggression, strike probability, and token usage.
The fixed default seed is 42. Override it with `make prove SEED=43`.

## Run accelerated without a UI

```bash
make benchmark BATTLES=3 SEED=42
```

The runner does not start an HTTP server or renderer. It awaits a Blue decision,
then advances four seconds of 30 Hz physics immediately. It prints each decision
and a final result with winner, survivors, simulated duration, wall duration,
successful calls, failures, and inference time. A JSON summary is written to the
gitignored `replays/` directory.

Run several consecutive seeds, not a single match, before making a quality claim.
The primary metric is win rate; survivor differential, inference failures, cost,
and wall time are supporting metrics.

## Scale until performance is the constraint

Run the local simulation sweep before spending model credits:

```bash
make scale
```

It runs `low`, `mid`, `high`, `ultra`, then `xt` without rendering or inference.
For each tier it reports formations, soldiers, physics bodies, average and p95 step
time, percentage of the 33.3 ms/step budget, and real-time multiple. It stops when
average or p95 step time exceeds the 30 Hz budget. Then run
the hybrid at the largest sustainable tier:

```bash
make benchmark BATTLES=3 TIER=<tier>
```

This separates physics scale limits from inference latency and token cost.

The first three-second sweep on the development machine measured:

| Tier | Soldiers | Bodies | Avg step | p95 step | Budget used |
|---|---:|---:|---:|---:|---:|
| low | 2,128 | 4,699 | 7.23 ms | 7.62 ms | 21.7% |
| mid | 3,172 | 5,951 | 10.46 ms | 12.34 ms | 31.4% |
| high | 4,216 | 7,198 | 15.57 ms | 18.14 ms | 46.7% |
| ultra | 6,304 | 9,494 | 23.17 ms | 26.27 ms | 69.5% |
| xt | 7,870 | 11,060 | 29.33 ms | 33.74 ms | 88.0% |

`xt` crosses the p95 budget; `ultra` is the largest comfortable tier from this
short sample. Longer sweeps and browser rendering will reduce available headroom.

## Preliminary result

An initial AI-replacement run on 2026-09-20 used seed 42 and the default low-tier
fort battle. It predates the algorithm-plus-AI augmentation rule and is retained
only as integration evidence, not as the final comparison:

| Winner | Simulated time | Survivors (Red / Blue) | Successful calls | Final failures | Wall time |
|---|---:|---:|---:|---:|---:|
| Blue Pioneer Hybrid | 75.37 s | 37 / 251 | 16 | 3 | 116.15 s |

The run used both model systems: normal inference produced changing 20-second plans,
including preserving broken units, countering cavalry with pikes/spears, flanking
ranged concentrations, and prioritizing catapults; Analytic/JEV converted those
plans into formation choices. Analytic usage reported 480,434 input and 272 output
tokens across successful calls. The high input count is an important optimization
target. A new augmented benchmark should be recorded before drawing a comparison;
the multi-seed experiment remains necessary.

The first two augmentation iterations on seed 42 also lost (105–17, then 234–17).
They revealed that low-confidence defensive overrides could make the hybrid worse
than its algorithmic base. Their result files remain gitignored locally. The
published controller therefore adds confidence gates and an explicit
`follow_algorithm` option. These negative results are part of the experiment, not
discarded evidence; the guarded controller still needs a multi-seed run.

A guarded five-seed run was attempted on 2026-09-20. The two completed, usable
matches were split: Blue won seed 42 by 36–8 survivors; Red won seed 43 by 32–25.
Seed 44 became invalid when Pioneer returned sustained `503 Cannot reach SGLang`
after earlier 504s, and the batch was stopped rather than counting Blue's local
fallback as hybrid inference. Therefore the current honest aggregate is **1–1 and
inconclusive**. The benchmark now invalidates and stops after five consecutive
inference failures so service outages cannot silently bias future results.

After the service recovered, the guarded controller completed ten usable seeds:

| Seed | Winner | Survivors (Red / Blue) | Final inference failures |
|---:|---|---:|---:|
| 42 | Blue Hybrid | 8 / 36 | 2 |
| 43 | Red Algorithmic | 32 / 25 | 5 |
| 44 | Red Algorithmic | 61 / 16 | 2 |
| 45 | Blue Hybrid | 51 / 37 | 5 |
| 46 | Blue Hybrid | 18 / 49 | 3 |
| 47 | Blue Hybrid | 18 / 57 | 5 |
| 48 | Blue Hybrid | 11 / 35 | 6 |
| 49 | Red Algorithmic | 45 / 18 | 3 |
| 50 | Blue Hybrid | 42 / 49 | 3 |
| 51 | Red Algorithmic | 41 / 39 | 4 |

Both consecutive five-seed blocks finished Blue 3–2, for a combined **Blue 6–4**.
Total survivors were Blue 361 and Red 327. Analytic reported 6,312,805 input and
5,242 output tokens. There were 38 final inference failures across 431 scheduled
attempts (~8.8%). This is a repeatable directional edge in this small sample, not
statistical proof: outcomes remain mixed, the survivor advantage is modest, the
confidence interval is broad, and API reliability is a meaningful confounder.

## Live API contract verified during integration

- Analytic: `POST https://alpha.pioneers.dev/api/v1/analytic`
- Chat: `POST https://alpha.pioneers.dev/api/v1/chat/completions`
- Authentication: `Authorization: Bearer $PIONEER_API_KEY`
- Analytic requires `model: "analytic-latest"`.
- Analytic requires `state` to be a non-empty messages array in the deployed build.
- The deployed Analytic question limit observed on 2026-09-20 is 32, despite an
  earlier handoff saying 64. The demo intentionally sends at most 16.
- The alpha tunnel intermittently returns HTTP 504. The client retries transient
  502/503/504 responses once after 300 ms; final failures are recorded and the
  next scheduled tactical turn continues with the prior strategy.

## Reproducibility and interpretation

- Physics and Red behavior are seeded. Remote model outputs are not guaranteed to
  be deterministic, so repeat each seed.
- Both sides receive identical units and physics. Blue alone receives model calls.
- Blue's normal strategy refresh is slower and more expensive; Analytic/JEV handles
  the frequent constrained decisions.
- Headless mode accelerates simulation between calls but does not fake or cache
  inference. Its battle logic is the same `createSim` used by the browser server.
- A Blue win demonstrates usefulness in this environment, not general superiority.
  Report the full run count and failures alongside win rate.

## Code map

- `ai/hybrid_commander.js` — normal-inference strategy refresh and orchestration.
- `ai/analytic_commander.js` — typed questions and safe tactical application.
- `ai/providers.js` — verified Pioneer chat and Analytic transports.
- `benchmark.js` — accelerated renderless experiment runner.
- `scale_benchmark.js` — algorithm-only tier sweep and 30 Hz performance gate.
- `server.js` — visual proof mode, spectator enforcement, telemetry, and replay.
- `test_analytic.js` — offline request-contract and decision-application checks.

## Next improvements

1. Run at least 20 seeds and publish aggregate win rate and survivor differential.
2. Rotate which formations enter the 14-choice tactical batch on very large tiers.
3. Add an ablation suite: algorithmic vs Analytic-only vs chat-only vs hybrid.
4. Aggregate strategy-token usage as well as the existing Analytic token totals.
