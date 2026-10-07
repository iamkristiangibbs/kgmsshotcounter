import { config } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, collection, where, addDoc, deleteDoc, writeBatch, onSnapshot, query, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = s => document.querySelector(s);
const TYPES = { shot: ['🥃', 'Shot'], beer: ['🍺', 'Beer'], water: ['💧', 'Water'] };
const COLORS = ['#ff3d8b', '#7a3cff', '#19a7d6', '#22b34a', '#ff7a00', '#e8308f', '#0f8b8d', '#d62828'];

let db, uid = null, code = null, self = null, unsubs = [], drinks = [], members = {}, open = {}, busy = false, noticeTimer, isOwner = false, ownerUid = null, deleting = false;
let comments = [], drafts = {}, replyingTo = {}, pendingFocus = null;

// Remembers the username and last-used code (localStorage plus a 1-year cookie backup).
const ck = (k, v) => { try { if (v === undefined) { const m = document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; } document.cookie = k + '=' + encodeURIComponent(v) + '; max-age=31536000; path=/; SameSite=Lax'; } catch (e) { return null; } };
const ls = (k, v) => {
  if (v === undefined) { let x = null; try { x = localStorage.getItem(k); } catch (e) {} return x || ck(k) || null; }
  try { localStorage.setItem(k, v); } catch (e) {}
  ck(k, v);
};
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
const localPhoto = () => { try { return localStorage.getItem('rc_photo') || ''; } catch (e) { return ''; } };
const setLocalPhoto = v => { try { localStorage.setItem('rc_photo', v); } catch (e) {} };
const CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';
const typedName = () => $('#nm').value.trim().slice(0, 24);

$('#nm').value = ls('rc_name') || '';

/* ---------- install hint (home screen app) ---------- */
(function () {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || ls('rc_hint') === '1') return;
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let msg = '';
  if (ios) {
    msg = "In Safari, tap the three dots at the bottom right, tap Share, then Add to Home Screen. You'll get Shot Counter as an app on your phone.";
    if (/CriOS|FxiOS|EdgiOS/.test(ua)) msg = 'Open this page in Safari first. Then ' + msg.charAt(0).toLowerCase() + msg.slice(1);
  } else if (/android/i.test(ua)) {
    msg = 'In Chrome, tap the three dots at the top right, then Install app (or Add to Home screen) to get Shot Counter as an app.';
  }
  if (!msg) return;
  $('#installBody').textContent = msg;
  $('#installHint').classList.remove('hidden');
  $('#hintClose').onclick = () => { ls('rc_hint', '1'); $('#installHint').classList.add('hidden'); };
})();

/* ---------- startup ---------- */
async function init() {
  if (config.apiKey.startsWith('PASTE')) return notice('Setup needed: open firebase-config.js and paste in your Firebase web app config.');
  try {
    const app = initializeApp(config);
    const auth = getAuth(app);
    try { await setPersistence(auth, browserLocalPersistence); } catch (e) {}
    db = getFirestore(app);
    await new Promise((resolve, reject) => {
      onAuthStateChanged(auth, u => { if (u) { uid = u.uid; resolve(); } });
      signInAnonymously(auth).catch(reject);
    });
  } catch (e) {
    return notice('Could not connect. Check your Firebase config and that Anonymous sign-in is turned on.');
  }
  const h = location.hash.replace('#', '').toUpperCase();
  const prefill = h.length === 5 ? h : (ls('rc_code') || '');
  if (prefill.length === 5) $('#jc').value = prefill;
  previewSession();
}

