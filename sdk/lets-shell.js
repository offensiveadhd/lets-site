/**
 * lets-shell.js — the shared browser shell every lets unique mounts (LIP v1).
 *
 * One call gives a unique what all uniques share: the companion entity ("you"),
 * the chat panel, dynamic components, image paste/drop, toasts and the
 * deep-violet theme. The shell answers every `entity.*`, `chat.*`,
 * `component.*` and `ui.*` command itself, plus `session.close` (the
 * farewell) and `session.listening` (docs/UI-CONTRACT.md §2).
 *
 *   import { Lets } from '/sdk/lets-client.js';
 *   import { Shell } from '/sdk/lets-shell.js';
 *   const lets = Lets.connect({ unique: 'graph', version: '0.1.0', caps: ['entity', 'chat', 'components', 'media.image'] });
 *   const shell = Shell.mount(lets, { entity: { name: 'Pip' }, context: () => ({}), quickSuggestions: () => [] });
 *
 * Works under the host CSP: no inline scripts, no eval, image previews are
 * painted to <canvas>. Motion is transform/opacity only and honours
 * prefers-reduced-motion.
 */

/**
 * @typedef {{id:string, label:string, hint?:string, run?:(item:{id:string,label:string}, ctx:any)=>void}} Suggestion
 * @typedef {object} MountOptions
 * @property {HTMLElement} [root] where overlays mount and right-click is intercepted (default `document.body`)
 * @property {{name?:string, traits?:{speed?:number,distance?:number,chatty?:number,playful?:number}, color?:string, visible?:boolean}} [entity]
 * @property {(info:{reason:'summon'|'click'|'hotkey'|'api', x:number, y:number, target?:Element}) => any} [context]
 *   unique context attached to entity.summon / entity.click. Return `{handled:true}` on a right-click to keep it.
 * @property {(ctx:any) => Suggestion[]} [quickSuggestions] instant local items for the click menu
 * @property {boolean} [media=true] enable image paste and file drop on `document`
 * @property {boolean} [hotkeys=true] Ctrl+Space (entity), Ctrl+/ (chat)
 */

const CSS_HREF = '/sdk/lets-shell.css';
const PROFILE_KEY = 'lets.profile';
const MOODS = ['idle', 'happy', 'curious', 'thinking', 'busy', 'proud', 'sleepy', 'alert'];
const SIZE = 56;                 // sprite px
const DEAD = 24;                 // follow dead-zone px
const MAX_UPLOAD = 25 << 20;     // host default cap
const HANDLED = Symbol('lets.handled');
const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const ICONS = { note: '✎', options: '☰', slider: '⇆', toggle: '◐', form: '▤', 'image-drop': '⬒', progress: '◔', code: '</>' };
const TITLES = { note: 'Note', options: 'Choose', slider: 'Adjust', toggle: 'Switch', form: 'Form', 'image-drop': 'Add an image', progress: 'Progress', code: 'Code' };
const GREETINGS = ['Hi!', 'Hey there ✦', 'Ready when you are.', 'What are we making?', 'Oh, hello!'];
// Reactions (docs/ENTITY.md "Expressions & secret moves"): cooldown and default length in ms, plus the CSS hooks
// set on the entity layer while one plays: data-face (eyes), data-mouth, data-fx (extra parts). Motion: motion().
const REACT = {
  dizzy:      { cd: 8000,  ms: 2200, face: 'spiral', mouth: 'wavy',  fx: 'orbit' },
  whoa:       { cd: 5000,  ms: 1000, face: 'wide',   mouth: 'o',     fx: 'pulse' },
  startled:   { cd: 6000,  ms: 1200, face: 'wide',   mouth: 'o',     fx: 'sweat' },
  gasp:       { cd: 3000,  ms: 1000, face: 'wide',   mouth: 'o',     fx: 'hands' },
  oops:       { cd: 3000,  ms: 1100, face: 'squint', mouth: 'flat',  fx: 'sweat' },
  wink:       { cd: 2000,  ms: 900,  face: 'wink',   mouth: 'smile', fx: 'twinkle' },
  cheer:      { cd: 4000,  ms: 1400, face: 'happy',  mouth: 'grin',  fx: 'arms confetti' },
  blush:      { cd: 20000, ms: 1800, face: '',       mouth: 'smile', fx: 'blush' },
  boop:       { cd: 0,     ms: 900,  face: 'happy',  mouth: 'o',     fx: 'heart blush' },
  yawn:       { cd: 60000, ms: 2200, face: 'shut',   mouth: 'yawn',  fx: '' },
  peek:       { cd: 15000, ms: 1300, face: '',       mouth: 'o',     fx: '' },
  nod:        { cd: 1000,  ms: 700,  face: '',       mouth: 'smile', fx: '' },
  'shake-no': { cd: 1000,  ms: 700,  face: '',       mouth: 'flat',  fx: '' },
  wave:       { cd: 2000,  ms: 1600, face: 'happy',  mouth: 'smile', fx: 'wave' },
  spin:       { cd: 1000,  ms: 800,  face: 'happy',  mouth: 'o',     fx: '' },
  dance:      { cd: 10000, ms: 2400, face: 'happy',  mouth: 'smile', fx: 'notes' },
  disco:      { cd: 30000, ms: 4000, face: 'happy',  mouth: 'grin',  fx: 'notes disco' },
  sparkle:    { cd: 4000,  ms: 1200, face: 'happy',  mouth: 'smile', fx: 'stars' },
  nightcap:   { cd: 0,     ms: 2600, face: 'shut',   mouth: 'flat',  fx: 'cap' },
  wheee:      { cd: 0,     ms: 1200, face: 'squint', mouth: 'grin',  fx: 'trail' },
};
// secret moves: emitted once per window as entity.secret {name}, counted in entity.profile.secrets
const SECRETS = { spin: 'barrel roll', dance: 'name dance', disco: 'disco', dizzy: 'round and round', nightcap: 'nightcap', boop: 'boop streak', wheee: 'wheee' };
const KONAMI = 'ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight b a';
const FAREWELL = { handoff: 'Sent to Claude ✦ see you in Claude Code', idle: 'All quiet here, so this window is closing ✦ see you in Claude Code', claude: 'Back to Claude Code ✦ see you there' };
let uid = 0;

// ------------------------------------------------------------------ helpers

/** Create an element. attrs: class, text, on<event> functions, anything else becomes an attribute. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false && kid !== '') el.append(kid);
  return el;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (v === null || v === '' || !Number.isFinite(+v) ? d : +v);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const keep = (arr, v, cap) => { arr.push(v); if (arr.length > cap) arr.shift(); };
const isImage = (f) => /^image\//.test(f?.type || '');
const plain = (v) => { try { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); } catch { return undefined; } };
const safe = (fn, ...a) => { try { return fn?.(...a); } catch (e) { console.warn('[lets-shell]', e); return undefined; } };
const spring = (y, v, w, dt) => { const e = Math.exp(-w * dt), c = v + w * y; return [(y + c * dt) * e, (v - w * c * dt) * e]; }; // exact critically damped step

function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|file|color|image)$/i.test(el.type);
}

function imageFiles(dt) {
  const out = [];
  for (const it of dt?.items || []) if (it.kind === 'file' && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) out.push(f); }
  if (!out.length) for (const f of dt?.files || []) if (isImage(f)) out.push(f);
  return out;
}

/** Markdown-lite → safe DOM: **bold**, *em*, `code`, ``` fences ```, line breaks. Never parses HTML. */
function mdLite(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text ?? '').split(/```([\w+-]*)\n?([\s\S]*?)(?:```|$)/);
  for (let i = 0; i < parts.length; i += 3) {
    inlineMd(frag, parts[i]);
    if (i + 2 < parts.length) frag.append(h('pre', { class: 'lets-pre', 'data-lang': parts[i + 1] || null }, h('code', { text: parts[i + 2].replace(/\n$/, '') })));
  }
  return frag;
}
function inlineMd(parent, s) {
  const re = /(\*\*[^*\n]+?\*\*|`[^`\n]+`|\*(?=\S)[^*\n]+?\*|\n)/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) parent.append(s.slice(last, m.index));
    const t = m[0];
    parent.append(t === '\n' ? h('br') : t.startsWith('**') ? h('strong', { text: t.slice(2, -2) }) : t[0] === '`' ? h('code', { text: t.slice(1, -1) }) : h('em', { text: t.slice(1, -1) }));
    last = re.lastIndex;
  }
  if (last < s.length) parent.append(s.slice(last));
}

/** A <canvas> thumbnail of an image blob (no blob:/data: URLs needed). */
function thumb(blob, max = 96) {
  const c = h('canvas', { class: 'lets-thumb', width: 1, height: 1, 'aria-hidden': 'true' });
  c.style.width = c.style.height = `${max}px`;
  (globalThis.createImageBitmap ? createImageBitmap(blob) : Promise.reject(new Error('no createImageBitmap'))).then((b) => {
    const s = Math.min(1, max / Math.max(b.width, b.height)), w = Math.max(1, Math.round(b.width * s)), hh = Math.max(1, Math.round(b.height * s)), d = Math.min(2, devicePixelRatio || 1);
    c.width = Math.round(w * d); c.height = Math.round(hh * d); c.style.width = `${w}px`; c.style.height = `${hh}px`;
    c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
    b.close?.();
  }, () => c.classList.add('lets-thumb-x'));
  return c;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = h('textarea', { class: 'lets-offscreen', 'aria-hidden': 'true' });
    ta.value = text; document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
    ta.remove();
    return ok;
  }
}

/** Inject /sdk/lets-shell.css once; resolves when it has loaded (or after 2 s). */
function ensureCss() {
  let link = document.querySelector('link[href$="lets-shell.css"]');
  if (link?.sheet) return Promise.resolve();
  if (!link) { link = h('link', { rel: 'stylesheet', href: CSS_HREF }); document.head.append(link); }
  return new Promise((res) => { link.addEventListener('load', res, { once: true }); link.addEventListener('error', res, { once: true }); setTimeout(res, 2000); });
}

function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { return null; } }

/** SVG path of a 4-point star at (x, y) with radius r. */
const star = (x, y, r) => { const q = r * 0.3, f = (v) => +v.toFixed(2); return `M${f(x)} ${f(y - r)}L${f(x + q)} ${f(y - q)} ${f(x + r)} ${f(y)} ${f(x + q)} ${f(y + q)} ${f(x)} ${f(y + r)} ${f(x - q)} ${f(y + q)} ${f(x - r)} ${f(y)} ${f(x - q)} ${f(y - q)}Z`; };
const ring = (n, fn) => Array.from({ length: n }, (_, i) => fn(i, (360 / n) * i)).join('');

