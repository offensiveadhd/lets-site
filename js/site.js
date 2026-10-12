/**
 * site.js — small, framework-free behaviour for the lets site.
 *
 *  - marks <html class="js"> so CSS can collapse the menus
 *  - main nav + docs nav toggles (Esc closes)
 *  - copy-to-clipboard buttons with a manual fallback
 *  - the Doto orbs: blink, glance at the pointer, boop, moods, speech bubble
 *  - makes overflowing code blocks / tables keyboard-scrollable
 *  - adds "#" anchors to docs headings
 *
 * Every path the site uses is relative; this file fetches nothing.
 */

const RM = matchMedia('(prefers-reduced-motion: reduce)');
document.documentElement.classList.add('js');

// ------------------------------------------------------------------ toggles
function wireToggle(btn) {
  const target = document.getElementById(btn.getAttribute('aria-controls'));
  if (!target) return;
  const set = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    target.dataset.open = String(open);
  };
  set(false);
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  target.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') { set(false); btn.focus(); }
  });
}
document.querySelectorAll('.nav-toggle, .docs-nav-toggle').forEach(wireToggle);

// --------------------------------------------------------------------- copy
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

document.querySelectorAll('[data-copy]').forEach((btn) => {
  const src = document.getElementById(btn.dataset.copy);
  if (!src) return;
  const label = btn.textContent;
  const status = btn.parentElement.querySelector('.copy-status');
  btn.addEventListener('click', async () => {
    const text = src.textContent.trim();
    const ok = await copyText(text);
    if (ok) {
      btn.textContent = 'Copied ✓';
      if (status) status.textContent = 'Copied to your clipboard.';
      setTimeout(() => { btn.textContent = label; if (status) status.textContent = ''; }, 2200);
      return;
    }
    // no clipboard access: show the text selected in a textarea so Ctrl+C works
    let fb = btn.parentElement.parentElement.querySelector('.copy-fallback');
    if (!fb) {
      fb = document.createElement('div');
      fb.className = 'copy-fallback';
      const id = `fb-${btn.dataset.copy}`;
      fb.innerHTML = `<label for="${id}" class="dim">Copy blocked by the browser. The text is selected below: press Ctrl+C (⌘C on a Mac).</label><textarea id="${id}" readonly></textarea>`;
      btn.parentElement.after(fb);
    }
    const ta = fb.querySelector('textarea');
    ta.value = text;
    ta.focus();
    ta.select();
    if (status) status.textContent = 'Select and copy manually.';
  });
});

// ---------------------------------------------------- scrollable regions a11y
function markScrollables() {
  document.querySelectorAll('pre, .table-wrap').forEach((el) => {
    const scrolls = el.scrollWidth > el.clientWidth + 1;
    if (scrolls && !el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('role')) el.setAttribute('role', 'region');
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.matches('pre') ? 'Code (scrolls sideways)' : 'Table (scrolls sideways)');
      el.dataset.autoTab = '1';
    } else if (!scrolls && el.dataset.autoTab) {
      el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-label'); delete el.dataset.autoTab;
    }
  });
}
let rT = 0;
addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(markScrollables, 150); });
markScrollables();

// ------------------------------------------------------------- doc anchors
document.querySelectorAll('.doc h2[id], .doc h3[id]').forEach((hd) => {
  const a = document.createElement('a');
  a.className = 'anchor';
  a.href = `#${hd.id}`;
  a.textContent = '#';
  a.setAttribute('aria-label', `Link to “${hd.textContent.trim()}”`);
  hd.append(a);
});

// -------------------------------------------------------------------- Doto
const MOODS = ['idle', 'happy', 'curious', 'thinking', 'busy', 'proud', 'sleepy', 'alert'];
const BOOP_LINES = ['Boop.', 'Again? Fine.', 'That tickles.', 'Still counting.', 'Noted.'];

