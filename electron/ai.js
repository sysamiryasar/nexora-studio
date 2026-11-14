'use strict';
/* ====================== NEXORA AI editor: Claude API bridge (Electron main process) ======================
   Uses the official Anthropic SDK (vendor/anthropic). The API key is encrypted with the OS key store and never reaches
   the page. The page owns the agent loop (it executes the editing tools); this module performs one streamed model turn. */
const fs = require('fs'), path = require('path');

const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Best results' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Faster, lower cost' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'Fastest, lowest cost' }
];
let SDK = null;
const sdk = () => SDK || (SDK = require(path.join(__dirname, '..', 'vendor', 'anthropic', 'node_modules', '@anthropic-ai', 'sdk')));

/* ---------- OpenCode Zen (opencode.ai/zen): one key, many models ----------
   Zen serves each model family on its own API shape: Claude and Qwen on Anthropic Messages (/v1/messages), most open
   models (DeepSeek, GLM, Kimi, MiniMax, …) on OpenAI Chat Completions (/v1/chat/completions), GPT on Responses and
   Gemini on Google's API. NEXORA's agent speaks Messages, so Messages models are used directly and Chat Completions
   models go through a translator below. GPT / Gemini / other shapes are not offered. */
const ZEN = 'https://opencode.ai/zen';
const zenRoute = id => /^(claude-|qwen)/.test(id) ? 'messages' : /^(gpt-|o\d|grok|muse|gemini|jev|codex)/.test(id) ? null : 'chat';
const prettyName = id => id.replace(/-free$/, '').split('-').map(w => /^(glm|gpt|ai)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)).join(' ') + (/-free$/.test(id) ? ' (free)' : '');
/** Anthropic-format request → OpenAI Chat Completions body */
function toChat(model, req) {
  const msgs = []; if (req.system) msgs.push({ role: 'system', content: Array.isArray(req.system) ? req.system.map(b => b.text || '').join('\n\n') : String(req.system) });
  const img = b => ({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
  for (const m of req.messages || []) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || [];
    if (m.role === 'assistant') {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join(''), calls = blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      msgs.push(Object.assign({ role: 'assistant', content: text || null }, calls.length ? { tool_calls: calls } : {}));
    } else {
      const later = [];   // images returned by tools go in a user message after the tool results (tool messages are text-only)
      for (const b of blocks.filter(b => b.type === 'tool_result')) {
        const parts = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : b.content || [];
        msgs.push({ role: 'tool', tool_call_id: b.tool_use_id, content: (b.is_error ? 'Error: ' : '') + (parts.filter(p => p.type === 'text').map(p => p.text).join('\n') || 'done') });
        parts.filter(p => p.type === 'image').forEach(p => later.push(img(p)));
      }
      const rest = blocks.filter(b => b.type === 'text' || b.type === 'image').map(b => b.type === 'text' ? { type: 'text', text: b.text } : img(b)).concat(later);
      if (rest.length) msgs.push({ role: 'user', content: rest.every(p => p.type === 'text') ? rest.map(p => p.text).join('\n') : rest });
    }
  }
  const tools = (req.tools || []).map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  return Object.assign({ model, messages: msgs, max_tokens: 16000 }, tools.length ? { tools, tool_choice: 'auto' } : {});
}
/** OpenAI Chat Completions response → Anthropic-format message */
function fromChat(r) {
  const c = (r.choices && r.choices[0]) || {}, m = c.message || {}, content = [];
  if (m.content) content.push({ type: 'text', text: typeof m.content === 'string' ? m.content : m.content.map(p => p.text || '').join('') });
  for (const t of m.tool_calls || []) { let input = {}; try { input = JSON.parse(t.function.arguments || '{}'); } catch (e) { input = {}; } content.push({ type: 'tool_use', id: t.id || 'call_' + Math.random().toString(36).slice(2), name: t.function.name, input }); }
  const stop = (m.tool_calls || []).length ? 'tool_use' : c.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
  return { id: r.id || 'msg', type: 'message', role: 'assistant', model: r.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: (r.usage || {}).prompt_tokens || 0, output_tokens: (r.usage || {}).completion_tokens || 0 } };
}
const ZEN_WORDS = {
  billing: 'This OpenCode Zen account needs credit before it can use this model (Payment Required). Add credit at opencode.ai/zen, or pick a model ending in "(free)".',
  rate: m => /-free$/.test(m) ? 'This free model is busy or its free limit is used up right now (OpenCode Zen said "too many requests"). Try another free model, or wait a minute.' : 'OpenCode Zen is rate-limiting this key. Wait a moment and try again.'
};
/** strip fields only Anthropic's own API understands */
function plainBody(b) {
  const o = JSON.parse(JSON.stringify(b)); delete o.thinking; delete o.output_config; delete o.betas; delete o.fallbacks; delete o.cache_control;
  const scrub = x => { if (Array.isArray(x)) x.forEach(scrub); else if (x && typeof x === 'object') { delete x.cache_control; delete x.eager_input_streaming; Object.values(x).forEach(scrub); } }; scrub(o.tools); scrub(o.system); scrub(o.messages);
  o.max_tokens = Math.min(o.max_tokens || 16000, 16000); return o;
}

