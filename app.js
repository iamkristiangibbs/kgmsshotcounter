import { config } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, deleteDoc, onSnapshot, query, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = s => document.querySelector(s);
const TYPES = { shot: ['🥃', 'Shot'], beer: ['🍺', 'Beer'], water: ['💧', 'Water'] };
const COLORS = ['#ff3d8b', '#7a3cff', '#19a7d6', '#22b34a', '#ff7a00', '#e8308f', '#0f8b8d', '#d62828'];

let db, uid = null, code = null, self = null, unsubs = [], drinks = [], members = {}, open = {}, busy = false, noticeTimer;

const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
const notice = (t, ok) => {
  clearTimeout(noticeTimer);
  $('#notice').innerHTML = '';
  if (!t) return;
  $('#notice').appendChild(el('div', 'msg' + (ok ? ' ok' : ''), t));
  if (ok) noticeTimer = setTimeout(() => $('#notice').innerHTML = '', 3500);
};
const colorFor = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const ago = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
// A username becomes the member's ID inside a session, so the same username always resumes the same member.
const keyFor = n => (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user').slice(0, 24);
const typedName = () => $('#nm').value.trim().slice(0, 24);

$('#nm').value = ls('rc_name') || '';

/* ---------- startup ---------- */
async function init() {
  if (config.apiKey.startsWith('PASTE')) return notice('Setup needed: open firebase-config.js and paste in your Firebase web app config.');
  try {
    const app = initializeApp(config);
    const auth = getAuth(app);
    db = getFirestore(app);
    await new Promise((resolve, reject) => {
      onAuthStateChanged(auth, u => { if (u) { uid = u.uid; resolve(); } });
      signInAnonymously(auth).catch(reject);
    });
  } catch (e) {
    return notice('Could not connect. Check your Firebase config and that Anonymous sign-in is turned on.');
  }
  const h = location.hash.replace('#', '').toUpperCase();
  const target = h.length === 5 ? h : (ls('rc_session') || '');
  if (target.length === 5) {
    $('#jc').value = target;
    if (typedName()) enter(target);
    else notice('Enter your username, then tap "Join with code" to jump into session ' + target + '.');
  }
}

/* ---------- home ---------- */
$('#create').onclick = async () => {
  if (!db) return notice('Finish the Firebase setup first (see firebase-config.js).');
  if (!typedName()) return notice('Enter a username first.');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = ''; for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  try {
    await setDoc(doc(db, 'sessions', c), { name: $('#sn').value.trim() || 'Drinks session', owner: uid, createdAt: Date.now() });
    enter(c);
  } catch (e) { notice('Could not create the session. Check your Firestore rules.'); }
};
$('#join').onclick = () => {
  if (!db) return notice('Finish the Firebase setup first (see firebase-config.js).');
  if (!typedName()) return notice('Enter your username first.');
  const c = $('#jc').value.trim().toUpperCase();
  if (c.length !== 5) return notice('Session codes have 5 characters.');
  enter(c);
};

/* ---------- session ---------- */
async function enter(c) {
  const typed = typedName();
  if (!typed) return notice('Enter your username first.');
  ls('rc_name', typed); notice(''); stop();
  let snap;
  try { snap = await getDoc(doc(db, 'sessions', c)); } catch (e) { return notice('Could not reach that session.'); }
  if (!snap.exists()) { ls('rc_session', ''); history.replaceState(null, '', location.pathname); return notice('No session found with code ' + c + '.'); }

  // Same username in the same session = same member (resume), otherwise a new member.
  const key = keyFor(typed), mref = doc(db, 'sessions', c, 'members', key);
  let returning = false, display = typed;
  try {
    const ms = await getDoc(mref);
    returning = ms.exists();
    if (returning) display = ms.data().name || typed;
    await setDoc(mref, returning ? { name: display, lastSeen: Date.now() } : { name: typed, joined: Date.now(), lastSeen: Date.now() }, { merge: true });
  } catch (e) { return notice('Could not join. Check your Firestore rules.'); }

  code = c; self = { key, name: display };
  ls('rc_session', c);
  history.replaceState(null, '', '#' + c);
  $('#home').classList.add('hidden'); $('#session').classList.remove('hidden');
  $('#sname').textContent = snap.data().name || 'Session'; $('#scode').textContent = c;
  drinks = []; members = {}; open = {}; render();
  if (returning) notice('Welcome back, ' + display + '!', true);

  const err = () => notice('Live updates stopped. Reload the page to reconnect.');
  unsubs.push(onSnapshot(query(collection(db, 'sessions', c, 'drinks'), orderBy('ts', 'desc'), limit(1000)),
    s => { drinks = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, err));
  unsubs.push(onSnapshot(collection(db, 'sessions', c, 'members'),
    s => { members = {}; s.docs.forEach(d => members[d.id] = d.data()); render(); }, err));
}
function stop() { unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; code = null; self = null; }

$('#leave').onclick = () => {
  stop(); ls('rc_session', ''); history.replaceState(null, '', location.pathname);
  $('#session').classList.add('hidden'); $('#home').classList.remove('hidden');
};
$('#share').onclick = async () => {
  const url = location.origin + location.pathname + '#' + code, b = $('#share');
  try {
    if (navigator.share) await navigator.share({ title: 'Join my session', text: 'Join my Round Counter session: ' + code, url });
    else { await navigator.clipboard.writeText(url); b.textContent = 'Copied ✓'; setTimeout(() => b.textContent = 'Share link', 1600); }
  } catch (e) {}
};
const addDrink = type => addDoc(collection(db, 'sessions', code, 'drinks'), { member: self.key, name: self.name, type, ts: Date.now() });

$('#log').onclick = async () => {
  if (busy || !code) return;
  busy = true; const b = $('#log'); b.disabled = true;
  try { await addDrink($('#type').value); b.textContent = 'Logged ✓'; setTimeout(() => b.textContent = '+ Log it', 900); }
  catch (e) { notice('Could not log that drink. Try again.'); }
  busy = false; b.disabled = false;
};

/* ---------- render ---------- */
function render() {
  if (!code || !self) return;
  const t = {};
  const blank = name => ({ name, shot: 0, beer: 0, water: 0, last: 0, list: [] });
  Object.entries(members).forEach(([id, m]) => t[id] = blank(m.name || 'Friend'));
  drinks.forEach(d => {
    const k = d.member || d.uid;
    const p = t[k] || (t[k] = blank(d.name || 'Friend'));
    if (p[d.type] !== undefined) p[d.type]++;
    p.list.push(d); if (d.ts > p.last) p.last = d.ts;
  });
  const ids = Object.keys(t).sort((a, b) => (t[b].shot * 2 + t[b].beer) - (t[a].shot * 2 + t[a].beer) || t[b].last - t[a].last);
  let S = 0, B = 0, W = 0; ids.forEach(i => { S += t[i].shot; B += t[i].beer; W += t[i].water; });
  $('#tShot').textContent = S; $('#tBeer').textContent = B; $('#tWater').textContent = W;
  $('#people').textContent = ids.length + (ids.length === 1 ? ' person' : ' people') + ' here · you are ' + self.name;

  /* your drinks: tap a tile to add, minus to remove your last one */
  const mineBox = $('#mine'); mineBox.innerHTML = ''; mineBox.classList.add('mine-wrap');
  const mine = t[self.key] || blank(self.name);
  const grid = el('div', 'tiles');
  ['shot', 'beer', 'water'].forEach(k => {
    const tile = el('div', 'tile ' + k);
    const body = el('button', 'tile-body'); body.setAttribute('aria-label', 'Add one ' + TYPES[k][1].toLowerCase());
    body.append(el('span', 'tile-emoji', TYPES[k][0]), el('b', 'tile-num', mine[k]), el('span', 'tile-label', TYPES[k][1] + 's'), el('span', 'tile-add', '+ Add'));
    body.onclick = async () => {
      body.disabled = true;
      try { await addDrink(k); } catch (e) { notice('Could not log that drink.'); }
      body.disabled = false;
    };
    const minus = el('button', 'tile-minus', '−'); minus.setAttribute('aria-label', 'Remove one ' + TYPES[k][1].toLowerCase());
    minus.disabled = !mine[k];
    minus.onclick = async () => {
      const last = drinks.find(d => (d.member || d.uid) === self.key && d.type === k);
      if (!last) return; minus.disabled = true;
      try { await deleteDoc(doc(db, 'sessions', code, 'drinks', last.id)); } catch (e) { notice('Could not remove that drink.'); }
    };
    tile.append(minus, body); grid.appendChild(tile);
  });
  mineBox.appendChild(grid);
  mineBox.appendChild(el('div', 'tile-hint', 'Tap a tile to add one. Use − to undo your last.'));

  const box = $('#members'); box.innerHTML = '';
  if (!ids.length) { box.appendChild(el('div', 'card empty', 'Waiting for friends to join. Send them the link!')); return; }
  const top = t[ids[0]].shot * 2 + t[ids[0]].beer;

  ids.forEach(id => {
    const p = t[id], tot = p.shot + p.beer + p.water, card = el('div', 'card member');
    const head = el('div', 'mhead'); head.tabIndex = 0;
    const av = el('div', 'av', (p.name[0] || '?').toUpperCase()); av.style.background = colorFor(id);
    const mi = el('div', 'mi'), mn = el('div', 'mn');
    mn.appendChild(el('span', 'nm2', p.name));
    if (id === self.key) mn.appendChild(el('span', 'tag', 'you'));
    if (top > 0 && p.shot * 2 + p.beer === top) mn.appendChild(el('span', null, '👑'));
    mi.appendChild(mn);
    mi.appendChild(el('div', 'last', tot ? 'Last: ' + TYPES[p.list[0].type][1].toLowerCase() + ', ' + ago(p.last) : 'Nothing logged yet'));
    const counts = el('div', 'counts');
    ['shot', 'beer', 'water'].forEach(k => {
      const c = el('div', 'cnt ' + k); c.appendChild(el('span', 'ce', TYPES[k][0])); c.appendChild(el('b', null, p[k])); counts.appendChild(c);
    });
    const bar = el('div', 'bar');
    if (tot) ['shot', 'beer', 'water'].forEach(k => { if (p[k]) { const i = el('i'); i.style.width = (p[k] / tot * 100) + '%'; i.style.background = 'var(--' + k + ')'; bar.appendChild(i); } });
    head.append(av, mi, counts);
    const toggle = () => { open[id] = !open[id]; render(); };
    head.onclick = toggle; head.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    card.appendChild(head);
    if (tot) card.appendChild(bar);
    if (open[id]) {
      const h = el('div', 'hist');
      if (!p.list.length) h.appendChild(el('div', 'ev mute', 'No drinks yet.'));
      p.list.slice(0, 30).forEach(d => {
        const r = el('div', 'ev'), l = el('span', null, TYPES[d.type][0] + ' ' + TYPES[d.type][1] + '  ');
        l.appendChild(el('small', null, ago(d.ts))); r.appendChild(l);
        if ((d.member || d.uid) === self.key) {
          const x = el('button', 'x', '✕'); x.title = 'Undo';
          x.onclick = async e => { e.stopPropagation(); x.disabled = true; try { await deleteDoc(doc(db, 'sessions', code, 'drinks', d.id)); } catch (er) { x.disabled = false; } };
          r.appendChild(x);
        }
        h.appendChild(r);
      });
      card.appendChild(h);
    }
    box.appendChild(card);
  });
}
setInterval(() => { if (code && drinks.length) render(); }, 60000);
init();
