/**
 * playground.js — mounts the real lets shell (vendored in ../sdk/) on an
 * offline loopback transport. Nothing is fetched or sent: the transport's
 * network methods are stubbed, and "Claude" is these buttons plus a tiny echo.
 *
 * Commands are dispatched exactly as the host would deliver them:
 *   lets._dispatch({lip:1, id, ts, dir:'down', from:'claude', type, data})
 * Events the shell emits are shown in "the wire" instead of being POSTed.
 *
 * Reactions use shell.entity.react?.(name, {force: true}), which arrives with
 * lets 0.4.0; with an older vendored shell the buttons are marked disabled.
 */
import { Lets } from '../sdk/lets-client.js';
import { Shell } from '../sdk/lets-shell.js';

const $ = (sel) => document.querySelector(sel);
const statusEl = $('#pg-status');
const logEl = $('#pg-log');
const MOODS = ['idle', 'happy', 'curious', 'thinking', 'busy', 'proud', 'sleepy', 'alert'];
// Doto's default persona (the same as the engine's DEFAULT_PERSONA): a dot that does
const PERSONA = { name: 'Doto', tagline: 'a dot that does', traits: { speed: 0.6, distance: 0.45, chatty: 0.4, playful: 0.7, formality: 0.15, curiosity: 0.6 }, color: '#a66bff' };
const REACTIONS = ['dizzy', 'whoa', 'startled', 'gasp', 'oops', 'wink', 'cheer', 'blush', 'boop', 'yawn', 'peek', 'nod', 'shake-no', 'wave', 'spin', 'dance', 'disco', 'sparkle'];

const lines = [];
function log(line) {
  lines.push(line);
  if (lines.length > 80) lines.shift();
  logEl.textContent = lines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}
const short = (v) => { try { return JSON.stringify(v ?? {}).slice(0, 140); } catch { return '{…}'; } };
const setStatus = (text, state) => { statusEl.textContent = text; statusEl.dataset.state = state; };

function button(label, onClick, attrs = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm';
  b.textContent = label;
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  b.addEventListener('click', onClick);
  return b;
}

