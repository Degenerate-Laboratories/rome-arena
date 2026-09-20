// Renderless CPU scale sweep. Finds where the authoritative 30 Hz simulation
// consumes its 33.3 ms step budget before spending model credits on large matches.
import { createSim } from './sim.js';
import { createArena } from './physics/arena_api.js';
import { CONFIG, setTier } from './physics/config.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
};
const seconds = Math.max(1, arg('seconds', 8));
const budgetMs = 1000 / 30;
const tiers = ['low', 'mid', 'high', 'ultra', 'xt'];

setTier('xt');
const arena = await createArena({ maxBodies: CONFIG.maxBodies });
const results = [];
for (const tier of tiers) {
  setTier(tier);
  const sim = createSim({ seed: 42, players: CONFIG.players, arena, fort: true });
  const samples = [];
  const steps = Math.round(seconds * 30);
  const started = performance.now();
  for (let i = 0; i < steps && sim.winner === null; i++) {
    const before = performance.now();
    sim.step(1 / 30);
    samples.push(performance.now() - before);
  }
  const elapsed = performance.now() - started;
  const sorted = [...samples].sort((a, b) => a - b);
  const avgMs = elapsed / samples.length;
  const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const result = {
    tier, formations: sim.units.length, soldiers: sim.soldiers.length,
    physicsBodies: arena.count, avgStepMs: +avgMs.toFixed(2), p95StepMs: +p95Ms.toFixed(2),
    budgetUsedPct: +(avgMs / budgetMs * 100).toFixed(1), realtimeMultiple: +(budgetMs / avgMs).toFixed(2),
  };
  results.push(result);
  console.log(JSON.stringify(result));
  if (avgMs >= budgetMs || p95Ms >= budgetMs) {
    console.log(`performance limit reached at tier=${tier}`);
    break;
  }
}
console.table(results);
