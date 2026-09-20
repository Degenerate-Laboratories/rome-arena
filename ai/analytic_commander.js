// Fast tactical commander powered by Pioneer Analytic. The model only chooses
// among legal maneuvers; deterministic game code owns coordinates and validation.
import { analytic } from './providers.js';

const FIELD_X = 100, FIELD_Z = 70;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const r1 = (n) => Math.round(n);
const teamName = (t) => (t === 0 ? 'RED' : 'BLUE');
const dist2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cz - b.cz) ** 2;

function nearest(unit, units, pred = () => true) {
  let best = null, d = Infinity;
  for (const other of units) {
    if (!pred(other)) continue;
    const nd = dist2(unit, other);
    if (nd < d) { best = other; d = nd; }
  }
  return best;
}

export function serializeAnalyticState(sim, team, strategicGuidance = '') {
  const desc = (u) => `#${u.id} ${u.typeKey} men=${u.alive}/${u.n0} morale=${r1(u.morale)}` +
    `${u.broken ? ' BROKEN' : ''}${u.stance ? ' in-stance' : ''} at (${r1(u.cx)},${r1(u.cz)})`;
  const mine = sim.units.filter((u) => u.team === team && u.alive > 0);
  const foe = sim.units.filter((u) => u.team !== team && u.alive > 0);
  const objective = sim.zones ? ' Domination capture zones are active.' : sim.flags ? ' Capture the flag is active.' : '';
  return `You are the tactical controller for ${teamName(team)} in Rome Arena.${objective}\n` +
    (strategicGuidance ? `Your general's current strategic plan: ${strategicGuidance}\n` : '') +
    `Field bounds: x -${FIELD_X}..${FIELD_X}, z -${FIELD_Z}..${FIELD_Z}.\n` +
    `Friendly formations:\n${mine.map(desc).join('\n')}\nEnemy formations:\n${foe.map(desc).join('\n')}`;
}

export function buildQuestions(sim, team) {
  const questions = {};
  // The live API accepts at most 32 questions. This demo deliberately stays at
  // 16 to keep requests quick through the alpha tunnel: 14 formations + 2 army decisions.
  const eligible = sim.units
    .filter((x) => x.team === team && x.alive > 0 && !x.broken)
    .sort((a, b) => (b.alive / b.n0) - (a.alive / a.n0))
    .slice(0, 14);
  for (const u of eligible) {
    questions[`unit_${u.id}`] = {
      type: 'choice',
      instructions: `Choose formation #${u.id}'s best immediate maneuver. Consider its type, casualties, morale, nearby counters, and the whole battle.`,
      criteria: {
        follow_algorithm: 'Keep the local battlefield algorithm current target, formation, and fallback behavior',
        engage_nearest: 'Advance on the nearest enemy formation',
        attack_ranged: 'Prioritize an enemy archer or siege formation',
        flank_left: 'Sweep around the enemy left flank',
        flank_right: 'Sweep around the enemy right flank',
        defend: 'Hold or fall back toward friendly territory',
      },
    };
  }
  questions.aggression = {
    type: 'score',
    instructions: 'How aggressively should this army act right now?',
    criteria: ['Defensive', 'Cautious', 'Balanced', 'Aggressive', 'All-in'],
  };
  questions.use_strike = {
    type: 'noul',
    instructions: 'Should this army use its limited fire barrage now against the densest valuable enemy concentration?',
  };
  return questions;
}

function maneuverPoint(sim, team, unit, action, aggression) {
  const foes = sim.units.filter((u) => u.team !== team && u.alive > 0 && !u.broken);
  const close = nearest(unit, foes);
  const ranged = nearest(unit, foes, (u) => u.typeKey === 'archer' || u.typeKey === 'catapult');
  const forward = team === 0 ? -1 : 1;
  let x = unit.cx, z = unit.cz;
  if (action === 'engage_nearest' && close) ({ cx: x, cz: z } = close);
  else if (action === 'attack_ranged' && (ranged || close)) ({ cx: x, cz: z } = ranged || close);
  else if (action === 'flank_left') { x = -75; z += forward * (18 + aggression * 4); }
  else if (action === 'flank_right') { x = 75; z += forward * (18 + aggression * 4); }
  else if (action === 'defend') { x *= 0.65; z = team === 0 ? 48 : -48; }
  return { x: clamp(x, -FIELD_X, FIELD_X), z: clamp(z, -FIELD_Z, FIELD_Z) };
}

function densestEnemy(sim, team) {
  const foes = sim.units.filter((u) => u.team !== team && u.alive > 0 && !u.broken);
  let best = null, value = -1;
  for (const u of foes) {
    let score = u.alive;
    for (const v of foes) if (v !== u && dist2(u, v) < 20 ** 2) score += v.alive;
    if (score > value) { best = u; value = score; }
  }
  return best;
}

export function applyAnalyticAnswers(sim, team, answers) {
  const aggression = clamp(Number(answers.aggression?.score ?? 2), 0, 4);
  const decisions = [];
  let count = 0, confidenceTotal = 0, confidenceN = 0;
  for (const u of sim.units.filter((x) => x.team === team && x.alive > 0 && !x.broken)) {
    const answer = answers[`unit_${u.id}`];
    if (!answer?.choice) continue;
    if (answer.choice === 'follow_algorithm') continue;
    const confidence = Number(answer.confidence ?? 0);
    // In augmented mode, uncertain model advice must not displace a competent
    // local controller. Defensive overrides require real battlefield danger;
    // flanks require stronger confidence because they expose a formation.
    const augmented = sim.ai.has(`${team}:${u.slot}`);
    const depleted = u.morale < 55 || u.alive < u.n0 * 0.6;
    const threshold = answer.choice.startsWith('flank_') ? 0.6 : 0.45;
    if (augmented && (confidence < threshold || (answer.choice === 'defend' && !depleted && confidence < 0.7))) continue;
    const p = maneuverPoint(sim, team, u, answer.choice, aggression);
    sim.order([u.id], p, p);
    // Hybrid teams retain the built-in algorithm. This short lease lets the model
    // override it until the next tactical turn; on API failure the local AI resumes.
    u.aiOverrideUntil = sim.time + 4.5;
    if (u.type.alt) {
      const wantStance = answer.choice === 'defend';
      if (!!u.stance !== wantStance) sim.toggleStance([u.id]);
    }
    decisions.push(`#${u.id} ${answer.choice}`);
    count++;
    if (Number.isFinite(answer.confidence)) { confidenceTotal += answer.confidence; confidenceN++; }
  }
  const strikeProbability = Number(answers.use_strike?.noul || 0);
  if (strikeProbability >= 0.65 && sim.strike) {
    const target = densestEnemy(sim, team);
    if (target) sim.strike(team, target.cx, target.cz);
  }
  return {
    count,
    aggression,
    strikeProbability,
    confidence: confidenceN ? confidenceTotal / confidenceN : null,
    summary: decisions.slice(0, 3).join(' · ') + (decisions.length > 3 ? ` · +${decisions.length - 3}` : ''),
  };
}

export async function commandAnalyticTeam(sim, team, cfg, strategicGuidance = '') {
  const analyticCfg = cfg.analyticModel ? { ...cfg, model: cfg.analyticModel } : cfg;
  const result = await analytic(analyticCfg, serializeAnalyticState(sim, team, strategicGuidance), buildQuestions(sim, team));
  return { ...applyAnalyticAnswers(sim, team, result.answers), model: result.model || cfg.model, latencyMs: result.latencyMs, usage: result.usage };
}