try {
  // ---- an offline transport: a real Lets instance whose network legs are stubbed
  const lets = new Lets({ unique: 'playground', version: '0.1.0', caps: ['entity', 'chat', 'components'] });
  lets.status = 'open';                                   // never call lets.open(): no EventSource, no fetch
  lets._flush = function flush() { clearTimeout(this._flushTimer); this._flushTimer = null; this._queue.length = 0; };
  lets.upload = async (blob, { source = 'file' } = {}) => {
    const res = { path: `~/.lets/uploads/playground/${Date.now().toString(36)}`, w: 0, h: 0, bytes: blob.size, mime: blob.type || 'application/octet-stream' };
    log(`↑ media.image (host) ${short({ ...res, source })}`);
    return res;
  };

  let k = 0;
  const cmd = (type, data = {}, extra = {}) => {
    log(`↓ ${type} ${short(data)}`);
    lets._dispatch({ lip: 1, id: `cm_pg${Date.now().toString(36)}${(++k).toString(36)}`, ts: Date.now(), dir: 'down', from: 'claude', type, data, ...extra });
  };
  const streamReply = (text) => {
    const re = `pg-${++k}`;
    const parts = text.match(/[\s\S]{1,14}/g) || [''];
    cmd('chat.typing', { on: true });
    parts.forEach((p, i) => setTimeout(() => {
      lets._dispatch({ lip: 1, id: `cm_pgs${(++k).toString(36)}`, ts: Date.now(), dir: 'down', from: 'claude', type: 'chat.say', data: { text: p, seq: i, done: i === parts.length - 1 }, re });
    }, 600 + i * 60));
    log(`↓ chat.say (streamed in ${parts.length} chunks)`);
  };

  let shell = null;
  // every event the shell emits passes through envelope(): show it, and play a tiny fake Claude
  const envelope = lets.envelope.bind(lets);
  lets.envelope = (type, data, extra) => {
    log(`↑ ${type} ${short(data)}`);
    if (type === 'entity.click') {
      setTimeout(() => cmd('entity.suggest', { items: [{ id: 'r-explain', label: 'Explain this page', hint: 'arrived via entity.suggest' }, { id: 'r-joke', label: 'Tell me something nice' }] }), 800);
    } else if (type === 'entity.pick' && String(data?.id).startsWith('r-')) {
      const text = data.id === 'r-joke' ? 'You make good company. Noted.' : 'My playground. In a real window I roll around on top of a unique, like the graph board.';
      setTimeout(() => cmd('entity.say', { text, mood: 'happy', ttl: 5000 }), 300);
    } else if (type === 'chat.message') {
      setTimeout(() => streamReply(`(playground echo) You said: **${String(data?.text || '…').slice(0, 200)}**\nIn a real window, Claude answers here.`), 300);
    } else if (type === 'entity.secret') {
      setTimeout(() => shell?.toast(`You found a secret: ${data?.name} ✦`, 'ok', 4000), 50);
    }
    return envelope(type, data, extra);
  };

  shell = Shell.mount(lets, {
    root: document.body,
    entity: PERSONA,
    media: false,
    context: (info) => ({ page: 'playground', at: info ? { x: Math.round(info.x), y: Math.round(info.y) } : null }),
    quickSuggestions: () => [
      { id: 'hi', label: 'Say hi', hint: 'a local bubble', run: () => shell.entity.say({ text: "Hi, I'm **Doto**. Point at something and let's do it.", mood: 'happy' }) },
      { id: 'chat', label: 'Open chat', run: () => shell.chat.open() },
      { id: 'think', label: 'Think about it', run: () => shell.entity.mood('thinking') },
    ],
  });
  Object.assign(window, { __shell: shell, __lets: lets });

  // the dot in the chat header: "listening" (the echo answers right away)
  lets._dispatch({ lip: 1, id: 'cm_pg_listen', ts: Date.now(), dir: 'down', from: 'host', type: 'session.listening', data: { on: true, at: Date.now() } });

  // ---- moods
  const moodRow = $('#pg-moods');
  for (const m of MOODS) {
    moodRow.append(button(m, (e) => {
      moodRow.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      cmd('entity.mood', { mood: m });
    }, { 'aria-pressed': String(m === 'idle') }));
  }

  // ---- say
  $('#pg-say').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#pg-say-text');
    const text = input.value.trim() || 'On it. I do **bold** and `code`.';
    cmd('entity.say', { text, mood: 'happy' });
    input.value = '';
  });

  // ---- doto controls
  $('#pg-suggest').addEventListener('click', () => cmd('entity.suggest', { items: [{ id: 'r-explain', label: 'Explain this page', hint: 'from entity.suggest' }, { id: 'r-joke', label: 'Tell me something nice' }] }));
  $('#pg-center').addEventListener('click', () => cmd('entity.move', { to: 'center' }));
  $('#pg-cursor').addEventListener('click', () => cmd('entity.move', { to: 'cursor' }));
  $('#pg-show').addEventListener('click', () => cmd('entity.show'));
  $('#pg-hide').addEventListener('click', () => cmd('entity.hide'));

  // ---- reactions (lets 0.4.0): shell.entity.react?.(name)
  const reactRow = $('#pg-reactions');
  const canReact = typeof shell.entity.react === 'function';
  for (const name of REACTIONS) {
    if (canReact) {
      reactRow.append(button(name, () => {
        // force: skip the per-reaction cooldown so every press plays (the real gestures keep their cooldowns)
        const ok = shell.entity.react?.(name, { force: true });
        log(`· shell.entity.react('${name}') → ${ok === false ? 'not played' : 'played'}`);
      }));
    } else {
      reactRow.append(button(name, () => shell.toast('Reactions are coming with lets 0.4.0', 'info', 2600),
        { 'aria-disabled': 'true', title: 'coming with 0.4.0' }));
    }
  }
  if (!canReact) $('#pg-react-note').textContent = 'Coming with lets 0.4.0: this copy of the shell does not have shell.entity.react yet.';

  // ---- chat
  $('#pg-chat').addEventListener('click', () => cmd('chat.open'));
  $('#pg-stream').addEventListener('click', () => { cmd('chat.open'); streamReply('Here is a **streamed** reply, chunk by chunk, with a cursor while it streams.\n```js\nconst answer = 42;\n```\nDone.'); });
  $('#pg-toast').addEventListener('click', () => cmd('ui.toast', { text: 'A toast from "Claude"', level: 'ok' }));

  setStatus('Doto is rolling on an offline loopback: nothing leaves this page.', 'ok');
} catch (err) {
  console.error('[playground]', err);
  setStatus(`The shell could not start: ${err?.message || err}`, 'err');
}