/* Show which session a code belongs to as soon as it is typed. */
let pvTok = 0;
async function previewSession() {
  const box = $('#jpreview'), c = $('#jc').value.trim().toUpperCase(), tok = ++pvTok;
  box.className = 'preview'; box.textContent = '';
  if (c.length !== 5 || !db) return;
  box.className = 'preview wait'; box.textContent = 'Checking…';
  try {
    const s = await getDoc(doc(db, 'sessions', c));
    if (tok !== pvTok) return;
    if (s.exists()) { box.className = 'preview ok'; box.textContent = 'Session: ' + (s.data().name || 'Drinks session'); }
    else { box.className = 'preview no'; box.textContent = 'No session found with that code'; }
  } catch (e) { if (tok === pvTok) { box.className = 'preview'; box.textContent = ''; } }
}
$('#jc').addEventListener('input', () => { $('#jc').value = $('#jc').value.toUpperCase(); previewSession(); });

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
  if (!snap.exists()) { ls('rc_code', ''); history.replaceState(null, '', location.pathname); previewSession(); return notice('No session found with code ' + c + '.'); }

  // Look the member up by their current username, so renamed members can still resume.
  const nk = keyFor(typed), mcol = collection(db, 'sessions', c, 'members');
  let key = null, returning = false, display = typed, existingPhoto = '';
  try {
    const q = await getDocs(query(mcol, where('nameKey', '==', nk), limit(1)));
    if (!q.empty) { key = q.docs[0].id; display = q.docs[0].data().name || typed; existingPhoto = q.docs[0].data().photo || ''; returning = true; }
    else {
      const old = await getDoc(doc(mcol, nk));
      if (old.exists() && !old.data().nameKey) { key = nk; display = old.data().name || typed; existingPhoto = old.data().photo || ''; returning = true; }
      else key = old.exists() ? nk.slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6) : nk;
    }
    const lp = localPhoto(), photoField = (!existingPhoto && lp) ? { photo: lp } : {};
    await setDoc(doc(mcol, key), returning
      ? { name: display, nameKey: keyFor(display), lastSeen: Date.now(), uid, ...photoField }
      : { name: typed, nameKey: nk, joined: Date.now(), lastSeen: Date.now(), uid, ...photoField }, { merge: true });
  } catch (e) { return notice('Could not join. Check your Firestore rules.'); }

  code = c; self = { key, name: display }; isOwner = snap.data().owner === uid; ownerUid = snap.data().owner; deleting = false;
  ls('rc_code', c); $('#jc').value = c;
  history.replaceState(null, '', '#' + c);
  $('#home').classList.add('hidden'); $('#session').classList.remove('hidden');
  $('#sname').textContent = snap.data().name || 'Session'; $('#scode').textContent = c;
  const del = $('#del'); del.classList.toggle('hidden', !isOwner); del.disabled = false; del.textContent = 'Delete session';
  drinks = []; members = {}; open = {}; comments = []; drafts = {}; replyingTo = {}; render();
  if (returning) notice('Welcome back, ' + display + '!', true);

  const err = () => notice('Live updates stopped. Reload the page to reconnect.');
  unsubs.push(onSnapshot(doc(db, 'sessions', c), s => {
    if (!s.exists()) return sessionGone();
    ownerUid = s.data().owner;
    const o = ownerUid === uid;
    if (o !== isOwner) { isOwner = o; $('#del').classList.toggle('hidden', !o); if (o) notice('You are now the owner of this session.', true); }
    render();
  }, err));
  unsubs.push(onSnapshot(query(collection(db, 'sessions', c, 'comments'), orderBy('ts', 'asc'), limit(2000)),
    s => { comments = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, err));
  unsubs.push(onSnapshot(query(collection(db, 'sessions', c, 'drinks'), orderBy('ts', 'desc'), limit(1000)),
    s => { drinks = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, err));
  unsubs.push(onSnapshot(collection(db, 'sessions', c, 'members'),
    s => { members = {}; s.docs.forEach(d => members[d.id] = d.data()); render(); }, err));
}
function stop() { unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; code = null; self = null; }

function sessionGone() {
  const mine = deleting; deleting = false;
  stop(); ls('rc_code', ''); $('#jc').value = ''; history.replaceState(null, '', location.pathname);
  $('#session').classList.add('hidden'); $('#home').classList.remove('hidden'); previewSession();
  notice(mine ? 'Session deleted.' : 'This session was deleted by its creator.', mine);
}
$('#del').onclick = async () => {
  if (!code || !isOwner) return;
  if (!confirm('Delete this session for everyone? All members and drinks will be removed. This cannot be undone.')) return;
  const b = $('#del'), c = code; b.disabled = true; b.textContent = 'Deleting…'; deleting = true;
  try {
    const refs = [];
    (await getDocs(collection(db, 'sessions', c, 'drinks'))).forEach(d => refs.push(d.ref));
    (await getDocs(collection(db, 'sessions', c, 'members'))).forEach(d => refs.push(d.ref));
    (await getDocs(collection(db, 'sessions', c, 'comments'))).forEach(d => refs.push(d.ref));
    for (let i = 0; i < refs.length; i += 400) {
      const wb = writeBatch(db); refs.slice(i, i + 400).forEach(r => wb.delete(r)); await wb.commit();
    }
    await deleteDoc(doc(db, 'sessions', c));
  } catch (e) {
    deleting = false; b.disabled = false; b.textContent = 'Delete session';
    notice('Could not delete the session. Make sure the latest Firestore rules are published.');
  }
};
$('#rename').onclick = async () => {
  if (!self) return;
  const raw = prompt('Choose a new username (max 24 characters):', self.name);
  if (raw === null) return;
  const n = raw.trim().slice(0, 24);
  if (!n) return notice("A username can't be empty.");
  const nk = keyFor(n);
  const taken = Object.entries(members).some(([id, m]) => id !== self.key && (m.nameKey || keyFor(m.name || id)) === nk);
  if (taken) return notice('That username is already taken in this session.');
  try {
    await updateDoc(doc(db, 'sessions', code, 'members', self.key), { name: n, nameKey: nk });
    self.name = n; ls('rc_name', n); $('#nm').value = n; render();
    notice('Username changed to ' + n + '.', true);
  } catch (e) { notice('Could not change your username. Make sure the latest Firestore rules are published.'); }
};
$('#leave').onclick = () => {
  stop(); history.replaceState(null, '', location.pathname);
  $('#session').classList.add('hidden'); $('#home').classList.remove('hidden'); previewSession();
};
$('#share').onclick = async () => {
  const url = location.origin + location.pathname + '#' + code, b = $('#share');
  try {
    if (navigator.share) await navigator.share({ title: 'Join my session', text: 'Join my Shot Counter session: ' + code, url });
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
  const ae = document.activeElement;
  const keep = ae && ae.dataset && ae.dataset.draft ? { id: ae.dataset.draft, s: ae.selectionStart, e: ae.selectionEnd } : null;
  const byTarget = {};
  comments.forEach(cm => { (byTarget[cm.target] = byTarget[cm.target] || []).push(cm); });
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
    const photo = members[id] && members[id].photo, mineAv = id === self.key;
    const av = el('div', 'av' + (mineAv ? ' me' : ''));
    if (photo) { const im = el('img'); im.src = photo; im.alt = p.name; av.appendChild(im); }
    else { av.textContent = (p.name[0] || '?').toUpperCase(); av.style.background = colorFor(id); }
    if (mineAv) {
      const cam = el('span', 'cam'); cam.innerHTML = CAM; av.appendChild(cam);
      av.tabIndex = 0; av.setAttribute('role', 'button'); av.setAttribute('aria-label', 'Change profile photo');
      av.onclick = e => { e.stopPropagation(); pickPhoto(); };
      av.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pickPhoto(); } };
    }
    const mi = el('div', 'mi'), mn = el('div', 'mn');
    mn.appendChild(el('span', 'nm2', p.name));
    if (id === self.key) mn.appendChild(el('span', 'tag', 'you'));
    if (members[id] && members[id].uid && members[id].uid === ownerUid) mn.appendChild(el('span', 'tag', 'owner'));
    if (byTarget[id]) mn.appendChild(el('span', 'tag', '💬 ' + byTarget[id].length));
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
      if (isOwner && id !== self.key && members[id] && members[id].uid) {
        const mk = el('button', 'btn small white', 'Make owner'); mk.style.margin = '8px 0 4px';
        mk.onclick = async e => {
          e.stopPropagation();
          if (!confirm('Make ' + p.name + ' the owner of this session? You will no longer be able to delete it.')) return;
          mk.disabled = true;
          try { await updateDoc(doc(db, 'sessions', code), { owner: members[id].uid }); notice(p.name + ' is now the owner.', true); }
          catch (er) { mk.disabled = false; notice('Could not change the owner. Make sure the latest Firestore rules are published.'); }
        };
        h.appendChild(mk);
      }
      if (mineAv && photo) {
        const rm = el('button', 'btn small white', 'Remove photo'); rm.style.margin = '8px 0 4px';
        rm.onclick = async e => {
          e.stopPropagation(); rm.disabled = true;
          try { await updateDoc(doc(db, 'sessions', code, 'members', self.key), { photo: '' }); setLocalPhoto(''); }
          catch (er) { rm.disabled = false; notice('Could not remove your photo.'); }
        };
        h.appendChild(rm);
      }
      h.appendChild(el('div', 'sect', 'Comments'));
      h.appendChild(buildThread(id, byTarget[id] || []));
      h.appendChild(el('div', 'sect', 'Drink log'));
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
  const target = pendingFocus || (keep && keep.id);
  if (target) {
    const inp = document.querySelector('input[data-draft="' + target + '"]');
    if (inp) { inp.focus(); if (!pendingFocus && keep && keep.s != null) { try { inp.setSelectionRange(keep.s, keep.e); } catch (e) {} } }
    pendingFocus = null;
  }
}