function register(ipcMain, app, safeStorage, logLine) {
  const testMode = process.argv.includes('--nx-hidden');
  const file = path.join(app.getPath('userData'), testMode ? 'ai-settings-test.json' : 'ai-settings.json');
  const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; } };
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { }
  let baseURL = null, memKey = null, zenBase = ZEN;
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(cfg), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); };
  const key = () => { if (memKey) return memKey; if (!cfg.key) return null; try { return safeStorage.decryptString(Buffer.from(cfg.key, 'base64')); } catch (e) { logLine('ai key unreadable', e); return null; } };
  const provider = () => cfg.provider === 'zen' ? 'zen' : 'anthropic';
  const isFree = id => /-free$/.test(id);
  const freeOnly = () => provider() === 'zen' && !!cfg.freeOnly;
  const models = () => provider() === 'zen' ? (cfg.zenModels || []).filter(m => !freeOnly() || isFree(m.id)) : MODELS;
  const FREE_PICK = ['deepseek-v4.1-flash-free', 'glm-5.3-flash-free', 'minimax-m3.1-flash-free', 'nemotron-3.5-super-vl-free'];
  const model = () => { const L = models(); if (L.some(m => m.id === cfg.model)) return cfg.model; if (freeOnly()) { const p = FREE_PICK.find(id => L.some(m => m.id === id)); if (p) return p; } return (L.find(m => m.def) || L[0] || { id: '' }).id; };
  const active = new Map();
  /** the Zen catalogue for this key: GET /v1/models, keeping the models NEXORA can drive (Messages or Chat Completions) */
  async function zenModels(k) {
    const r = await fetch(zenBase + '/v1/models', { headers: { Authorization: 'Bearer ' + k } });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('auth'), { code: 'auth' });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { code: 'network' });
    const ids = ((await r.json()).data || []).map(m => m.id).filter(id => zenRoute(id));
    // open models first (that is what this provider is for), then Claude; a capable non-Claude model is the default
    const rank = id => /^claude-/.test(id) ? 2 : /-free$/.test(id) ? 1 : 0;
    const list = ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map(id => ({ id, name: prettyName(id), note: zenRoute(id) === 'messages' ? 'Messages API' : 'Chat API', route: zenRoute(id) }));
    const pick = ['kimi-k3', 'deepseek-v4-pro', 'glm-5.3', 'qwen3.8-max', 'qwen3.6-plus'].find(p => ids.includes(p)) || (list.find(m => !/^claude-/.test(m.id)) || list[0] || {}).id;
    list.forEach(m => m.def = m.id === pick); return list;
  }

  ipcMain.handle('nxai:status', () => ({ hasKey: !!key(), provider: provider(), model: model(), models: models(), freeOnly: freeOnly(), encrypted: canEncrypt() }));
  ipcMain.handle('nxai:setFreeOnly', (_e, on) => { if (provider() !== 'zen') return { ok: false }; cfg.freeOnly = !!on; if (on && !isFree(cfg.model || '')) delete cfg.model; save(); return { ok: true, freeOnly: freeOnly(), model: model(), models: models().length }; });
  ipcMain.handle('nxai:setModel', (_e, m) => { if (models().some(x => x.id === m)) { cfg.model = m; save(); } return { model: model() }; });
  ipcMain.handle('nxai:setKey', async (_e, k) => {
    k = String(k || '').trim();
    if (!k) { delete cfg.key; delete cfg.provider; delete cfg.zenModels; delete cfg.model; memKey = null; save(); return { ok: true, hasKey: false }; }
    if (/\s/.test(k) || k.length < 20) return { ok: false, error: 'That does not look like an API key.' };
    let prov = 'anthropic', list = null;
    if (!/^sk-ant-/.test(k)) {   // anything else is treated as an OpenCode Zen key and checked against Zen before it is saved
      try { list = await zenModels(k); } catch (e) { return { ok: false, error: e.code === 'auth' ? 'OpenCode Zen rejected this key. Copy it again from opencode.ai/zen (or use an Anthropic key that starts with sk-ant-).' : 'Could not reach OpenCode Zen to check the key. Check your internet connection.' }; }
      if (!list.length) return { ok: false, error: 'This OpenCode Zen key has no models NEXORA can use.' };
      prov = 'zen';
    }
    cfg.provider = prov; if (list) cfg.zenModels = list; else delete cfg.zenModels; delete cfg.model;
    if (canEncrypt()) { cfg.key = safeStorage.encryptString(k).toString('base64'); memKey = null; save(); }
    else { memKey = k; delete cfg.key; save(); }                     // no OS key store: keep it for this session only, never in plain text on disk
    return { ok: true, hasKey: true, persisted: canEncrypt(), provider: prov, models: models().length };
  });
  ipcMain.handle('nxai:refreshModels', async () => { const k = key(); if (provider() !== 'zen' || !k) return { ok: false }; try { cfg.zenModels = await zenModels(k); save(); return { ok: true, models: cfg.zenModels.length }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('nxai:cancel', (_e, id) => { const s = active.get(id); if (s) s.abort(); return true; });

  function explain(e, A) {
    if (e instanceof A.APIUserAbortError) return ['cancelled', 'Stopped.'];
    if (e instanceof A.AuthenticationError) return ['auth', 'Your Anthropic API key was rejected. Check it in AI settings.'];
    if (e instanceof A.PermissionDeniedError) return ['permission', 'This API key is not allowed to use that model.'];
    if (e instanceof A.NotFoundError) return ['model', 'That model is not available to this API key. Choose another model.'];
    if (e instanceof A.RateLimitError) return ['rate', 'Anthropic is rate-limiting this key. Wait a moment and try again.'];
    if (e instanceof A.BadRequestError) return ['request', 'The request was rejected: ' + e.message];
    if (e instanceof A.InternalServerError) return ['server', 'Anthropic is having a temporary problem (' + e.status + '). Try again shortly.'];
    if (e instanceof A.APIConnectionError) return ['network', 'Could not reach Anthropic. Check your internet connection.'];
    if (e instanceof A.APIError) return [e.status === 402 ? 'billing' : 'api', e.status === 402 ? 'This Anthropic account has a billing problem.' : e.message];
    return null;
  }
  ipcMain.handle('nxai:turn', async (e, req) => {
    const apiKey = key(); if (!apiKey) return { ok: false, code: 'no_key', error: 'Add an API key first (Anthropic or OpenCode Zen).' };
    const zen = provider() === 'zen', m = req.model && models().some(x => x.id === req.model) ? req.model : model();
    const send = d => { try { e.sender.send('nxai:delta', req.id, d); } catch (x) { } };
    if (zen && zenRoute(m) === 'chat') {
      // free models: if one is busy (short wait), try the other free models before giving up
      const order = isFree(m) ? [m, ...models().map(x => x.id).filter(id => isFree(id) && id !== m && zenRoute(id) === 'chat')] : [m];
      let r = null;
      for (const id of order) { r = await zenChat(apiKey, id, req, send); if (r.ok) { if (id !== m) r.message.fallbackModel = id; return r; } if (r.code !== 'rate' || r.retryAfter > 300) break; }
      return r;
    }
    const A = sdk(), Anthropic = A.default || A;
    // Zen's Messages endpoint authenticates with x-api-key (a Bearer-only request gets 401); send both
    const client = zen ? new Anthropic({ apiKey, baseURL: baseURL || zenBase, defaultHeaders: { Authorization: 'Bearer ' + apiKey, 'x-api-key': apiKey } }) : new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
    let body = { model: m, max_tokens: 64000, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, cache_control: { type: 'ephemeral' }, system: req.system, tools: req.tools, messages: req.messages };
    if (zen) body = plainBody(body);
    else if (m !== 'claude-haiku-5-5') { body.betas = ['server-side-fallback-2026-07-01']; body.fallbacks = 'default'; }   // a safety decline re-runs on Anthropic's recommended model
    for (let attempt = 0; ; attempt++) {
      let stream = null;
      try {
        stream = zen ? client.messages.stream(body) : client.beta.messages.stream(body); active.set(req.id, stream);
        stream.on('text', t => send({ text: t }));
        const message = await stream.finalMessage();
        return { ok: true, message };
      } catch (err) {
        const known = explain(err, Anthropic); if (known && zen) known[1] = known[0] === 'billing' ? ZEN_WORDS.billing : known[0] === 'rate' ? ZEN_WORDS.rate(m) : known[1].replace(/Your Anthropic API key/, 'Your OpenCode Zen key').replace(/Anthropic/g, 'OpenCode Zen');
        if (known) { if (known[0] !== 'cancelled') logLine('ai error', known[0], err.status || '', err.message); return { ok: false, code: known[0], error: known[1] }; }
        if (attempt >= 2) { logLine('ai error', err); return { ok: false, code: 'parse', error: 'The response could not be read. Please try again.' }; }   // incomplete streamed tool input: issue the turn again
        send({ restart: true });
      } finally { active.delete(req.id); }
    }
  });
  /** one turn on a Zen Chat Completions model, translated to and from the Messages shape the page's agent loop uses */
  async function zenChat(apiKey, m, req, send) {
    const ctl = new AbortController(); active.set(req.id, { abort: () => ctl.abort() });
    try {
      const r = await fetch((baseURL || zenBase) + '/v1/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify(toChat(m, req)) });
      const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (x) { }
      if (!r.ok) {
        const msg = (j && (j.error && (j.error.message || j.error) || j.message)) || txt.slice(0, 200);
        const code = r.status === 401 ? 'auth' : r.status === 402 ? 'billing' : r.status === 404 ? 'model' : r.status === 429 ? 'rate' : r.status >= 500 ? 'server' : 'request';
        const words = { auth: 'Your OpenCode Zen key was rejected. Check it in AI settings.', billing: ZEN_WORDS.billing, model: 'That model is not available to this key. Choose another model.', rate: ZEN_WORDS.rate(m), server: 'OpenCode Zen is having a temporary problem (' + r.status + '). Try again shortly.' };
        const ra = +(r.headers.get('retry-after') || 0);
        if (code === 'rate' && ra > 300) {   // a long wait means the account's free allowance is used up, not a busy model
          const at = new Date(Date.now() + ra * 1000), h = Math.floor(ra / 3600), mi = Math.round(ra % 3600 / 60);
          words.rate = `The free model allowance on this OpenCode Zen account is used up. OpenCode Zen says to try again in ${h ? h + ' h ' : ''}${mi} min (about ${at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}). Adding credit at opencode.ai/zen unlocks the paid models now.`;
        }
        logLine('ai error zen', r.status, m, ra ? 'retry-after ' + ra : '', String(msg).slice(0, 200)); return { ok: false, code, retryAfter: ra, error: words[code] || 'The request was rejected: ' + msg };
      }
      const message = fromChat(j || {}); const t = message.content.filter(b => b.type === 'text').map(b => b.text).join(''); if (t) send({ text: t });
      return { ok: true, message };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, code: 'cancelled', error: 'Stopped.' };
      logLine('ai error zen', err.message); return { ok: false, code: 'network', error: 'Could not reach OpenCode Zen. Check your internet connection.' };
    } finally { active.delete(req.id); }
  }
  /* automated tests only: point the SDK at a local server speaking the Messages streaming protocol */
  if (testMode) {
    const http = require('http'); const T = { srv: null, script: [], requests: [] };
    const sse = (res, events) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const ev of events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); res.end(); };
    const eventsFor = reply => { const ev = [{ type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }]; reply.content.forEach((b, i) => { if (b.type === 'text') { ev.push({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } }); } else { ev.push({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }, { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }); } ev.push({ type: 'content_block_stop', index: i }); }); ev.push({ type: 'message_delta', delta: { stop_reason: reply.stop || 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }, { type: 'message_stop' }); return ev; };
    ipcMain.handle('nxaitest', async (_e, op, a) => {
      if (op === 'start') { if (!T.srv) { T.srv = http.createServer(async (req, res) => { let s = ''; for await (const c of req) s += c; T.requests.push({ url: req.url, headers: req.headers, body: JSON.parse(s || '{}') });
          if (req.url.endsWith('/v1/models')) { const ok = /Bearer zen-good/.test(req.headers.authorization || ''); res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(ok ? { object: 'list', data: ['claude-opus-5-5', 'gpt-6-sol', 'gemini-3.1-pro', 'kimi-k3', 'qwen3.6-plus', 'glm-5.3-flash-free', 'deepseek-v4.1-flash-free'].map(id => ({ id, object: 'model' })) } : { error: { message: 'bad key' } })); }
          if (T.zen && req.url.includes('/v1/messages') && !req.headers['x-api-key']) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"type":"error","error":{"type":"authentication_error","message":"x-api-key required"}}'); }   // like the live Zen
          const r = T.script.shift();
          if (req.url.includes('/chat/completions') && r && !r.status) { const calls = r.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } })), text = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
            res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id: 'chatcmpl-test', model: 'test', choices: [{ index: 0, finish_reason: calls.length ? 'tool_calls' : 'stop', message: Object.assign({ role: 'assistant', content: text || null }, calls.length ? { tool_calls: calls } : {}) }], usage: { prompt_tokens: 3, completion_tokens: 4 } })); } if (!r) { res.writeHead(500); return res.end('{}'); } if (r.status) { res.writeHead(r.status, Object.assign({ 'Content-Type': 'application/json' }, r.retryAfter ? { 'Retry-After': String(r.retryAfter) } : {})); return res.end(JSON.stringify({ type: 'error', error: { type: 'x', message: r.message || 'error' } })); } sse(res, eventsFor(r)); }); await new Promise(r => T.srv.listen(0, '127.0.0.1', r)); } baseURL = `http://127.0.0.1:${T.srv.address().port}`; T.script = a || []; T.requests = []; return baseURL; }
      if (op === 'requests') return T.requests;
      if (op === 'script') { T.script = a; T.requests = []; return true; }
      if (op === 'zen') { zenBase = baseURL; baseURL = null; T.zen = true; return zenBase; }   // after 'start': the mock server plays OpenCode Zen
      if (op === 'stop') { baseURL = null; zenBase = ZEN; T.zen = false; memKey = null; delete cfg.key; delete cfg.provider; delete cfg.zenModels; delete cfg.model; save(); return true; }
    });
  }
}
module.exports = { register };
