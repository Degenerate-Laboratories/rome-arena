// Accelerated, renderless proof runner: local algorithmic Red vs Pioneer hybrid Blue.
// Simulation time advances as fast as the CPU allows between remote decision turns.
import { createSim } from './sim.js';
import { createArena } from './physics/arena_api.js';
import { CONFIG, setTier } from './physics/config.js';
import { resolveProvider } from './ai/providers.js';
import { commandTeam } from './ai/commander.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
};
const argStr = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const battles = Math.max(1, arg('battles', 1));
const seed0 = arg('seed', 42) | 0;
const decisionSeconds = Math.max(1, arg('decision-seconds', 4));
const maxSeconds = Math.max(30, arg('max-seconds', 300));
const tier = argStr('tier', 'low');
setTier(tier);
const arena = await createArena({ maxBodies: CONFIG.maxBodies });
const results = [];

for (let battle = 0; battle < battles; battle++) {
  const seed = seed0 + battle;
  const blue = resolveProvider('hybrid');
  const sim = createSim({ seed, players: CONFIG.players, arena, fort: true });
  let calls = 0, failures = 0, inferenceMs = 0, lastStrategy = '', inputTokens = 0, outputTokens = 0;
  const wallStarted = performance.now();
  while (sim.winner === null && sim.time < maxSeconds) {
    const started = performance.now();
    try {
      const decision = await commandTeam(sim, 1, blue);
      inferenceMs += performance.now() - started;
      calls++;
      lastStrategy = decision.strategy || lastStrategy;
      inputTokens += decision.usage?.input_tokens || 0;
      outputTokens += decision.usage?.output_tokens || 0;
      console.log(`battle ${battle + 1} t=${sim.time.toFixed(0)}s Blue: ${decision.summary} (${decision.latencyMs}ms tactical)`);
    } catch (e) {
      failures++;
      console.error(`battle ${battle + 1} t=${sim.time.toFixed(0)}s inference failed: ${e.message}`);
    }
    const steps = Math.round(decisionSeconds * 30);
    for (let i = 0; i < steps && sim.winner === null; i++) sim.step(1 / 30);
  }
  const result = {
    battle: battle + 1, seed, winner: sim.winner === 0 ? 'Red Algorithmic' : sim.winner === 1 ? 'Blue Pioneer Hybrid' : 'Draw',
    simulatedSeconds: +sim.time.toFixed(2), wallSeconds: +((performance.now() - wallStarted) / 1000).toFixed(2),
    survivors: sim.counts, calls, failures, inferenceMs: Math.round(inferenceMs),
    analyticTokens: { input: inputTokens, output: outputTokens }, lastStrategy,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}

const summary = {
  experiment: 'Red Algorithmic AI vs Blue Algorithm + Pioneer normal inference + Analytic/JEV',
  tier,
  results,
  wins: {
    red: results.filter((r) => r.winner.startsWith('Red')).length,
    blue: results.filter((r) => r.winner.startsWith('Blue')).length,
    draw: results.filter((r) => r.winner === 'Draw').length,
  },
};
await Bun.write(`replays/benchmark-${Date.now()}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