/* ---------- profile photo ---------- */
function pickPhoto() { const f = $('#photoIn'); f.value = ''; f.click(); }
function toAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const S = 160, c = document.createElement('canvas'); c.width = c.height = S;
      const m = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
$('#photoIn').addEventListener('change', async () => {
  const f = $('#photoIn').files[0];
  if (!f || !self || !code) return;
  if (!f.type.startsWith('image/')) return notice('Please choose an image file.');
  try {
    const data = await toAvatar(f);
    await updateDoc(doc(db, 'sessions', code, 'members', self.key), { photo: data });
    setLocalPhoto(data); notice('Profile photo updated.', true);
  } catch (e) { notice('Could not update your photo. Make sure the latest Firestore rules are published.'); }
});

/* ---------- comments & replies (on a person) ---------- */
function buildThread(pid, list) {
  const box = el('div', 'thread');
  const ids = new Set(list.map(c => c.id));
  const roots = list.filter(c => !c.replyTo || !ids.has(c.replyTo));
  const nameOf = c => (members[c.author] && members[c.author].name) || c.authorName || 'Friend';

  const row = (c, isReply) => {
    const r = el('div', 'cm' + (isReply ? ' rep' : ''));
    const top = el('div', 'cmtop'); top.appendChild(el('b', null, nameOf(c))); top.appendChild(el('small', null, ' · ' + ago(c.ts)));
    r.appendChild(top); r.appendChild(el('div', 'cmtext', c.text));
    const acts = el('div', 'cmacts');
    const rp = el('button', 'link', 'Reply');
    rp.onclick = e => {
      e.stopPropagation();
      replyingTo[pid] = { id: isReply ? c.replyTo : c.id, name: nameOf(c) };
      if (isReply && !(drafts[pid] || '').trim()) drafts[pid] = '@' + nameOf(c) + ' ';
      pendingFocus = pid; render();
    };
    acts.appendChild(rp);
    if (c.author === self.key) {
      const del = el('button', 'link', 'Delete');
      del.onclick = async e => {
        e.stopPropagation(); del.disabled = true;
        try {
          const wb = writeBatch(db);
          wb.delete(doc(db, 'sessions', code, 'comments', c.id));
          list.filter(x => x.replyTo === c.id).forEach(x => wb.delete(doc(db, 'sessions', code, 'comments', x.id)));
          await wb.commit();
        } catch (er) { del.disabled = false; notice('Could not delete that comment.'); }
      };
      acts.appendChild(del);
    }
    r.appendChild(acts);
    return r;
  };
  roots.forEach(c => { box.appendChild(row(c, false)); list.filter(x => x.replyTo === c.id).forEach(x => box.appendChild(row(x, true))); });
  if (!roots.length) box.appendChild(el('div', 'cmempty', 'No comments yet.'));

  const send = async text => {
    text = (text || '').trim(); if (!text) return false;
    const data = { target: pid, author: self.key, authorName: self.name, text: text.slice(0, 280), ts: Date.now() };
    const rp = replyingTo[pid]; if (rp) data.replyTo = rp.id;
    try { await addDoc(collection(db, 'sessions', code, 'comments'), data); delete replyingTo[pid]; return true; }
    catch (e) { notice('Could not post your comment. Make sure the latest Firestore rules are published.'); return false; }
  };

  const rep = replyingTo[pid];
  if (rep) {
    const tag = el('div', 'replying', 'Replying to ' + rep.name + ' ');
    const cancel = el('button', 'link', 'Cancel'); cancel.onclick = e => { e.stopPropagation(); delete replyingTo[pid]; render(); };
    tag.appendChild(cancel); box.appendChild(tag);
  }
  const cr = el('div', 'cmrow'), inp = el('input'), go = el('button', 'btn small pink', 'Send');
  inp.dataset.draft = pid; inp.maxLength = 280; inp.placeholder = rep ? 'Write a reply…' : 'Add a comment…'; inp.value = drafts[pid] || '';
  inp.oninput = () => { drafts[pid] = inp.value; };
  const submit = async () => { if (await send(inp.value)) { drafts[pid] = ''; inp.value = ''; } };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  go.onclick = e => { e.stopPropagation(); submit(); };
  cr.append(inp, go); box.appendChild(cr);
  return box;
}

setInterval(() => { if (code && drinks.length) render(); }, 60000);
init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
