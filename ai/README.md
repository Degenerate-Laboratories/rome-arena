# AI-general battle

Two LLMs act as opposing generals. Every few seconds each commanded team's model
is given a text summary of the battlefield and replies with unit orders (JSON),
which are applied through the sim's normal order API (`sim.order` / `toggleStance`).
Units then execute those orders until the next turn — turn-based command at a low
polling frequency (not per-frame control). Inspired by
[llm_chess_arena](https://github.com/rferrari/llm_chess_arena).

## Run

```bash
make ai AI0=mock AI1=mock          # offline test — no keys needed
make ai AI0=groq AI1=openai        # Groq (Red) vs OpenAI (Blue)
make ai AI0=groq AI1=groq FORT=1   # same-model duel over a castle
make analytic AITURN=2             # Pioneer Analytic typed-decision showcase
make prove                         # algorithmic Red vs hybrid LLM + Analytic/JEV Blue
make benchmark BATTLES=3           # accelerated headless comparison
# spectate at http://localhost:8321  (battle auto-starts)
```

Flags (also usable via `bun server.js`): `--ai0 <provider> --ai1 <provider>`,
`--aiturn <seconds>` (default 4), `--autostart 1`.

## Providers

All are OpenAI-`/chat/completions`-compatible; keys come from the environment:

| provider | env keys | default model |
|---|---|---|
| `groq`    | `GROQ_API_KEY` (`GROQ_MODEL`, `GROQ_BASE_URL`) | `llama-3.3-70b-versatile` |
| `openai`  | `OPENAI_API_KEY` (`OPENAI_MODEL`, `OPENAI_BASE_URL`) | `gpt-4o-mini` |
| `pioneer` | `PIONEER_API_KEY` (`PIONEER_MODEL`, `PIONEER_BASE_URL`) | `default` |
| `mock`    | none — offline heuristic (all units advance) | — |
| `analytic` | `PIONEER_API_KEY` (`PIONEER_ANALYTIC_URL`, `PIONEER_ANALYTIC_MODEL`) | `analytic-latest` |
| `hybrid` / `jev` | `PIONEER_API_KEY` (chat + Analytic overrides above) | `default` + `analytic-latest` |

`analytic` uses `POST https://alpha.pioneers.dev/api/v1/analytic`. It batches one
typed choice per live formation plus an army aggression score and a yes/no strike
decision. Local code converts the choices into legal coordinates; the live panel
shows latency and confidence. Override the endpoint with `PIONEER_ANALYTIC_URL`.
The deployed API currently accepts up to 32 questions per request. For reliable,
fast calls through the alpha tunnel, the demo uses 14 formation questions plus
two army-wide questions and staggers the opposing armies' calls.

`hybrid` refreshes a senior general's plan through normal chat inference every
five tactical turns, then includes that plan in every Analytic/JEV state. This
lets generative inference handle long-horizon strategy while typed inference
handles frequent formation-level action, confidence, aggression, and strike use.

Add a provider by extending `PRESETS` in `providers.js`. Pioneer's chat base URL/model
are assumed OpenAI-compatible; set `PIONEER_BASE_URL`/`PIONEER_MODEL` to match its
API (get a key at https://alpha.pioneers.dev/keys).

## Files
- `providers.js` — provider presets + one OpenAI-compatible `chat()` call.
- `commander.js` — serialize battlefield → prompt → parse orders → apply. `mock` uses a local heuristic.
- server wiring — `server.js` resolves `--ai0/--ai1`, removes the built-in unit AI for commanded teams, and runs the per-team turn loop.
