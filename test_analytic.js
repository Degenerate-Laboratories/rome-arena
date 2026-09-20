import { createSim } from './sim.js';
import { createArena } from './physics/arena_api.js';
import { buildQuestions, applyAnalyticAnswers, serializeAnalyticState } from './ai/analytic_commander.js';
import { analytic } from './ai/providers.js';

const arena = await createArena({ maxBodies: 10000 });
const sim = createSim({ seed: 42, players: [2, 2], arena, fort: false });
const questions = buildQuestions(sim, 0);
const unitQuestions = Object.keys(questions).filter((k) => k.startsWith('unit_'));
if (unitQuestions.length !== Math.min(14, sim.units.filter((u) => u.team === 0).length)) throw new Error('expected one question per eligible formation');
if (Object.keys(questions).length > 32) throw new Error('exceeded API question limit');
if (questions.aggression.type !== 'score' || questions.use_strike.type !== 'noul') throw new Error('missing typed army questions');
if (!serializeAnalyticState(sim, 0).includes('Enemy formations:')) throw new Error('state is incomplete');

const answers = { aggression: { type: 'score', score: 3 }, use_strike: { type: 'noul', noul: 0.1 } };
for (const key of unitQuestions) answers[key] = { type: 'choice', choice: 'engage_nearest', confidence: 0.8 };
const result = applyAnalyticAnswers(sim, 0, answers);
if (result.count !== unitQuestions.length) throw new Error('not all decisions applied');
if (Math.abs(result.confidence - 0.8) > 1e-9) throw new Error('confidence aggregation failed');

const guarded = createSim({ seed: 42, players: [2, 2], arena, fort: false });
const guardedAnswers = { aggression: { score: 1 }, use_strike: { noul: 0 } };
for (const key of unitQuestions) guardedAnswers[key] = { type: 'choice', choice: 'defend', confidence: 0.2 };
const guardedResult = applyAnalyticAnswers(guarded, 0, guardedAnswers);
if (guardedResult.count !== 0) throw new Error('low-confidence model advice overrode the local AI');

let sent;
globalThis.fetch = async (url, init) => {
  sent = { url, init, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({ model: 'analytic-latest', answers, usage: { input_tokens: 10, output_tokens: 2 } }));
};
const wire = await analytic({ name: 'analytic', url: 'https://example.test/api/v1/analytic', model: 'analytic-latest', key: 'test-key' }, 'battle state', questions);
if (sent.url !== 'https://example.test/api/v1/analytic') throw new Error('wrong Analytic endpoint');
if (sent.init.headers.Authorization !== 'Bearer test-key') throw new Error('wrong Analytic auth header');
if (sent.body.model !== 'analytic-latest') throw new Error('wrong Analytic model');
if (sent.body.state?.[0]?.role !== 'user' || sent.body.state[0].content !== 'battle state' || JSON.stringify(sent.body.questions) !== JSON.stringify(questions)) throw new Error('wrong Analytic request shape');
if (wire.model !== 'analytic-latest') throw new Error('wrong Analytic response handling');
console.log(`analytic commander ok: ${result.count} typed orders, confidence=${result.confidence}`);