// Expression parts (spiral / X / shut / squint eyes, extra mouths, arms, sweat, cap, heart, notes, confetti,
// stars, disco lights) are all in the markup and hidden (opacity 0) until a reaction or mood shows them.
function spriteSvg(n) {
  const eye = (x, cls, sq) => `<g transform="translate(${x} -2)"><g class="lets-e-eye ${cls}"><ellipse class="lets-e-white" rx="3.9" ry="5"/><g class="lets-e-pupil"><circle r="2.2"/><circle class="lets-e-glint" cx=".8" cy="-.9" r=".8"/></g><path class="lets-e-arc" d="M-3.8 1.4Q0-3.6 3.8 1.4"/>`
    + `<path class="lets-e-spiral" d="M0 0a.7.7 0 0 1 1.4 0a1.4 1.4 0 0 1-2.8 0a2.1 2.1 0 0 1 4.2 0a2.8 2.8 0 0 1-5.6 0"/><path class="lets-e-x" d="M-2.6-2.6L2.6 2.6M2.6-2.6L-2.6 2.6"/><path class="lets-e-shut" d="M-3.6-.2Q0 3.2 3.6-.2"/><path class="lets-e-squint" d="${sq}"/></g></g>`;
  const arm = (s) => `<g class="lets-e-arm lets-e-arm-${s < 0 ? 'l' : 'r'}"><ellipse class="lets-e-hand" cx="${22 * s}" cy="-5" rx="3.4" ry="4.4"/></g>`;
  const disco = (k) => `<radialGradient id="lets-d${k}-${n}"><stop offset=".3" class="lets-d${k}0"/><stop offset="1" class="lets-dz"/></radialGradient>`;
  return `<svg class="lets-e-svg" viewBox="-32 -32 64 64" width="${SIZE}" height="${SIZE}" aria-hidden="true" focusable="false">
<defs><radialGradient id="lets-aura-${n}"><stop offset="0" class="lets-g0"/><stop offset="1" class="lets-g1"/></radialGradient>
<radialGradient id="lets-body-${n}" cx="38%" cy="30%" r="75%"><stop offset="0" class="lets-b0"/><stop offset=".55" class="lets-b1"/><stop offset="1" class="lets-b2"/></radialGradient>
<linearGradient id="lets-rim-${n}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="lets-r0"/><stop offset="1" class="lets-r1"/></linearGradient>${disco('a')}${disco('b')}${disco('c')}</defs>
<circle class="lets-e-aura" r="31" fill="url(#lets-aura-${n})"/>
<g class="lets-e-disco">${['a', 'b', 'c'].map((k) => `<circle r="30" fill="url(#lets-d${k}-${n})"/>`).join('')}<g class="lets-e-disco-dots">${ring(8, (i, a) => `<circle class="lets-c${i % 3}" cy="-27" r="1.5" transform="rotate(${a})"/>`)}</g></g>
<circle class="lets-e-ring" r="28.5"/>
<g class="lets-e-body"><path class="lets-e-blob" d="M0-21C14-21 23-11 22 2 21 15 12 21 0 21S-21 15-22 2C-23-11-14-21 0-21Z" fill="url(#lets-body-${n})" stroke="url(#lets-rim-${n})"/>
<ellipse class="lets-e-shine" cx="-8" cy="-12" rx="7" ry="3.4" transform="rotate(-24 -8 -12)"/>
<ellipse class="lets-e-cheek" cx="-13" cy="6" rx="3.4" ry="2"/><ellipse class="lets-e-cheek" cx="13" cy="6" rx="3.4" ry="2"/>
${arm(-1)}${arm(1)}
<g class="lets-e-blinker">${eye(-8, 'lets-e-eye-l', 'M-3-3L2.6 0-3 3')}${eye(8, 'lets-e-eye-r', 'M3-3L-2.6 0 3 3')}</g>
<path class="lets-e-mouth lets-m-smile" d="M-4 9Q0 12.5 4 9"/><path class="lets-e-mouth lets-m-flat" d="M-3 10.5H3"/><ellipse class="lets-e-mouth lets-m-o" cx="0" cy="10.5" rx="2" ry="2.4"/>
<path class="lets-e-mouth lets-m-wavy" d="M-6 10.5q1.5-1.8 3 0t3 0 3 0 3 0"/><path class="lets-e-mouth lets-m-grin" d="M-5 8.6Q0 9.8 5 8.6Q3.8 14.8 0 14.8Q-3.8 14.8-5 8.6Z"/>
<path class="lets-e-sweat" d="M17.5-16Q14.9-12.1 14.9-10.4A2.6 2.6 0 0 0 20.1-10.4Q20.1-12.1 17.5-16Z"/>
<text class="lets-e-z" x="13" y="-15">z</text>
<g class="lets-e-cap"><path class="lets-e-cap-cone" d="M-14-15.5Q-9-30 6-29.5Q16-28 22.5-13L19.8-12Q15-21 6.5-22.5Q-4-23.5-14-15.5Z"/><path class="lets-e-cap-band" d="M-15.5-14.2Q-1-23 15.5-17.4"/><circle class="lets-e-cap-pom" cx="21.6" cy="-10.6" r="2.8"/></g></g>
<g class="lets-e-fx"><g transform="translate(13 -25)"><path class="lets-e-heart" d="M0 3.4C-4.4.2-5.4-2.6-3.6-4.3-2.2-5.6-.6-4.8 0-3.5.6-4.8 2.2-5.6 3.6-4.3 5.4-2.6 4.4.2 0 3.4Z"/></g>
<text class="lets-e-note" x="-27" y="-14">♪</text><text class="lets-e-note lets-c0" x="18" y="-20">♫</text>
${ring(8, (i, a) => `<g transform="rotate(${a})"><rect class="lets-e-conf lets-c${i % 3}" x="-1.1" y="-15" width="2.2" height="3.4" rx=".6"/></g>`)}
${ring(6, (i, a) => `<g transform="rotate(${a + 30})"><path class="lets-e-star lets-c${i % 2 ? 1 : 2}" d="${star(0, -23, 2.8)}"/></g>`)}
<path class="lets-e-twinkle" d="${star(16, -13, 3.4)}"/>
<g transform="translate(0 -22) scale(1 .4)"><g class="lets-e-dizzy">${ring(3, (i, a) => `<path d="${star(14 * Math.cos((a * Math.PI) / 180), 14 * Math.sin((a * Math.PI) / 180), 3.6)}"/>`)}</g></g></g>
<g class="lets-e-orbit"><circle cx="0" cy="-28.5" r="2.6"/></g></svg>`;
}

// ---------------------------------------------------------- built-in components
// A factory gets ctx {id, type, props, emit(action, value), upload(blob, source), shell}
// and returns an Element or {el, update?(props, patch), destroy?()}.

const BUILTINS = {
  note: (c) => h('div', { class: 'lets-note' }, mdLite(c.props.text ?? '')),

  options(c) {
    const p = c.props, multi = !!p.multi, chosen = new Set([].concat(p.value ?? []).map(String));
    const box = h('div', { class: 'lets-options', role: 'group' });
    for (const it of Array.isArray(p.items) ? p.items : []) {
      const id = String(it?.id ?? it);
      const btn = h('button', { class: 'lets-opt', type: 'button', 'aria-pressed': String(chosen.has(id)) },
        h('span', { class: 'lets-opt-label', text: String(it?.label ?? id) }), it?.hint && h('span', { class: 'lets-opt-hint', text: String(it.hint) }));
      btn.onclick = () => {
        if (multi) { chosen.has(id) ? chosen.delete(id) : chosen.add(id); btn.setAttribute('aria-pressed', String(chosen.has(id))); return; }
        for (const b of box.querySelectorAll('.lets-opt')) b.setAttribute('aria-pressed', String(b === btn));
        c.emit('pick', id);
      };
      box.append(btn);
    }
    if (multi) box.append(h('button', { class: 'lets-btn lets-btn-primary', type: 'button', text: p.submit || 'Done', onclick: () => c.emit('pick', [...chosen]) }));
    return box;
  },

  slider(c) {
    const input = h('input', { class: 'lets-range', type: 'range' }), out = h('output', { class: 'lets-slider-val' }), lab = h('span', { class: 'lets-dim' });
    let t = 0;
    const set = (p, withValue) => {
      input.min = num(p.min, 0); input.max = num(p.max, 100); input.step = num(p.step, 1) || 'any';
      if (withValue) input.value = num(p.value, input.min);
      lab.textContent = p.label || ''; input.setAttribute('aria-label', p.label || p.title || 'value'); out.textContent = input.value;
    };
    input.addEventListener('input', () => { out.textContent = input.value; clearTimeout(t); t = setTimeout(() => c.emit('change', Number(input.value)), 150); });
    set(c.props, true);
    return { el: h('div', { class: 'lets-slider' }, h('div', { class: 'lets-row' }, lab, out), input), update: (p, patch) => set(p, 'value' in patch), destroy: () => clearTimeout(t) };
  },

  toggle(c) {
    let v = !!c.props.value;
    const sw = h('button', { class: 'lets-switch', type: 'button', role: 'switch' }, h('span', { class: 'lets-switch-knob' }));
    const lab = h('span', { class: 'lets-toggle-label' });
    const set = (p, patch) => { if (!patch || 'value' in patch) v = !!p.value; sw.setAttribute('aria-checked', String(v)); lab.textContent = p.label || ''; sw.setAttribute('aria-label', p.label || p.title || 'toggle'); };
    sw.onclick = () => { v = !v; sw.setAttribute('aria-checked', String(v)); c.emit('change', v); };
    set(c.props);
    return { el: h('label', { class: 'lets-toggle' }, sw, lab), update: set };
  },

  form(c) {
    const p = c.props, fields = (Array.isArray(p.fields) ? p.fields : []).filter((f) => f && f.id != null), label = p.submit || 'Submit';
    const btn = h('button', { class: 'lets-btn lets-btn-primary', type: 'submit', text: label });
    const form = h('form', { class: 'lets-form' }, fields.map((f) => {
      let el;
      if (f.type === 'select') {
        el = h('select', null, (Array.isArray(f.options) ? f.options : []).map((o) => {
          const obj = o && typeof o === 'object', v = obj ? (o.value ?? o.id) : o;
          return h('option', { value: String(v), text: String(obj ? (o.label ?? v) : o) });
        }));
      } else el = f.type === 'textarea' ? h('textarea', { rows: '3' }) : h('input', f.type === 'number' ? { type: 'number', step: 'any' } : { type: 'text' });
      el.name = String(f.id);
      if (f.placeholder) el.placeholder = String(f.placeholder);
      if (f.value != null) el.value = String(f.value);
      return h('label', { class: 'lets-field' }, h('span', { text: String(f.label ?? f.id) }), el);
    }), btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = {};
      for (const f of fields) { const raw = form.elements.namedItem(String(f.id))?.value ?? ''; value[f.id] = f.type === 'number' ? (raw === '' ? null : Number(raw)) : raw; }
      c.emit('submit', value);
      btn.textContent = 'Sent ✓'; setTimeout(() => { btn.textContent = label; }, 1600);
    });
    return form;
  },

  'image-drop'(c) {
    const p = c.props, multi = !!p.multiple, thumbs = h('div', { class: 'lets-thumbs' });
    const file = h('input', { type: 'file', accept: 'image/*', multiple: multi, hidden: true });
    const zone = h('button', { class: 'lets-drop', type: 'button' },
      h('span', { class: 'lets-drop-icon', 'aria-hidden': 'true', text: '⬒' }), h('span', { text: p.hint || 'Drop, paste or click to add an image' }));
    const take = async (files, source) => {
      for (const f of [...files].filter(isImage).slice(0, multi ? 12 : 1)) {
        const t = thumb(f, 84); t.dataset.state = 'up';
        if (!multi) thumbs.replaceChildren();
        thumbs.append(t);
        const res = await c.upload(f, source);
        if (res) { t.dataset.state = 'ok'; c.emit('added', res.path); } else t.remove();
      }
    };
    zone.onclick = () => file.click();
    file.onchange = () => { take(file.files, 'file'); file.value = ''; };
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.dataset.over = 'true'; });
    zone.addEventListener('dragleave', () => { delete zone.dataset.over; });
    zone.addEventListener('drop', (e) => { e.preventDefault(); e[HANDLED] = true; delete zone.dataset.over; take(e.dataTransfer?.files || [], 'drop'); });
    zone.addEventListener('paste', (e) => { const fs = imageFiles(e.clipboardData); if (fs.length) { e.preventDefault(); e[HANDLED] = true; take(fs, 'paste'); } });
    return h('div', { class: 'lets-imgdrop' }, zone, file, thumbs);
  },

  progress(c) {
    const fill = h('div', { class: 'lets-bar-fill' }), lab = h('span'), pct = h('span', { class: 'lets-dim' });
    const bar = h('div', { class: 'lets-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
    const set = (p) => {
      const v = num(p.value, NaN), ok = Number.isFinite(v), f = ok ? clamp(v, 0, 1) : 0;
      bar.dataset.indet = String(!ok); fill.style.transform = ok ? `scaleX(${f})` : '';
      ok ? bar.setAttribute('aria-valuenow', String(Math.round(f * 100))) : bar.removeAttribute('aria-valuenow');
      pct.textContent = ok ? `${Math.round(f * 100)}%` : ''; lab.textContent = p.label || ''; bar.setAttribute('aria-label', p.label || p.title || 'progress');
    };
    set(c.props);
    return { el: h('div', { class: 'lets-progress' }, h('div', { class: 'lets-row' }, lab, pct), bar), update: set };
  },

  code(c) {
    const p = c.props, code = String(p.code ?? '');
    const copy = h('button', { class: 'lets-btn lets-btn-ghost lets-btn-sm', type: 'button', text: 'Copy' });
    copy.onclick = async () => { const ok = await copyText(code); copy.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { copy.textContent = 'Copy'; }, 1400); c.emit('copy'); };
    return h('div', { class: 'lets-code' }, h('div', { class: 'lets-row' }, h('span', { class: 'lets-lang', text: p.lang || '' }), copy), h('pre', { class: 'lets-pre' }, h('code', { text: code })));
  },
};

function unknownType(c) {
  let json;
  try { json = JSON.stringify(c.props, null, 2); } catch { json = String(c.props); }
  return h('div', { class: 'lets-note' }, h('p', { class: 'lets-dim', text: `Unknown component type “${c.type}”; showing its props.` }), h('pre', { class: 'lets-pre', text: json }));
}

// ---------------------------------------------------------------------- Shell

export class Shell {
  /**
   * Mount the shell and wire it to a LIP connection.
   * @param {object} lets a `Lets` instance from `/sdk/lets-client.js`
   * @param {MountOptions} [opts]
   * @returns {{lets:object, root:HTMLElement, entity:object, chat:object, components:object, media:object,
   *   toast:(text:string, level?:string, ttl?:number)=>()=>void, theme:(vars:object)=>void, destroy:()=>void,
   *   onInline:(cb:Function)=>()=>void, onMedia:(cb:Function)=>()=>void}}
   */
  static mount(lets, opts) { return mount(lets, opts || {}); }

  /** Render markdown-lite text to a DocumentFragment (the renderer bubbles, chat and notes use). */
  static md(text) { return mdLite(text); }
}
export default Shell;

