// Pioneer hybrid commander: normal inference periodically sets the strategic
// plan; Analytic/JEV turns that plan and live battlefield state into fast typed tactics.
import { chat } from './providers.js';
import { commandAnalyticTeam, serializeAnalyticState } from './analytic_commander.js';

const stateByConfig = new WeakMap();

function parseStrategy(text) {
  const clean = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const value = JSON.parse(match[0]);
      return String(value.strategy || value.plan || value.directive || '').slice(0, 600);
    } catch {}
  }
  return clean.trim().slice(0, 600);
}

async function refreshStrategy(sim, team, cfg) {
  const messages = [
    {
      role: 'system',
      content: 'You are the senior general in Rome Arena. Produce a concise strategic plan for the next 20 seconds. Account for unit counters, morale, flanking, ranged targets, forts, and preservation of forces. Reply only as JSON: {"strategy":"..."}. Do not issue coordinates.',
    },
    { role: 'user', content: serializeAnalyticState(sim, team) },
  ];
  // The default Pioneer model reasons before emitting its JSON. A full fort
  // battlefield needs enough completion room for both; this runs only every ~20s.
  const text = await chat({ ...cfg, model: cfg.chatModel }, messages, { temperature: 0.2, maxTokens: 3000 });
  const strategy = parseStrategy(text);
  if (!strategy) throw new Error('normal inference returned no final strategy');
  return strategy;
}

export async function commandHybridTeam(sim, team, cfg) {
  let state = stateByConfig.get(cfg);
  if (!state) { state = { turns: 0, strategy: '', strategyLatencyMs: null }; stateByConfig.set(cfg, state); }
  // Refresh immediately, then every fifth tactical turn (~20 seconds in the demo).
  if (!state.strategy || state.turns % 5 === 0) {
    const started = performance.now();
    try {
      state.strategy = await refreshStrategy(sim, team, cfg);
      state.strategyLatencyMs = Math.round(performance.now() - started);
    } catch (e) {
      // Tactical inference can keep playing through a transient chat/tunnel error.
      if (!state.strategy) state.strategy = 'Advance carefully, exploit favorable counters, and protect depleted formations.';
      console.error(`hybrid strategy refresh failed: ${e.message}`);
    }
  }
  state.turns++;
  const tactical = await commandAnalyticTeam(sim, team, cfg, state.strategy);
  return {
    ...tactical,
    model: cfg.model,
    strategy: state.strategy,
    strategyLatencyMs: state.strategyLatencyMs,
    summary: `${tactical.summary} | plan: ${state.strategy.slice(0, 100)}`,
  };
}
