// LLM provider abstraction for the AI-general battle. Most hosted LLMs speak the
// OpenAI /chat/completions shape, so one fetch path covers Groq, OpenAI, Pioneer,
// and friends — differing only by base URL, model, and API-key env var. A built-in
// `mock` provider needs no network so the turn loop can be tested offline.
//
// Keys come from the environment (never hard-code them):
//   GROQ_API_KEY, OPENAI_API_KEY, PIONEER_API_KEY  (+ optional *_BASE_URL / *_MODEL)

const PRESETS = {
  groq: {
    baseURL: () => process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    model: () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    key: () => process.env.GROQ_API_KEY,
  },
  openai: {
    baseURL: () => process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: () => process.env.OPENAI_MODEL || 'gpt-4o-mini',
    key: () => process.env.OPENAI_API_KEY,
  },
  // Pioneer (https://alpha.pioneers.dev). Assumed OpenAI-compatible; override the
  // base/model via env if their API differs.
  pioneer: {
    baseURL: () => process.env.PIONEER_BASE_URL || 'https://alpha.pioneers.dev/api/v1',
    model: () => process.env.PIONEER_MODEL || 'default',
    key: () => process.env.PIONEER_API_KEY,
  },
  analytic: {
    analytic: true,
    url: () => process.env.PIONEER_ANALYTIC_URL || 'https://alpha.pioneers.dev/api/v1/analytic',
    model: () => process.env.PIONEER_ANALYTIC_MODEL || 'analytic-latest',
    key: () => process.env.PIONEER_API_KEY,
  },
};

// spec is "provider" or "provider:model-id" (e.g. "groq:openai/gpt-oss-120b").
// The model part may itself contain ':' or '/', so split only on the first ':'.
export function resolveProvider(spec) {
  if (!spec || spec === 'none') return null;
  const i = spec.indexOf(':');
  const name = i < 0 ? spec : spec.slice(0, i);
  const modelOverride = i < 0 ? null : spec.slice(i + 1);
  if (name === 'mock') return { name: 'mock', mock: true, model: 'mock' };
  if (name === 'hybrid' || name === 'jev') {
    const key = process.env.PIONEER_API_KEY;
    if (!key) throw new Error(`${name} selected but PIONEER_API_KEY is not set`);
    const chatModel = modelOverride || process.env.PIONEER_MODEL || 'default';
    const analyticModel = process.env.PIONEER_ANALYTIC_MODEL || 'analytic-latest';
    return {
      name, hybrid: true, key, model: `Hybrid ${chatModel} + ${analyticModel}`,
      chatModel, analyticModel,
      baseURL: process.env.PIONEER_BASE_URL || 'https://alpha.pioneers.dev/api/v1',
      url: process.env.PIONEER_ANALYTIC_URL || 'https://alpha.pioneers.dev/api/v1/analytic',
    };
  }
  const p = PRESETS[name];
  if (!p) throw new Error(`unknown AI provider '${name}' (use: ${Object.keys(PRESETS).join(', ')}, mock)`);
  const key = p.key();
  if (!key) throw new Error(`${name} selected but ${p.analytic ? 'PIONEER' : name.toUpperCase()}_API_KEY is not set`);
  if (p.analytic) return { name, analytic: true, url: p.url(), model: modelOverride || p.model(), key };
  return { name, baseURL: p.baseURL(), model: modelOverride || p.model(), key };
}

// Pioneer Analytic returns typed, probability-scored answers rather than prose.
export async function analytic(cfg, state, questions) {
  const started = performance.now();
  const messages = Array.isArray(state) ? state : [{ role: 'user', content: String(state) }];
  const body = JSON.stringify({ model: cfg.model || 'analytic-latest', state: messages, questions });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body,
    });
    if (res.ok) {
      const data = await res.json();
      if (!data || typeof data.answers !== 'object') throw new Error(`${cfg.name} returned no answers`);
      return { ...data, latencyMs: Math.round(performance.now() - started), retries: attempt };
    }
    const detail = (await res.text()).slice(0, 300);
    if (attempt === 0 && [502, 503, 504].includes(res.status)) { await new Promise((r) => setTimeout(r, 300)); continue; }
    throw new Error(`${cfg.name} HTTP ${res.status}: ${detail}`);
  }
}

// Send a chat and return the assistant's text. `mock` is handled by the caller.
// maxTokens is generous because reasoning models (gpt-oss, etc.) spend part of the
// budget "thinking" before the JSON; for those we also request low reasoning effort
// so the answer isn't truncated away.
export async function chat(cfg, messages, { temperature = 0.4, maxTokens = 1600 } = {}) {
  const body = { model: cfg.model, messages, temperature, max_tokens: maxTokens };
  if (cfg.hybrid || cfg.name === 'pioneer' || /gpt-oss|deepseek|reason/i.test(cfg.model)) body.reasoning_effort = 'low';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '';
    }
    const detail = (await res.text()).slice(0, 200);
    if (attempt === 0 && [502, 503, 504].includes(res.status)) { await new Promise((r) => setTimeout(r, 300)); continue; }
    throw new Error(`${cfg.name} HTTP ${res.status}: ${detail}`);
  }
}