function mount(lets, opts) {
  const host = opts.root || document.body;
  const offs = [], timers = new Set();
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const cancel = (id) => { clearTimeout(id); timers.delete(id); };
  const anim = (el, frames, o) => (RM.matches || !el.animate ? null : el.animate(frames, { duration: 300, easing: 'ease-out', ...o }));
  const ctxOf = (info) => plain(safe(opts.context, info));
  let api = null;

  // root + lazily created layers
  const root = h('div', { class: 'lets-shell', 'data-chat': 'closed' });
  root.style.visibility = 'hidden';                       // no unstyled flash while the CSS loads
  const cssReady = ensureCss().then(() => root.style.removeProperty('visibility'));
  const LAYERS = { panel: ['aside', 'lets-panel-slot'], float: ['div', 'lets-float-layer'], dock: ['div', 'lets-dock'], toasts: ['div', 'lets-toasts'], drop: ['div', 'lets-drop-hint', 'Drop to send to Claude'] };
  const layers = {};
  const layer = (k) => layers[k] || (layers[k] = root.appendChild(h(LAYERS[k][0], { class: LAYERS[k][1], text: LAYERS[k][2] })));
  host.append(root);

  // ================================================================ entity
  const persona = { name: 'Pip', tagline: '', traits: { speed: 0.5, distance: 0.5, chatty: 0.5, playful: 0.6 }, color: null, pace: 0 };
  const saved = loadProfile();
  const P = { start: Date.now(), speeds: [], gaps: [], reg: { tl: 0, tr: 0, bl: 0, br: 0, c: 0 }, clicks: 0, idleMs: 0, summons: 0, picks: 0, dismisses: 0, secrets: 0,
    lastInput: performance.now(), lastAction: 0, winT: 0, winD: 0, dirty: false, lastEmit: Date.now() };
  const E = { shown: false, x: innerWidth - 150, y: innerHeight - 46, vx: 0, vy: 0, px: null, py: null, ax: 0, ay: 0, sideX: 1, sideY: -1,
    offX: 66, offY: 50, omega: 9, parked: false, hold: 0, caught: false, hover: false, still: false, drag: false, lx: 0, ly: 0, peak: false, raf: 0, last: 0,
    mood: 'idle', base: 'idle', over: '', typing: false, dozing: false, blinkT: 0, bubbleT: 0 };
  E.tx = E.tlx = E.x; E.ty = E.tly = E.y;
  // reactions (R), secret moves found in this window (S), gesture detectors (D), dragging the companion (W)
  const R = { name: '', t: 0, sub: 0, anims: [], last: {}, look: null };
  const S = new Set();
  const D = { fast: [], sx: { dir: 0, run: 0, at: 0, revs: [] }, sy: { dir: 0, run: 0, at: 0, revs: [] }, ang: null, cum: 0, turns: [], wheel: [], clicks: [],
    boops: 0, boopT: 0, awayAt: 0, blushT: 0, yawnAt: 30000, yawned: false, keys: [], word: '', wordT: 0 };
  const W = { down: null, on: false, gx: 0, gy: 0, press: Infinity, eat: false };

  const eLayer = h('div', { class: 'lets-entity-layer', 'data-mood': 'idle', 'data-shown': 'false', 'data-still': 'false' });
  const trail = h('div', { class: 'lets-e-trail', 'aria-hidden': 'true' });
  const lean = h('div', { class: 'lets-e-lean' });
  lean.innerHTML = spriteSvg(++uid);                        // static markup, no user content
  const squash = h('div', { class: 'lets-e-squash' }, h('div', { class: 'lets-e-bob' }, lean));
  const pop = h('div', { class: 'lets-e-pop' }, squash);
  const sprite = h('div', { class: 'lets-entity', role: 'button', tabindex: '0', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, pop, h('span', { class: 'lets-e-badge', 'aria-hidden': 'true' }));
  const nameTag = h('span', { class: 'lets-e-name', 'aria-hidden': 'true' });
  const bubbleBody = h('div', { class: 'lets-bubble-body' });
  const bubble = h('div', { class: 'lets-bubble', role: 'status', 'data-open': 'false' }, bubbleBody);
  const menu = h('div', { class: 'lets-menu', role: 'menu', 'aria-label': 'Suggestions', 'data-open': 'false' });
  const wrap = h('div', { class: 'lets-e-wrap' }, sprite, nameTag, bubble, menu);
  eLayer.append(trail, wrap);
  root.append(eLayer);
  const blinker = lean.querySelector('.lets-e-blinker');
  const pupils = [...lean.querySelectorAll('.lets-e-pupil')];

  const squish = (k = 1) => { const p = 0.14 * k * (0.5 + persona.traits.playful); anim(squash, [{ transform: 'none' }, { transform: `scale(${1 + p},${1 - p})` }, { transform: `scale(${1 - p / 2},${1 + p / 2})` }, { transform: 'none' }], { duration: 420 }); };
  const hop = () => anim(squash, [{ transform: 'none' }, { transform: 'translateY(-10px) scale(.95,1.06)', offset: 0.4 }, { transform: 'scale(1.08,.92)', offset: 0.75 }, { transform: 'none' }], { duration: 480 });
  const shake = () => anim(squash, [0, -3, 3, -2, 2, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 380, easing: 'linear' });
  const blink = () => anim(blinker, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)', offset: 0.45 }, { transform: 'scaleY(1)' }], { duration: 170, easing: 'ease-in-out' });

  function retune() {
    const pace = (P.speeds.length >= 20 && median(P.speeds)) || saved?.pace || persona.pace || 600;
    E.omega = clamp(5 + pace / 130, 5.5, 14) * (0.65 + 0.7 * persona.traits.speed);   // faster users → snappier spring
    const d = 0.6 + 0.8 * persona.traits.distance;
    E.offX = 66 * d; E.offY = 50 * d;                                     // a comfortable step away from the pointer
  }

  function applyPersona(p = {}) {
    if (typeof p.name === 'string' && p.name.trim()) persona.name = p.name.trim().slice(0, 32);
    if (typeof p.tagline === 'string') persona.tagline = p.tagline.slice(0, 120);
    const tr = p.traits && typeof p.traits === 'object' ? p.traits : {};
    for (const k in persona.traits) if (tr[k] != null && Number.isFinite(+tr[k])) persona.traits[k] = clamp(+tr[k], 0, 1);
    if ('color' in p) persona.color = typeof p.color === 'string' && p.color ? p.color : null;
    if (Number.isFinite(p.profile?.pace)) persona.pace = p.profile.pace;
    sprite.setAttribute('aria-label', `${persona.name}, your companion`);
    nameTag.textContent = persona.tagline ? `${persona.name} · ${persona.tagline}` : persona.name;
    chatTitle.textContent = persona.name;
    for (const el of chatList.querySelectorAll('.lets-msg-entity .lets-msg-who')) el.textContent = persona.name;
    persona.color ? eLayer.style.setProperty('--lets-e-tint', persona.color) : eLayer.style.removeProperty('--lets-e-tint');
    eLayer.style.setProperty('--lets-play', persona.traits.playful.toFixed(2));
    if (MOODS.includes(p.mood)) { E.base = p.mood; refreshMood(false); }
    retune();
  }

  /** Follow target for a pointer position: offset up-right, flipping near viewport edges (with hysteresis). */
  function targetFor(px, py) {
    const vw = innerWidth, vh = innerHeight, r = SIZE / 2 + 6;
    const m = E.drag ? 1.5 : 1;                                            // while the human drags something, give more room
    const ox = E.offX * m, oy = E.offY * m;
    if (E.sideX > 0 ? px + ox + r > vw : px + ox + r < vw - 48) E.sideX = -E.sideX;
    if (E.sideY < 0 ? py - oy - r < 0 : py - oy - r > 48) E.sideY = -E.sideY;
    return { x: clamp(px + E.sideX * ox, r, vw - r), y: clamp(py + E.sideY * oy, r, vh - r) };
  }

  function kick() { if (!E.raf && E.shown) { E.last = performance.now(); E.raf = requestAnimationFrame(frame); } }

  function frame(t) {
    E.raf = 0;
    if (!E.shown) return;
    const dt = clamp((t - E.last) / 1000, 0.001, 0.05);
    E.last = t;
    if (E.px != null && !M.open && !E.caught && !E.parked && !W.on) {
      const dx = E.px - E.ax, dy = E.py - E.ay, d = Math.hypot(dx, dy);
      if (d > DEAD) { const k = 1 - DEAD / d; E.ax += dx * k; E.ay += dy * k; }   // dead-zone leash: micro-moves never move it
      const g = targetFor(E.ax, E.ay);
      E.tx = g.x; E.ty = g.y;
    }
    if (RM.matches) { E.x = E.tlx = E.tx; E.y = E.tly = E.ty; E.vx = E.vy = 0; }
    else {
      const w = W.on ? 26 : E.omega;                        // dragged ("wheee"): stick to the pointer
      let s = spring(E.x - E.tx, E.vx, w, dt); E.x = E.tx + s[0]; E.vx = s[1];
      s = spring(E.y - E.ty, E.vy, w, dt); E.y = E.ty + s[0]; E.vy = s[1];
      const k = 1 - Math.exp(-dt * 7); E.tlx += (E.x - E.tlx) * k; E.tly += (E.y - E.tly) * k;
    }
    const sp = Math.hypot(E.vx, E.vy);
    if (sp > 450) E.peak = true; else if (E.peak && sp < 40) { E.peak = false; squish(0.8); }   // squash on arrival
    let lx = 0, ly = 0;                                     // pupils: glance toward the pointer
    if (R.look) { lx = R.look.x; ly = R.look.y; }           // a reaction looks somewhere on purpose (peek, blush)
    else if (E.mood === 'thinking') { lx = 1.1; ly = -1.6; }
    else if (E.mood !== 'sleepy' && E.px != null) {
      const dx = E.px - E.x, dy = E.py - E.y, d = Math.hypot(dx, dy) || 1, m = Math.min(1, d / 140);
      lx = (dx / d) * 1.4 * m; ly = (dy / d) * 1.7 * m;
    }
    const ke = 1 - Math.exp(-dt * 12); E.lx += (lx - E.lx) * ke; E.ly += (ly - E.ly) * ke;
    wrap.style.transform = `translate3d(${(E.x - SIZE / 2).toFixed(1)}px,${(E.y - SIZE / 2).toFixed(1)}px,0)`;
    trail.style.transform = `translate3d(${(E.tlx - 22).toFixed(1)}px,${(E.tly - 22).toFixed(1)}px,0)`;
    lean.style.transform = `rotate(${clamp(E.vx * 0.012, -10, 10).toFixed(2)}deg)`;
    const pt = `translate(${E.lx.toFixed(2)}px,${E.ly.toFixed(2)}px)`;
    for (const p of pupils) p.style.transform = pt;
    if (bubble.dataset.open === 'true') placeBubble();
    const moving = sp > 1 || Math.abs(E.x - E.tx) > 0.3 || Math.abs(E.y - E.ty) > 0.3 || Math.abs(E.tlx - E.x) > 0.3 || Math.abs(E.tly - E.y) > 0.3 || Math.abs(lx - E.lx) > 0.02 || Math.abs(ly - E.ly) > 0.02;
    if (moving) E.raf = requestAnimationFrame(frame);
  }

  function show(at, fx = true) {
    setCatchable(true);                                   // just summoned: reachable right away
    cancel(E.catchT); E.catchT = later(() => setCatchable(E.caught || M.open), 1500);
    if (at) { E.x = E.tx = E.tlx = at.x; E.y = E.ty = E.tly = at.y; E.vx = E.vy = 0; }
    const was = E.shown;
    E.shown = true; eLayer.dataset.shown = 'true';
    if (!was) { for (const a of pop.getAnimations?.() || []) a.cancel(); if (fx) anim(pop, [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.16,.86)', opacity: 1, offset: 0.5 }, { transform: 'scale(.95,1.06)', offset: 0.75 }, { transform: 'none', opacity: 1 }], { duration: 520 }); }
    if (E.raf) { cancelAnimationFrame(E.raf); E.raf = 0; }
    E.last = performance.now(); frame(E.last);
    blinkLoop();
  }

  function hide() {
    if (!E.shown) return;
    closeMenu(); hideBubble();
    E.shown = false;
    const a = anim(pop, [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.3 }, { transform: 'scale(0)', opacity: 0 }], { duration: 240, easing: 'ease-in', fill: 'forwards' });
    const done = () => { if (!E.shown) eLayer.dataset.shown = 'false'; };
    a ? a.finished.then(done, done) : done();
  }

  function toggleAt(x, y, ctx) {
    if (E.shown) { P.dismisses++; P.dirty = true; hide(); lets.emit('entity.dismiss', {}); return; }
    P.summons++; P.dirty = true;
    E.px = E.ax = x; E.py = E.ay = y; E.parked = false; E.caught = false;
    show(targetFor(x, y));
    lets.emit('entity.summon', { x: Math.round(x), y: Math.round(y), context: ctx });
    if (Math.random() < persona.traits.chatty * 0.7) bubbleSay(GREETINGS[(Math.random() * GREETINGS.length) | 0], 2200);
  }

  function blinkLoop() {
    if (E.blinkT) return;
    E.blinkT = later(() => {
      E.blinkT = 0;
      if (!E.shown) return;
      blink();
      if (Math.random() < 0.2) later(blink, 240);
      blinkLoop();
    }, 2200 + Math.random() * 4200);
  }

  /** Effective mood: transient `say` mood > Claude typing > dozing > the base mood set by entity.mood. */
  function refreshMood(fx = true) {
    const m = E.over || (E.typing && E.base === 'idle' ? 'thinking' : '') || (E.dozing ? 'sleepy' : '') || E.base;
    if (m === E.mood) return;
    E.mood = m; eLayer.dataset.mood = m;
    if (fx) { if (m === 'alert') shake(); else if (m === 'happy' || m === 'proud') hop(); else if (m === 'curious') squish(0.5); }
    const cap = m === 'sleepy' && new Date().getHours() < 5;   // sleepy after midnight: night cap (a secret)
    if (cap !== (eLayer.dataset.cap === 'true')) {
      eLayer.dataset.cap = String(cap);
      if (cap && E.shown && auto('nightcap', { force: true })) secret('nightcap');
    }
    kick();
  }
  function setMood(m) { if (!MOODS.includes(m)) return false; E.base = m; E.dozing = false; refreshMood(); return true; }

  function placeBubble() {
    const x = E.x > innerWidth - 300 ? 'left' : 'right', y = E.y < 160 ? 'down' : 'up';
    if (bubble.dataset.x !== x) bubble.dataset.x = x;
    if (bubble.dataset.y !== y) bubble.dataset.y = y;
  }
  function bubbleSay(text, ttl) {
    bubbleBody.replaceChildren(mdLite(text));
    bubble.dataset.open = 'true'; placeBubble();
    cancel(E.bubbleT); E.bubbleT = later(hideBubble, clamp(num(ttl, 6000), 800, 120000));
  }
  function say(d) {
    const text = String(d.text ?? '').trim();
    if (!text) return;
    if (!E.shown) show(E.px != null ? targetFor(E.px, E.py) : null);
    E.over = MOODS.includes(d.mood) ? d.mood : '';
    refreshMood();
    bubbleSay(text, d.ttl);
  }
  function hideBubble() {
    if (bubble.dataset.open !== 'true') return;
    bubble.dataset.open = 'false'; cancel(E.bubbleT);
    if (E.over) { E.over = ''; refreshMood(false); }
  }

  // ---- click menu
  const M = { open: false, local: [], remote: [], replace: false, waiting: false, waitT: 0, ctx: undefined };
  const pickCbs = new Set();
  const norm = (items, src) => (Array.isArray(items) ? items : []).filter((it) => it && it.id != null && it.label != null).slice(0, 12)
    .map((it) => ({ id: String(it.id), label: String(it.label).slice(0, 120), hint: it.hint ? String(it.hint).slice(0, 160) : '', run: typeof it.run === 'function' ? it.run : null, src }));

  function renderMenu() {
    const items = M.replace ? M.remote : [...M.local, ...M.remote];
    const fi = [...menu.querySelectorAll('.lets-menu-item')].indexOf(document.activeElement);
    menu.replaceChildren(h('div', { class: 'lets-menu-head', 'aria-hidden': 'true', text: persona.name }),
      ...items.map((it) => h('button', { class: 'lets-menu-item', type: 'button', role: 'menuitem', 'data-src': it.src, onclick: () => pick(it) },
        h('span', { class: 'lets-mi-label', text: it.label }), it.hint && h('span', { class: 'lets-mi-hint', text: it.hint }))),
      M.waiting ? h('div', { class: 'lets-menu-wait lets-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))
        : !items.length && h('div', { class: 'lets-menu-empty', text: 'Nothing to suggest yet.' }));
    sprite.dataset.hasSuggestions = String(!M.open && M.remote.length > 0);
    if (fi >= 0 && items.length) menu.querySelectorAll('.lets-menu-item')[Math.min(fi, items.length - 1)].focus();
  }
  function openMenu(ctx, focus) {
    setCatchable(true);
    M.ctx = ctx; M.local = norm(safe(opts.quickSuggestions, ctx), 'local');
    M.open = true; M.waiting = true; cancel(M.waitT);
    M.waitT = later(() => { M.waiting = false; if (M.open) renderMenu(); }, 6000);
    menu.dataset.x = E.x > innerWidth - 320 ? 'left' : 'right';
    menu.dataset.y = E.y > innerHeight - 260 ? 'up' : 'down';
    renderMenu();
    menu.dataset.open = 'true'; sprite.setAttribute('aria-expanded', 'true');
    if (focus) menu.querySelector('.lets-menu-item')?.focus();
  }
  function closeMenu(refocus) {
    if (!M.open) return;
    const had = menu.contains(document.activeElement);
    M.open = false; cancel(M.waitT);
    menu.dataset.open = 'false'; sprite.setAttribute('aria-expanded', 'false');
    sprite.dataset.hasSuggestions = String(M.remote.length > 0);
    if (had || refocus) sprite.focus({ preventScroll: true });
    setCatchable(E.caught);
    kick();
  }
  function suggest(items, replace) {
    const list = norm(items, 'remote');
    M.remote = replace ? list : [...M.remote.filter((r) => !list.some((x) => x.id === r.id)), ...list];
    if (replace) M.replace = true;
    M.waiting = false; cancel(M.waitT);
    if (M.open) renderMenu();
    else { sprite.dataset.hasSuggestions = String(M.remote.length > 0); if (list.length) squish(0.35); }
  }
  function pick(it) {
    P.picks++; P.dirty = true;
    lets.emit('entity.pick', { id: it.id, label: it.label });
    M.remote = []; M.replace = false;
    closeMenu(); hop();
    const item = { id: it.id, label: it.label };
    safe(it.run, item, M.ctx);
    for (const fn of pickCbs) safe(fn, { ...item, source: it.src });
  }
  function activate(x, y, keyboard) {
    if (root.dataset.closing === 'true') return;            // saying goodbye: no menu
    if (M.open) { closeMenu(keyboard); return; }
    hideBubble();
    const ctx = ctxOf({ reason: 'click', x, y });
    squish(0.6);
    lets.emit('entity.click', { x: Math.round(x), y: Math.round(y), context: ctx });
    openMenu(ctx, keyboard);
  }

  /** entity.move: {x,y} | {to:"cursor"|"center"|"<selector>"} — eases there, then holds a moment before following again. */
  function moveTo(d = {}) {
    let p = null;
    if (Number.isFinite(+d.x) && Number.isFinite(+d.y) && d.x !== null && d.y !== null) p = { x: +d.x, y: +d.y };
    else if (d.to === 'cursor') { E.parked = false; if (E.px != null) { E.ax = E.px; E.ay = E.py; } if (!E.shown) show(E.px != null ? targetFor(E.px, E.py) : null); kick(); return; }
    else if (d.to === 'center') p = { x: innerWidth / 2, y: innerHeight / 2 };
    else if (typeof d.to === 'string') {
      let el = null;
      try { el = document.querySelector(d.to); } catch { /* bad selector */ }
      if (!el) throw new Error(`entity.move: nothing matches "${d.to}"`);
      const r = el.getBoundingClientRect();
      p = { x: r.right + SIZE / 2 + 8 > innerWidth ? r.left - SIZE / 2 - 8 : r.right + SIZE / 2 + 8, y: r.top + Math.min(r.height / 2, 40) };
    }
    if (!p) throw new Error('entity.move: needs {x,y} or {to}');
    const r = SIZE / 2 + 4;
    E.tx = clamp(p.x, r, innerWidth - r); E.ty = clamp(p.y, r, innerHeight - r);
    E.parked = true; E.hold = performance.now() + 3500;
    if (!E.shown) show({ x: E.tx, y: E.ty }); else kick();
  }

  // ---- learning: aggregate interaction stats (never raw moves)
  function touch(t) {
    const gap = t - P.lastInput;
    if (gap > 2500) P.idleMs += gap;
    P.lastInput = t; P.dirty = true;
    if (E.still) { E.still = false; eLayer.dataset.still = 'false'; }
    if (E.dozing) { E.dozing = false; refreshMood(false); hop(); }
    if (D.yawned) { D.yawned = false; D.yawnAt = 25000 + Math.random() * 15000; }   // the next idle stretch yawns again
  }
  function act(t) { if (P.lastAction) { const g = t - P.lastAction; if (g < 300000) keep(P.gaps, g, 300); } P.lastAction = t; }
  function profileData() {
    const now = performance.now(), sessionMs = Date.now() - P.start, tot = Object.values(P.reg).reduce((a, b) => a + b, 0) || 1, regions = {};
    for (const k in P.reg) regions[k] = +(P.reg[k] / tot).toFixed(2);
    return { pace: Math.round(median(P.speeds)), clickRate: +(P.clicks / Math.max(0.25, sessionMs / 60000)).toFixed(1), dwell: Math.round(median(P.gaps)), regions,
      idleMs: Math.round(P.idleMs + (now - P.lastInput > 2500 ? now - P.lastInput : 0)), sessionMs, summons: P.summons, picks: P.picks, dismisses: P.dismisses, secrets: P.secrets };
  }
  function emitProfile(force) {
    if (!P.dirty && !force) return;
    P.dirty = false; P.lastEmit = Date.now();
    const d = profileData();
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
    force ? lets.emitNow('entity.profile', d) : lets.emit('entity.profile', d);
    retune();
  }

  on(sprite, 'click', (e) => {
    if (W.eat) { W.eat = false; return; }                  // the end of a drag ("wheee"), not a click
    const quick = W.press < 350;
    W.press = Infinity;
    activate(e.clientX, e.clientY, false);
    if (quick) boop(e.detail === 2);                        // a boop still opens the menu; a double-click's 2nd click leaves the stage to `spin`
  });
  on(sprite, 'dblclick', (e) => { e.preventDefault(); if (auto('spin', { force: !S.has('spin') })) secret('spin'); });
  on(sprite, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    W.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    W.gx = E.x - e.clientX; W.gy = E.y - e.clientY;         // grab point, kept under the pointer while dragged
  });
  on(sprite, 'keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.ctrlKey) { e.preventDefault(); activate(E.x, E.y, true); }
    else if (e.key === 'ArrowDown' && M.open) { e.preventDefault(); menu.querySelector('.lets-menu-item')?.focus(); }
  });
  on(sprite, 'pointerenter', () => {
    E.hover = true; E.caught = true; setCatchable(true);
    cancel(D.blushT); D.blushT = later(() => { if (E.hover && !M.open && !W.on) auto('blush'); }, 1500);   // hovered a while: shy
  });
  on(sprite, 'pointerleave', () => { E.hover = false; cancel(D.blushT); });
  on(bubble, 'click', hideBubble);
  on(menu, 'keydown', (e) => {
    const items = [...menu.querySelectorAll('.lets-menu-item')], i = items.indexOf(document.activeElement);
    const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (go === undefined || !items.length) return;
    e.preventDefault(); items[(go + items.length) % items.length].focus();
  });

  on(window, 'pointermove', (e) => {
    const t = performance.now(), x = e.clientX, y = e.clientY;
    if (W.down && !W.on && (e.buttons & 1) && Math.hypot(x - W.down.x, y - W.down.y) > 60) startWheee();
    if (E.px != null) {
      const mx = x - E.px, my = y - E.py;
      P.winD += Math.hypot(mx, my);
      if (t - P.winT >= 100) {                              // 100 ms windows → speed + region samples
        const v = P.winD / ((t - P.winT) / 1000);
        if (P.winT && v > 30 && v < 20000) keep(P.speeds, v, 400);
        if (P.winT && !W.on) fastMotion(t, v);
        const rx = x / innerWidth, ry = y / innerHeight;
        P.reg[rx > 0.3 && rx < 0.7 && ry > 0.3 && ry < 0.7 ? 'c' : (ry < 0.5 ? 't' : 'b') + (rx < 0.5 ? 'l' : 'r')]++;
        P.winT = t; P.winD = 0;
      }
      // speed of this move (px/s); a deliberate approach is slow, a drag across the board is fast
      const dtm = Math.max(1, t - (E.lastMoveT || t - 16));
      E.spd = Math.hypot(mx, my) / (dtm / 1000);
      E.lastMoveT = t;
      const ex = E.x - x, ey = E.y - y, de = Math.hypot(ex, ey);   // let the human catch it: hold while approached slowly
      if (W.on) { const r = SIZE / 2 + 4; E.tx = clamp(x + W.gx, r, innerWidth - r); E.ty = clamp(y + W.gy, r, innerHeight - r); E.caught = true; }
      else if (E.drag) E.caught = false;                              // never park in the way of a drag
      else if (E.hover && E.spd < 900) E.caught = true;
      else if (de < 58 && E.spd < 350) E.caught = true;              // slow and near: it is being reached for
      else if (de > 110 || E.spd > 700) E.caught = false;            // far, or the pointer is just passing through
      setCatchable(E.caught || M.open);
      if (!W.on) gestures(x, y, mx, my, t);
    }
    E.px = x; E.py = y;
    if (E.parked && t > E.hold) { E.parked = false; E.ax = x; E.ay = y; }
    touch(t);
    if (D.awayAt) { const away = t - D.awayAt; D.awayAt = 0; if (away > 10000) auto('peek'); }   // back after a while: peek
    kick();
  }, { passive: true });
  on(window, 'pointerdown', (e) => {
    const t = performance.now();
    touch(t); act(t);
    if (e.button === 0) P.clicks++;
    if (e.button === 0 && !root.contains(e.target)) {        // a click storm on the unique's surface startles it
      keep(D.clicks, t, 6);
      if (D.clicks.length >= 6 && t - D.clicks[0] <= 1500) { D.clicks.length = 0; auto('startled'); }
    }
    if (M.open && !wrap.contains(e.target)) closeMenu();
    // a press on the unique's own surface starts a drag: the sprite steps aside and stops taking pointer events
    if (e.button === 0 && !root.contains(e.target)) setDrag(true);
  }, true);
  const endDrag = () => setDrag(false);
  on(window, 'pointerup', endDrag, true);
  on(window, 'pointercancel', endDrag, true);
  on(window, 'blur', endDrag);
  const endPress = () => { if (W.down) { W.press = performance.now() - W.down.t; W.down = null; } if (W.on) endWheee(); };
  on(window, 'pointerup', endPress, true);
  on(window, 'pointercancel', endPress, true);
  on(window, 'blur', endPress);
  function setDrag(on) {
    if (E.drag === on) return;
    E.drag = on;
    eLayer.dataset.drag = on ? 'true' : 'false';
    if (on) { E.caught = false; E.hover = false; setCatchable(M.open); }
    kick();
  }
  /** The sprite takes pointer events only when the human is reaching for it (or its menu is open); otherwise clicks fall through to the board. */
  function setCatchable(on) {
    const v = on ? 'true' : 'false';
    if (eLayer.dataset.catchable !== v) eLayer.dataset.catchable = v;
  }
  on(window, 'wheel', (e) => {
    const t = performance.now();
    touch(t);
    // a fast wheel / zoom burst (≥ 1500 px in 0.6 s; pinch-zoom deltas are small, so they count 4×) → whoa
    const k = (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1) * (e.ctrlKey ? 4 : 1);
    keep(D.wheel, [t, (Math.abs(e.deltaY) + Math.abs(e.deltaX)) * k], 120);
    while (t - D.wheel[0][0] > 600) D.wheel.shift();
    if (D.wheel.reduce((sum, w) => sum + w[1], 0) >= 1500) { D.wheel.length = 0; auto('whoa'); }
  }, { passive: true });
  // the pointer leaves the window: wave (and remember when, for a peek on return)
  on(document, 'mouseout', (e) => {
    if (e.relatedTarget) return;
    D.awayAt = performance.now();
    if (!E.drag && !W.on) auto('wave');
  });
  on(document, 'visibilitychange', () => { if (document.hidden && !D.awayAt) D.awayAt = performance.now(); });
  on(window, 'resize', () => {
    const r = SIZE / 2 + 6;
    // never moved by the human yet (or the viewport had no size at boot): re-home to the corner
    if (E.px == null && !E.caught) { E.tx = E.tlx = innerWidth - 150; E.ty = E.tly = innerHeight - 46; }
    if (root.dataset.closing === 'true') { E.tx = innerWidth / 2; E.ty = innerHeight / 2; }   // stay centred for the farewell
    E.tx = clamp(E.tx, r, innerWidth - r); E.ty = clamp(E.ty, r, innerHeight - r); kick();
  });
  on(window, 'beforeunload', () => emitProfile(true));
  on(host, 'contextmenu', (e) => {
    if (root.dataset.closing === 'true') { e.preventDefault(); return; }
    const t = e.target;
    if (isTextField(t) || t.closest?.('.lets-chat, .lets-card, .lets-menu, .lets-bubble, .lets-toast')) return;
    const x = e.clientX || E.px || innerWidth / 2, y = e.clientY || E.py || innerHeight / 2;
    const ctx = ctxOf({ reason: 'summon', x, y, target: t });
    if (ctx?.handled) return;
    e.preventDefault();
    toggleAt(x, y, ctx);
  });
  const tick = setInterval(() => {
    const idle = performance.now() - P.lastInput;
    if (!E.still && idle > 2500) { E.still = true; eLayer.dataset.still = 'true'; }   // idle bob
    // idle 25–40 s: one yawn (then, at 45 s, it dozes off)
    if (!D.yawned && !E.dozing && E.shown && !document.hidden && idle > D.yawnAt && E.base === 'idle' && !E.over && !E.typing && !R.name && root.dataset.closing !== 'true') { D.yawned = true; auto('yawn'); }
    if (!E.dozing && E.shown && idle > 45000 && E.base === 'idle' && !E.over && !E.typing) { E.dozing = true; refreshMood(false); }
    if (Date.now() - P.lastEmit >= 60000) emitProfile();
  }, 1000);

  // ---- reactions: short expressions. CSS draws the look (data-react / data-face / data-mouth / data-fx on the
  // entity layer), WAAPI the motion. One at a time; every name has a cooldown so the companion never nags.
  const auto = (name, o) => play(name, o, true);
  function setData(k, v) { if (v) eLayer.dataset[k] = v; else delete eLayer.dataset[k]; }
  function endReact() {
    cancel(R.t); cancel(R.sub); R.t = R.sub = 0;
    for (const a of R.anims.splice(0)) a.cancel();
    if (!R.name) return;
    R.name = ''; R.look = null;
    for (const k of ['react', 'face', 'mouth', 'fx']) delete eLayer.dataset[k];
    kick();
  }
  /**
   * Play reaction `name` for `o.ms` (300–8000; default per reaction). A new reaction replaces the current one,
   * except the farewell wave. Gesture triggers need a visible companion; API calls pop it in.
   * @returns {boolean} false for an unknown name, while cooling down (unless `o.force`), or when blocked
   */
  function play(name, o = {}, byGesture = false) {
    const spec = Object.hasOwn(REACT, name) ? REACT[name] : null;
    if (!spec) return false;
    if (R.name === 'wave' && root.dataset.closing === 'true' && name !== 'wave') return false;
    const t = performance.now();
    if (!o.force && t - (R.last[name] ?? -Infinity) < spec.cd) return false;
    if (!E.shown) { if (byGesture) return false; show(E.px != null ? targetFor(E.px, E.py) : null); }
    endReact();
    let ms = clamp(num(o.ms, spec.ms), 300, 8000);
    if (RM.matches) ms = Math.min(ms, 1100);                  // reduced motion: no motion, about a second of face/aura
    R.name = name; R.last[name] = t;
    setData('react', name); setData('face', spec.face); setData('mouth', spec.mouth); setData('fx', spec.fx);
    const dir = Math.sign((E.px ?? E.x) - E.x) || 1;
    if (name === 'peek') R.look = { x: 1.8 * dir, y: -0.4 };       // eyes dart to the pointer
    else if (name === 'blush') R.look = { x: -1.4 * dir, y: 1.5 };  // shy: looks away and down
    if (name === 'dizzy') R.sub = later(() => setData('face', 'x'), ms * 0.72);   // @_@ … x_x
    R.anims = motion(name, ms, dir).filter(Boolean);
    if (!o.hold) R.t = later(endReact, ms);
    kick();
    return true;
  }
  /** WAAPI motion of a reaction: the body moves on `squash`, tilts on `lean` (added to the follow tilt). None under reduced motion. */
  function motion(name, ms, dir) {
    const at = (transform, offset) => ({ transform, offset });
    const body = (frames, o) => anim(squash, frames.map((f) => (typeof f === 'string' ? { transform: f } : f)), { duration: ms, easing: 'ease-in-out', ...o });
    const tilt = (degs, o) => anim(lean, degs.map((d) => (Array.isArray(d) ? at(`rotate(${d[0]}deg)`, d[1]) : at(`rotate(${d}deg)`))), { duration: ms, easing: 'ease-in-out', composite: 'add', ...o });
    const up = 'translateY(-12px) scale(.94,1.07)', land = 'scale(1.08,.92)';
    switch (name) {
      case 'dizzy': return [tilt([0, 14, -12, 10, -8, 5, -2, 0]), body(['none', 'translateX(3px)', 'translateX(-3px)', 'translateX(2px)', 'none'])];
      case 'whoa': return [body(['none', at('translateY(2px) scale(1.07,.9)', 0.2), at('translateY(1px) scale(1.03,.95)', 0.75), 'none']), tilt([0, [-9, 0.2], [-7, 0.75], 0])];
      case 'startled': { const d = Math.min(ms, 700); return [body(['none', at('translateY(-14px) scale(.9,1.12)', 0.22), at('scale(1.12,.88)', 0.45), at('translateY(-3px)', 0.62), 'none'], { duration: d, easing: 'ease-out' }), tilt([0, -4, 4, -3, 3, 0], { duration: d })]; }
      case 'gasp': return [body(['none', at('scale(.9,1.08)', 0.2), at('scale(.92,1.06)', 0.8), 'none'])];
      case 'oops': return [tilt([0, [-13, 0.25], [-11, 0.75], 0]), body(['none', at('translateY(1px) scale(1.03,.97)', 0.3), 'none'], { duration: 500 })];
      case 'wink': return [body(['none', at('scale(1.06,.94)', 0.3), at('scale(.98,1.02)', 0.6), 'none'], { duration: 500 })];
      case 'cheer': return [body(['none', at(up, 0.18), at(land, 0.36), at('none', 0.5), at(up, 0.68), at(land, 0.86), 'none'], { duration: Math.min(ms, 1100) })];
      case 'blush': return [tilt([0, 4, -4, 3, -2, 0], { duration: Math.min(ms, 1000) })];
      case 'boop': return [body(['none', at('scale(1.16,.84)', 0.25), at('scale(.94,1.06)', 0.6), 'none'], { duration: 450, easing: 'ease-out' })];
      case 'yawn': return [body(['none', at('translateY(-2px) scale(.95,1.08)', 0.35), at('scale(.96,1.07)', 0.7), 'none']), tilt([0, [-3, 0.35], [3, 0.7], 0])];
      case 'peek': return [tilt([0, [10 * dir, 0.3], [10 * dir, 0.75], 0]), body(['none', at(`translateX(${4 * dir}px)`, 0.3), at(`translateX(${4 * dir}px)`, 0.75), 'none'])];
      case 'nod': return [body(['none', 'translateY(3px) scale(1.03,.97)', 'none', 'translateY(3px) scale(1.03,.97)', 'none'])];
      case 'shake-no': return [body([0, -4, 4, -4, 4, 0].map((x) => `translateX(${x}px)`)), tilt([0, -5, 5, -5, 5, 0])];
      case 'wave': return [body(['none', at('translateY(-6px)', 0.15), at('translateY(-6px)', 0.85), 'none']), tilt([0, 9, -9, 9, -9, 7, 0])];
      case 'spin': { const d = Math.min(ms, 900); return [tilt([0, 360], { duration: d }), body(['none', at('translateY(-8px)', 0.45), 'none'], { duration: d })]; }
      case 'dance': case 'disco': {                        // a groove on the beat: dip, sway left, dip, sway right…
        const beats = Math.max(4, Math.round(ms / 300)), moves = [], tilts = [];
        for (let i = 0; i <= beats; i++) {
          const end = i === 0 || i === beats, b = i % 4;
          moves.push({ transform: end ? 'none' : ['translateY(2px) scale(1.05,.95)', 'translate(-5px,-3px)', 'translateY(2px) scale(1.05,.95)', 'translate(5px,-3px)'][b], easing: 'ease-in-out' });
          tilts.push(end ? 0 : [0, -10, 0, 10][b]);
        }
        return [body(moves, { easing: 'linear' }), tilt(tilts, { easing: 'linear' })];
      }
      case 'sparkle': return [body(['none', at('translateY(-6px) scale(.97,1.04)', 0.3), at('scale(1.04,.96)', 0.55), 'none'], { duration: 600 })];
      case 'nightcap': return [body(['none', at('scale(1.05,.95)', 0.3), 'none'], { duration: 600 })];
      default: return [];                                   // wheee: the drag itself is the motion
    }
  }
  /** First discovery of a secret move in this window: tell Claude once, count it, and celebrate with a bubble. */
  function secret(name) {
    if (S.has(name) || !SECRETS[name]) return;
    S.add(name); P.secrets = S.size; P.dirty = true;
    lets.emit('entity.secret', { name });
    later(() => bubbleSay(`✦ Secret move found: **${SECRETS[name]}** (${S.size}/${Object.keys(SECRETS).length})`, 4200), 250);
  }
  /** A quick click on the companion: squish and a heart. Five in a row (each within 1.5 s) is the "boop streak" secret. */
  function boop(silent) {
    const t = performance.now();
    D.boops = t - D.boopT < 1500 ? D.boops + 1 : 1; D.boopT = t;
    const streak = D.boops >= 5;
    if (streak) D.boops = 0;
    if (streak && !S.has('boop')) { if (auto('boop', { force: true })) secret('boop'); }
    else if (!silent) auto('boop');
  }
  /** Dragging the caught companion ("wheee"): it follows the pointer directly, squints, and lands on release. */
  function startWheee() {
    W.on = true; cancel(D.blushT); closeMenu(); hideBubble();
    E.caught = true; E.parked = false; setCatchable(true);
    eLayer.dataset.wheee = 'true';
    try { sprite.setPointerCapture(W.down.id); } catch { /* the pointer is already gone */ }
    if (auto('wheee', { force: true, hold: true })) secret('wheee');
  }
  function endWheee() {
    W.on = false; W.eat = true; later(() => { W.eat = false; }, 80);   // swallow the click that ends the drag
    delete eLayer.dataset.wheee;
    if (R.name === 'wheee') endReact();
    squish(0.8); kick();
  }
  /** One axis of a mouse shake: true on the 3rd quick reversal (each swing ≥ 40 px in < 350 ms) within 1 s. */
  function swing(s, d, t) {
    if (Math.abs(d) < 2) return false;
    const dir = d > 0 ? 1 : -1;
    if (dir === s.dir) { s.run += Math.abs(d); return false; }
    const quick = s.dir !== 0 && s.run >= 40 && t - s.at < 350;
    s.dir = dir; s.run = Math.abs(d); s.at = t;
    if (!quick) { s.revs.length = 0; return false; }
    s.revs.push(t);
    while (t - s.revs[0] > 1000) s.revs.shift();
    return s.revs.length >= 3;
  }
  /** Pointer gestures: a mouse shake makes the companion dizzy; circling it 2 turns in 3 s too (a secret). */
  function gestures(x, y, mx, my, t) {
    const a = swing(D.sx, mx, t), b = swing(D.sy, my, t);
    if (a || b) { D.sx.revs.length = D.sy.revs.length = 0; auto('dizzy'); }
    if (!E.shown) return;
    const cx = x - E.x, cy = y - E.y, dc = Math.hypot(cx, cy);
    if (dc < 20 || dc > 260) { D.ang = null; D.turns.length = 0; return; }
    const ang = Math.atan2(cy, cx);
    if (D.ang != null) { const da = ang - D.ang; D.cum += da - Math.round(da / (2 * Math.PI)) * 2 * Math.PI; }
    D.ang = ang;
    keep(D.turns, [t, D.cum], 600);
    while (t - D.turns[0][0] > 3000) D.turns.shift();
    if (Math.abs(D.cum - D.turns[0][1]) >= 4 * Math.PI) { D.turns.length = 0; if (auto('dizzy', { force: !S.has('dizzy') })) secret('dizzy'); }
  }
  /** ~1.5 s of very fast pointer travel (median ≥ 2500 px/s over the 100 ms samples) → dizzy. */
  function fastMotion(t, v) {
    keep(D.fast, [t, v], 30);
    while (t - D.fast[0][0] > 1500) D.fast.shift();
    if (D.fast.length >= 8 && t - D.fast[0][0] >= 1200 && median(D.fast.map((f) => f[1])) >= 2500) { D.fast.length = 0; auto('dizzy'); }
  }
  /** Keys outside text fields: Delete/Backspace → gasp, Ctrl+Z → oops, "pip" (or its name) → dance, Konami → disco. */
  function keyMoves(e, t) {
    if (e.repeat || e.isComposing || isTextField(e.target) || isTextField(document.activeElement)) return;
    const k = String(e.key || ''), kk = k.length === 1 ? k.toLowerCase() : k, mod = e.ctrlKey || e.metaKey;
    if (/^(Control|Shift|Alt|Meta)$/.test(k)) return;
    keep(D.keys, kk, 10);
    if (D.keys.join(' ') === KONAMI) { D.keys.length = 0; if (auto('disco', { force: !S.has('disco') })) secret('disco'); return; }
    if (mod && !e.altKey && !e.shiftKey && kk === 'z') { auto('oops'); return; }
    if ((k === 'Delete' || k === 'Backspace') && !mod && !e.altKey) { auto('gasp'); return; }
    if (!/^[a-z]$/.test(kk) || mod || e.altKey) { D.word = ''; return; }
    D.word = ((t - D.wordT < 1500 ? D.word : '') + kk).slice(-16); D.wordT = t;
    const name = persona.name.toLowerCase();
    if (D.word.endsWith('pip') || (/^[a-z]{3,16}$/.test(name) && D.word.endsWith(name))) { D.word = ''; if (auto('dance', { force: !S.has('dance') })) secret('dance'); }
  }

  const entity = {
    /** Pop the sprite in at `at` ({x,y}) or where it last was. No event is emitted. */
    show: (at) => show(at || null),
    /** Pop the sprite out. No event is emitted. */
    hide: () => hide(),
    /** Toggle like a right-click at the pointer; emits entity.summon / entity.dismiss. */
    toggle: () => { const x = E.px ?? innerWidth / 2, y = E.py ?? innerHeight / 2; toggleAt(x, y, E.shown ? undefined : ctxOf({ reason: 'api', x, y })); },
    /** Speech bubble. `say('hi')` or `say({text, mood?, ttl?})`; the mood lasts while the bubble shows. */
    say: (t, o) => say(typeof t === 'string' ? { ...o, text: t } : t || {}),
    /** Set the base mood; returns false for an unknown mood. */
    mood: (m) => setMood(m),
    /** Play a reaction (`dizzy`, `cheer`, `wink`, … see docs/ENTITY.md) with opts {ms?, force?}. False for an unknown name or while it cools down. */
    react: (name, o) => play(String(name), { ms: o?.ms, force: !!o?.force }),
    /** Add (or with replace=true, replace) click-menu suggestions. */
    suggest: (items, replace = false) => suggest(items, replace),
    /** Ease to {x,y} or {to:"cursor"|"center"|"<selector>"}. */
    move: (d) => moveTo(d),
    /** Apply {name?, traits?, color?, mood?, tagline?}. */
    persona: (p) => applyPersona(p || {}),
    /** Listen to menu picks: cb({id, label, source:'local'|'remote'}). Returns an unsubscribe function. */
    onPick: (cb) => { pickCbs.add(cb); return () => pickCbs.delete(cb); },
    /** Current aggregate interaction stats (the entity.profile payload). */
    profile: () => profileData(),
    get state() { return { visible: E.shown, x: Math.round(E.x), y: Math.round(E.y), mood: E.mood, name: persona.name, traits: { ...persona.traits } }; },
    el: sprite,
  };

  // ================================================================== chat
  const C = { open: false, unread: 0, streams: new Map(), atts: [], q: Promise.resolve() };
  const chatStatus = h('span', { class: 'lets-chat-status', 'data-status': lets.status || 'connecting', role: 'img', 'aria-label': 'connection status' });
  const chatTitle = h('span', { class: 'lets-chat-title' });
  const chatList = h('div', { class: 'lets-chat-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages', tabindex: '0' });
  const typingEl = h('div', { class: 'lets-typing lets-dots', 'data-on': 'false', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const attRow = h('div', { class: 'lets-chat-atts' });
  const input = h('textarea', { class: 'lets-chat-input', rows: '1', placeholder: 'Message…  (Enter sends, Shift+Enter new line)', 'aria-label': 'Message' });
  const form = h('form', { class: 'lets-chat-form' }, attRow,
    h('div', { class: 'lets-chat-row' }, input, h('button', { class: 'lets-btn lets-btn-primary lets-chat-send', type: 'submit', 'aria-label': 'Send', text: '➤' })));
  const panel = h('section', { class: 'lets-chat', 'aria-label': 'Chat', 'data-open': 'false' },
    h('header', { class: 'lets-chat-head' }, chatStatus, chatTitle, h('kbd', { class: 'lets-kbd', text: 'Ctrl+/' }),
      h('button', { class: 'lets-icon-btn', type: 'button', 'aria-label': 'Collapse chat', text: '›', onclick: () => chatSet(false) })),
    chatList, typingEl, form);
  const badgeEl = h('span', { class: 'lets-chat-badge', hidden: true });
  const tab = h('button', { class: 'lets-chat-tab', type: 'button', 'aria-label': 'Open chat (Ctrl+/)', 'aria-expanded': 'false', onclick: () => chatSet(true, true) },
    h('span', { class: 'lets-chat-tab-orb', 'aria-hidden': 'true' }), h('span', { text: 'Chat' }), badgeEl);
  root.append(panel, tab);
  const offStatus = lets.onStatus?.((s) => { chatStatus.dataset.status = s; });
  if (typeof offStatus === 'function') offs.push(offStatus);

  function chatSet(open, focus) {
    C.open = !!open; panel.dataset.open = String(C.open); root.dataset.chat = C.open ? 'open' : 'closed';
    tab.setAttribute('aria-expanded', String(C.open));
    if (C.open) { C.unread = 0; badgeEl.hidden = true; chatList.scrollTop = chatList.scrollHeight; if (focus) later(() => input.focus({ preventScroll: true }), 40); }
    else if (panel.contains(document.activeElement)) tab.focus({ preventScroll: true });
  }
  function msgEl(role, text) {
    const who = /^(you|user|human|me)$/.test(role) ? 'you' : role === 'system' ? 'system' : 'entity';
    const body = h('div', { class: 'lets-msg-body' }, mdLite(text));
    const el = h('div', { class: `lets-msg lets-msg-${who}` }, who !== 'system' && h('div', { class: 'lets-msg-who', text: who === 'you' ? 'you' : persona.name }), body);
    return { el, body, who };
  }
  const nearBottom = () => chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 80;
  function addMsg(el, who) {
    const stick = nearBottom();
    chatList.append(el);
    while (chatList.childElementCount > 300) chatList.firstElementChild.remove();
    if (stick || who === 'you') chatList.scrollTop = chatList.scrollHeight;
    if (!C.open && who === 'entity') { C.unread++; badgeEl.hidden = false; badgeEl.textContent = C.unread > 9 ? '9+' : String(C.unread); }
  }
  function append(role, text) { const m = msgEl(String(role || 'entity'), text); addMsg(m.el, m.who); return m.el; }
  function stream(id, chunk = '', done = false, seq) {
    let s = C.streams.get(id);
    if (!s) {
      const m = msgEl('entity', '');
      s = { el: m.el, body: m.body, parts: [], t: 0 };
      m.el.classList.add('lets-streaming'); C.streams.set(id, s); addMsg(m.el, 'entity'); typing(false);
    }
    if (Number.isInteger(seq) && seq >= 0 && seq < 100000) s.parts[seq] = String(chunk); else s.parts.push(String(chunk));
    const stick = nearBottom();
    s.body.replaceChildren(mdLite(s.parts.join('')));
    if (stick) chatList.scrollTop = chatList.scrollHeight;
    cancel(s.t);
    if (done) { s.el.classList.remove('lets-streaming'); C.streams.delete(id); }
    else s.t = later(() => stream(id, '', true), 30000);   // a stream that never says done:true still ends
    return s.el;
  }
  function typing(v) { typingEl.dataset.on = String(!!v); E.typing = !!v; refreshMood(false); }
  function autosize() { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; }
  function attach(file, source = 'paste') {
    const a = { path: null, mime: file.type, preview: isImage(file) ? thumb(file, 56) : h('span', { class: 'lets-att-file', text: file.name || 'file' }) };
    const chip = h('div', { class: 'lets-att', 'data-state': 'up' }, a.preview);
    chip.append(h('button', { class: 'lets-att-x', type: 'button', 'aria-label': 'Remove attachment', text: '×', onclick: () => { C.atts = C.atts.filter((o) => o !== a); chip.remove(); } }));
    a.promise = upload(file, { source, notify: false, quiet: true }).then((res) => { chip.dataset.state = res ? 'ok' : 'err'; if (res) { a.path = res.path; a.mime = res.mime || file.type; } });
    C.atts.push(a); attRow.append(chip);
  }
  function sendChat() {
    const text = input.value.trim(), atts = C.atts.splice(0);
    if (!text && !atts.length) return;
    input.value = ''; autosize(); attRow.replaceChildren();
    const m = msgEl('you', text);
    if (atts.length) m.body.append(h('div', { class: 'lets-msg-atts' }, atts.map((a) => a.preview)));
    addMsg(m.el, 'you');
    C.q = C.q.then(async () => {                         // keep order even while uploads finish
      await Promise.allSettled(atts.map((a) => a.promise));
      const attachments = atts.filter((a) => a.path).map((a) => ({ path: a.path, mime: a.mime }));
      lets.emit('chat.message', attachments.length ? { text, attachments } : { text });
      if (L.on === false) toast(`${persona.name} is away — Claude reads this with your next message in Claude Code`, 'info', 4500);
    });
  }
  on(form, 'submit', (e) => { e.preventDefault(); sendChat(); });
  on(input, 'keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); } });
  on(input, 'input', autosize);
  on(input, 'paste', (e) => { const fs = imageFiles(e.clipboardData); if (!fs.length) return; e.preventDefault(); e[HANDLED] = true; fs.forEach((f) => attach(f, 'paste')); });

  const chatApi = {
    /** Open the panel (no focus steal). */ open: () => chatSet(true),
    /** Collapse to the tab. */ close: () => chatSet(false),
    /** Toggle; `focus` moves focus to the input when opening. */ toggle: (focus = false) => chatSet(!C.open, focus),
    /** Add a finished message: role 'you' | 'entity' (or 'claude') | 'system'. */ append,
    /** Append a chunk to stream `id`; `done` ends it. */ stream: (id, chunk, done = false, seq) => stream(String(id), chunk, done, seq),
    /** Show / hide the typing dots. */ typing,
    /** Attach a File to the next chat.message (uploads now). */ attach,
    get isOpen() { return C.open; },
  };

  // ============================================================ components
  const comps = new Map(), types = new Map(Object.entries(BUILTINS)), inlineCbs = new Set(), actionCbs = new Set();
  let zTop = 1;
  const view = (r) => r.view || (r.view = { id: r.id, type: r.type, slot: r.slot, el: r.el, get props() { return r.props; }, update: (p) => update(r.id, p), remove: () => remove(r.id) });
  const place = (r) => { r.el.style.transform = `translate3d(${Math.round(r.pos.x)}px,${Math.round(r.pos.y)}px,0)`; };

  function fire(rec, action, value) {
    const d = value === undefined ? { id: rec.id, action } : { id: rec.id, action, value };
    lets.emit('component.action', d);
    for (const fn of actionCbs) safe(fn, d);
  }
  function render(rec, patch) {
    const p = rec.props;
    rec.title.textContent = p.title != null ? String(p.title) : TITLES[rec.type] || rec.type;
    rec.el.setAttribute('aria-label', rec.title.textContent);
    rec.el.dataset.tone = typeof p.tone === 'string' ? p.tone : '';
    if (patch && rec.inst?.update) { safe(() => rec.inst.update(p, patch)); return; }
    safe(() => rec.inst?.destroy?.());
    const ctx = { id: rec.id, type: rec.type, props: p, shell: api, emit: (a, v) => fire(rec, a, v), upload: (blob, source = 'file') => upload(blob, { source, componentId: rec.id }) };
    let out;
    try { out = (types.get(rec.type) || unknownType)(ctx); } catch (e) { console.warn('[lets-shell] component', rec.type, e); out = unknownType(ctx); }
    rec.inst = out instanceof Node ? null : out || null;
    const node = out instanceof Node ? out : out?.el;
    rec.body.replaceChildren(...(node ? [node] : []));
  }
  function dragify(rec) {
    rec.head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      rec.el.style.zIndex = String(++zTop);
      const sx = e.clientX - rec.pos.x, sy = e.clientY - rec.pos.y;
      rec.head.setPointerCapture?.(e.pointerId);
      const move = (ev) => { rec.pos = { x: clamp(ev.clientX - sx, -240, innerWidth - 80), y: clamp(ev.clientY - sy, 0, innerHeight - 40) }; place(rec); };
      const up = () => { for (const [k, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) rec.head.removeEventListener(k, f); };
      rec.head.addEventListener('pointermove', move); rec.head.addEventListener('pointerup', up); rec.head.addEventListener('pointercancel', up);
    });
  }
  /** Create (or re-create) a component from a `component.create` spec; returns its handle. */
  function create(spec = {}) {
    const id = String(spec.id ?? `c_${Date.now().toString(36)}${(++uid).toString(36)}`), type = String(spec.type || 'note');
    let slot = ['dock', 'float', 'panel', 'inline'].includes(spec.slot) ? spec.slot : 'dock';
    if (slot === 'inline' && !inlineCbs.size) slot = 'float';             // nobody to hand it to
    const old = comps.get(id);
    if (old && old.type === type && old.slot === slot) { old.props = { ...(spec.props || {}) }; render(old); return view(old); }
    if (old) { comps.delete(id); safe(() => old.inst?.destroy?.()); old.el.remove(); }
    const rec = { id, type, slot, props: { ...(spec.props && typeof spec.props === 'object' ? spec.props : {}) }, inst: null };
    rec.title = h('h3', { class: 'lets-card-title' });
    rec.body = h('div', { class: 'lets-card-body' });
    rec.head = h('header', { class: 'lets-card-head' }, h('span', { class: 'lets-card-icon', 'aria-hidden': 'true', text: ICONS[type] || '◇' }), rec.title,
      h('button', { class: 'lets-icon-btn lets-card-x', type: 'button', 'aria-label': 'Close', text: '×', onclick: () => { fire(rec, 'close'); remove(id); } }));
    rec.el = h('article', { class: 'lets-card', role: 'region', 'data-type': type, 'data-slot': slot, 'data-id': id }, rec.head, rec.body);
    render(rec);
    comps.set(id, rec);
    if (slot === 'float') {
      const ax = num(spec.at?.x, NaN), ay = num(spec.at?.y, NaN);
      const a = Number.isFinite(ax) && Number.isFinite(ay) ? { x: ax, y: ay } : E.shown ? { x: E.x + 40, y: E.y - 40 } : { x: innerWidth / 2 - 160, y: innerHeight / 3 };
      rec.pos = { x: clamp(a.x, 8, Math.max(8, innerWidth - 328)), y: clamp(a.y, 8, Math.max(8, innerHeight - 140)) };
      place(rec); rec.el.style.zIndex = String(++zTop);
      layer('float').append(rec.el); dragify(rec);
    } else if (slot === 'inline') for (const fn of inlineCbs) safe(fn, view(rec));
    else layer(slot).append(rec.el);
    anim(rec.el, [{ opacity: 0, scale: '.96' }, { opacity: 1, scale: '1' }], { duration: 220 });
    return view(rec);
  }
  /** Patch props and re-render in place. Throws for an unknown id. */
  function update(id, props) {
    const rec = comps.get(String(id));
    if (!rec) throw new Error(`component.update: no component "${id}"`);
    const patch = props && typeof props === 'object' ? props : {};
    rec.props = { ...rec.props, ...patch };
    render(rec, patch);
    return view(rec);
  }
  /** Remove a component (no event). Returns false for an unknown id. */
  function remove(id) {
    const rec = comps.get(String(id));
    if (!rec) return false;
    comps.delete(rec.id);
    safe(() => rec.inst?.destroy?.());
    const a = anim(rec.el, [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.96' }], { duration: 160, easing: 'ease-in' });
    a ? a.finished.then(() => rec.el.remove(), () => rec.el.remove()) : rec.el.remove();
    return true;
  }
  const compApi = {
    create, update, remove,
    /** Handle {id,type,slot,el,props,update,remove} or null. */ get: (id) => { const r = comps.get(String(id)); return r ? view(r) : null; },
    /** All live component handles. */ list: () => [...comps.values()].map(view),
    /** Add or override a type: factory(ctx) → Element | {el, update?(props, patch), destroy?()}. */ register: (type, factory) => { types.set(String(type), factory); },
    /** Local listener for every component.action {id, action, value?}. */ onAction: (cb) => { actionCbs.add(cb); return () => actionCbs.delete(cb); },
  };

  // ================================================================= media
  const mediaCbs = new Set(), pasteOn = new WeakSet(), dropOn = new WeakSet();
  /** Upload through lets.upload (the host emits media.image); toasts and notifies onMedia listeners. */
  async function upload(blob, { source = 'file', componentId = '', notify = true, quiet = false } = {}) {
    if (blob.size > MAX_UPLOAD) { toast('That file is too big (25 MB max).', 'warn'); return null; }
    try {
      const res = await lets.upload(blob, { source, componentId, name: blob.name || '' });
      const out = { ...res, source, componentId: componentId || undefined, blob };
      if (!quiet) toast(isImage(blob) ? 'image sent to Claude' : 'file sent to Claude', 'ok', 2200);
      if (notify) for (const fn of mediaCbs) safe(fn, out);
      return out;
    } catch (e) { toast(`Upload failed: ${e?.message || e}`, 'error'); return null; }
  }
  /** Upload pasted images (ignored while typing in a text field other than the chat). Idempotent per element. */
  function enablePaste(el = document) {
    if (pasteOn.has(el)) return () => {};
    pasteOn.add(el);
    const fn = (e) => {
      const field = isTextField(e.target) ? e.target : isTextField(document.activeElement) ? document.activeElement : null;
      if (e[HANDLED] || (field && field !== input)) return;          // typing elsewhere: leave the paste alone
      const files = imageFiles(e.clipboardData);
      if (!files.length) return;
      e[HANDLED] = true; e.preventDefault();
      for (const f of files) upload(f, { source: 'paste' });
    };
    el.addEventListener('paste', fn);
    const off = () => { el.removeEventListener('paste', fn); pasteOn.delete(el); };
    offs.push(off);
    return off;
  }
  /** Upload dropped files (drops on the chat panel attach to the next message). Idempotent per element. */
  function enableDrop(el = document) {
    if (dropOn.has(el)) return () => {};
    dropOn.add(el);
    let depth = 0;
    const files = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const fns = {
      dragenter: (e) => { if (files(e)) { depth++; root.dataset.drop = 'on'; } },
      dragleave: (e) => { if (files(e) && --depth <= 0) { depth = 0; delete root.dataset.drop; } },
      dragover: (e) => { if (files(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
      drop: (e) => {
        depth = 0; delete root.dataset.drop;
        if (!files(e)) return;
        e.preventDefault();
        if (e[HANDLED]) return;
        e[HANDLED] = true;
        const list = [...e.dataTransfer.files], toChat = !!e.target.closest?.('.lets-chat');
        for (const f of list) toChat ? attach(f, 'drop') : upload(f, { source: 'drop' });
      },
    };
    layer('drop');
    for (const k in fns) el.addEventListener(k, fns[k]);
    const off = () => { for (const k in fns) el.removeEventListener(k, fns[k]); dropOn.delete(el); };
    offs.push(off);
    return off;
  }
  /** Open the file picker; resolves with the upload results. */
  function pickFiles({ accept = 'image/*', multiple = true } = {}) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept, multiple, hidden: true });
      inp.addEventListener('change', async () => { const res = await Promise.all([...inp.files].map((f) => upload(f, { source: 'file' }))); inp.remove(); resolve(res.filter(Boolean)); });
      inp.addEventListener('cancel', () => { inp.remove(); resolve([]); });
      root.append(inp); inp.click();
    });
  }
  const mediaApi = { enablePaste, enableDrop, pick: pickFiles, /** Upload a Blob yourself. */ upload: (blob, source = 'file') => upload(blob, { source }) };

  // ============================================================ toast/theme
  /** Bottom-center toast; returns a dismiss function. */
  function toast(text, level = 'info', ttl = 3500) {
    const lv = { err: 'error', danger: 'error', success: 'ok', warning: 'warn' }[level] || level;
    const lvl = ['info', 'ok', 'warn', 'error'].includes(lv) ? lv : 'info';
    const box = layer('toasts');
    const el = h('div', { class: 'lets-toast', 'data-level': lvl, role: lvl === 'error' ? 'alert' : 'status' },
      h('span', { class: 'lets-toast-dot', 'aria-hidden': 'true' }), h('span', { class: 'lets-toast-text', text: String(text ?? '') }));
    let tid = 0;
    const kill = () => {
      if (!el.isConnected) return;
      cancel(tid);
      const a = anim(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px) scale(.97)' }], { duration: 180, easing: 'ease-in' });
      a ? a.finished.then(() => el.remove(), () => el.remove()) : el.remove();
    };
    el.addEventListener('click', kill);
    box.append(el);
    while (box.childElementCount > 4) box.firstElementChild.remove();
    anim(el, [{ opacity: 0, transform: 'translateY(10px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.3,1)' });
    tid = later(kill, clamp(num(ttl, 3500), 800, 60000));
    return kill;
  }
  /** Override theme variables: {accent:'#f0f'} → --lets-accent; '--x' keys pass through; '' / null resets. */
  function theme(vars = {}) {
    const st = document.documentElement.style;
    for (const [k, v] of Object.entries(vars || {})) {
      const key = k.startsWith('--') ? k : `--${k.startsWith('lets-') ? k : `lets-${k}`}`;
      if (!/^--[a-z0-9-]{1,48}$/i.test(key)) continue;
      v == null || v === '' ? st.removeProperty(key) : st.setProperty(key, String(v).slice(0, 200));
    }
  }

  // =============================================================== farewell
  // session.close {reason, text?, ms?}: wave, a glass overlay, then window.close(). A tab the page did not open
  // itself may refuse to close, so the overlay then stays with a hint and a Keep working button (session.stay).
  const F = { el: null, text: null, sub: null, btn: null, t: 0 };
  function farewell(d = {}) {
    const reason = typeof d.reason === 'string' && d.reason ? d.reason.slice(0, 40) : 'handoff';
    const text = typeof d.text === 'string' && d.text.trim() ? d.text.trim().slice(0, 240) : FAREWELL[reason] || FAREWELL.handoff;
    const ms = clamp(num(d.ms, 1400), 300, 8000);
    if (!F.el) {
      const id = `lets-fw-${++uid}`;
      F.text = h('p', { class: 'lets-farewell-text', id });
      F.sub = h('p', { class: 'lets-farewell-sub', 'aria-live': 'polite' });
      F.btn = h('button', { class: 'lets-btn lets-btn-primary', type: 'button', text: 'Keep working', onclick: () => stay() });
      F.el = h('div', { class: 'lets-farewell', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id }, h('div', { class: 'lets-farewell-card' }, F.text, F.sub, F.btn));
    }
    cancel(F.t); closeMenu(); hideBubble();
    F.text.replaceChildren(mdLite(text));
    F.sub.textContent = 'This window is closing…';
    root.dataset.closing = 'true';
    if (!F.el.isConnected) root.append(F.el);
    moveTo({ to: 'center' }); E.hold = Infinity;              // stay centred until the window goes (or Keep working)
    play('wave', { ms: Math.max(1600, ms + 300), force: true });
    bubbleSay('Bye! ✦', ms + 600);
    lets.emitNow('session.closing', { reason });
    F.btn.focus({ preventScroll: true });
    F.t = later(() => {
      try { window.close(); } catch { /* not ours to close */ }
      F.t = later(() => { if (document.visibilityState === 'visible' && root.dataset.closing === 'true') F.sub.textContent = "This tab can't close itself — Claude will close it, or keep working here."; }, 350);
    }, ms);
  }
  /** Keep working: drop the overlay, follow the pointer again, tell the host (session.stay). */
  function stay() {
    if (root.dataset.closing !== 'true') return;
    cancel(F.t); delete root.dataset.closing;
    const el = F.el, a = anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' });
    a ? a.finished.then(() => { if (root.dataset.closing !== 'true') el.remove(); }, () => {}) : el.remove();
    if (R.name === 'wave') endReact();
    hideBubble();
    E.parked = false; E.hold = 0;
    if (E.px != null) { E.ax = E.px; E.ay = E.py; }
    kick();
    lets.emit('session.stay', {});
  }

  // ===================================================== LIP command wiring
  const CMD = {
    'entity.say': (d) => say(d),
    'entity.mood': (d) => { if (!setMood(d.mood)) throw new Error(`entity.mood: unknown mood "${d.mood}"`); },
    'entity.suggest': (d) => suggest(d.items, !!d.replace),
    'entity.move': (d) => moveTo(d),
    'entity.show': () => show(E.shown || E.px == null ? null : targetFor(E.px, E.py)),
    'entity.hide': () => hide(),
    'entity.persona': (d) => applyPersona(d),
    'entity.react': (d) => {
      const name = String(d.name ?? '');
      if (!Object.hasOwn(REACT, name)) throw new Error(`entity.react: unknown reaction "${name}"`);
      play(name, { ms: d.ms, force: !!d.force });
    },
    'chat.open': () => chatSet(true),
    'chat.close': () => chatSet(false),
    'chat.say': (d, m) => {
      const re = m.re || d.re, seq = Number.isInteger(d.seq) ? d.seq : m.seq;
      const done = typeof d.done === 'boolean' ? d.done : typeof m.done === 'boolean' ? m.done : !(re || Number.isInteger(seq));
      stream(String(re || d.id || m.id), String(d.text ?? ''), done, seq);
    },
    'chat.typing': (d) => typing(!!d.on),
    'component.create': (d) => { create(d); },
    'component.update': (d) => { update(d.id, d.props); },
    'component.remove': (d) => { remove(d.id); },
    'ui.toast': (d) => { toast(d.text, d.level, d.ttl); },
    'ui.theme': (d) => { if (typeof d.name === 'string') document.documentElement.dataset.letsTheme = d.name; if (d.vars) theme(d.vars); },
    // host: is Claude blocked in `listen` right now? (shown as a dot in the chat header and on the sprite)
    'session.listening': (d) => setListening(!!d.on),
    // host or Claude: say goodbye and close this window (handoff after "Send to Claude", idle, or Claude's call)
    'session.close': (d) => farewell(d),
  };
  const L = { on: null };
  function setListening(on) {
    if (L.on === on) return;
    L.on = on;
    root.dataset.listening = on ? 'true' : 'false';
    chatStatus.dataset.listening = on ? 'true' : 'false';
    chatStatus.setAttribute('aria-label', on ? `${persona.name} is listening` : `${persona.name} is away`);
    chatStatus.title = on ? `${persona.name} is listening` : `${persona.name} is away — messages are delivered with your next prompt in Claude Code`;
    input.placeholder = on ? `Message ${persona.name}…  (Enter sends, Shift+Enter new line)` : `${persona.name} is away — your message waits for your next Claude Code prompt`;
  }
  for (const dom of ['entity', 'chat', 'component', 'ui', 'session']) {
    offs.push(lets.on(`${dom}.*`, (data, msg) => {
      const fn = CMD[msg.type];
      if (!fn) return undefined;                                      // LIP §8: ignore unknown types
      try { return fn(data && typeof data === 'object' ? data : {}, msg); } catch (e) {
        if (msg.ack) throw e;                                         // becomes lip.ack {ok:false}
        console.warn('[lets-shell]', msg.type, e.message);
        return undefined;
      }
    }));
  }

  // ======================================================= global keyboard
  on(window, 'keydown', (e) => {
    const t = performance.now();
    touch(t);
    if (!/^(Control|Shift|Alt|Meta)$/.test(e.key)) act(t);
    keyMoves(e, t);
    if (e.key === 'Escape') {
      if (root.dataset.closing === 'true') { e.preventDefault(); stay(); return; }
      if (M.open) { e.preventDefault(); closeMenu(true); } else if (bubble.dataset.open === 'true') hideBubble();
      return;
    }
    if (opts.hotkeys === false || !e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      const x = E.px ?? innerWidth / 2, y = E.py ?? innerHeight / 2;
      toggleAt(x, y, E.shown ? undefined : ctxOf({ reason: 'hotkey', x, y }));
      if (E.shown && (!document.activeElement || document.activeElement === document.body)) sprite.focus({ preventScroll: true });
    } else if (e.key === '/' || e.code === 'Slash') { e.preventDefault(); chatSet(!C.open, true); }
  });

  function destroy() {
    emitProfile();
    clearInterval(tick);
    cancelAnimationFrame(E.raf); E.shown = false;
    safe(endReact);
    for (const off of offs.splice(0)) safe(off);
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const rec of comps.values()) safe(() => rec.inst?.destroy?.());
    comps.clear();
    root.remove();
  }

  api = {
    lets, root, entity, chat: chatApi, components: compApi, media: mediaApi, toast, theme, destroy,
    /** Receive `slot:"inline"` components ({id,type,el,props,update,remove}) to place on your own canvas. */
    onInline: (cb) => { inlineCbs.add(cb); return () => inlineCbs.delete(cb); },
    /** Receive every upload result {path, url?, w, h, mime, bytes, source, componentId?, blob}. */
    onMedia: (cb) => { mediaCbs.add(cb); return () => mediaCbs.delete(cb); },
    /** true while Claude is blocked in `listen` (reacts live), false when away, null before the host said. */
    get listening() { return L.on; },
  };

  // ================================================================== boot
  applyPersona(opts.entity || {});
  if (opts.media !== false) { enablePaste(document); enableDrop(document); }
  cssReady.then(() => {
    if (opts.entity?.visible === false || !root.isConnected || E.shown) return;
    // some embedded panes report a 0×0 viewport until their first layout: wait for a real size
    const boot = (tries = 0) => {
      if (opts.entity?.visible === false || !root.isConnected || E.shown) return;
      if ((innerWidth < 80 || innerHeight < 80) && tries < 120) return requestAnimationFrame(() => boot(tries + 1));
      E.x = E.tx = E.tlx = innerWidth - 150; E.y = E.ty = E.tly = innerHeight - 46;
      show({ x: E.x, y: E.y });
      if (!saved) later(() => bubbleSay(`Hi, I'm **${persona.name}**! Right-click anywhere to call me, click me for ideas.`, 6500), 700);
    };
    boot();
  });
  return api;
}

// ----------------------------------------------------------- demo self-boot
// /sdk/demo/index.html loads `lets-shell.js?demo`, because the host CSP
// (script-src 'self') blocks inline scripts. Opened without a host token it
// runs on a local loopback transport that echoes like a tiny fake Claude.
if (typeof document !== 'undefined' && new URL(import.meta.url).searchParams.has('demo')) {
  import('/sdk/lets-client.js').then(({ Lets }) => bootDemo(Lets), (e) => console.warn('[lets-shell demo]', e));
}

function bootDemo(Lets) {
  const lets = new Lets({ unique: 'demo', version: '0.1.0', caps: ['entity', 'chat', 'components', 'media.image', 'clipboard'] });
  const live = !!lets.token, lines = [];
  let shell = null, k = 0;
  const cmd = (type, data = {}, extra = {}) => lets._dispatch({ lip: 1, id: `cm_demo${Date.now().toString(36)}${(++k).toString(36)}`, ts: Date.now(), dir: 'down', from: 'claude', type, data, ...extra });
  const log = (line) => { keep(lines, line, 14); if (shell?.components.get('demo-log')) shell.components.update('demo-log', { code: lines.join('\n') }); };
  const streamReply = (text) => {
    const re = `demo-${++k}`, parts = text.match(/[\s\S]{1,14}/g) || [''];
    cmd('chat.typing', { on: true });
    parts.forEach((p, i) => setTimeout(() => cmd('chat.say', { text: p, seq: i, done: i === parts.length - 1 }, { re }), 700 + i * 70));
  };
  const envelope = lets.envelope.bind(lets);
  lets.envelope = (type, data, extra) => {
    log(`↑ ${type} ${JSON.stringify(data ?? {}).slice(0, 120)}`);
    if (!live && type === 'entity.click') setTimeout(() => cmd('entity.suggest', { items: [{ id: 'r-explain', label: 'Explain this canvas', hint: 'arrived via entity.suggest' }, { id: 'r-tidy', label: 'Tidy up the cards' }] }), 900);
    if (!live && type === 'entity.pick' && String(data?.id).startsWith('r-')) setTimeout(() => cmd('entity.say', { text: `On it: **${data.label}**`, mood: 'busy', ttl: 2500 }), 300);
    if (!live && type === 'chat.message') setTimeout(() => streamReply(`(offline echo) You said: **${data.text || '…'}**${data.attachments ? `\nwith ${data.attachments.length} attachment(s): \`${data.attachments[0].path}\`` : ''}`), 300);
    return envelope(type, data, extra);
  };
  if (live) lets.open();
  else {
    lets.status = 'open';
    lets._flush = function flush() { clearTimeout(this._flushTimer); this._flushTimer = null; this._queue.length = 0; };
    window.close = () => log('window.close() → the offline demo stays open (try Keep working)');
    lets.upload = async (blob, { source = 'file', componentId = '' } = {}) => {
      let w = 0, hh = 0;
      try { const b = await createImageBitmap(blob); w = b.width; hh = b.height; b.close(); } catch { /* not an image */ }
      const res = { path: `~/.lets/uploads/demo/${Date.now().toString(36)}.${(blob.type.split('/')[1] || 'bin').replace(/\W/g, '')}`, w, h: hh, bytes: blob.size, mime: blob.type || 'application/octet-stream' };
      log(`↑ media.image (host) ${JSON.stringify({ ...res, source, componentId: componentId || undefined })}`);
      return res;
    };
  }
  shell = Shell.mount(lets, {
    entity: { name: 'Pip' },
    context: (info) => ({ demo: true, at: info ? { x: Math.round(info.x), y: Math.round(info.y) } : null }),
    quickSuggestions: () => [
      { id: 'hi', label: 'Say hi', hint: 'local bubble', run: () => shell.entity.say({ text: 'Hi! I am **Pip**. Try `Ctrl+/` for chat.', mood: 'happy' }) },
      { id: 'chat', label: 'Open chat', run: () => shell.chat.open() },
      { id: 'shot', label: 'Paste a screenshot', hint: 'creates an image-drop card', run: () => shell.components.create({ type: 'image-drop', slot: 'float', props: { title: 'Paste a screenshot' } }) },
      { id: 'think', label: 'Think about it', run: () => shell.entity.mood('thinking') },
    ],
  });
  Object.assign(window, { __shell: shell, __lets: lets, __cmd: cmd });
  let alt = false, warm = false, typingOn = false;
  const SAMPLES = {
    note: () => ({ type: 'note', props: { title: 'A note', text: 'Notes support **bold**, `code` and\nline breaks.', tone: 'ok' } }),
    options: () => ({ type: 'options', props: { title: 'Pick a layout', items: [{ id: 'tree', label: 'Tree', hint: 'top-down' }, { id: 'grid', label: 'Grid' }, { id: 'radial', label: 'Radial', hint: 'around a root' }] } }),
    multi: () => ({ type: 'options', props: { title: 'Which kinds?', multi: true, items: ['idea', 'step', 'decision'].map((id) => ({ id, label: id })) } }),
    slider: () => ({ type: 'slider', props: { title: 'Zoom', min: 0.25, max: 3, step: 0.05, value: 1, label: 'zoom' } }),
    toggle: () => ({ type: 'toggle', props: { title: 'Snap to grid', value: true, label: 'Snap' } }),
    form: () => ({ type: 'form', props: { title: 'New node', submit: 'Create', fields: [{ id: 'label', label: 'Label', type: 'text', value: 'Idea' }, { id: 'kind', label: 'Kind', type: 'select', options: ['idea', 'step', 'decision'] }, { id: 'weight', label: 'Weight', type: 'number', value: 3 }, { id: 'notes', label: 'Notes', type: 'textarea' }] } }),
    'image-drop': () => ({ type: 'image-drop', slot: 'float', props: { title: 'Show me', hint: 'Drop, paste or click for a screenshot', multiple: true } }),
    progress: (id) => {
      let v = 0;
      const t = setInterval(() => { v = Math.min(1, v + 0.1); if (!shell.components.get(id) || v >= 1) clearInterval(t); if (shell.components.get(id)) cmd('component.update', { id, props: { value: v, label: v >= 1 ? 'done' : 'working…' } }); }, 350);
      return { type: 'progress', props: { title: 'Indexing', value: 0, label: 'starting' } };
    },
    code: () => ({ type: 'code', props: { title: 'Snippet', lang: 'js', code: "shell.toast('hello', 'ok');\nshell.entity.say('hi');" } }),
    unknown: () => ({ type: 'hologram', slot: 'float', props: { title: 'Unknown type', beams: 3, color: 'cyan' } }),
  };
  shell.components.register('demo-controls', () => {
    const b = (label, fn) => h('button', { class: 'lets-btn lets-btn-sm', type: 'button', text: label, onclick: fn });
    const row = (title, ...btns) => h('div', { class: 'lets-demo-row' }, h('div', { class: 'lets-dim', text: title }), h('div', { class: 'lets-demo-btns' }, ...btns));
    return h('div', { class: 'lets-demo' },
      row('entity', b('say', () => cmd('entity.say', { text: 'Look: **markdown-lite** works, `code` too.\nAnd line breaks.', mood: 'happy' })),
        b('suggest', () => cmd('entity.suggest', { items: [{ id: 'r-more', label: 'A remote idea', hint: 'from entity.suggest' }] })),
        b('center', () => cmd('entity.move', { to: 'center' })), b('cursor', () => cmd('entity.move', { to: 'cursor' })),
        b('show', () => cmd('entity.show')), b('hide', () => cmd('entity.hide')),
        b('persona', () => { alt = !alt; cmd('entity.persona', alt ? { name: 'Nova', traits: { speed: 0.9, distance: 0.3, chatty: 1, playful: 1 }, color: '#e0559b' } : { name: 'Pip', traits: { speed: 0.5, distance: 0.5, chatty: 0.5, playful: 0.6 }, color: '' }); })),
      row('mood', ...MOODS.map((m) => b(m, () => cmd('entity.mood', { mood: m })))),
      row('reactions', ...Object.keys(REACT).map((n) => b(n, () => cmd('entity.react', { name: n, force: true })))),
      row('chat', b('stream reply', () => { cmd('chat.open'); streamReply('Sure! Here is a **streamed** reply, with a cursor while it streams.\n```js\nconst answer = 42;\n```\nDone.'); }),
        b('typing', () => { typingOn = !typingOn; cmd('chat.typing', { on: typingOn }); }), b('toggle', () => shell.chat.toggle(true))),
      row('components', ...Object.keys(SAMPLES).map((t) => b(t, () => { const id = `demo-${t}-${++k}`; cmd('component.create', { id, ...SAMPLES[t](id) }); }))),
      row('ui', ...['info', 'ok', 'warn', 'error'].map((l) => b(l, () => cmd('ui.toast', { text: `A ${l} toast`, level: l }))),
        b('theme', () => { warm = !warm; cmd('ui.theme', { name: warm ? 'ember' : 'deep-violet', vars: { accent: warm ? '#ff9f6b' : '', 'accent-2': warm ? '#ffd166' : '' } }); }),
        b('session.close', () => cmd('session.close', { reason: 'handoff', text: 'Sent to Claude ✦ see you in Claude Code', ms: 1400 }))));
  });
  shell.components.create({ id: 'demo-controls', type: 'demo-controls', slot: 'panel', props: { title: live ? 'Shell demo (live host)' : 'Shell demo (offline loopback)' } });
  shell.components.create({ id: 'demo-help', type: 'note', props: { title: 'Try me', text: '**Right-click** anywhere or **Ctrl+Space**: summon / dismiss.\n**Click** the companion for suggestions, **Esc** closes.\n**Ctrl+/** toggles chat. **Paste** or **drop** an image anywhere.\nShake the mouse, hover or boop the companion… it has a few *secret moves* too.' } });
  shell.components.create({ id: 'demo-log', type: 'code', props: { title: 'Events → Claude', lang: 'lip', code: '(nothing yet)' } });
}