function initDoto(btn) {
  const holder = btn.closest('.doto-holder') || btn.parentElement;
  const bubble = holder.querySelector('.doto-bubble');
  const blinker = btn.querySelector('.doto-blinker');
  const pupils = [...btn.querySelectorAll('.doto-pupil')];
  const lines = (btn.dataset.lines || '').split('|').filter(Boolean);
  let bubbleT = 0, boops = 0, boopT = 0, lineI = 0, idleT = 0;
  const baseMood = () => btn.dataset.base || 'idle';

  const say = (text, ms = 3200) => {
    if (!bubble) return;
    bubble.textContent = text;
    bubble.dataset.open = 'true';
    clearTimeout(bubbleT);
    bubbleT = setTimeout(() => { bubble.dataset.open = 'false'; }, ms);
  };
  btn.dotoSay = say;

  // blink every few seconds
  const blink = () => {
    if (!RM.matches && btn.dataset.mood !== 'sleepy' && blinker) {
      blinker.classList.remove('blink');
      void blinker.getBBox?.();
      blinker.classList.add('blink');
      setTimeout(() => blinker.classList.remove('blink'), 200);
    }
    setTimeout(blink, 2400 + Math.random() * 3600);
  };
  setTimeout(blink, 1200 + Math.random() * 1500);

  // pupils glance toward the pointer (pupils are SVG user units: ±1.4 x, ±1.7 y)
  let raf = 0, px = null, py = null;
  const look = () => {
    raf = 0;
    if (px == null) return;
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1, m = Math.min(1, d / 220);
    let lx = (dx / d) * 1.4 * m, ly = (dy / d) * 1.7 * m;
    if (btn.dataset.mood === 'thinking') { lx = 1.1; ly = -1.6; }
    if (btn.dataset.mood === 'sleepy') { lx = 0; ly = 0.6; }
    const t = `translate(${lx.toFixed(2)}px, ${ly.toFixed(2)}px)`;
    for (const p of pupils) p.style.transform = t;
  };
  addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY;
    if (!raf) raf = requestAnimationFrame(look);
    // the hero orb dozes off when nobody moves for a while, and wakes on movement
    if (btn.dataset.doze) {
      if (btn.dataset.mood === 'sleepy' && baseMood() !== 'sleepy') { setMood(baseMood()); say("Oh. You're back.", 2200); }
      clearTimeout(idleT);
      idleT = setTimeout(() => setMood('sleepy'), 30000);
    }
  }, { passive: true });

  function setMood(m) {
    if (!MOODS.includes(m)) return;
    btn.dataset.mood = m;
    look();
  }
  btn.dotoMood = (m) => { btn.dataset.base = m; setMood(m); };

  // boop: squish, a heart floats up, a short line
  btn.addEventListener('click', () => {
    btn.classList.remove('booped');
    void btn.offsetWidth;
    btn.classList.add('booped');
    setTimeout(() => btn.classList.remove('booped'), 1150);
    clearTimeout(boopT);
    boops += 1;
    boopT = setTimeout(() => { boops = 0; }, 1600);
    if (btn.dataset.mood === 'sleepy' && baseMood() !== 'sleepy') setMood(baseMood());   // only wakes a dozing Doto
    if (boops === 5) say("Five dots. You're keeping count too.", 3600);
    else if (lines.length && boops === 1) { say(lines[lineI % lines.length]); lineI += 1; }
    else say(BOOP_LINES[(boops - 1) % BOOP_LINES.length], 1800);
  });

  if (btn.dataset.greet) setTimeout(() => say(btn.dataset.greet, 5200), 900);
  if (btn.dataset.doze) idleT = setTimeout(() => setMood('sleepy'), 30000);
}
document.querySelectorAll('.doto').forEach(initDoto);

// mood chips: <div data-doto-controls="dotoId"><button data-mood="happy" aria-pressed="false">…
const MOOD_LINES = {
  idle: 'Rolling in place.', happy: 'That landed.', curious: 'Which branch is the happy path?', thinking: 'Thinking. One sec.',
  busy: 'On it.', proud: 'Done. Look.', sleepy: 'zzz.', alert: 'Look here. Something changed.',
};
document.querySelectorAll('[data-doto-controls]').forEach((group) => {
  const doto = document.getElementById(group.dataset.dotoControls);
  if (!doto) return;
  group.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mood]');
    if (!b) return;
    group.querySelectorAll('[data-mood]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    doto.dotoMood?.(b.dataset.mood);
    doto.dotoSay?.(MOOD_LINES[b.dataset.mood] || b.dataset.mood, 2200);
  });
});
