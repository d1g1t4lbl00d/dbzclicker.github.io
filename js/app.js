/* =======================================================================
   UnderBro :: lógica de la aplicación
   ======================================================================= */
(() => {
'use strict';

// versión de esta build (derivada del ?v= con el que se cargó este script)
const APP_VERSION = (() => { try { return (document.currentScript.src.match(/[?&]v=([^&]+)/) || [])[1] || 'dev'; } catch { return 'dev'; } })();

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.UNDERBRO_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---------------------------------------------------------------- estado
const state = {
  user: null,          // sesión auth
  profile: null,       // fila profiles propia
  tracks: [],          // pistas cargadas en la vista actual
  likes: new Set(),    // track_ids que me gustan
  reposts: new Set(),  // track_ids que he reposteado
  eventSaves: new Set(),// event_ids que he guardado
  badges: new Set(),   // insignias que poseo
  follows: new Set(),  // user_ids que sigo
  blocked: new Set(),  // user_ids que he bloqueado
  hidden: new Set(),   // user_ids a ocultar (bloqueo en cualquier sentido)
  downloads: new Set(JSON.parse(localStorage.getItem('ub_downloads') || '[]')),
  view: 'feed',
  tab: 'trending',
  search: '',
  queue: [],           // cola de reproducción (track ids en orden)
  current: null,       // track en reproducción
  presence: null,      // canal de presencia
  online: [],          // usuarios online
  dmPeer: null,        // id del interlocutor del chat abierto
  dmPeerProfile: null, // perfil del interlocutor
  dmMsgs: new Map(),   // id -> mensaje (conversación abierta)
  dmReacts: new Map(), // message_id -> { emoji: Set(userIds) }
  dmReplyTo: null,     // mensaje al que se está respondiendo
  dmConv: null,        // canal realtime de la conversación abierta
  dmPendingFile: null,
};

/* ---- TEMA (claro / oscuro) ---- */
function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('ub_theme', theme); } catch (_) {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0d18' : '#3e57fc');
}

/* ---- insignia de verificado / fundador ---- */
function verifiedBadge(p) { return (p && p.verified) ? ' <svg class="vbadge" viewBox="0 0 24 24" aria-label="Verificado"><use href="#i-verify"/></svg>' : ''; }

/* ---- SISTEMA DE INSIGNIAS ---- */
const BADGES = {
  alpha:  { name: 'Alpha',  glyph: 'α', cls: 'bdg-alpha',  desc: 'Estuviste en la fase Alpha de UnderBro.' },
  tester: { name: 'Tester', glyph: '★', cls: 'bdg-tester', desc: 'Invitaste a alguien a UnderBro. ¡Gracias por hacerla crecer!' },
};
function displayBadgeHtml(p) {
  const key = (p && p.displayed_badge) || 'alpha';
  const b = BADGES[key];
  return b ? ` <span class="bdg ${b.cls}" title="${esc(b.name)}">${b.glyph}</span>` : '';
}
async function loadBadges() {
  const { data } = await sb.from('user_badges').select('badge').eq('user_id', state.user.id);
  state.badges = new Set((data || []).map(r => r.badge));
  // el desarrollador (admin) posee todo el catálogo, presente y futuro
  if (state.profile && state.profile.is_admin) Object.keys(BADGES).forEach(k => state.badges.add(k));
  let seen = []; try { seen = JSON.parse(localStorage.getItem('ub_badges_seen') || '[]'); } catch (_) {}
  const seenSet = new Set(seen);
  const fresh = [...state.badges].filter(b => BADGES[b] && !seenSet.has(b));
  if (fresh.length) {
    localStorage.setItem('ub_badges_seen', JSON.stringify([...state.badges]));
    badgeUnlockQueue(fresh);
  }
}
function badgeUnlockQueue(keys) {
  let i = 0;
  const next = () => { if (i >= keys.length) return; badgeUnlockAnim(keys[i++], next); };
  setTimeout(next, 600);
}
function badgeUnlockAnim(key, onDone) {
  const b = BADGES[key]; if (!b) { if (onDone) onDone(); return; }
  const colors = ['#27a9ff', '#6e2df5', '#3e57fc', '#ffd166', '#ff6f9c', '#4f8ff7'];
  const confetti = Array.from({ length: 26 }, (_, i) => `<i style="left:${(Math.random() * 100).toFixed(1)}%;background:${colors[i % colors.length]};animation-delay:${(Math.random() * 0.5).toFixed(2)}s;animation-duration:${(1.6 + Math.random() * 1.3).toFixed(2)}s"></i>`).join('');
  const ov = el(`<div class="badge-pop"><div class="bp-confetti">${confetti}</div><div class="bp-card"><div class="bdg ${b.cls} bp-badge">${b.glyph}</div><div class="bp-kicker">¡Insignia desbloqueada!</div><div class="bp-name">${esc(b.name)}</div><div class="bp-desc">${esc(b.desc)}</div><div class="bp-tap">toca para cerrar</div></div></div>`);
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  let closed = false;
  const close = () => { if (closed) return; closed = true; ov.classList.remove('show'); setTimeout(() => { ov.remove(); if (onDone) onDone(); }, 320); };
  ov.addEventListener('click', close);
  setTimeout(close, 4200);
}

/* ---- referidos (marketing) ---- */
try { const _r = new URLSearchParams(location.search).get('ref'); if (_r) localStorage.setItem('ub_ref', _r.slice(0, 40)); } catch (_) {}
async function applyReferral() {
  if (!state.profile || state.profile.referred_by) return;
  const ref = localStorage.getItem('ub_ref');
  if (!ref) return;
  localStorage.removeItem('ub_ref');
  try {
    const { data } = await sb.from('profiles').select('id').ilike('username', ref).maybeSingle();
    if (data && data.id && data.id !== state.user.id) {
      await sb.from('profiles').update({ referred_by: data.id }).eq('id', state.user.id);
      state.profile.referred_by = data.id;
    }
  } catch (_) {}
}

// ---------------------------------------------------------------- helpers
const $ = (id) => document.getElementById(id);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => (s ?? '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtTime = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); const m = Math.floor(sec/60); const s = sec%60; return `${m}:${s.toString().padStart(2,'0')}`; };
const initials = (name) => (name||'?').trim().slice(0,2).toUpperCase();
function timeAgo(ts) {
  const d = (Date.now() - new Date(ts).getTime())/1000;
  if (d < 60) return 'ahora';
  if (d < 3600) return Math.floor(d/60)+'m';
  if (d < 86400) return Math.floor(d/3600)+'h';
  if (d < 604800) return Math.floor(d/86400)+'d';
  return new Date(ts).toLocaleDateString();
}
function skeletonFeed(n=5) {
  let s = '';
  for (let i=0;i<n;i++) s += `<div class="skeleton"><div class="sk sk-cover"></div><div style="flex:1"><div class="sk sk-line" style="width:42%"></div><div class="sk sk-line" style="width:28%"></div><div class="sk sk-line" style="width:100%;height:40px;margin-top:14px"></div></div></div>`;
  return s;
}
function toast(msg) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  $('toastWrap').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(()=>t.remove(), 300); }, 2600);
}
function requireNotBanned() {
  if (state.profile?.banned) { toast('Tu cuenta está suspendida por un moderador.'); return false; }
  return true;
}
function avatarHTML(profile, cls='') {
  const url = profile?.avatar_url;
  const name = profile?.display_name || profile?.username || '?';
  const pos = czPos(profile?.theme?.avatarPos);
  const zoom = czZoom(profile?.theme?.avatarZoom);
  const st = (pos || zoom > 1) ? ` style="${pos ? `object-position:${pos};` : ''}${zoom > 1 ? `transform:scale(${zoom});` : ''}"` : '';
  if (url) return `<div class="avatar ${cls}"><img src="${esc(url)}" alt=""${st} /></div>`;
  return `<div class="avatar ${cls}">${esc(initials(name))}</div>`;
}

// pseudo-waveform determinista a partir del id de la pista
function waveBars(id, n=64) {
  let h = 0; for (let i=0;i<id.length;i++) h = (h*31 + id.charCodeAt(i)) >>> 0;
  const bars = [];
  for (let i=0;i<n;i++) { h = (h*1103515245 + 12345) >>> 0; bars.push(18 + (h % 82)); }
  return bars;
}

/* =======================================================================
   AUTH
   ======================================================================= */
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  $('tabLogin').classList.toggle('active', mode==='login');
  $('tabRegister').classList.toggle('active', mode==='register');
  $('fieldUsername').style.display = mode==='register' ? '' : 'none';
  $('fieldTerms').style.display = mode==='register' ? '' : 'none';
  $('authSubmit').textContent = mode==='register' ? 'Crear cuenta' : 'Entrar';
  $('authPassword').autocomplete = mode==='register' ? 'new-password' : 'current-password';
  $('authMsg').textContent = '';
}
$('tabLogin').onclick = () => setAuthMode('login');
$('tabRegister').onclick = () => setAuthMode('register');
$('authPolicyLink').onclick = (e) => { e.preventDefault(); showPrivacyPolicy(); };
$('authPolicyFooter').onclick = (e) => { e.preventDefault(); showPrivacyPolicy(); };

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const username = $('authUsername').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const msg = $('authMsg');
  const btn = $('authSubmit');
  msg.className = 'auth-msg'; msg.textContent = '';
  btn.disabled = true;
  try {
    if (authMode === 'register') {
      if (username.length < 3) throw new Error('El nombre de usuario debe tener al menos 3 caracteres.');
      if (!$('authTerms').checked) throw new Error('Debes aceptar la Política de privacidad para registrarte.');
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { username, display_name: username }, emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      if (data.session) {
        await onAuthenticated();
      } else {
        // las cuentas se autoconfirman: iniciar sesión directamente
        const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
        if (e2) {
          msg.className = 'auth-msg ok';
          msg.textContent = '¡Cuenta creada! Ya puedes iniciar sesión.';
          setAuthMode('login');
        } else {
          await onAuthenticated();
        }
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await onAuthenticated();
    }
  } catch (err) {
    msg.className = 'auth-msg error';
    msg.textContent = traducirError(err.message);
  } finally {
    btn.disabled = false;
  }
});

function traducirError(m) {
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/User already registered/i.test(m)) return 'Ese correo ya está registrado.';
  if (/Password should be/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/duplicate key|already exists/i.test(m)) return 'Ese nombre de usuario ya existe.';
  return m;
}

async function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  try { await sb.auth.signOut(); } catch {}
  location.reload();
}
$('btnLogout').onclick = logout;

/* =======================================================================
   ARRANQUE / SESIÓN
   ======================================================================= */
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) { state.user = session.user; await onAuthenticated(); }
  sb.auth.onAuthStateChange((_e, sess) => {
    if (!sess && state.user) location.reload();
  });
}

async function onAuthenticated() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session.user;
  // cargar / asegurar perfil
  await ensureProfile();
  applyReferral();
  $('authScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  renderMe();
  await Promise.all([loadLikes(), loadReposts(), loadEventSaves(), loadFollows(), loadBlocks(), loadBadges()]);
  bindUI();
  initSwipeNav();
  initPlayer();
  initNowPlaying();
  initChat();
  initPresence();
  initDM();
  setupPush();
  loadNotifBadge();
  switchView('feed');
  handleDeepLink();
}

async function ensureProfile() {
  let { data: profile } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  if (!profile) {
    // fallback por si el trigger no creó el perfil
    const meta = state.user.user_metadata || {};
    let username = (meta.username || (state.user.email||'user').split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g,'');
    if (username.length < 3) username = 'user_' + state.user.id.slice(0,5);
    const ins = await sb.from('profiles').insert({
      id: state.user.id, username, display_name: meta.display_name || username,
    }).select().single();
    profile = ins.data;
    if (!profile) { // username colisionó
      username = username + '_' + state.user.id.slice(0,4);
      const ins2 = await sb.from('profiles').insert({ id: state.user.id, username, display_name: username }).select().single();
      profile = ins2.data;
    }
  }
  state.profile = profile;
}

function renderMe() {
  $('meName').innerHTML = esc(state.profile.display_name || state.profile.username) + verifiedBadge(state.profile) + displayBadgeHtml(state.profile) +
    (state.profile.is_admin ? ' <span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c;padding:1px 7px">MOD</span>' : '');
  $('meAvatar').outerHTML = avatarHTML(state.profile).replace('class="avatar ', 'id="meAvatar" class="avatar ');
  // avatar del orbe central "Yo"
  const orb = $('orbAv');
  if (orb) {
    const av = state.profile.avatar_url;
    if (av) { const z = czZoom(state.profile.theme?.avatarZoom); orb.style.backgroundImage = `url('${czUrl(av)}')`; orb.style.backgroundPosition = czPos(state.profile.theme?.avatarPos) || 'center'; orb.style.backgroundSize = z > 1 ? (z * 100) + '%' : 'cover'; orb.textContent = ''; }
    else { orb.style.backgroundImage = 'none'; orb.textContent = initials(state.profile.display_name || state.profile.username || '?'); }
  }
}

async function loadLikes() {
  const { data } = await sb.from('likes').select('track_id').eq('user_id', state.user.id);
  state.likes = new Set((data||[]).map(r => r.track_id));
}
async function loadReposts() {
  const { data } = await sb.from('reposts').select('track_id').eq('user_id', state.user.id);
  state.reposts = new Set((data||[]).map(r => r.track_id));
}
async function loadEventSaves() {
  const { data } = await sb.from('event_saves').select('event_id').eq('user_id', state.user.id);
  state.eventSaves = new Set((data||[]).map(r => r.event_id));
}
async function loadFollows() {
  const { data } = await sb.from('follows').select('following_id').eq('follower_id', state.user.id);
  state.follows = new Set((data||[]).map(r => r.following_id));
}
async function loadBlocks() {
  const { data } = await sb.from('blocks').select('blocker_id,blocked_id')
    .or(`blocker_id.eq.${state.user.id},blocked_id.eq.${state.user.id}`);
  const mine = new Set(), hidden = new Set();
  (data || []).forEach(b => {
    if (b.blocker_id === state.user.id) { mine.add(b.blocked_id); hidden.add(b.blocked_id); }
    if (b.blocked_id === state.user.id) hidden.add(b.blocker_id);
  });
  state.blocked = mine; state.hidden = hidden;
}
function isHidden(userId) { return userId && userId !== state.user.id && state.hidden && state.hidden.has(userId); }

/* =======================================================================
   SEGURIDAD: BLOQUEAR Y REPORTAR (moderación / cumplimiento Play)
   ======================================================================= */
async function blockUser(userId, name, onDone) {
  if (!userId || userId === state.user.id) return;
  if (!confirm(`¿Bloquear a ${name || 'este usuario'}?\n\nNo podrá enviarte mensajes y dejarás de ver su contenido.`)) return;
  const { error } = await sb.from('blocks').insert({ blocker_id: state.user.id, blocked_id: userId });
  if (error) { toast('No se pudo bloquear'); return; }
  state.blocked.add(userId); state.hidden.add(userId);
  toast('Usuario bloqueado');
  if (onDone) onDone();
}
async function unblockUser(userId, onDone) {
  const { error } = await sb.from('blocks').delete().eq('blocker_id', state.user.id).eq('blocked_id', userId);
  if (error) { toast('No se pudo desbloquear'); return; }
  state.blocked.delete(userId);
  await loadBlocks();
  toast('Usuario desbloqueado');
  if (onDone) onDone();
}
const REPORT_REASONS = ['Spam o engaño', 'Acoso o bullying', 'Contenido sexual', 'Violencia o amenazas', 'Discurso de odio', 'Suplantación de identidad', 'Propiedad intelectual', 'Otro'];
const REPORT_LABEL = { user: 'usuario', track: 'pista', post: 'publicación', comment: 'comentario', message: 'mensaje', chat: 'mensaje del chat' };
function openReportModal(targetType, targetId, targetOwner, label) {
  if (!requireNotBanned()) return;
  const chips = REPORT_REASONS.map(r => `<button type="button" class="rep-reason" data-r="${esc(r)}">${esc(r)}</button>`).join('');
  const m = openModal(`
    <div class="modal-head"><h3>Reportar ${esc(REPORT_LABEL[targetType] || 'contenido')}</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <p class="sub" style="margin-bottom:12px">Cuéntanos qué pasa con ${esc(label || 'este contenido')}. Los moderadores lo revisarán.</p>
      <div class="rep-reasons">${chips}</div>
      <div class="field" style="margin-top:14px"><label>Detalles (opcional)</label><textarea id="repDetails" maxlength="600" placeholder="Añade contexto si quieres..."></textarea></div>
      <button class="btn primary" id="repSend" disabled style="width:100%">Enviar reporte</button>
    </div>`);
  let reason = '';
  m.querySelectorAll('.rep-reason').forEach(b => b.onclick = () => {
    m.querySelectorAll('.rep-reason').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); reason = b.dataset.r; m.querySelector('#repSend').disabled = false;
  });
  m.querySelector('#repSend').onclick = async () => {
    if (!reason) return;
    const details = m.querySelector('#repDetails').value.trim();
    m.querySelector('#repSend').disabled = true;
    const { error } = await sb.from('reports').insert({
      reporter_id: state.user.id, target_type: targetType, target_id: String(targetId),
      target_owner: targetOwner || null, reason, details: details || null,
    });
    if (error) { toast('No se pudo enviar el reporte'); m.querySelector('#repSend').disabled = false; return; }
    m.remove();
    toast('Gracias. Reporte enviado a moderación.');
  };
}
// gestor de cuentas bloqueadas (cualquier usuario)
async function openBlockedList() {
  const m = openModal(`<div class="modal-head"><h3>Cuentas bloqueadas</h3><button class="close">&times;</button></div><div class="modal-body" id="blkBody"><div class="loading"><div class="spinner"></div></div></div>`);
  const body = m.querySelector('#blkBody');
  const ids = [...state.blocked];
  if (!ids.length) { body.innerHTML = `<div class="empty" style="padding:20px"><p>No has bloqueado a nadie.</p></div>`; return; }
  const { data } = await sb.from('profiles').select('id,username,display_name,avatar_url,theme').in('id', ids);
  body.innerHTML = '';
  (data || []).forEach(p => {
    const row = el(`<div class="follow-row"><div class="fr-left">${avatarHTML(p)}<div><div class="fr-name">${esc(p.display_name || p.username)}</div><div class="fr-handle">@${esc(p.username)}</div></div></div><div class="fr-actions"><button class="btn sm">Desbloquear</button></div></div>`);
    row.querySelector('button').onclick = () => unblockUser(p.id, () => { row.remove(); if (!state.blocked.size) body.innerHTML = `<div class="empty" style="padding:20px"><p>No has bloqueado a nadie.</p></div>`; });
    body.appendChild(row);
  });
}
// panel de moderación: revisar reportes (solo admin)
async function openReportsAdmin() {
  if (!state.profile.is_admin) return;
  const m = openModal(`<div class="modal-head"><h3>Reportes</h3><button class="close">&times;</button></div><div class="modal-body" id="repBody"><div class="loading"><div class="spinner"></div></div></div>`);
  const body = m.querySelector('#repBody');
  const { data, error } = await sb.from('reports').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  if (error) { body.innerHTML = `<div class="empty" style="padding:20px"><p>No se pudieron cargar los reportes.</p></div>`; return; }
  if (!data || !data.length) { body.innerHTML = `<div class="empty" style="padding:20px"><svg fill="none"><use href="#i-verify"/></svg><p>Sin reportes abiertos. ¡Todo en orden!</p></div>`; return; }
  // perfiles implicados
  const uids = [...new Set(data.flatMap(r => [r.reporter_id, r.target_owner]).filter(Boolean))];
  const { data: profs } = await sb.from('profiles').select('id,username,display_name').in('id', uids);
  const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
  const nameOf = (id) => id && byId[id] ? ('@' + byId[id].username) : '—';
  body.innerHTML = '';
  data.forEach(r => {
    const card = el(`<div class="rep-card">
      <div class="rep-top"><span class="rep-type">${esc(REPORT_LABEL[r.target_type] || r.target_type)}</span><span class="rep-when">${timeAgo(r.created_at)}</span></div>
      <div class="rep-reason-l">${esc(r.reason)}</div>
      ${r.details ? `<div class="rep-details">${esc(r.details)}</div>` : ''}
      <div class="rep-meta">Autor: <b data-go="${esc(r.target_owner || '')}">${esc(nameOf(r.target_owner))}</b> · Reporta: ${esc(nameOf(r.reporter_id))}</div>
      <div class="rep-actions">
        ${r.target_owner ? `<button class="btn sm" data-a="profile">Ver autor</button><button class="btn sm" data-a="ban" style="border-color:#e3b7b0;color:#c0533f">Banear autor</button>` : ''}
        <button class="btn sm" data-a="dismiss">Descartar</button>
        <button class="btn sm primary" data-a="done">Resuelto</button>
      </div></div>`);
    const resolve = async (status) => {
      const { error: e2 } = await sb.from('reports').update({ status, resolved_by: state.user.id, resolved_at: new Date().toISOString() }).eq('id', r.id);
      if (e2) { toast('No se pudo actualizar'); return; }
      card.remove(); if (!body.querySelector('.rep-card')) body.innerHTML = `<div class="empty" style="padding:20px"><p>Sin reportes abiertos.</p></div>`;
    };
    const prof = card.querySelector('[data-a="profile"]'); if (prof) prof.onclick = () => { m.remove(); openProfile(r.target_owner); };
    const ban = card.querySelector('[data-a="ban"]'); if (ban) ban.onclick = async () => {
      if (!confirm('¿Banear al autor de este contenido?')) return;
      await sb.from('profiles').update({ banned: true }).eq('id', r.target_owner);
      toast('Usuario baneado'); resolve('actioned');
    };
    card.querySelector('[data-a="dismiss"]').onclick = () => resolve('dismissed');
    card.querySelector('[data-a="done"]').onclick = () => resolve('reviewed');
    body.appendChild(card);
  });
}

/* =======================================================================
   UI BINDINGS
   ======================================================================= */
function bindUI() {
  document.querySelectorAll('.nav-item[data-view]').forEach(b => {
    b.onclick = () => { switchView(b.dataset.view); hideDrawers(); };
  });
  document.querySelectorAll('#feedTabs button').forEach(b => {
    b.onclick = () => {
      state.tab = b.dataset.tab;
      document.querySelectorAll('#feedTabs button').forEach(x => x.classList.toggle('active', x===b));
      switchView('feed');
    };
  });
  $('btnUpload').onclick = openCreateChooser;
  $('btnNotif').onclick = () => switchView('notifications');
  $('btnMessages').onclick = () => { switchView('messages'); hideDrawers(); };
  $('meChip').onclick = () => openProfile(state.user.id);
  $('menuToggle').onclick = () => { const open = $('sidebar').classList.toggle('open'); $('drawerBackdrop').classList.toggle('show', open); };
  $('btnChatToggle').onclick = toggleRight;
  $('drawerBackdrop').onclick = hideDrawers;
  $('btnSearchToggle').onclick = () => {
    const tb = document.querySelector('.topbar');
    const open = tb.classList.toggle('search-open');
    if (open) setTimeout(() => $('searchInput').focus(), 60);
    else { $('searchInput').value = ''; state.search = ''; }
  };

  // navegación inferior (móvil)
  document.querySelectorAll('#bottomNav button[data-bnav]').forEach(b => {
    b.onclick = () => {
      const act = b.dataset.bnav;
      document.querySelectorAll('#bottomNav button').forEach(x => x.classList.toggle('active', x === b && act !== 'upload'));
      if (act === 'feed') { state.tab = 'trending'; switchView('feed'); $('main').scrollTo({top:0,behavior:'smooth'}); }
      else if (act === 'posts') switchView('posts');
      else if (act === 'people') switchView('people');
      else if (act === 'me') openProfile(state.user.id);
      else if (act === 'upload') openCreateChooser();
      else if (act === 'chat') switchView('messages');
      if (act !== 'upload') hideDrawers();
    };
  });

  let st;
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(st);
    st = setTimeout(() => { state.search = e.target.value.trim(); switchView('search'); }, 320);
  });
  updateCounts();
}
const rightEl = () => document.querySelector('.right');
function hideDrawers() {
  $('sidebar').classList.remove('open');
  rightEl().classList.remove('open');
  $('drawerBackdrop').classList.remove('show');
}
function toggleRight() {
  const r = rightEl();
  const open = r.classList.toggle('open');
  $('sidebar').classList.remove('open');
  $('drawerBackdrop').classList.toggle('show', open);
  if (open) setTimeout(scrollChat, 50);
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
}

async function updateCounts() {
  const [{ count: all }, mine, dl] = await Promise.all([
    sb.from('tracks').select('id', { count: 'exact', head: true }),
    sb.from('tracks').select('id', { count: 'exact', head: true }).eq('user_id', state.user.id),
    Promise.resolve(null),
  ]);
  $('cntAll').textContent = all ?? '';
  $('cntFav').textContent = state.likes.size || '';
  $('cntMine').textContent = mine.count ?? '';
  $('cntDl').textContent = state.downloads.size || '';
}

/* =======================================================================
   VISTAS
   ======================================================================= */
async function switchView(view) {
  state.view = view;
  const main = $('main');
  $('feedTabs')?.classList.toggle('hidden', view !== 'feed');
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  if (['feed','feed-trending','all','favorites','mytracks','downloads','search'].includes(view)) setActiveNav(view === 'search' ? '' : view);
  else setActiveNav(view);

  if (view === 'settings') return renderSettings();
  if (view === 'notifications') return renderNotifications();
  if (view === 'people') return renderPeople();
  if (view === 'messages') return renderMessages();
  if (view === 'posts') return renderPosts();
  if (view === 'search') return renderSearch();
  if (view === 'playlists') return renderPlaylists();
  if (view === 'dashboard') return renderDashboard();
  if (view === 'events') return renderEvents();
  if (view === 'radio') return startRadio();

  main.innerHTML = skeletonFeed();
  let tracks = [], head = { title: 'Stream', sub: '' };

  try {
    if (view === 'feed') {
      if (state.tab === 'trending') { tracks = await fetchTracks({ order: 'plays' }); head = { title: 'Trending', sub: 'Lo más escuchado en UnderBro' }; }
      else if (state.tab === 'new') { tracks = await fetchTracks({ order: 'created_at' }); head = { title: 'New', sub: 'Lo último que se ha subido' }; }
      else { tracks = await fetchFollowingTracks(); head = { title: 'Following', sub: 'Pistas de gente que sigues' }; }
    } else if (view === 'feed-trending') {
      tracks = await fetchTracks({ order: 'plays' }); head = { title: 'Trending', sub: 'Lo más escuchado' };
    } else if (view === 'all') {
      tracks = await fetchTracks({ order: 'created_at' }); head = { title: 'All Tracks', sub: 'Toda la biblioteca' };
    } else if (view === 'favorites') {
      tracks = await fetchFavorites(); head = { title: 'Favorites', sub: 'Tus pistas favoritas' };
    } else if (view === 'mytracks') {
      tracks = await fetchTracks({ order: 'created_at', userId: state.user.id }); head = { title: 'My Uploads', sub: 'Pistas que has subido' };
    } else if (view === 'downloads') {
      tracks = await fetchByIds([...state.downloads]); head = { title: 'Downloads', sub: 'Pistas que descargaste' };
    }
  } catch (err) { console.error(err); toast('Error al cargar pistas'); tracks = []; }

  state.tracks = tracks;
  renderFeed(head, tracks, view);
}

/* =======================================================================
   NAVEGACIÓN POR GESTOS (deslizar entre pantallas, solo móvil)
   ======================================================================= */
const SWIPE_SEQ = ['following', 'trending', 'new', 'posts', 'chat'];
function setBnavActive(bnav) {
  document.querySelectorAll('#bottomNav button').forEach(x => x.classList.toggle('active', x.dataset.bnav === bnav));
}
function curScreenIdx() {
  if (state.view === 'feed') return SWIPE_SEQ.indexOf(state.tab);
  if (state.view === 'posts') return SWIPE_SEQ.indexOf('posts');
  if (state.view === 'messages') return SWIPE_SEQ.indexOf('chat');
  return -1;
}
function gotoScreenIdx(i) {
  if (i < 0 || i >= SWIPE_SEQ.length) return;
  const key = SWIPE_SEQ[i];
  if (i <= 2) {
    state.tab = key;
    document.querySelectorAll('#feedTabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === key));
    setBnavActive('feed');
    switchView('feed');
  } else if (key === 'posts') { setBnavActive('posts'); switchView('posts'); }
  else if (key === 'chat') { setBnavActive('chat'); switchView('messages'); }
}
/* ---- háptica: vibración breve al tocar controles (solo móvil) ---- */
function haptic(ms) { try { if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(ms || 8); } catch (_) {} }
const HAPTIC_SEL = '.btn, .icon-btn, .act, .play-lg, .nav-item, .bottom-nav button, .tabs button, .profile-tabs button, .pstat, .badge-item:not(.locked), .dm-track-play, .story-circle, .pl-card, .ev-card, .social-card, .dt-row, [data-ev-save], [data-send], [data-add], [data-bnav], [data-tab], [data-ptab], .mention';
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  if (e.target.closest && e.target.closest(HAPTIC_SEL)) haptic(9);
}, { passive: true });

function initSwipeNav() {
  if (initSwipeNav._done) return; initSwipeNav._done = true;
  const EXCLUDE = '.seek, .vol-slider, .wave, #npWave, .stories-bar, .dm-bubble, .dm-thread, .pl-cover-grid, input, textarea, select, .mention-dd, .post-grid';
  let sx = 0, sy = 0, st = 0, ignore = true, moved = false;
  const overlayOpen = () =>
    document.querySelector('.modal-backdrop, .story-viewer, .right.open') ||
    (typeof npIsOpen === 'function' && npIsOpen()) ||
    $('dmScreen')?.classList.contains('open') ||
    $('sidebar')?.classList.contains('open');
  document.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 720 || e.touches.length !== 1 || overlayOpen()) { ignore = true; return; }
    const t = e.target;
    if (t && t.closest && t.closest(EXCLUDE)) { ignore = true; return; }
    ignore = false; moved = false;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (ignore) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) moved = true;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (ignore || !moved) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.6 || Date.now() - st > 700) return;
    const cur = curScreenIdx();
    if (cur < 0) return;
    gotoScreenIdx(cur + (dx < 0 ? 1 : -1));
  }, { passive: true });
}

async function fetchTracks({ order='created_at', userId=null, limit=50 } = {}) {
  let q = sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)');
  if (userId) q = q.eq('user_id', userId);
  q = q.order(order, { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
async function fetchFollowingTracks() {
  if (state.follows.size === 0) return [];
  const followed = [...state.follows];
  const ownP = sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)')
    .in('user_id', followed).order('created_at', { ascending: false }).limit(50);
  const repP = sb.from('reposts')
    .select('created_at, user_id, reposter:profiles!reposts_user_id_fkey(display_name,username), tracks(*, profiles!tracks_user_id_fkey(*))')
    .in('user_id', followed).order('created_at', { ascending: false }).limit(50);
  const [{ data: own }, { data: reps }] = await Promise.all([ownP, repP]);
  const items = [];
  (own || []).forEach(t => items.push({ track: t, ts: t.created_at }));
  (reps || []).forEach(r => {
    if (!r.tracks) return;
    const t = { ...r.tracks };
    t._repostedBy = r.reposter?.display_name || r.reposter?.username || 'alguien';
    t._repostedById = r.user_id;
    items.push({ track: t, ts: r.created_at });
  });
  items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const seen = new Set(); const out = [];
  for (const it of items) { if (seen.has(it.track.id)) continue; seen.add(it.track.id); out.push(it.track); }
  return out;
}
async function fetchFavorites() {
  if (state.likes.size === 0) return [];
  return fetchByIds([...state.likes]);
}
async function fetchByIds(ids) {
  if (!ids.length) return [];
  const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').in('id', ids);
  return data || [];
}
// quita caracteres que romperían el filtro or() de PostgREST
function sanitizeTerm(s) { return (s || '').trim().replace(/[,()*%:]/g, ''); }

async function fetchSearch(term) {
  const t = sanitizeTerm(term);
  if (!t) return [];
  const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)')
    .or(`title.ilike.%${t}%,artist.ilike.%${t}%,genre.ilike.%${t}%`)
    .order('plays', { ascending: false }).limit(50);
  return data || [];
}
async function fetchPeopleSearch(term) {
  const t = sanitizeTerm(term);
  if (!t) return [];
  const { data } = await sb.from('profiles').select('*')
    .or(`username.ilike.%${t}%,display_name.ilike.%${t}%`)
    .limit(12);
  return (data || []).filter(p => p.id !== state.user.id);
}

// Vista de búsqueda: personas + pistas
async function renderSearch() {
  setActiveNav('');
  const main = $('main');
  const term = (state.search || '').trim();
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  if (!term) {
    main.innerHTML = `<div class="main-head"><div><h2>Buscar</h2><div class="sub">Personas y pistas en UnderBro</div></div></div><div class="empty"><svg fill="none"><use href="#i-search"/></svg><p>Escribe para buscar personas o pistas.</p></div>`;
    return;
  }
  main.innerHTML = skeletonFeed();
  let people = [], tracks = [];
  try { [people, tracks] = await Promise.all([fetchPeopleSearch(term), fetchSearch(term)]); }
  catch (err) { console.error(err); toast('Error en la búsqueda'); }
  people = (people || []).filter(p => !isHidden(p.id));
  tracks = (tracks || []).filter(t => !isHidden(t.user_id));

  main.innerHTML = `
    <div class="main-head"><div><h2>Búsqueda: "${esc(term)}"</h2><div class="sub">${people.length} persona(s) · ${tracks.length} pista(s)</div></div></div>
    ${people.length ? `<div class="search-section">Personas</div><div class="search-people" id="searchPeople"></div>` : ''}
    ${tracks.length ? `<div class="search-section">Pistas</div>` : ''}
    <div id="feedList" class="feed-list compact"></div>`;

  if (people.length) { const pc = $('searchPeople'); people.forEach(p => pc.appendChild(personSearchRow(p))); }

  const list = $('feedList');
  if (!people.length && !tracks.length) {
    list.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-search"/></svg><p>Sin resultados para "${esc(term)}".</p></div>`;
  } else if (tracks.length) {
    state.tracks = tracks; state.queue = tracks.map(t => t.id);
    tracks.forEach(t => list.appendChild(trackCard(t)));
  }
}

function personSearchRow(p) {
  const f = state.follows.has(p.id);
  const row = el(`
    <div class="search-person" data-uid="${p.id}">
      ${avatarHTML(p)}
      <div class="sp-meta">
        <div class="sp-name">${esc(p.display_name || p.username)}${p.is_admin ? ' <span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c">MOD</span>' : ''}</div>
        <div class="sp-handle">@${esc(p.username)}</div>
      </div>
      <button class="btn sm ${f ? '' : 'primary'}" data-act="follow">${f ? 'Siguiendo ✓' : '+ Seguir'}</button>
    </div>`);
  const fb = row.querySelector('[data-act="follow"]');
  fb.onclick = async (e) => {
    e.stopPropagation();
    if (state.follows.has(p.id)) {
      state.follows.delete(p.id);
      await sb.from('follows').delete().eq('follower_id', state.user.id).eq('following_id', p.id);
      fb.classList.add('primary'); fb.textContent = '+ Seguir';
    } else {
      state.follows.add(p.id);
      await sb.from('follows').insert({ follower_id: state.user.id, following_id: p.id });
      fb.classList.remove('primary'); fb.textContent = 'Siguiendo ✓';
    }
  };
  row.addEventListener('click', (e) => { if (e.target.closest('[data-act]')) return; openProfile(p.id); });
  return row;
}

function renderFeed(head, tracks, view) {
  tracks = (tracks || []).filter(t => !isHidden(t.user_id) && !isHidden(t._repostedById));
  const main = $('main');
  const showStories = view === 'feed';
  main.innerHTML = `<div class="main-head"><div><h2>${esc(head.title)}</h2><div class="sub">${esc(head.sub)}</div></div></div>${showStories ? '<div id="storiesBar" class="stories-bar"></div>' : ''}<div id="feedList" class="feed-list compact"></div>`;
  if (showStories) loadStoriesBar();
  const list = $('feedList');
  if (!tracks.length) {
    let hint = 'No hay pistas todavía.';
    if (view === 'favorites') hint = 'Aún no has marcado favoritos. Dale al ♥ en una pista.';
    if (view === 'mytracks') hint = 'No has subido nada todavía. ¡Pulsa "Upload Track"!';
    if (view === 'downloads') hint = 'No has descargado ninguna pista.';
    if (view === 'feed' && state.tab === 'following') hint = 'Sigue a gente para ver sus pistas aquí.';
    list.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-music"/></svg><p>${esc(hint)}</p></div>`;
    return;
  }
  state.queue = tracks.map(t => t.id);
  tracks.forEach(t => list.appendChild(trackCard(t)));
  if (state.current && audio && !audio.paused) markPlayingCard();
}

/* =======================================================================
   TARJETA DE PISTA
   ======================================================================= */
function trackCard(t) {
  const liked = state.likes.has(t.id);
  const reposted = state.reposts.has(t.id);
  const prof = t.profiles || {};
  const collabs = Array.isArray(t.collaborators) ? t.collaborators : [];
  const ft = collabs.length ? ` ft. ${collabs.map(c => `<a data-collab="${esc(c.id)}">${esc(c.display_name || c.username)}</a>`).join(', ')}` : '';
  const mine = t.user_id === state.user.id;
  const cov = t.cover_url ? czUrl(t.cover_url) : '';
  const card = el(`
    <div class="track ${cov ? 'has-bg' : ''}" data-id="${t.id}" ${cov ? `style="background-image:url('${cov}')"` : ''}>
      ${t._repostedBy ? `<div class="repost-badge"><svg fill="none" stroke="currentColor"><use href="#i-repeat"/></svg> Reposteado por <a data-act="repostby">${esc(t._repostedBy)}</a></div>` : ''}
      <div class="t-head">
        <div class="t-titles">
          <div class="t-title">${esc(t.title)}</div>
          <div class="t-artist">por <a data-act="profile">${esc(prof.display_name || prof.username || t.artist || 'anónimo')}</a>${verifiedBadge(prof)}${displayBadgeHtml(prof)}${ft}</div>
        </div>
        ${t.genre ? `<span class="t-genre">${esc(t.genre)}</span>` : ''}
      </div>
      <div class="wave-row">
        <button class="play-lg" data-act="play" title="Reproducir"><svg class="ci-play"><use href="#i-play"/></svg><svg class="ci-pause"><use href="#i-pause"/></svg></button>
        ${waveHTML(t)}
      </div>
      <div class="t-foot">
        <span class="time"><svg style="width:12px;height:12px;vertical-align:-1px" fill="none" stroke="currentColor"><use href="#i-headphones"/></svg> ${t.plays||0} · <svg style="width:12px;height:12px;vertical-align:-2px" fill="currentColor" stroke="none"><use href="#i-heart"/></svg> <span class="likecount">${t.likes_count||0}</span> · <svg style="width:12px;height:12px;vertical-align:-2px" fill="none" stroke="currentColor"><use href="#i-repeat"/></svg> <span class="repostcount">${t.reposts_count||0}</span> · ${fmtTime(t.duration)}</span>
        <button class="act like ${liked?'on':''}" data-act="like"><svg><use href="#i-heart"/></svg><span class="ln">${liked?'Te gusta':'Me gusta'}</span></button>
        ${mine ? '' : `<button class="act repost ${reposted?'on':''}" data-act="repost"><svg fill="none" stroke="currentColor"><use href="#i-repeat"/></svg><span class="rn">${reposted?'Reposteado':'Resubir'}</span></button>`}
        <button class="act" data-act="toggleComments"><svg><use href="#i-comment"/></svg><span class="cn">Comentar</span></button>
        <button class="act" data-act="share"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg>Compartir</button>
        <button class="act" data-act="addPlaylist"><svg fill="none" stroke="currentColor"><use href="#i-listadd"/></svg>Playlist</button>
        <button class="act" data-act="download"><svg><use href="#i-download"/></svg>Descargar</button>
        ${mine ? `<button class="act" data-act="edit"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg>Editar</button>` : ''}
        ${mine ? '' : `<button class="act" data-act="report"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg>Reportar</button>`}
        ${(mine || state.profile.is_admin) ? `<button class="act danger" data-act="delete"><svg fill="none" stroke="currentColor"><use href="#i-trash"/></svg>${mine ? 'Borrar' : 'Borrar (mod)'}</button>` : ''}
      </div>
      <div class="comments hidden" data-comments></div>
    </div>`);

  card.querySelectorAll('[data-collab]').forEach(a => a.onclick = (e) => { e.stopPropagation(); openProfile(a.dataset.collab); });
  card.addEventListener('click', (e) => handleTrackClick(e, t, card));
  return card;
}

function openEditTrack(t, card) {
  const m = openModal(`
    <div class="modal-head"><h3>Editar pista</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label>Portada</label>
        <div class="cover-pick" id="dzCover">
          <div class="cover-prev" id="coverPrev">${t.cover_url ? `<img src="${esc(t.cover_url)}" alt="" />` : `<svg width="24" height="24" fill="none" stroke="currentColor"><use href="#i-image"/></svg>`}</div>
          <div class="cover-pick-txt"><b id="coverName">Cambiar portada</b><span>Imagen cuadrada · JPG, PNG o WebP</span></div>
        </div>
        <input type="file" id="fCover" accept="image/*" hidden />
      </div>
      <div class="field"><label>Título</label><input type="text" id="eTitle" value="${esc(t.title)}" /></div>
      <div class="field"><label>Género</label><input type="text" id="eGenre" value="${esc(t.genre || '')}" /></div>
      <div class="field">
        <label>Colaboradores (ft.)</label>
        <div class="collab-chips" id="collabChips"></div>
        <div class="collab-add"><input type="text" id="collabInput" placeholder="usuario o nombre…" autocomplete="off" /><button type="button" class="btn sm" id="collabAdd">Añadir</button></div>
      </div>
      <button class="btn primary" id="eSave">Guardar cambios</button>
      <div class="auth-msg" id="eMsg"></div>
    </div>`);
  let coverFile = null;
  const fC = m.querySelector('#fCover');
  m.querySelector('#dzCover').onclick = () => fC.click();
  const setCover = (f) => { if (!f || !f.type.startsWith('image')) { toast('Selecciona una imagen'); return; } coverFile = f; m.querySelector('#coverName').textContent = f.name; m.querySelector('#coverPrev').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`; };
  fC.onchange = () => { if (fC.files[0]) setCover(fC.files[0]); };
  const collab = mountCollab(m, t.collaborators || []);
  m.querySelector('#eSave').onclick = async () => {
    const title = m.querySelector('#eTitle').value.trim();
    const genre = m.querySelector('#eGenre').value.trim();
    const eMsg = m.querySelector('#eMsg'); eMsg.className = 'auth-msg';
    if (!title) { eMsg.className = 'auth-msg error'; eMsg.textContent = 'El título no puede estar vacío.'; return; }
    const btn = m.querySelector('#eSave'); btn.disabled = true;
    try {
      let cover_url = t.cover_url;
      if (coverFile) {
        const cext = (coverFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${state.user.id}/${Date.now()}.${cext}`;
        const cu = await sb.storage.from('covers').upload(path, coverFile, { contentType: coverFile.type });
        if (cu.error) throw cu.error;
        cover_url = sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
      }
      // regenerar la onda real si la pista no la tiene (pistas antiguas)
      const patch = { title, genre: genre || null, cover_url, collaborators: collab.get() };
      if (!Array.isArray(t.waveform) || !t.waveform.length) {
        eMsg.textContent = 'Generando la onda real…';
        try { const r = await fetch(t.audio_url); const wf = await computeWaveformPeaks(await r.blob()); if (wf) patch.waveform = wf; } catch {}
      }
      const { data, error } = await sb.from('tracks').update(patch)
        .eq('id', t.id).select('*, profiles!tracks_user_id_fkey(*)').single();
      if (error) throw error;
      Object.assign(t, data);
      if (card) card.replaceWith(trackCard(t));
      m.remove(); toast('Pista actualizada ✓');
    } catch (err) { eMsg.className = 'auth-msg error'; eMsg.textContent = 'Error: ' + (err.message || err); btn.disabled = false; }
  };
}

// dibuja el waveform real (si existe) o uno de respaldo
function waveHTML(t) {
  const peaks = Array.isArray(t.waveform) && t.waveform.length ? t.waveform : waveBars(t.id, 80);
  const bars = peaks.map((h, i) => `<div class="bar" data-i="${i}" style="--h:${czNum(h)}%;--d:${((i * 37) % 23) * 0.045}s"></div>`).join('');
  return `<div class="wave" data-act="seekwave">${bars}</div>`;
}

async function handleTrackClick(e, t, card) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'play') playTrack(t);
  else if (act === 'profile') openProfile(t.user_id);
  else if (act === 'like') toggleLike(t, card);
  else if (act === 'download') downloadTrack(t);
  else if (act === 'share') shareTrack(t);
  else if (act === 'addPlaylist') openPlaylistPicker(t);
  else if (act === 'repost') toggleRepost(t, card);
  else if (act === 'repostby') { if (t._repostedById) openProfile(t._repostedById); }
  else if (act === 'delete') deleteTrack(t, card);
  else if (act === 'report') openReportModal('track', t.id, t.user_id, '“' + (t.title || 'pista') + '”');
  else if (act === 'edit') openEditTrack(t, card);
  else if (act === 'toggleComments') toggleComments(t, card);
  else if (act === 'seekwave') {
    const wave = e.target.closest('.wave');
    if (wave && state.current?.id === t.id && audio.duration) {
      const r = wave.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      audio.currentTime = pct * audio.duration;
    } else { playTrack(t); }
  }
}

/* ---- COMPARTIR ---- */
function trackShareUrl(t) { return `${location.origin}/?track=${t.id}`; }
function shareTrack(t) {
  const url = trackShareUrl(t);
  const who = t.profiles?.display_name || t.profiles?.username || t.artist || 'UnderBro';
  const title = `${t.title} — ${who}`;
  const m = openModal(`
    <div class="modal-head"><h3>Compartir pista</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="share-meta"><b>${esc(t.title)}</b><span> · ${esc(who)}</span></div>
      <div class="share-link"><input type="text" id="shareUrl" readonly value="${esc(url)}" /><button class="btn sm primary" id="copyLink">Copiar</button></div>
      <div class="share-actions">
        ${navigator.share ? `<button class="btn" id="nativeShare"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg> Compartir…</button>` : ''}
        <button class="btn" id="shareToChat"><svg fill="none" stroke="currentColor"><use href="#i-mail"/></svg> Enviar por chat</button>
      </div>
    </div>`);
  const copyBtn = m.querySelector('#copyLink');
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(url); }
    catch { const i = m.querySelector('#shareUrl'); i.select(); try { document.execCommand('copy'); } catch {} }
    copyBtn.textContent = 'Copiado ✓'; toast('Enlace copiado');
  };
  const ns = m.querySelector('#nativeShare');
  if (ns) ns.onclick = () => { navigator.share({ title, text: title, url }).catch(() => {}); };
  m.querySelector('#shareToChat').onclick = () => { m.remove(); shareToChatPicker(t); };
}
/* ---- COMPARTIR FOTO ---- */
function postShareUrl(p) { return `${location.origin}/?post=${p.id}`; }
function sharePost(p) {
  const url = postShareUrl(p);
  const who = p.profiles?.display_name || p.profiles?.username || 'UnderBro';
  const title = `Foto de ${who}`;
  const m = openModal(`
    <div class="modal-head"><h3>Compartir foto</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="share-photo-prev"><img src="${esc(p.image_url)}" alt="" /></div>
      <div class="share-link"><input type="text" id="shareUrl" readonly value="${esc(url)}" /><button class="btn sm primary" id="copyLink">Copiar</button></div>
      <div class="share-actions">
        ${navigator.share ? `<button class="btn" id="nativeShare"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg> Compartir…</button>` : ''}
        <button class="btn" id="shareToChat"><svg fill="none" stroke="currentColor"><use href="#i-mail"/></svg> Enviar por chat</button>
      </div>
    </div>`);
  const copyBtn = m.querySelector('#copyLink');
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(url); }
    catch { const i = m.querySelector('#shareUrl'); i.select(); try { document.execCommand('copy'); } catch {} }
    copyBtn.textContent = 'Copiado ✓'; toast('Enlace copiado');
  };
  const ns = m.querySelector('#nativeShare');
  if (ns) ns.onclick = () => { navigator.share({ title, text: title, url }).catch(() => {}); };
  m.querySelector('#shareToChat').onclick = () => {
    m.remove();
    openSharePicker(() => ({ body: p.caption ? p.caption.slice(0, 80) : '', attachment_type: 'image', attachment_url: p.image_url, attachment_name: 'foto' }), 'Foto enviada');
  };
}
// Selector de chat genérico para compartir: makeMessage() devuelve los campos del DM
async function openSharePicker(makeMessage, sentLabel) {
  const m = openModal(`<div class="modal-head"><h3>Enviar a…</h3><button class="close">&times;</button></div><div class="modal-body" id="shareChatBody"><div class="loading" style="padding:24px"><div class="spinner"></div></div></div>`);
  const body = m.querySelector('#shareChatBody');
  const { data } = await sb.from('follows').select('profiles!follows_following_id_fkey(*)').eq('follower_id', state.user.id);
  const people = (data || []).map(r => r.profiles).filter(Boolean);
  if (!people.length) { body.innerHTML = `<div class="empty"><p>Sigue a alguien para poder enviarle contenido por chat.</p></div>`; return; }
  body.innerHTML = '';
  people.forEach(p => {
    const row = el(`<div class="follow-row">${avatarHTML(p)}<div class="fr-info"><div class="fr-name">${esc(p.display_name || p.username)}</div><div class="fr-handle">@${esc(p.username)}</div></div><div class="fr-actions"><button class="btn sm primary" data-send>Enviar</button></div></div>`);
    row.querySelector('[data-send]').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Enviando…';
      const { error } = await sb.from('direct_messages').insert({ sender_id: state.user.id, recipient_id: p.id, ...makeMessage() });
      if (error) { toast('No se pudo enviar'); btn.disabled = false; btn.textContent = 'Enviar'; return; }
      btn.textContent = 'Enviado ✓';
      toast((sentLabel || 'Enviado') + ' a ' + (p.display_name || p.username));
    };
    body.appendChild(row);
  });
}
function shareToChatPicker(t) {
  openSharePicker(() => ({
    body: `🎵 ${t.title}`,
    attachment_type: 'track',
    attachment_url: t.audio_url,
    attachment_name: JSON.stringify({ id: t.id, title: t.title, artist: (t.profiles?.display_name || t.profiles?.username || t.artist || ''), cover_url: t.cover_url || '' }),
  }), 'Pista enviada');
}
// abrir una pista compartida por enlace (?track=ID)
async function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const trackId = params.get('track');
  const postId = params.get('post');
  const playlistId = params.get('playlist');
  if (!trackId && !postId && !playlistId) return;
  history.replaceState(null, '', location.pathname);
  if (trackId) {
    const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').eq('id', trackId).maybeSingle();
    if (data) { state.tracks = [data]; state.queue = [data.id]; playTrack(data); openNowPlaying(); }
    else toast('La pista no existe o fue eliminada');
  } else if (postId) {
    const { data } = await sb.from('posts').select('*, profiles!posts_user_id_fkey(*)').eq('id', postId).maybeSingle();
    if (data) openPostModal(data);
    else toast('La foto no existe o fue eliminada');
  } else if (playlistId) {
    openPlaylist(playlistId);
  }
}

/* ---- LIKES ---- */
async function toggleLike(t, card) {
  const btn = card.querySelector('[data-act="like"]');
  const cntEl = card.querySelector('.likecount');
  const liked = state.likes.has(t.id);
  if (liked) {
    state.likes.delete(t.id);
    t.likes_count = Math.max(0, (t.likes_count || 0) - 1);
    btn.classList.remove('on'); btn.querySelector('.ln').textContent = 'Me gusta';
    await sb.from('likes').delete().eq('track_id', t.id).eq('user_id', state.user.id);
  } else {
    state.likes.add(t.id);
    t.likes_count = (t.likes_count || 0) + 1;
    btn.classList.add('on'); btn.querySelector('.ln').textContent = 'Te gusta';
    await sb.from('likes').insert({ track_id: t.id, user_id: state.user.id });
  }
  if (cntEl) cntEl.textContent = t.likes_count;
  updateCounts();
}

/* ---- REPOST ---- */
async function toggleRepost(t, card) {
  if (typeof requireNotBanned === 'function' && !requireNotBanned()) return;
  if (t.user_id === state.user.id) { toast('No puedes repostear tu propia pista'); return; }
  const btn = card.querySelector('[data-act="repost"]');
  const cntEl = card.querySelector('.repostcount');
  const reposted = state.reposts.has(t.id);
  if (reposted) {
    state.reposts.delete(t.id);
    t.reposts_count = Math.max(0, (t.reposts_count || 0) - 1);
    if (btn) { btn.classList.remove('on'); const r = btn.querySelector('.rn'); if (r) r.textContent = 'Resubir'; }
    await sb.from('reposts').delete().eq('track_id', t.id).eq('user_id', state.user.id);
    toast('Repost quitado');
  } else {
    state.reposts.add(t.id);
    t.reposts_count = (t.reposts_count || 0) + 1;
    if (btn) { btn.classList.add('on'); const r = btn.querySelector('.rn'); if (r) r.textContent = 'Reposteado'; }
    await sb.from('reposts').insert({ track_id: t.id, user_id: state.user.id });
    toast('🔁 Reposteado a tus seguidores');
  }
  // actualizar el contador en todas las copias de la pista
  document.querySelectorAll(`.track[data-id="${t.id}"] .repostcount`).forEach(e => e.textContent = t.reposts_count);
}

/* ---- DESCARGA ---- */
async function downloadTrack(t) {
  try {
    toast('Descargando…');
    const res = await fetch(t.audio_url);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ext = (t.audio_url.split('.').pop() || 'mp3').split('?')[0];
    a.href = url; a.download = `${t.title}.${ext}`.replace(/[\\/:*?"<>|]/g,'_');
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    state.downloads.add(t.id);
    localStorage.setItem('ub_downloads', JSON.stringify([...state.downloads]));
    updateCounts();
  } catch { toast('No se pudo descargar'); }
}

/* ---- BORRAR ---- */
async function deleteTrack(t, card) {
  if (!confirm(`¿Borrar "${t.title}"? Esta acción no se puede deshacer.`)) return;
  const { error } = await sb.from('tracks').delete().eq('id', t.id);
  if (error) { toast('No se pudo borrar'); return; }
  // limpiar storage (best-effort)
  try {
    const path = storagePathFromUrl(t.audio_url, 'tracks');
    if (path) await sb.storage.from('tracks').remove([path]);
    if (t.cover_url) { const cp = storagePathFromUrl(t.cover_url, 'covers'); if (cp) await sb.storage.from('covers').remove([cp]); }
  } catch {}
  card.remove();
  toast('Pista borrada');
  updateCounts();
}
function storagePathFromUrl(url, bucket) {
  const m = url && url.split(`/object/public/${bucket}/`)[1];
  return m ? decodeURIComponent(m.split('?')[0]) : null;
}

/* ---- COMENTARIOS ---- */
async function toggleComments(t, card) {
  const box = card.querySelector('[data-comments]');
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<div class="loading" style="padding:14px"><div class="spinner"></div></div>`;
  const { data } = await sb.from('comments').select('*, profiles(*)').eq('track_id', t.id).order('created_at', { ascending: true });
  renderComments(box, t, data || []);
}
/* =======================================================================
   MENCIONES @usuario (enlazar + autocompletar)
   ======================================================================= */
function linkifyMentions(text) {
  return esc(text || '').replace(/(^|[^a-zA-Z0-9_@])@([a-zA-Z0-9_.]{2,30})/g,
    (mm, pre, name) => `${pre}<a class="mention" data-mention="${name}">@${name}</a>`);
}
async function openProfileByUsername(username) {
  const clean = String(username || '').replace(/^@/, '').replace(/\.+$/, '');
  const { data } = await sb.from('profiles').select('id').ilike('username', clean).maybeSingle();
  if (data) openProfile(data.id); else toast('Usuario @' + clean + ' no encontrado');
}
// un único listener delegado para todas las menciones
document.addEventListener('click', (e) => {
  const mEl = e.target.closest('.mention');
  if (!mEl) return;
  e.preventDefault(); e.stopPropagation();
  openProfileByUsername(mEl.dataset.mention);
});
// autocompletado al escribir @ en un input/textarea
function attachMentionAutocomplete(input) {
  if (!input || input.dataset.mentionAc) return;
  input.dataset.mentionAc = '1';
  let dd = null, reqId = 0;
  const close = () => { if (dd) { dd.remove(); dd = null; } };
  const place = () => {
    if (!dd) return;
    const r = input.getBoundingClientRect();
    dd.style.left = Math.max(8, r.left) + 'px';
    dd.style.width = Math.min(r.width, 300) + 'px';
    dd.style.bottom = (window.innerHeight - r.top + 6) + 'px';
  };
  input.addEventListener('input', async () => {
    const pos = input.selectionStart;
    const m = input.value.slice(0, pos).match(/@([a-zA-Z0-9_.]{1,30})$/);
    if (!m) { close(); return; }
    const q = m[1]; const my = ++reqId;
    const { data } = await sb.from('profiles').select('id,username,display_name,avatar_url').ilike('username', q + '%').limit(6);
    if (my !== reqId) return;
    const list = data || [];
    if (!list.length) { close(); return; }
    close();
    dd = el(`<div class="mention-dd"></div>`);
    list.forEach(u => {
      const item = el(`<div class="mention-dd-item">${avatarHTML(u, '')}<div class="mdd-txt"><b>@${esc(u.username)}</b><span>${esc(u.display_name || '')}</span></div></div>`);
      item.onmousedown = (ev) => {
        ev.preventDefault();
        const before = input.value.slice(0, pos - m[0].length);
        const after = input.value.slice(pos);
        const ins = '@' + u.username + ' ';
        input.value = before + ins + after;
        const np = (before + ins).length;
        input.setSelectionRange(np, np); input.focus(); close();
      };
      dd.appendChild(item);
    });
    document.body.appendChild(dd); place();
  });
  input.addEventListener('blur', () => setTimeout(close, 160));
  window.addEventListener('resize', place);
}

function renderComments(box, t, comments) {
  box.innerHTML = comments.map(c => {
    const canDel = c.user_id === state.user.id || state.profile.is_admin;
    return `
    <div class="comment" data-cid="${c.id}">
      <span class="c-av" data-uid="${c.user_id}">${avatarHTML(c.profiles)}</span>
      <div class="c-body">
        <div class="c-line"><b class="c-name" data-uid="${c.user_id}">${esc(c.profiles?.display_name || c.profiles?.username || 'anónimo')}</b>
        <span class="c-time">${timeAgo(c.created_at)}</span>
        ${canDel ? `<button class="c-del" data-del-comment="${c.id}" title="Borrar comentario">✕</button>` : ''}</div>
        <p>${linkifyMentions(c.body)}</p>
      </div>
    </div>`;
  }).join('') || '<p class="c-hint">Sé el primero en comentar.</p>';
  box.querySelectorAll('[data-uid]').forEach(elm => elm.onclick = (e) => { e.stopPropagation(); openProfile(elm.dataset.uid); });
  box.querySelectorAll('[data-del-comment]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-del-comment');
      const { error } = await sb.from('comments').delete().eq('id', id);
      if (error) { toast('No se pudo borrar el comentario'); return; }
      renderComments(box, t, comments.filter(x => x.id !== id));
    };
  });
  const form = el(`<form class="comment-form"><input type="text" placeholder="Añade un comentario... (@ para mencionar)" maxlength="400" required /><button class="comment-send" type="submit" aria-label="Enviar"><svg fill="none" stroke="#fff"><use href="#i-send"/></svg></button></form>`);
  attachMentionAutocomplete(form.querySelector('input'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireNotBanned()) return;
    const input = form.querySelector('input');
    const body = input.value.trim(); if (!body) return;
    input.value = '';
    const { data, error } = await sb.from('comments').insert({ track_id: t.id, user_id: state.user.id, body }).select('*, profiles(*)').single();
    if (error) { toast('No se pudo comentar'); return; }
    renderComments(box, t, [...comments, data]);
  });
  box.appendChild(form);
}

/* =======================================================================
   REPRODUCTOR
   ======================================================================= */
let audio, seeking = false;
function initPlayer() {
  audio = $('audio');
  audio.volume = parseFloat(localStorage.getItem('ub_vol') ?? '0.8');
  setVolUI(audio.volume);

  $('pPlay').onclick = togglePlay;
  $('pPrev').onclick = () => step(-1);
  $('pNext').onclick = () => step(1);

  audio.addEventListener('timeupdate', () => {
    if (seeking || !audio.duration) return;
    const pct = audio.currentTime / audio.duration;
    $('pFill').style.width = (pct*100)+'%';
    $('pKnob').style.left = (pct*100)+'%';
    $('pCur').textContent = fmtTime(audio.currentTime);
    updateCardWave(pct);
    updateNpProgress(pct);
    updateMediaPositionState();
  });
  audio.addEventListener('loadedmetadata', () => { $('pDur').textContent = fmtTime(audio.duration); if (npIsOpen()) $('npDur').textContent = fmtTime(audio.duration); updateMediaPositionState(); });
  audio.addEventListener('ended', () => step(1));
  audio.addEventListener('play', () => { setPlayIcon(true); showEq(true); markPlayingCard(); setNpPlayIcon(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
  audio.addEventListener('pause', () => { setPlayIcon(false); showEq(false); setNpPlayIcon(false); document.querySelectorAll('.track.playing, .dm-track.playing').forEach(c => c.classList.remove('playing')); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });

  // controles del sistema (pantalla de bloqueo / notificación de reproducción)
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', () => step(-1));
    ms.setActionHandler('nexttrack', () => step(1));
    try { ms.setActionHandler('seekbackward', (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); }); } catch {}
    try { ms.setActionHandler('seekforward', (d) => { if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + (d.seekOffset || 10)); }); } catch {}
    try { ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; }); } catch {}
  }

  // seek preciso (pointer events: ratón + táctil unificados) con vista previa
  const seek = $('pSeek'), fill = $('pFill'), knob = $('pKnob'), ghost = $('pGhost'), tip = $('pTip');
  const pctFromX = (clientX) => { const r = seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - r.left) / r.width)); };
  const paint = (pct) => { fill.style.width = (pct*100)+'%'; knob.style.left = (pct*100)+'%'; };
  const preview = (pct) => { ghost.style.width = (pct*100)+'%'; tip.style.left = (pct*100)+'%'; if (audio.duration) tip.textContent = fmtTime(pct*audio.duration); };
  let rafSeek = 0, pendingPct = null;
  const commitLive = () => { rafSeek = 0; if (audio.duration && pendingPct != null) audio.currentTime = pendingPct * audio.duration; };
  const queueLive = (p) => { pendingPct = p; if (!rafSeek) rafSeek = requestAnimationFrame(commitLive); };
  seek.addEventListener('pointerdown', (e) => {
    seeking = true; seek.classList.add('scrub');
    try { seek.setPointerCapture(e.pointerId); } catch {}
    const p = pctFromX(e.clientX); paint(p); preview(p); $('pCur').textContent = fmtTime(p*(audio.duration||0)); queueLive(p);
  });
  seek.addEventListener('pointermove', (e) => {
    const p = pctFromX(e.clientX); preview(p);
    if (seeking) { paint(p); $('pCur').textContent = fmtTime(p*(audio.duration||0)); queueLive(p); }
  });
  const endScrub = (e) => {
    if (!seeking) return; seeking = false; seek.classList.remove('scrub');
    try { seek.releasePointerCapture(e.pointerId); } catch {}
    const p = pctFromX(e.clientX); if (audio.duration) audio.currentTime = p * audio.duration; paint(p);
  };
  seek.addEventListener('pointerup', endScrub);
  seek.addEventListener('pointercancel', endScrub);

  // indicador del buffer cargado
  audio.addEventListener('progress', () => {
    if (audio.duration && audio.buffered.length)
      $('pBuffered').style.width = (audio.buffered.end(audio.buffered.length-1) / audio.duration * 100) + '%';
  });

  // volumen
  const vol = $('volSlider');
  const doVol = (clientX) => {
    const r = vol.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    audio.volume = v; setVolUI(v); localStorage.setItem('ub_vol', String(v));
  };
  let volDrag = false;
  vol.addEventListener('mousedown', (e) => { volDrag = true; doVol(e.clientX); });
  window.addEventListener('mousemove', (e) => { if (volDrag) doVol(e.clientX); });
  window.addEventListener('mouseup', () => { volDrag = false; });

  // teclado: espacio = play/pause · ←/→ = retroceder/avanzar (Shift = 15s)
  document.addEventListener('keydown', (e) => {
    if (!state.current || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight' && audio.duration) { e.preventDefault(); audio.currentTime = Math.min(audio.duration, audio.currentTime + (e.shiftKey ? 15 : 5)); }
    else if (e.code === 'ArrowLeft' && audio.duration) { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - (e.shiftKey ? 15 : 5)); }
  });
}
function setVolUI(v) { $('volFill').style.width = (v*100)+'%'; $('volKnob').style.left = (v*100)+'%'; }
function showEq(on) {
  const cover = $('pCover');
  let eq = cover.querySelector('.eq');
  if (on) { if (!eq) { eq = el('<div class="eq"><span></span><span></span><span></span><span></span></div>'); cover.appendChild(eq); } }
  else if (eq) eq.remove();
}
function markPlayingCard() {
  document.querySelectorAll('.track.playing, .dm-track.playing').forEach(c => c.classList.remove('playing'));
  if (!state.current?.id) return;
  // puede haber la misma pista en varias listas (p. ej. Pistas y Feats) y en el chat: marcarlas todas
  document.querySelectorAll(`.track[data-id="${state.current.id}"], .dm-track[data-track-id="${state.current.id}"]`).forEach(card => card.classList.add('playing'));
}

/* ---- Vista "Reproduciendo ahora" a pantalla completa ---- */
function initNowPlaying() {
  $('npPlay').onclick = togglePlay;
  $('npPrev').onclick = () => step(-1);
  $('npNext').onclick = () => step(1);
  $('npClose').onclick = closeNowPlaying;
  $('player').querySelector('.now').addEventListener('click', openNowPlaying);

  // seek arrastrando sobre el waveform grande
  const w = $('npWave');
  const seekW = (x) => { if (!audio.duration) return; const r = w.getBoundingClientRect(); audio.currentTime = Math.min(1, Math.max(0, (x - r.left) / r.width)) * audio.duration; };
  let wd = false;
  w.addEventListener('pointerdown', (e) => { wd = true; try { w.setPointerCapture(e.pointerId); } catch {} seekW(e.clientX); });
  w.addEventListener('pointermove', (e) => { if (wd) seekW(e.clientX); });
  w.addEventListener('pointerup', () => { wd = false; });
  w.addEventListener('pointercancel', () => { wd = false; });
}
function npIsOpen() { return $('nowPlaying').classList.contains('open'); }
function openNowPlaying() { if (!state.current) return; syncNowPlaying(); $('nowPlaying').classList.add('open'); }
function closeNowPlaying() { $('nowPlaying').classList.remove('open'); }
function setNpPlayIcon(playing) { const u = $('npPlay').querySelector('use'); if (u) u.setAttribute('href', playing ? '#i-pause' : '#i-play'); }
function syncNowPlaying() {
  const t = state.current; if (!t) return;
  $('npTitle').textContent = t.title;
  $('npArtist').textContent = t.profiles?.display_name || t.profiles?.username || t.artist || '';
  $('npCover').innerHTML = t.cover_url ? `<img src="${esc(t.cover_url)}" alt="" />` : `<svg fill="none" stroke="#fff"><use href="#i-music"/></svg>`;
  $('npBg').style.backgroundImage = t.cover_url ? `url("${esc(t.cover_url)}")` : 'none';
  const npPeaks = Array.isArray(t.waveform) && t.waveform.length ? t.waveform : waveBars(t.id, 80);
  $('npWave').innerHTML = npPeaks.map(h => `<div class="bar" style="--h:${czNum(h)}%"></div>`).join('');
  $('npCur').textContent = fmtTime(audio.currentTime);
  $('npDur').textContent = fmtTime(audio.duration || t.duration);
  setNpPlayIcon(!audio.paused);
  if (audio.duration) updateNpProgress(audio.currentTime / audio.duration);
}
function updateNpProgress(pct) {
  if (!npIsOpen()) return;
  const bars = $('npWave').querySelectorAll('.bar');
  const upto = Math.floor(pct * bars.length);
  bars.forEach((b, i) => b.classList.toggle('played', i <= upto));
  $('npCur').textContent = fmtTime(audio.currentTime);
}
function setPlayIcon(playing) {
  $('pPlay').querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
}
function togglePlay() { if (audio.paused) audio.play(); else audio.pause(); }

// metadatos para los controles del sistema (carátula, título, artista)
function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.current) return;
  const t = state.current;
  const artist = t.profiles?.display_name || t.profiles?.username || t.artist || 'UnderBro';
  const artwork = t.cover_url
    ? [96, 192, 256, 384, 512].map(s => ({ src: t.cover_url, sizes: `${s}x${s}`, type: 'image/jpeg' }))
    : [];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || 'Pista', artist, album: 'UnderBro', artwork });
  } catch {}
}
function updateMediaPositionState() {
  if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
  if (!audio || !audio.duration || !isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(Math.max(audio.currentTime, 0), audio.duration),
    });
  } catch {}
}

async function playTrack(t) {
  if (state.current?.id === t.id) { togglePlay(); return; }
  state.current = t;
  $('player').classList.remove('hidden');
  $('pTitle').textContent = t.title;
  $('pArtist').textContent = (t.profiles?.display_name || t.profiles?.username || t.artist || '');
  $('pCover').innerHTML = t.cover_url ? `<img src="${esc(t.cover_url)}" alt="" />` : `<svg width="22" height="22" fill="none" stroke="#fff" style="margin:15px"><use href="#i-music"/></svg>`;
  updateMediaSession();
  if (npIsOpen()) syncNowPlaying();
  audio.src = t.audio_url;
  try { await audio.play(); } catch {}
  // contar reproducción
  sb.rpc('increment_plays', { track: t.id }).then(() => { t.plays = (t.plays||0)+1; });
  // si no está en la cola actual, crear cola con la vista
  if (!state.queue.includes(t.id)) state.queue = [t.id];
}
async function step(dir) {
  if (!state.current) return;
  let idx = state.queue.indexOf(state.current.id);
  let nextId = state.queue[idx + dir];
  // radio / autoplay infinito: al llegar al final, cargar más y seguir
  if (!nextId && dir > 0) {
    const added = await loadRadioBatch();
    if (added) {
      idx = state.queue.indexOf(state.current.id);
      nextId = state.queue[idx + 1];
      if (added > 0 && !state._radioToasted) { state._radioToasted = true; toast('📻 Radio: seguimos con más música'); }
    }
  }
  if (nextId) { const t = state.tracks.find(x => x.id === nextId); if (t) playTrack(t); }
  else if (dir > 0) { setPlayIcon(false); }
}
// trae más pistas (mezcladas) y las añade a la cola para que la música no pare
let _radioLoading = false;
async function loadRadioBatch() {
  if (_radioLoading) return 0;
  _radioLoading = true;
  try {
    const exclude = new Set(state.queue);
    const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').order('plays', { ascending: false }).limit(80);
    let pool = (data || []).filter(t => !exclude.has(t.id));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const batch = pool.slice(0, 20);
    batch.forEach(t => { if (!state.tracks.find(x => x.id === t.id)) state.tracks.push(t); });
    state.queue.push(...batch.map(t => t.id));
    return batch.length;
  } catch (_) { return 0; }
  finally { _radioLoading = false; }
}
// inicia una sesión de radio (mezcla sin fin) desde cero
async function startRadio() {
  toast('📻 Iniciando radio…');
  const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').order('created_at', { ascending: false }).limit(80);
  let pool = (data || []).slice();
  if (!pool.length) { toast('Aún no hay pistas para la radio'); return; }
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  state.tracks = pool;
  state.queue = pool.map(t => t.id);
  state._radioToasted = false;
  playTrack(pool[0]);
  openNowPlaying();
}
function updateCardWave(pct) {
  if (!state.current?.id) return;
  // actualizar la onda en todas las copias de la pista (Pistas y Feats)
  document.querySelectorAll(`.track[data-id="${state.current.id}"]`).forEach(card => {
    const bars = card.querySelectorAll('.wave .bar');
    const upto = Math.floor(pct * bars.length);
    bars.forEach((b, i) => b.classList.toggle('played', i <= upto));
  });
}

/* =======================================================================
   SUBIR PISTA
   ======================================================================= */
function openModal(html) {
  const backdrop = el(`<div class="modal-backdrop"><div class="modal">${html}</div></div>`);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('.close')?.addEventListener('click', () => backdrop.remove());
  $('modalRoot').appendChild(backdrop);
  return backdrop;
}

// Comprime cualquier audio a MP3 en el navegador (reduce mucho el tamaño de los WAV)
async function compressAudioToMp3(file, kbps = 192, onProgress) {
  const arrayBuf = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let audioBuf;
  try { audioBuf = await ctx.decodeAudioData(arrayBuf); }
  finally { /* se cierra abajo */ }
  const channels = Math.min(2, audioBuf.numberOfChannels);
  const sampleRate = audioBuf.sampleRate;
  const enc = new window.lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const left = audioBuf.getChannelData(0);
  const right = channels > 1 ? audioBuf.getChannelData(1) : null;
  const len = left.length, blockSize = 1152, mp3Data = [];
  const to16 = (f) => { const s = Math.max(-1, Math.min(1, f)); return s < 0 ? s * 0x8000 : s * 0x7FFF; };
  for (let i = 0; i < len; i += blockSize) {
    const n = Math.min(blockSize, len - i);
    const l16 = new Int16Array(n); const r16 = right ? new Int16Array(n) : null;
    for (let j = 0; j < n; j++) { l16[j] = to16(left[i + j]); if (r16) r16[j] = to16(right[i + j]); }
    const buf = r16 ? enc.encodeBuffer(l16, r16) : enc.encodeBuffer(l16);
    if (buf.length) mp3Data.push(buf);
    if (i % (blockSize * 300) === 0) { if (onProgress) onProgress(i / len); await new Promise(r => setTimeout(r)); }
  }
  const tail = enc.flush(); if (tail.length) mp3Data.push(tail);
  try { ctx.close(); } catch {}
  if (onProgress) onProgress(1);
  const name = file.name.replace(/\.[^.]+$/, '') + '.mp3';
  return new File(mp3Data, name, { type: 'audio/mpeg' });
}

// Calcula el waveform REAL de la canción (picos RMS) para dibujarlo fielmente
async function computeWaveformPeaks(file, n = 80) {
  try {
    const buf = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const block = Math.floor(ch.length / n) || 1;
    const step = Math.max(1, Math.floor(block / 220));
    const peaks = [];
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      const start = i * block;
      for (let j = 0; j < block; j += step) { const v = ch[start + j] || 0; sum += v * v; cnt++; }
      peaks.push(Math.sqrt(sum / (cnt || 1)));
    }
    try { ctx.close(); } catch {}
    const max = Math.max(...peaks) || 1;
    // normaliza a 10..100 con una pizca de realce perceptual
    return peaks.map(p => Math.round(10 + Math.pow(p / max, 0.85) * 90));
  } catch { return null; }
}

// Selector de colaboradores reutilizable (subida y edición)
// Busca por nombre de usuario O nombre visible, con sugerencias.
function mountCollab(scope, initial = []) {
  const chips = scope.querySelector('#collabChips');
  const input = scope.querySelector('#collabInput');
  const addBtn = scope.querySelector('#collabAdd');
  let sug = scope.querySelector('#collabSug');
  if (!sug) { sug = el('<div class="collab-sug hidden" id="collabSug"></div>'); input.parentElement.appendChild(sug); }
  let list = (initial || []).slice();
  let matches = [];

  const render = () => {
    chips.innerHTML = list.map((c, i) => `<span class="chip">@${esc(c.username)}<button type="button" data-i="${i}" aria-label="quitar">&times;</button></span>`).join('');
    chips.querySelectorAll('button[data-i]').forEach(b => b.onclick = () => { list.splice(+b.dataset.i, 1); render(); });
  };
  const hideSug = () => { sug.classList.add('hidden'); sug.innerHTML = ''; matches = []; };
  const addProfile = (p) => {
    if (!p) return;
    if (p.id === state.user.id) { toast('Tú ya apareces como autor'); input.value = ''; hideSug(); return; }
    if (list.some(c => c.id === p.id)) { input.value = ''; hideSug(); return; }
    list.push({ id: p.id, username: p.username, display_name: p.display_name });
    input.value = ''; hideSug(); render();
  };
  const clean = (s) => s.trim().replace(/[,()*%:]/g, '');
  const search = async (raw) => {
    const t = clean(raw);
    if (t.length < 2) { hideSug(); return; }
    const { data } = await sb.from('profiles').select('id,username,display_name')
      .or(`username.ilike.%${t}%,display_name.ilike.%${t}%`).limit(6);
    matches = (data || []).filter(p => p.id !== state.user.id && !list.some(c => c.id === p.id));
    if (!matches.length) { sug.innerHTML = `<div class="cs-empty">Sin resultados para "${esc(t)}"</div>`; sug.classList.remove('hidden'); return; }
    sug.innerHTML = matches.map((p, i) => `
      <button type="button" class="cs-item" data-i="${i}">
        ${avatarHTML(p)}
        <span class="cs-meta"><b>${esc(p.display_name || p.username)}</b><span>@${esc(p.username)}</span></span>
      </button>`).join('');
    sug.classList.remove('hidden');
    sug.querySelectorAll('.cs-item').forEach(b => b.onclick = () => addProfile(matches[+b.dataset.i]));
  };
  let deb;
  input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => search(input.value), 250); });
  input.addEventListener('blur', () => setTimeout(hideSug, 160));

  const addBest = async () => {
    const raw = input.value.trim();
    if (!raw) return;
    // si ya hay sugerencias en pantalla, usa la primera
    if (matches.length) { addProfile(matches[0]); return; }
    // 1) coincidencia exacta por nombre de usuario
    const uname = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
    let found = null;
    if (uname) { const { data } = await sb.from('profiles').select('id,username,display_name').eq('username', uname).maybeSingle(); found = data; }
    // 2) si no, primer resultado por usuario o nombre visible
    if (!found) {
      const t = clean(raw);
      const { data } = await sb.from('profiles').select('id,username,display_name')
        .or(`username.ilike.%${t}%,display_name.ilike.%${t}%`).limit(1);
      found = (data || [])[0] || null;
    }
    if (!found) { toast('No existe ningún usuario con "' + raw + '"'); return; }
    addProfile(found);
  };
  addBtn.onclick = addBest;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addBest(); } });
  render();
  return { get: () => list };
}

function openUploadModal() {
  if (!requireNotBanned()) return;
  const m = openModal(`
    <div class="modal-head"><h3>Subir pista</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="field">
        <label>Archivo de audio</label>
        <div class="dropzone" id="dzAudio">
          <svg fill="none"><use href="#i-upload"/></svg>
          <div>Arrastra tu MP3/WAV aquí o haz clic</div>
          <div class="fname" id="audioName"></div>
        </div>
        <input type="file" id="fAudio" accept="audio/*" hidden />
      </div>
      <div class="field">
        <label>Portada (opcional)</label>
        <div class="cover-pick" id="dzCover">
          <div class="cover-prev" id="coverPrev"><svg width="24" height="24" fill="none" stroke="currentColor"><use href="#i-image"/></svg></div>
          <div class="cover-pick-txt"><b id="coverName">Añadir portada</b><span>Imagen cuadrada · JPG, PNG o WebP</span></div>
        </div>
        <input type="file" id="fCover" accept="image/*" hidden />
      </div>
      <div class="field"><label>Título</label><input type="text" id="uTitle" placeholder="Nombre de la pista" /></div>
      <div class="field"><label>Género</label><input type="text" id="uGenre" placeholder="Hip-Hop, House, Lo-Fi…" /></div>
      <div class="field">
        <label>Colaboradores (ft.)</label>
        <div class="collab-chips" id="collabChips"></div>
        <div class="collab-add"><input type="text" id="collabInput" placeholder="usuario o nombre…" autocomplete="off" /><button type="button" class="btn sm" id="collabAdd">Añadir</button></div>
      </div>
      <div class="progress-bar hidden" id="upBar"><div></div></div>
      <button class="btn primary" id="uSubmit"><svg stroke="#fff"><use href="#i-upload"/></svg> Publicar pista</button>
      <div class="auth-msg" id="uMsg"></div>
    </div>`);

  let audioFile = null, coverFile = null, duration = 0;
  const dzA = m.querySelector('#dzAudio'), fA = m.querySelector('#fAudio');
  const dzC = m.querySelector('#dzCover'), fC = m.querySelector('#fCover');

  dzA.onclick = () => fA.click();
  dzC.onclick = () => fC.click();
  fA.onchange = () => setAudio(fA.files[0]);
  const setCover = (f) => {
    if (!f || !f.type.startsWith('image')) { toast('Selecciona una imagen'); return; }
    coverFile = f;
    m.querySelector('#coverName').textContent = f.name;
    m.querySelector('#coverPrev').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`;
  };
  fC.onchange = () => { if (fC.files[0]) setCover(fC.files[0]); };
  ['dragover','dragleave','drop'].forEach(ev => dzC.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev==='dragover') dzC.classList.add('drag'); else dzC.classList.remove('drag');
    if (ev==='drop' && e.dataTransfer.files[0]) setCover(e.dataTransfer.files[0]);
  }));
  ['dragover','dragleave','drop'].forEach(ev => dzA.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev==='dragover') dzA.classList.add('drag'); else dzA.classList.remove('drag');
    if (ev==='drop' && e.dataTransfer.files[0]) setAudio(e.dataTransfer.files[0]);
  }));
  function setAudio(f) {
    if (!f || !f.type.startsWith('audio')) { toast('Selecciona un archivo de audio'); return; }
    audioFile = f;
    m.querySelector('#audioName').textContent = f.name;
    if (!m.querySelector('#uTitle').value) m.querySelector('#uTitle').value = f.name.replace(/\.[^.]+$/,'');
    const tmp = new Audio(URL.createObjectURL(f));
    tmp.addEventListener('loadedmetadata', () => { duration = tmp.duration || 0; });
  }

  const collab = mountCollab(m);

  m.querySelector('#uSubmit').onclick = async () => {
    const title = m.querySelector('#uTitle').value.trim();
    const genre = m.querySelector('#uGenre').value.trim();
    const msg = m.querySelector('#uMsg'); msg.className = 'auth-msg';
    if (!audioFile) { msg.className='auth-msg error'; msg.textContent='Selecciona un archivo de audio.'; return; }
    if (!title) { msg.className='auth-msg error'; msg.textContent='Ponle un título a tu pista.'; return; }
    const btn = m.querySelector('#uSubmit'); btn.disabled = true;
    const bar = m.querySelector('#upBar'); bar.classList.remove('hidden');
    const fill = bar.firstElementChild; fill.style.width = '15%';
    try {
      const uid = state.user.id;
      const stamp = Date.now();
      const LIMIT = 50 * 1024 * 1024;            // 50 MB (límite del bucket)
      const TARGET_KBPS = 160;                   // bitrate de streaming eficiente
      const bytesPerSec = TARGET_KBPS * 1000 / 8;
      let uploadFile = audioFile;
      const tooBig = audioFile.size > 45 * 1024 * 1024;
      // optimiza si es muy grande (WAV) o si pesa más de lo que ocuparía a 160 kbps (ahorra datos)
      const worthShrinking = duration > 0 && audioFile.size > duration * bytesPerSec * 1.2;
      if (window.lamejs && (tooBig || worthShrinking)) {
        msg.className = 'auth-msg'; msg.textContent = 'Optimizando audio… esto puede tardar unos segundos.';
        try {
          uploadFile = await compressAudioToMp3(audioFile, tooBig ? 192 : TARGET_KBPS, (p) => { fill.style.width = (8 + p * 42) + '%'; });
          if (uploadFile.size > LIMIT) uploadFile = await compressAudioToMp3(audioFile, 128, (p) => { fill.style.width = (8 + p * 42) + '%'; });
        } catch (ce) {
          if (tooBig) throw new Error('No se pudo procesar el audio. Prueba con un MP3 o un archivo más corto.');
          uploadFile = audioFile; // si falla y cabía, sube el original
        }
        if (uploadFile.size > LIMIT) throw new Error('La pista es demasiado grande. Prueba con una versión más corta.');
        // si la versión optimizada no ahorró nada, conserva el original
        if (!tooBig && uploadFile.size >= audioFile.size && audioFile.size <= LIMIT) uploadFile = audioFile;
        msg.textContent = '';
      } else if (tooBig) {
        throw new Error('No se pudo cargar el optimizador. Recarga la página e inténtalo de nuevo.');
      }
      const ext = (uploadFile.name.split('.').pop() || 'mp3').toLowerCase();
      const audioPath = `${uid}/${stamp}.${ext}`;
      const up = await sb.storage.from('tracks').upload(audioPath, uploadFile, { contentType: uploadFile.type || 'audio/mpeg', upsert: false });
      if (up.error) throw up.error;
      fill.style.width = '60%';
      const audioUrl = sb.storage.from('tracks').getPublicUrl(audioPath).data.publicUrl;

      let coverUrl = null;
      if (coverFile) {
        const cext = (coverFile.name.split('.').pop() || 'jpg').toLowerCase();
        const coverPath = `${uid}/${stamp}.${cext}`;
        const cu = await sb.storage.from('covers').upload(coverPath, coverFile, { contentType: coverFile.type, upsert: false });
        if (!cu.error) coverUrl = sb.storage.from('covers').getPublicUrl(coverPath).data.publicUrl;
      }
      fill.style.width = '80%';

      const waveform = await computeWaveformPeaks(uploadFile);
      fill.style.width = '90%';

      const { error } = await sb.from('tracks').insert({
        user_id: uid, title, genre: genre || null,
        artist: state.profile.display_name || state.profile.username,
        audio_url: audioUrl, cover_url: coverUrl, duration: Math.round(duration),
        waveform, collaborators: collab.get(),
      });
      if (error) throw error;
      fill.style.width = '100%';
      toast('¡Pista publicada! 🎵');
      m.remove();
      updateCounts();
      switchView('mytracks');
    } catch (err) {
      console.error(err);
      msg.className = 'auth-msg error';
      msg.textContent = 'Error al subir: ' + (err.message || err);
      btn.disabled = false;
    }
  };
}

/* =======================================================================
   POSTS / FOTOS
   ======================================================================= */
// Selector: ¿subir una pista o una foto?
function openCreateChooser() {
  if (!requireNotBanned()) return;
  const m = openModal(`
    <div class="modal-head"><h3>¿Qué quieres compartir?</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="create-choices">
        <button class="create-choice" id="chTrack"><span class="cc-ic"><svg fill="none" stroke="#fff"><use href="#i-music"/></svg></span><b>Pista</b><span class="cc-sub">Sube una canción o beat</span></button>
        <button class="create-choice" id="chPhoto"><span class="cc-ic"><svg fill="none" stroke="#fff"><use href="#i-camera"/></svg></span><b>Foto</b><span class="cc-sub">Publica una imagen</span></button>
      </div>
    </div>`);
  m.querySelector('#chTrack').onclick = () => { m.remove(); openUploadModal(); };
  m.querySelector('#chPhoto').onclick = () => { m.remove(); openPhotoUploadModal(); };
}

function openPhotoUploadModal() {
  if (!requireNotBanned()) return;
  const m = openModal(`
    <div class="modal-head"><h3>Nueva foto</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="field">
        <label>Foto</label>
        <div class="dropzone" id="dzPhoto">
          <svg fill="none"><use href="#i-image"/></svg>
          <div>Arrastra una imagen aquí o haz clic</div>
          <div class="fname" id="photoName"></div>
        </div>
        <div class="post-photo-prev hidden" id="photoPrev"></div>
        <input type="file" id="fPhoto" accept="image/*" hidden />
      </div>
      <div class="field"><label>Pie de foto (opcional)</label><textarea id="pCaption" maxlength="600" placeholder="Escribe algo sobre tu foto…"></textarea></div>
      <div class="progress-bar hidden" id="ppBar"><div></div></div>
      <button class="btn primary" id="pSubmit"><svg stroke="#fff"><use href="#i-upload"/></svg> Publicar foto</button>
      <div class="auth-msg" id="ppMsg"></div>
    </div>`);

  let photoFile = null;
  const dz = m.querySelector('#dzPhoto'), fP = m.querySelector('#fPhoto'), prev = m.querySelector('#photoPrev');
  const setPhoto = (f) => {
    if (!f || !f.type.startsWith('image')) { toast('Selecciona una imagen'); return; }
    if (f.size > 10 * 1024 * 1024) { toast('La imagen no puede superar los 10 MB'); return; }
    photoFile = f;
    prev.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`;
    prev.classList.remove('hidden');
    m.querySelector('#photoName').textContent = f.name;
  };
  dz.onclick = () => fP.click();
  fP.onchange = () => { if (fP.files[0]) setPhoto(fP.files[0]); };
  ['dragover','dragleave','drop'].forEach(ev => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'dragover') dz.classList.add('drag'); else dz.classList.remove('drag');
    if (ev === 'drop' && e.dataTransfer.files[0]) setPhoto(e.dataTransfer.files[0]);
  }));

  m.querySelector('#pSubmit').onclick = async () => {
    const caption = m.querySelector('#pCaption').value.trim();
    const msg = m.querySelector('#ppMsg'); msg.className = 'auth-msg';
    if (!photoFile) { msg.className = 'auth-msg error'; msg.textContent = 'Selecciona una imagen.'; return; }
    const btn = m.querySelector('#pSubmit'); btn.disabled = true;
    const bar = m.querySelector('#ppBar'); bar.classList.remove('hidden');
    const fill = bar.firstElementChild; fill.style.width = '20%';
    try {
      const uid = state.user.id;
      const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${uid}/${Date.now()}.${ext}`;
      const up = await sb.storage.from('posts').upload(path, photoFile, { contentType: photoFile.type, upsert: false });
      if (up.error) throw up.error;
      fill.style.width = '70%';
      const image_url = sb.storage.from('posts').getPublicUrl(path).data.publicUrl;
      const { error } = await sb.from('posts').insert({ user_id: uid, image_url, caption });
      if (error) throw error;
      fill.style.width = '100%';
      toast('¡Foto publicada! 📸');
      m.remove();
      switchView('posts');
    } catch (err) {
      console.error(err);
      msg.className = 'auth-msg error';
      msg.textContent = 'Error al subir: ' + (err.message || err);
      btn.disabled = false;
    }
  };
}

async function fetchPosts({ userId = null, limit = 50 } = {}) {
  let q = sb.from('posts').select('*, profiles!posts_user_id_fkey(*)');
  if (userId) q = q.eq('user_id', userId);
  q = q.order('created_at', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function renderPosts() {
  setActiveNav('posts');
  const main = $('main');
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = `
    <div class="main-head">
      <div><h2>Fotos</h2><div class="sub">Comparte momentos con la comunidad</div></div>
      <button class="btn primary" id="newPostBtn"><svg stroke="#fff"><use href="#i-camera"/></svg> Nueva foto</button>
    </div>
    <div id="postList" class="post-list"><div class="loading"><div class="spinner"></div></div></div>`;
  $('newPostBtn').onclick = openPhotoUploadModal;

  let posts = [];
  try { posts = await fetchPosts(); }
  catch (err) { console.error(err); toast('Error al cargar las fotos'); }
  posts = (posts || []).filter(p => !isHidden(p.user_id));

  const list = $('postList'); list.innerHTML = '';
  if (!posts.length) {
    list.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-camera"/></svg><p>Todavía no hay fotos. ¡Pulsa "Nueva foto" y sé el primero!</p></div>`;
    return;
  }
  // qué fotos me gustan (entre las visibles)
  let likedSet = new Set();
  try {
    const ids = posts.map(p => p.id);
    const { data } = await sb.from('post_likes').select('post_id').eq('user_id', state.user.id).in('post_id', ids);
    likedSet = new Set((data || []).map(r => r.post_id));
  } catch {}
  posts.forEach(p => list.appendChild(postCard(p, likedSet.has(p.id))));
}

function postCard(p, liked) {
  const prof = p.profiles || {};
  const mine = p.user_id === state.user.id;
  const card = el(`
    <div class="track post" data-id="${p.id}">
      <div class="post-head">
        <span class="post-av" data-act="profile">${avatarHTML(prof)}</span>
        <div class="post-who">
          <b data-act="profile">${esc(prof.display_name || prof.username || 'anónimo')}</b>
          <span class="post-time">${timeAgo(p.created_at)}</span>
        </div>
        <div class="post-tools">
          ${mine ? `<button class="post-tool" data-act="edit" title="Editar pie de foto"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg></button>` : ''}
          ${!mine ? `<button class="post-tool" data-act="report" title="Reportar publicación"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg></button>` : ''}
          ${(mine || state.profile.is_admin) ? `<button class="post-tool danger" data-act="delete" title="Borrar publicación"><svg fill="none" stroke="currentColor"><use href="#i-trash"/></svg></button>` : ''}
        </div>
      </div>
      <div class="post-img"><img src="${esc(p.image_url)}" alt="" loading="lazy" data-act="zoom" /></div>
      ${p.caption ? `<div class="post-caption"><b data-act="profile">@${esc(prof.username || '')}</b> ${linkifyMentions(p.caption)}</div>` : ''}
      <div class="t-foot">
        <span class="time"><svg style="width:12px;height:12px;vertical-align:-2px" fill="currentColor" stroke="none"><use href="#i-heart"/></svg> <span class="likecount">${p.likes_count || 0}</span></span>
        <button class="act like ${liked ? 'on' : ''}" data-act="like"><svg><use href="#i-heart"/></svg><span class="ln">${liked ? 'Te gusta' : 'Me gusta'}</span></button>
        <button class="act" data-act="toggleComments"><svg><use href="#i-comment"/></svg>Comentar</button>
        <button class="act" data-act="share"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg>Compartir</button>
      </div>
      <div class="comments hidden" data-comments></div>
    </div>`);
  card.addEventListener('click', (e) => handlePostClick(e, p, card));
  return card;
}

function handlePostClick(e, p, card) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'profile') openProfile(p.user_id);
  else if (act === 'like') togglePostLike(p, card);
  else if (act === 'edit') openEditPost(p, card);
  else if (act === 'delete') deletePost(p, card);
  else if (act === 'report') openReportModal('post', p.id, p.user_id, 'esta publicación');
  else if (act === 'toggleComments') togglePostComments(p, card);
  else if (act === 'share') sharePost(p);
  else if (act === 'zoom') openImageViewer(p.image_url);
}

// Editar el pie de foto de una publicación propia
function openEditPost(p, card) {
  const m = openModal(`
    <div class="modal-head"><h3>Editar publicación</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="post-photo-prev" style="margin-top:0"><img src="${esc(p.image_url)}" alt="" /></div>
      <div class="field" style="margin-top:12px"><label>Pie de foto</label><textarea id="epCaption" maxlength="600" placeholder="Escribe algo sobre tu foto…">${esc(p.caption || '')}</textarea></div>
      <button class="btn primary" id="epSave">Guardar cambios</button>
      <div class="auth-msg" id="epMsg"></div>
    </div>`);
  setTimeout(() => m.querySelector('#epCaption')?.focus(), 60);
  m.querySelector('#epSave').onclick = async () => {
    const caption = m.querySelector('#epCaption').value.trim();
    const msg = m.querySelector('#epMsg'); msg.className = 'auth-msg';
    const btn = m.querySelector('#epSave'); btn.disabled = true;
    try {
      const { data, error } = await sb.from('posts').update({ caption }).eq('id', p.id).select('*, profiles!posts_user_id_fkey(*)').single();
      if (error) throw error;
      Object.assign(p, data);
      if (card && card.isConnected) {
        const liked = card.querySelector('[data-act="like"]')?.classList.contains('on');
        card.replaceWith(postCard(p, !!liked));
      }
      m.remove();
      toast('Publicación actualizada ✓');
    } catch (err) {
      msg.className = 'auth-msg error';
      msg.textContent = 'Error: ' + (err.message || err);
      btn.disabled = false;
    }
  };
}

async function togglePostLike(p, card) {
  const btn = card.querySelector('[data-act="like"]');
  const cntEl = card.querySelector('.likecount');
  const liked = btn.classList.contains('on');
  if (liked) {
    p.likes_count = Math.max(0, (p.likes_count || 0) - 1);
    btn.classList.remove('on'); btn.querySelector('.ln').textContent = 'Me gusta';
    await sb.from('post_likes').delete().eq('post_id', p.id).eq('user_id', state.user.id);
  } else {
    p.likes_count = (p.likes_count || 0) + 1;
    btn.classList.add('on'); btn.querySelector('.ln').textContent = 'Te gusta';
    await sb.from('post_likes').insert({ post_id: p.id, user_id: state.user.id });
  }
  if (cntEl) cntEl.textContent = p.likes_count;
}

async function deletePost(p, card) {
  if (!confirm('¿Borrar esta publicación? No se puede deshacer.')) return;
  const { error } = await sb.from('posts').delete().eq('id', p.id);
  if (error) { toast('No se pudo borrar'); return; }
  try { const path = storagePathFromUrl(p.image_url, 'posts'); if (path) await sb.storage.from('posts').remove([path]); } catch {}
  const modal = card.closest('.modal-backdrop');
  card.remove();
  document.querySelector(`.pg-item[data-id="${p.id}"]`)?.remove();
  if (modal) modal.remove();
  toast('Publicación borrada');
}

// Cuadrícula de fotos en el perfil (estilo Instagram)
async function loadProfileEvents(userId, container) {
  container.innerHTML = `<div class="loading" style="padding:24px"><div class="spinner"></div></div>`;
  const [createdRes, savedRes] = await Promise.all([
    sb.from('events').select('*, profiles!events_user_id_fkey(*)').eq('user_id', userId).order('starts_at', { ascending: false }),
    sb.from('event_saves').select('events(*, profiles!events_user_id_fkey(*))').eq('user_id', userId).order('created_at', { ascending: false }),
  ]);
  const created = createdRes.data || [];
  const createdIds = new Set(created.map(e => e.id));
  const saved = (savedRes.data || []).map(r => r.events).filter(e => e && !createdIds.has(e.id));
  if (!created.length && !saved.length) {
    container.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-calendar"/></svg><p>Sin eventos todavía.</p></div>`;
    return;
  }
  container.innerHTML = '';
  if (created.length) {
    container.appendChild(el(`<div class="prof-ev-head">🎤 Organiza</div>`));
    const w = el(`<div class="ev-list"></div>`); created.forEach(ev => w.appendChild(eventCard(ev))); container.appendChild(w);
  }
  if (saved.length) {
    container.appendChild(el(`<div class="prof-ev-head">🎟️ Va a ir</div>`));
    const w = el(`<div class="ev-list"></div>`); saved.forEach(ev => w.appendChild(eventCard(ev))); container.appendChild(w);
  }
}

async function loadProfilePosts(userId, grid) {
  grid.innerHTML = `<div class="loading" style="grid-column:1/-1"><div class="spinner"></div></div>`;
  let posts = [];
  try { posts = await fetchPosts({ userId }); } catch (e) { console.error(e); }
  if (!posts.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><svg fill="none"><use href="#i-camera"/></svg><p>Sin fotos todavía.</p></div>`;
    return;
  }
  grid.innerHTML = '';
  posts.forEach(p => {
    const item = el(`
      <div class="pg-item" data-id="${p.id}">
        <img src="${esc(p.image_url)}" alt="" loading="lazy" />
        <div class="pg-stats"><span><svg viewBox="0 0 24 24"><use href="#i-heart"/></svg> ${p.likes_count || 0}</span></div>
      </div>`);
    item.onclick = () => openPostModal(p);
    grid.appendChild(item);
  });
}

// Abre una publicación a tamaño completo (con likes y comentarios)
async function openPostModal(p) {
  let liked = false;
  try {
    const { data } = await sb.from('post_likes').select('post_id').eq('post_id', p.id).eq('user_id', state.user.id).maybeSingle();
    liked = !!data;
  } catch {}
  const m = openModal(`<div class="modal-head"><h3>Publicación</h3><button class="close">&times;</button></div><div class="modal-body" id="postModalBody"></div>`);
  m.querySelector('#postModalBody').appendChild(postCard(p, liked));
}

async function togglePostComments(p, card) {
  const box = card.querySelector('[data-comments]');
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<div class="loading" style="padding:14px"><div class="spinner"></div></div>`;
  const { data } = await sb.from('post_comments').select('*, profiles!post_comments_user_id_fkey(*)').eq('post_id', p.id).order('created_at', { ascending: true });
  renderPostComments(box, p, data || []);
}

function renderPostComments(box, p, comments) {
  box.innerHTML = comments.map(c => {
    const canDel = c.user_id === state.user.id || state.profile.is_admin;
    return `
    <div class="comment" data-cid="${c.id}">
      <span class="c-av" data-uid="${c.user_id}">${avatarHTML(c.profiles)}</span>
      <div class="c-body">
        <div class="c-line"><b class="c-name" data-uid="${c.user_id}">${esc(c.profiles?.display_name || c.profiles?.username || 'anónimo')}</b>
        <span class="c-time">${timeAgo(c.created_at)}</span>
        ${canDel ? `<button class="c-del" data-del-comment="${c.id}" title="Borrar comentario">✕</button>` : ''}</div>
        <p>${linkifyMentions(c.body)}</p>
      </div>
    </div>`;
  }).join('') || '<p class="c-hint">Sé el primero en comentar.</p>';
  box.querySelectorAll('[data-uid]').forEach(elm => elm.onclick = (e) => { e.stopPropagation(); openProfile(elm.dataset.uid); });
  box.querySelectorAll('[data-del-comment]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-del-comment');
      const { error } = await sb.from('post_comments').delete().eq('id', id);
      if (error) { toast('No se pudo borrar el comentario'); return; }
      renderPostComments(box, p, comments.filter(x => x.id !== id));
    };
  });
  const form = el(`<form class="comment-form"><input type="text" placeholder="Añade un comentario... (@ para mencionar)" maxlength="400" required /><button class="comment-send" type="submit" aria-label="Enviar"><svg fill="none" stroke="#fff"><use href="#i-send"/></svg></button></form>`);
  attachMentionAutocomplete(form.querySelector('input'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireNotBanned()) return;
    const input = form.querySelector('input');
    const body = input.value.trim(); if (!body) return;
    input.value = '';
    const { data, error } = await sb.from('post_comments').insert({ post_id: p.id, user_id: state.user.id, body }).select('*, profiles!post_comments_user_id_fkey(*)').single();
    if (error) { toast('No se pudo comentar'); return; }
    renderPostComments(box, p, [...comments, data]);
  });
  box.appendChild(form);
}

/* =======================================================================
   PERFIL
   ======================================================================= */
// saneamiento de la personalización (evita inyección en estilos/enlaces)
function czColor(c) { return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : ''; }
function czUrl(u) { return (typeof u === 'string') ? u.replace(/["')\\<>]/g, '') : ''; }
function czNum(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }
function czPos(s) { return /^\d{1,3}% \d{1,3}%$/.test(s || '') ? s : ''; }
function czZoom(v) { const n = Number(v); return (Number.isFinite(n) && n >= 1 && n <= 3) ? n : 1; }
function parsePos(s) { const m = /^(\d{1,3})% (\d{1,3})%$/.exec(s || ''); return m ? { x: Math.min(100, +m[1]), y: Math.min(100, +m[2]) } : { x: 50, y: 50 }; }
// selector de encuadre: arrastra para mover + control para acercar (zoom), con vista previa real
function openFramePicker(imgUrl, mode, initial, onSave) {
  const pos = parsePos(initial && initial.pos);
  let zoom = czZoom(initial && initial.zoom);
  const m = openModal(`
    <div class="modal-head"><h3>Ajustar encuadre</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <p class="dash-note" style="margin-bottom:12px">Arrastra para mover · usa el control para acercar.</p>
      <div class="frame-pick ${mode === 'avatar' ? 'is-avatar' : 'is-banner'}" id="framePick"><img id="frameImg" src="${imgUrl}" alt="" /></div>
      <div class="frame-zoom"><svg fill="none" stroke="currentColor"><use href="#i-search"/></svg><input type="range" id="frameZoom" min="1" max="3" step="0.01" value="${zoom}" /></div>
      <button class="btn primary" id="frameSave" style="width:100%;margin-top:12px">Usar este encuadre</button>
    </div>`);
  const box = m.querySelector('#framePick'), img = m.querySelector('#frameImg');
  const apply = () => { img.style.objectPosition = `${pos.x}% ${pos.y}%`; img.style.transform = `scale(${zoom})`; };
  apply();
  let dragging = false, sx = 0, sy = 0, spx = 0, spy = 0;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  box.addEventListener('pointerdown', (e) => { dragging = true; sx = e.clientX; sy = e.clientY; spx = pos.x; spy = pos.y; try { box.setPointerCapture(e.pointerId); } catch (_) {} });
  box.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = box.getBoundingClientRect();
    pos.x = clamp(spx - (e.clientX - sx) / r.width * 100);
    pos.y = clamp(spy - (e.clientY - sy) / r.height * 100);
    apply();
  });
  const stop = () => { dragging = false; };
  box.addEventListener('pointerup', stop);
  box.addEventListener('pointercancel', stop);
  m.querySelector('#frameZoom').oninput = (e) => { zoom = czZoom(parseFloat(e.target.value)); apply(); };
  m.querySelector('#frameSave').onclick = () => { onSave({ pos: `${Math.round(pos.x)}% ${Math.round(pos.y)}%`, zoom: Math.round(zoom * 100) / 100 }); m.remove(); };
}
function czHref(u) { if (typeof u !== 'string' || !u) return '#'; return /^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/+/, ''); }
function bgStyle(theme) {
  const bg = (theme && theme.bg) ? theme.bg : {};
  if (bg.type === 'image' && czUrl(bg.image)) return `background-image:linear-gradient(rgba(244,247,251,.5),rgba(238,241,246,.68)),url('${czUrl(bg.image)}');background-size:cover;background-position:center;`;
  if (bg.type === 'solid' && czColor(bg.c1)) return `background:${czColor(bg.c1)};`;
  if (bg.type === 'gradient' && (czColor(bg.c1) || czColor(bg.c2))) return `background:linear-gradient(160deg, ${czColor(bg.c1) || '#f3f6fb'}, ${czColor(bg.c2) || '#e0e6f0'});`;
  return '';
}

const LINK_TYPES = ['Instagram', 'YouTube', 'Spotify', 'SoundCloud', 'TikTok', 'X / Twitter', 'Sitio web', 'Otro'];

// fuentes disponibles (Google Fonts, se cargan bajo demanda)
const FONTS = {
  'Sistema': '',
  'Poppins': 'Poppins:wght@500;700',
  'Montserrat': 'Montserrat:wght@600;800',
  'Bebas Neue': 'Bebas+Neue',
  'Pacifico': 'Pacifico',
  'Lobster': 'Lobster',
  'Orbitron': 'Orbitron:wght@600;800',
  'Righteous': 'Righteous',
  'Caveat': 'Caveat:wght@600;700',
};
const _fontsLoaded = new Set();
function loadFont(name) {
  const spec = FONTS[name];
  if (!spec || _fontsLoaded.has(name)) return;
  _fontsLoaded.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}
const EFFECTS = { 'none': 'Ninguno', 'aurora': 'Aurora', 'stars': 'Estrellas', 'notes': 'Notas musicales' };
const GLOWS = { 'none': 'Ninguno', 'soft': 'Suave', 'neon': 'Neón' };
const CARD_STYLES = { 'default': 'Normal', 'glass': 'Cristal', 'dark': 'Oscuro', 'neon': 'Neón' };
function buildEffect(kind) {
  const fx = document.createElement('div');
  fx.className = 'pfx pfx-' + kind;
  if (kind === 'stars') {
    for (let i = 0; i < 40; i++) { const s = document.createElement('i'); s.style.left = (Math.random()*100)+'%'; s.style.top = (Math.random()*100)+'%'; s.style.animationDelay = (Math.random()*3)+'s'; s.style.setProperty('--sz', (1+Math.random()*2.4).toFixed(1)+'px'); fx.appendChild(s); }
  } else if (kind === 'notes') {
    const g = ['♪','♫','♩','✦','♬'];
    for (let i = 0; i < 18; i++) { const s = document.createElement('i'); s.textContent = g[i % g.length]; s.style.left = (Math.random()*100)+'%'; s.style.animationDelay = (Math.random()*9)+'s'; s.style.animationDuration = (8+Math.random()*8)+'s'; s.style.fontSize = (12+Math.random()*18)+'px'; fx.appendChild(s); }
  } else if (kind === 'aurora') {
    fx.innerHTML = '<span></span><span></span><span></span>';
  }
  return fx;
}

function openProfileCustomizer() {
  const t = (state.profile.theme && typeof state.profile.theme === 'object') ? JSON.parse(JSON.stringify(state.profile.theme)) : {};
  t.bg = t.bg || { type: 'gradient', c1: '#eef3fb', c2: '#e2e8f5' };
  let links = Array.isArray(t.links) ? t.links.slice() : [];
  const m = openModal(`
    <div class="modal-head"><h3>Personalizar perfil</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label>Banner (cabecera)</label>
        <div class="cover-pick" id="bannerPick">
          <div class="cover-prev cz-banner" id="bannerPrev">${t.banner ? `<img src="${esc(t.banner)}" alt="" ${czPos(t.bannerPos) ? `style="object-position:${czPos(t.bannerPos)}"` : ''} />` : `<svg width="22" height="22" fill="none" stroke="currentColor"><use href="#i-image"/></svg>`}</div>
          <div class="cover-pick-txt"><b id="bannerName">Subir banner</b><span>Imagen ancha (16:9)</span></div>
        </div>
        <input type="file" id="bannerFile" accept="image/*" hidden />
        <button type="button" class="btn sm" id="bannerFrame" style="margin-top:6px"><svg fill="none" stroke="currentColor"><use href="#i-image"/></svg> Ajustar encuadre</button>
      </div>
      <div class="field"><label>Color de acento</label><div class="bg-row"><input type="color" id="thAccent" value="${czColor(t.accent) || '#3e57fc'}"><span class="sub">Tiñe tu nombre, botones y enlaces</span></div></div>
      <div class="field"><label>Fuente</label><select class="cz-select" id="thFont">${Object.keys(FONTS).map(f => `<option>${f}</option>`).join('')}</select></div>
      <div class="field"><label>Frase destacada</label><input type="text" id="thTagline" maxlength="140" placeholder="Una frase que te represente" value="${esc(t.tagline || '')}" /></div>
      <div class="field"><label>Fondo del perfil</label>
        <select class="cz-select" id="bgType">
          <option value="gradient">Degradado</option>
          <option value="solid">Color sólido</option>
          <option value="image">Imagen</option>
        </select>
        <div class="bg-row" id="bgColors"><input type="color" id="bgC1" value="${czColor(t.bg.c1) || '#eef3fb'}"><input type="color" id="bgC2" value="${czColor(t.bg.c2) || '#e2e8f5'}"></div>
        <label id="bgAnimRow" style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:12.5px"><input type="checkbox" id="bgAnim" style="width:auto" /> Degradado animado</label>
        <div class="cover-pick" id="bgPick" style="margin-top:8px;display:none">
          <div class="cover-prev" id="bgPrev">${czUrl(t.bg.image) ? `<img src="${esc(t.bg.image)}" alt="" />` : `<svg width="22" height="22" fill="none" stroke="currentColor"><use href="#i-image"/></svg>`}</div>
          <div class="cover-pick-txt"><b id="bgName">Subir imagen de fondo</b></div>
        </div>
        <input type="file" id="bgFile" accept="image/*" hidden />
      </div>
      <div class="field"><label>Brillo (glow)</label><select class="cz-select" id="thGlow">${Object.entries(GLOWS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Efecto animado</label><select class="cz-select" id="thEffect">${Object.entries(EFFECTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Estilo de tarjetas</label><select class="cz-select" id="thCards">${Object.entries(CARD_STYLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Enlaces / redes</label>
        <div id="linkList"></div>
        <div class="link-add">
          <select id="linkType">${LINK_TYPES.map(x => `<option>${x}</option>`).join('')}</select>
          <input type="text" id="linkUrl" placeholder="https://..." />
          <button type="button" class="btn sm" id="linkAdd">Añadir</button>
        </div>
      </div>
      <button class="btn primary" id="thSave">Guardar perfil</button>
      <div class="auth-msg" id="thMsg"></div>
    </div>`);

  let bannerFile = null, bgFile = null, bannerPos = czPos(t.bannerPos) || '', bannerZoom = czZoom(t.bannerZoom);
  const bannerInput = m.querySelector('#bannerFile'), bgInput = m.querySelector('#bgFile');
  m.querySelector('#bannerPick').onclick = () => bannerInput.click();
  bannerInput.onchange = () => { const f = bannerInput.files[0]; if (!f || !f.type.startsWith('image')) return; bannerFile = f; bannerPos = ''; bannerZoom = 1; m.querySelector('#bannerPrev').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`; m.querySelector('#bannerName').textContent = f.name; };
  m.querySelector('#bannerFrame').onclick = () => {
    const imgUrl = bannerFile ? URL.createObjectURL(bannerFile) : (t.banner ? czUrl(t.banner) : '');
    if (!imgUrl) { toast('Sube primero un banner'); return; }
    openFramePicker(imgUrl, 'banner', { pos: bannerPos || '50% 50%', zoom: bannerZoom }, ({ pos, zoom }) => { bannerPos = pos; bannerZoom = zoom; const img = m.querySelector('#bannerPrev img'); if (img) { img.style.objectPosition = pos; img.style.transform = `scale(${zoom})`; } });
  };
  m.querySelector('#bgPick').onclick = () => bgInput.click();
  bgInput.onchange = () => { const f = bgInput.files[0]; if (!f || !f.type.startsWith('image')) return; bgFile = f; m.querySelector('#bgPrev').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`; m.querySelector('#bgName').textContent = f.name; };

  const bgType = m.querySelector('#bgType');
  bgType.value = t.bg.type || 'gradient';
  const syncBgType = () => {
    m.querySelector('#bgColors').style.display = (bgType.value === 'image') ? 'none' : 'flex';
    m.querySelector('#bgC2').style.display = (bgType.value === 'gradient') ? '' : 'none';
    m.querySelector('#bgPick').style.display = (bgType.value === 'image') ? 'flex' : 'none';
  };
  bgType.onchange = syncBgType; syncBgType();

  m.querySelector('#thFont').value = (t.font && FONTS[t.font]) ? t.font : 'Sistema';
  m.querySelector('#thGlow').value = GLOWS[t.glow] ? t.glow : 'none';
  m.querySelector('#thEffect').value = EFFECTS[t.effect] ? t.effect : 'none';
  m.querySelector('#thCards').value = CARD_STYLES[t.cards] ? t.cards : 'default';
  m.querySelector('#bgAnim').checked = !!t.bg.animated;
  const syncAnim = () => { m.querySelector('#bgAnimRow').style.display = (bgType.value === 'gradient') ? 'flex' : 'none'; };
  bgType.addEventListener('change', syncAnim); syncAnim();
  // previsualizar la fuente al elegirla
  m.querySelector('#thFont').addEventListener('change', (e) => loadFont(e.target.value));

  const renderLinks = () => {
    const box = m.querySelector('#linkList');
    box.innerHTML = links.map((l, i) => `<div class="link-row"><span class="lr-label">${esc(l.label)}</span><span class="lr-url">${esc(l.url)}</span><button type="button" data-i="${i}">&times;</button></div>`).join('');
    box.querySelectorAll('button[data-i]').forEach(b => b.onclick = () => { links.splice(+b.dataset.i, 1); renderLinks(); });
  };
  renderLinks();
  m.querySelector('#linkAdd').onclick = () => {
    const label = m.querySelector('#linkType').value;
    const url = m.querySelector('#linkUrl').value.trim();
    if (!url) return;
    if (links.length >= 8) { toast('Máximo 8 enlaces'); return; }
    links.push({ label, url });
    m.querySelector('#linkUrl').value = '';
    renderLinks();
  };

  m.querySelector('#thSave').onclick = async () => {
    const msg = m.querySelector('#thMsg'); msg.className = 'auth-msg';
    const btn = m.querySelector('#thSave'); btn.disabled = true;
    msg.textContent = 'Guardando…';
    try {
      const uid = state.user.id;
      const theme = {
        accent: m.querySelector('#thAccent').value,
        banner: t.banner || null,
        bannerPos: bannerPos || null,
        bannerZoom: bannerZoom > 1 ? bannerZoom : null,
        avatarPos: czPos(t.avatarPos) || null,
        avatarZoom: czZoom(t.avatarZoom) > 1 ? czZoom(t.avatarZoom) : null,
        bg: { type: bgType.value, c1: m.querySelector('#bgC1').value, c2: m.querySelector('#bgC2').value, image: t.bg.image || null, animated: m.querySelector('#bgAnim').checked },
        links: links.slice(0, 8),
        font: m.querySelector('#thFont').value,
        tagline: m.querySelector('#thTagline').value.trim().slice(0, 140),
        glow: m.querySelector('#thGlow').value,
        effect: m.querySelector('#thEffect').value,
        cards: m.querySelector('#thCards').value,
      };
      if (bannerFile) {
        const ext = (bannerFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${uid}/banner_${Date.now()}.${ext}`;
        const up = await sb.storage.from('avatars').upload(path, bannerFile, { contentType: bannerFile.type });
        if (up.error) throw up.error;
        theme.banner = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
      if (bgFile) {
        const ext = (bgFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${uid}/bg_${Date.now()}.${ext}`;
        const up = await sb.storage.from('avatars').upload(path, bgFile, { contentType: bgFile.type });
        if (up.error) throw up.error;
        theme.bg.image = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
      const { data, error } = await sb.from('profiles').update({ theme }).eq('id', uid).select().single();
      if (error) throw error;
      state.profile = data;
      m.remove();
      toast('Perfil personalizado ✓');
      openProfile(uid);
    } catch (err) { msg.className = 'auth-msg error'; msg.textContent = 'Error: ' + (err.message || err); btn.disabled = false; }
  };
}

async function openProfile(userId) {
  const main = $('main');
  setActiveNav('');
  $('feedTabs')?.classList.add('hidden');
  main.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { data: prof } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (!prof) { main.innerHTML = '<div class="empty">Perfil no encontrado.</div>'; return; }
  const [{ count: followers }, { count: following }, ownTracks, collabRes, badgesRes] = await Promise.all([
    sb.from('follows').select('follower_id', { count:'exact', head:true }).eq('following_id', userId),
    sb.from('follows').select('following_id', { count:'exact', head:true }).eq('follower_id', userId),
    fetchTracks({ order: 'created_at', userId }),
    sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').contains('collaborators', JSON.stringify([{ id: userId }])).order('created_at', { ascending: false }),
    sb.from('user_badges').select('badge').eq('user_id', userId),
  ]);
  const profBadges = (prof.is_admin ? Object.keys(BADGES) : (badgesRes.data || []).map(r => r.badge)).filter(b => BADGES[b]);
  const profBadgesHtml = profBadges.length ? `<div class="profile-badges">${profBadges.map(k => `<span class="bdg ${BADGES[k].cls}" title="${esc(BADGES[k].name)}">${BADGES[k].glyph} <span class="bdg-txt">${esc(BADGES[k].name)}</span></span>`).join('')}</div>` : '';
  // pistas propias y "feats" (cualquier colaboración que te involucra: tuyas con invitados
  // y pistas de otros donde te añadieron como colaborador)
  const myTracks = (ownTracks || []).slice();
  const myCollabs = myTracks.filter(t => Array.isArray(t.collaborators) && t.collaborators.length > 0);
  const collabSeen = new Set(myCollabs.map(t => t.id));
  const othersFeat = ((collabRes && collabRes.data) || []).filter(t => t.user_id !== userId && !collabSeen.has(t.id));
  const featTracks = [...myCollabs, ...othersFeat].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const isMe = userId === state.user.id;
  const followsHim = state.follows.has(userId);
  const theme = (prof.theme && typeof prof.theme === 'object') ? prof.theme : {};
  const accent = czColor(theme.accent) || '#3e57fc';
  const banner = czUrl(theme.banner);
  const bannerPos = czPos(theme.bannerPos) || '50% 50%';
  const bannerZoom = czZoom(theme.bannerZoom);
  const links = Array.isArray(theme.links) ? theme.links : [];
  const font = (theme.font && FONTS[theme.font]) ? theme.font : '';
  const fontVar = font ? `--pf-font:'${font.replace(/'/g,'')}', sans-serif;` : '';
  const glowCls = theme.glow === 'neon' ? 'glow-neon' : theme.glow === 'soft' ? 'glow-soft' : '';
  const cardsCls = (theme.cards && theme.cards !== 'default' && CARD_STYLES[theme.cards]) ? 'cards-' + theme.cards : '';
  const animCls = (theme.bg && theme.bg.type === 'gradient' && theme.bg.animated) ? 'bg-animated' : '';
  const tagline = (typeof theme.tagline === 'string') ? theme.tagline.slice(0, 140) : '';
  const backTo = ['feed','posts','people','messages','favorites','mytracks','all','downloads','notifications','search'].includes(state.view) ? state.view : 'feed';
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = `
    <div class="profile-view ${glowCls} ${cardsCls} ${animCls}" style="--accent:${accent};${fontVar}${bgStyle(theme)}">
      <button class="profile-back" id="profileBack"><svg fill="none" stroke="currentColor"><use href="#i-chevron-left"/></svg> Volver</button>
      ${banner ? `<div class="profile-cover"><img class="cover-img" src="${banner}" alt="" style="object-position:${bannerPos};transform:scale(${bannerZoom})" /></div>` : `<div class="profile-cover profile-cover-grad"></div>`}
      <div class="profile-head ${banner ? 'has-banner' : ''}">
        <div class="ph-avatar">${avatarHTML(prof)}</div>
        <h2 class="accent-name">${esc(prof.display_name || prof.username)}${verifiedBadge(prof)}${displayBadgeHtml(prof)} ${prof.is_admin?'<span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c;vertical-align:middle">MOD</span>':''} ${prof.banned?'<span class="t-genre" style="background:#fae3e0;border-color:#f0c2bc;color:#c0533f;vertical-align:middle">baneado</span>':''}</h2>
        <div class="ph-handle">@${esc(prof.username)}</div>
        ${prof.show_badges ? profBadgesHtml : ''}
        ${tagline ? `<div class="profile-tagline">${esc(tagline)}</div>` : ''}
        ${prof.bio ? `<p class="ph-bio">${esc(prof.bio)}</p>` : ''}
        <div class="pstats">
          <span class="pstat" data-pstat="tracks"><b>${myTracks.length}</b><i>pistas</i></span>
          <span class="pstat" data-pstat="followers"><b>${followers||0}</b><i>seguidores</i></span>
          <span class="pstat" data-pstat="following"><b>${following||0}</b><i>siguiendo</i></span>
        </div>
        <div class="pactions">
          ${isMe ? `<button class="btn primary" id="customizeBtn"><svg fill="none" stroke="#fff"><use href="#i-palette"/></svg> Personalizar</button><button class="btn" id="editProfBtn"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg> Editar perfil</button><button class="btn" id="logoutBtn"><svg fill="none" stroke="currentColor"><use href="#i-logout"/></svg> Cerrar sesión</button>`
                  : `<button class="btn ${followsHim?'':'primary'}" id="followBtn">${followsHim?'Siguiendo ✓':'+ Seguir'}</button>`}
          ${!isMe ? `<button class="btn" id="msgBtn"><svg fill="none" stroke="currentColor"><use href="#i-mail"/></svg> Mensaje</button>` : ''}
          ${(!isMe && state.profile.is_admin && !prof.is_admin) ? `<button class="btn" id="banBtn" style="border-color:#e3b7b0;color:#c0533f">${prof.banned?'Desbanear':'Banear usuario'}</button>` : ''}
          ${(!isMe && state.profile.is_admin) ? `<button class="btn" id="verifyBtn"><svg fill="none" stroke="currentColor"><use href="#i-verify"/></svg> ${prof.verified?'Quitar verificación':'Verificar'}</button>` : ''}
          ${(!isMe && state.profile.is_admin && !prof.is_admin) ? `<button class="btn danger-btn" id="delUserBtn"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg> Eliminar usuario</button>` : ''}
          ${!isMe ? `<button class="btn" id="blockBtn">${state.blocked.has(prof.id) ? 'Desbloquear' : 'Bloquear'}</button>` : ''}
          ${!isMe ? `<button class="btn" id="reportBtn"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg> Reportar</button>` : ''}
        </div>
        ${links.length ? `<div class="profile-links">${links.map(l => `<a href="${esc(czHref(l.url))}" target="_blank" rel="noopener noreferrer"><svg fill="none" stroke="currentColor"><use href="#i-globe"/></svg>${esc(l.label || 'enlace')}</a>`).join('')}</div>` : ''}
      </div>
      <div class="profile-tabs" id="profileTabs">
        <button class="active" data-ptab="tracks"><svg fill="none" stroke="currentColor"><use href="#i-music"/></svg> Pistas <span class="ptab-n">${myTracks.length}</span></button>
        <button data-ptab="posts"><svg fill="none" stroke="currentColor"><use href="#i-camera"/></svg> Fotos</button>
        <button data-ptab="feats"><svg fill="none" stroke="currentColor"><use href="#i-people"/></svg> Feats <span class="ptab-n">${featTracks.length}</span></button>
        <button data-ptab="events"><svg fill="none" stroke="currentColor"><use href="#i-calendar"/></svg> Eventos</button>
      </div>
      <div id="feedList" class="feed-list"></div>
      <div id="postGrid" class="post-grid hidden"></div>
      <div id="featList" class="feed-list hidden"></div>
      <div id="profEvents" class="hidden"></div>
    </div>`;
  $('profileBack').onclick = () => switchView(backTo);
  if (font) loadFont(font);
  if (theme.effect && theme.effect !== 'none' && EFFECTS[theme.effect]) {
    const v = main.querySelector('.profile-view'); if (v) v.prepend(buildEffect(theme.effect));
  }
  if (isMe) { const cb = $('customizeBtn'); if (cb) cb.onclick = openProfileCustomizer; const lo = $('logoutBtn'); if (lo) lo.onclick = logout; }

  const list = $('feedList');
  if (!myTracks.length) list.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-music"/></svg><p>Sin pistas todavía.</p></div>`;
  else myTracks.forEach(t => list.appendChild(trackCard(t)));

  const featEl = $('featList');
  if (!featTracks.length) featEl.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-people"/></svg><p>Sin colaboraciones todavía. Aquí aparecen las canciones en colaboración: las tuyas con invitados (<b>ft.</b>) y las de otros donde te añaden.</p></div>`;
  else featTracks.forEach(t => featEl.appendChild(trackCard(t)));

  // cola de reproducción inicial = pestaña Pistas
  state.tracks = myTracks; state.queue = myTracks.map(t => t.id);

  // pestañas Pistas / Fotos / Feats / Eventos
  const tabsEl = $('profileTabs'), gridEl = $('postGrid'), evEl = $('profEvents');
  let postsLoaded = false, eventsLoaded = false;
  tabsEl.querySelectorAll('button').forEach(b => b.onclick = () => {
    tabsEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    const tab = b.dataset.ptab;
    list.classList.toggle('hidden', tab !== 'tracks');
    gridEl.classList.toggle('hidden', tab !== 'posts');
    featEl.classList.toggle('hidden', tab !== 'feats');
    evEl.classList.toggle('hidden', tab !== 'events');
    if (tab === 'tracks') { state.tracks = myTracks; state.queue = myTracks.map(t => t.id); }
    else if (tab === 'feats') { state.tracks = featTracks; state.queue = featTracks.map(t => t.id); }
    if (tab === 'posts' && !postsLoaded) { postsLoaded = true; loadProfilePosts(userId, gridEl); }
    if (tab === 'events' && !eventsLoaded) { eventsLoaded = true; loadProfileEvents(userId, evEl); }
  });

  // estadísticas clicables: pistas → pestaña Pistas · seguidores/siguiendo → lista
  main.querySelectorAll('.pstat').forEach(s => s.onclick = () => {
    const k = s.dataset.pstat;
    if (k === 'tracks') {
      const tb = tabsEl.querySelector('[data-ptab="tracks"]');
      if (tb) tb.click();
      list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      openFollowList(userId, k);
    }
  });

  if (isMe) $('editProfBtn').onclick = () => switchView('settings');
  const msgBtn = $('msgBtn');
  if (msgBtn) msgBtn.onclick = () => openDM(userId);
  const blockBtn = $('blockBtn');
  if (blockBtn) blockBtn.onclick = () => {
    if (state.blocked.has(userId)) unblockUser(userId, () => openProfile(userId));
    else blockUser(userId, prof.display_name || prof.username, () => openProfile(userId));
  };
  const reportBtn = $('reportBtn');
  if (reportBtn) reportBtn.onclick = () => openReportModal('user', userId, userId, '@' + prof.username);
  const delUserBtn = $('delUserBtn');
  if (delUserBtn) delUserBtn.onclick = () => adminDeleteUser(userId, prof.username, () => switchView('people'));
  const banBtn = $('banBtn');
  if (banBtn) banBtn.onclick = async () => {
    const newVal = !prof.banned;
    const { error } = await sb.from('profiles').update({ banned: newVal }).eq('id', userId);
    if (error) { toast('No se pudo actualizar'); return; }
    prof.banned = newVal;
    banBtn.textContent = newVal ? 'Desbanear' : 'Banear usuario';
    toast(newVal ? 'Usuario baneado' : 'Usuario desbaneado');
  };
  const verifyBtn = $('verifyBtn');
  if (verifyBtn) verifyBtn.onclick = async () => {
    const newVal = !prof.verified;
    const { error } = await sb.from('profiles').update({ verified: newVal }).eq('id', userId);
    if (error) { toast('No se pudo actualizar'); return; }
    prof.verified = newVal;
    verifyBtn.textContent = newVal ? 'Quitar verificación' : 'Verificar';
    toast(newVal ? '✔ Usuario verificado' : 'Verificación quitada');
  };
  if (!isMe) $('followBtn').onclick = async () => {
    const btn = $('followBtn');
    if (state.follows.has(userId)) {
      state.follows.delete(userId);
      await sb.from('follows').delete().eq('follower_id', state.user.id).eq('following_id', userId);
      btn.className = 'btn primary'; btn.textContent = '+ Seguir';
    } else {
      state.follows.add(userId);
      await sb.from('follows').insert({ follower_id: state.user.id, following_id: userId });
      btn.className = 'btn'; btn.textContent = 'Siguiendo ✓';
    }
  };
}

/* =======================================================================
   PEOPLE (directorio)
   ======================================================================= */
async function renderPeople() {
  setActiveNav('people');
  const main = $('main');
  main.innerHTML = `<div class="main-head"><div><h2>Bro's</h2><div class="sub">Descubre a otros creadores</div></div></div><div id="peopleList" class="loading"><div class="spinner"></div></div>`;
  const { data } = await sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(60);
  const list = $('peopleList'); list.className = 'feed-list';
  const people = (data||[]).filter(p => p.id !== state.user.id && !isHidden(p.id));
  if (!people.length) { list.innerHTML = '<div class="empty"><p>Aún no hay nadie más por aquí.</p></div>'; return; }
  list.innerHTML = '';
  people.forEach(p => {
    const f = state.follows.has(p.id);
    const row = el(`
      <div class="person">
        <div class="person-top">
          ${avatarHTML(p)}
          <div class="person-info">
            <div class="person-name">${esc(p.display_name||p.username)}${verifiedBadge(p)}${displayBadgeHtml(p)}${p.is_admin?' <span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c">MOD</span>':''}${p.banned?' <span class="t-genre" style="background:#fae3e0;border-color:#f0c2bc;color:#c0533f">baneado</span>':''}</div>
            <div class="person-handle">@${esc(p.username)}</div>
            ${p.bio?`<div class="person-bio">${esc(p.bio)}</div>`:''}
          </div>
        </div>
        <div class="person-actions">
          <button class="btn sm ${f?'':'primary'}" data-act="follow">${f?'Siguiendo ✓':'+ Seguir'}</button>
          <button class="btn sm" data-act="msg"><svg style="width:15px;height:15px" fill="none" stroke="currentColor"><use href="#i-mail"/></svg> Mensaje</button>
          <button class="btn sm icon-only" data-act="view" title="Ver perfil"><svg style="width:16px;height:16px" fill="none" stroke="currentColor"><use href="#i-people"/></svg></button>
          ${state.profile.is_admin && !p.is_admin ? `<button class="btn sm icon-only" data-act="ban" title="${p.banned?'Desbanear':'Banear'}" style="border-color:#e3b7b0;color:#c0533f">${p.banned?'↺':'⊘'}</button>` : ''}
          ${state.profile.is_admin && !p.is_admin ? `<button class="btn sm icon-only" data-act="del" title="Eliminar usuario" style="border-color:#e3b7b0;color:#c0533f"><svg style="width:15px;height:15px" fill="none" stroke="currentColor"><use href="#i-trash"/></svg></button>` : ''}
        </div>
      </div>`);
    const followBtn = row.querySelector('[data-act="follow"]');
    row.querySelector('[data-act="view"]').onclick = () => openProfile(p.id);
    row.querySelector('[data-act="msg"]').onclick = () => openDM(p.id);
    const delBtn = row.querySelector('[data-act="del"]');
    if (delBtn) delBtn.onclick = () => adminDeleteUser(p.id, p.username, () => row.remove());
    const banBtn = row.querySelector('[data-act="ban"]');
    if (banBtn) banBtn.onclick = async () => {
      const newVal = !p.banned;
      const { error } = await sb.from('profiles').update({ banned: newVal }).eq('id', p.id);
      if (error) { toast('No se pudo actualizar'); return; }
      p.banned = newVal;
      banBtn.textContent = newVal ? '↺' : '⊘'; banBtn.title = newVal ? 'Desbanear' : 'Banear';
      toast(newVal ? `${p.username} baneado` : `${p.username} desbaneado`);
    };
    followBtn.onclick = async () => {
      if (state.follows.has(p.id)) {
        state.follows.delete(p.id);
        await sb.from('follows').delete().eq('follower_id', state.user.id).eq('following_id', p.id);
        followBtn.classList.add('primary'); followBtn.textContent = '+ Seguir';
      } else {
        state.follows.add(p.id);
        await sb.from('follows').insert({ follower_id: state.user.id, following_id: p.id });
        followBtn.classList.remove('primary'); followBtn.textContent = 'Siguiendo ✓';
      }
    };
    list.appendChild(row);
  });
}

// Lista de seguidores / seguidos de un perfil (en modal)
async function openFollowList(userId, mode) {
  const title = mode === 'followers' ? 'Seguidores' : 'Siguiendo';
  const m = openModal(`<div class="modal-head"><h3>${title}</h3><button class="close">&times;</button></div><div class="modal-body" id="followListBody"><div class="loading" style="padding:30px"><div class="spinner"></div></div></div>`);
  const body = m.querySelector('#followListBody');
  const q = mode === 'followers'
    ? sb.from('follows').select('created_at, profiles!follows_follower_id_fkey(*)').eq('following_id', userId).order('created_at', { ascending: false })
    : sb.from('follows').select('created_at, profiles!follows_following_id_fkey(*)').eq('follower_id', userId).order('created_at', { ascending: false });
  const { data, error } = await q;
  if (error) { body.innerHTML = `<div class="empty"><p>No se pudo cargar la lista.</p></div>`; return; }
  const people = (data || []).map(r => r.profiles).filter(Boolean);
  if (!people.length) {
    body.innerHTML = `<div class="empty"><p>${mode === 'followers' ? 'Aún no tiene seguidores.' : 'Todavía no sigue a nadie.'}</p></div>`;
    return;
  }
  body.innerHTML = '';
  people.forEach(p => {
    const isSelf = p.id === state.user.id;
    const f = state.follows.has(p.id);
    const row = el(`
      <div class="follow-row">
        ${avatarHTML(p)}
        <div class="fr-info">
          <div class="fr-name">${esc(p.display_name || p.username)}${p.is_admin ? ' <span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c">MOD</span>' : ''}</div>
          <div class="fr-handle">@${esc(p.username)}</div>
        </div>
        ${isSelf ? '' : `<div class="fr-actions">
          <button class="btn sm ${f ? '' : 'primary'}" data-act="follow">${f ? 'Siguiendo ✓' : '+ Seguir'}</button>
          <button class="btn sm icon-only" data-act="msg" title="Mensaje"><svg style="width:15px;height:15px" fill="none" stroke="currentColor"><use href="#i-mail"/></svg></button>
        </div>`}
      </div>`);
    row.onclick = () => { m.remove(); openProfile(p.id); };
    const msgBtn = row.querySelector('[data-act="msg"]');
    if (msgBtn) msgBtn.onclick = (e) => { e.stopPropagation(); m.remove(); openDM(p.id); };
    const followBtn = row.querySelector('[data-act="follow"]');
    if (followBtn) followBtn.onclick = async (e) => {
      e.stopPropagation();
      if (state.follows.has(p.id)) {
        state.follows.delete(p.id);
        await sb.from('follows').delete().eq('follower_id', state.user.id).eq('following_id', p.id);
        followBtn.classList.add('primary'); followBtn.textContent = '+ Seguir';
      } else {
        state.follows.add(p.id);
        await sb.from('follows').insert({ follower_id: state.user.id, following_id: p.id });
        followBtn.classList.remove('primary'); followBtn.textContent = 'Siguiendo ✓';
      }
    };
    body.appendChild(row);
  });
}

/* =======================================================================
   PLAYLISTS
   ======================================================================= */
async function renderPlaylists() {
  setActiveNav('playlists');
  const main = $('main');
  main.innerHTML = `<div class="main-head"><div><h2>Playlists</h2><div class="sub">Tus listas de reproducción</div></div><button class="btn primary" id="newPlaylistBtn"><svg fill="none" stroke="#fff"><use href="#i-plus"/></svg> Crear</button></div><div id="plGrid" class="pl-grid"><div class="loading" style="grid-column:1/-1;padding:30px"><div class="spinner"></div></div></div>`;
  $('newPlaylistBtn').onclick = createPlaylistModal;
  const { data } = await sb.from('playlists')
    .select('*, playlist_tracks(track_id, tracks(cover_url))')
    .eq('user_id', state.user.id).order('created_at', { ascending: false });
  const grid = $('plGrid');
  const lists = data || [];
  if (!lists.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><svg fill="none"><use href="#i-list"/></svg><p>No tienes playlists todavía. Crea una y añade pistas con el botón <b>Playlist</b> de cada tema.</p></div>`; return; }
  grid.innerHTML = '';
  lists.forEach(pl => grid.appendChild(playlistCard(pl)));
}
function playlistCovers(pl) {
  if (pl.cover_url) return `<div class="pl-cover" style="background-image:url('${czUrl(pl.cover_url)}')"></div>`;
  const covers = (pl.playlist_tracks || []).map(x => x.tracks?.cover_url).filter(Boolean).slice(0, 4);
  if (!covers.length) return `<div class="pl-cover pl-cover-empty"><svg fill="none" stroke="#fff"><use href="#i-list"/></svg></div>`;
  return `<div class="pl-cover pl-cover-grid">${covers.map(c => `<div style="background-image:url('${czUrl(c)}')"></div>`).join('')}</div>`;
}
function playlistCard(pl) {
  const n = (pl.playlist_tracks || []).length;
  const card = el(`<div class="pl-card">${playlistCovers(pl)}<div class="pl-info"><div class="pl-title">${esc(pl.title)}</div><div class="pl-count">${n} ${n === 1 ? 'pista' : 'pistas'}</div></div></div>`);
  card.onclick = () => openPlaylist(pl.id);
  return card;
}
function createPlaylistModal() {
  const m = openModal(`<div class="modal-head"><h3>Nueva playlist</h3><button class="close">&times;</button></div><div class="modal-body"><div class="field"><label>Nombre</label><input type="text" id="plTitle" maxlength="60" placeholder="Mi playlist" /></div><div class="field"><label>Descripción (opcional)</label><input type="text" id="plDesc" maxlength="140" /></div><button class="btn primary" id="plCreate" style="width:100%">Crear</button></div>`);
  const input = m.querySelector('#plTitle'); input.focus();
  m.querySelector('#plCreate').onclick = async () => {
    const title = input.value.trim(); if (!title) { input.focus(); return; }
    const description = m.querySelector('#plDesc').value.trim();
    const { data, error } = await sb.from('playlists').insert({ user_id: state.user.id, title, description }).select().single();
    if (error) { toast('No se pudo crear'); return; }
    m.remove(); toast('Playlist creada'); openPlaylist(data.id);
  };
}
async function openPlaylist(id) {
  const main = $('main'); setActiveNav('playlists'); state.view = 'playlist';
  $('feedTabs')?.classList.add('hidden');
  main.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { data: pl } = await sb.from('playlists').select('*, profiles!playlists_user_id_fkey(*)').eq('id', id).maybeSingle();
  if (!pl) { main.innerHTML = '<div class="empty">Playlist no encontrada.</div>'; return; }
  const { data: rows } = await sb.from('playlist_tracks').select('added_at, tracks(*, profiles!tracks_user_id_fkey(*))').eq('playlist_id', id).order('added_at', { ascending: true });
  const tracks = (rows || []).map(r => r.tracks).filter(Boolean);
  const isOwner = pl.user_id === state.user.id;
  const owner = pl.profiles?.display_name || pl.profiles?.username || '';
  main.innerHTML = `
    <div class="pl-detail">
      <button class="profile-back" id="plBack"><svg fill="none" stroke="currentColor"><use href="#i-chevron-left"/></svg> Volver</button>
      <div class="pl-head">
        ${playlistCovers({ ...pl, playlist_tracks: tracks.map(t => ({ tracks: { cover_url: t.cover_url } })) })}
        <div class="pl-head-info">
          <div class="pl-kicker">PLAYLIST</div>
          <h2 class="pl-h2">${esc(pl.title)}</h2>
          ${pl.description ? `<p class="pl-desc">${esc(pl.description)}</p>` : ''}
          <div class="pl-meta">por <a id="plOwner">${esc(owner)}</a> · ${tracks.length} ${tracks.length === 1 ? 'pista' : 'pistas'}</div>
          <div class="pl-actions">
            <button class="btn primary" id="plPlay"><svg fill="none" stroke="#fff"><use href="#i-play"/></svg> Reproducir</button>
            <button class="btn" id="plShare"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg> Compartir</button>
            ${isOwner ? `<button class="btn" id="plRename"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg> Editar</button><button class="btn danger-btn" id="plDelete"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg> Eliminar</button>` : ''}
          </div>
        </div>
      </div>
      <div id="plTracks" class="feed-list"></div>
    </div>`;
  $('plBack').onclick = () => switchView('playlists');
  $('plOwner').onclick = () => openProfile(pl.user_id);
  const listEl = $('plTracks');
  if (!tracks.length) { listEl.innerHTML = `<div class="empty"><p>Esta playlist está vacía. Añade pistas con el botón <b>Playlist</b> de cada tema.</p></div>`; }
  else tracks.forEach(t => {
    const card = trackCard(t);
    if (isOwner) {
      const rm = el(`<button class="act danger" data-act="rmpl"><svg fill="none" stroke="currentColor"><use href="#i-trash"/></svg>Quitar</button>`);
      rm.onclick = async (e) => {
        e.stopPropagation();
        await sb.from('playlist_tracks').delete().eq('playlist_id', id).eq('track_id', t.id);
        card.remove(); toast('Quitada de la playlist');
      };
      card.querySelector('.t-foot')?.appendChild(rm);
    }
    listEl.appendChild(card);
  });
  state.tracks = tracks;
  $('plPlay').onclick = () => { if (!tracks.length) return; state.tracks = tracks; state.queue = tracks.map(t => t.id); playTrack(tracks[0]); };
  $('plShare').onclick = async () => {
    const url = `${location.origin}/?playlist=${pl.id}`;
    try { await navigator.clipboard.writeText(url); toast('Enlace de la playlist copiado'); } catch { toast(url); }
  };
  if (isOwner) { $('plRename').onclick = () => renamePlaylist(pl); $('plDelete').onclick = () => deletePlaylist(pl); }
}
function renamePlaylist(pl) {
  const m = openModal(`<div class="modal-head"><h3>Editar playlist</h3><button class="close">&times;</button></div><div class="modal-body"><div class="field"><label>Nombre</label><input type="text" id="plTitle2" maxlength="60" value="${esc(pl.title)}" /></div><div class="field"><label>Descripción</label><input type="text" id="plDesc2" maxlength="140" value="${esc(pl.description || '')}" /></div><button class="btn primary" id="plSave2" style="width:100%">Guardar</button></div>`);
  m.querySelector('#plSave2').onclick = async () => {
    const title = m.querySelector('#plTitle2').value.trim(); if (!title) return;
    const description = m.querySelector('#plDesc2').value.trim();
    const { error } = await sb.from('playlists').update({ title, description }).eq('id', pl.id);
    if (error) { toast('No se pudo guardar'); return; }
    m.remove(); openPlaylist(pl.id);
  };
}
async function deletePlaylist(pl) {
  if (!confirm(`¿Eliminar la playlist "${pl.title}"? No se puede deshacer.`)) return;
  const { error } = await sb.from('playlists').delete().eq('id', pl.id);
  if (error) { toast('No se pudo eliminar'); return; }
  toast('Playlist eliminada'); switchView('playlists');
}
async function openPlaylistPicker(t) {
  const m = openModal(`<div class="modal-head"><h3>Añadir a playlist</h3><button class="close">&times;</button></div><div class="modal-body" id="plPickBody"><div class="loading" style="padding:20px"><div class="spinner"></div></div></div>`);
  const body = m.querySelector('#plPickBody');
  const [{ data: lists }, { data: inRows }] = await Promise.all([
    sb.from('playlists').select('id, title, playlist_tracks(track_id)').eq('user_id', state.user.id).order('created_at', { ascending: false }),
    sb.from('playlist_tracks').select('playlist_id').eq('track_id', t.id),
  ]);
  const inSet = new Set((inRows || []).map(r => r.playlist_id));
  body.innerHTML = `<button class="btn primary" id="plPickNew" style="width:100%;margin-bottom:12px"><svg fill="none" stroke="#fff"><use href="#i-plus"/></svg> Crear nueva playlist</button><div id="plPickList"></div>`;
  const listWrap = body.querySelector('#plPickList');
  const renderItem = (pl) => {
    const on = inSet.has(pl.id);
    const row = el(`<div class="follow-row"><div class="fr-info"><div class="fr-name">${esc(pl.title)}</div><div class="fr-handle">${(pl.playlist_tracks || []).length} pistas</div></div><div class="fr-actions"><button class="btn sm ${on ? '' : 'primary'}" data-add>${on ? 'Quitar' : 'Añadir'}</button></div></div>`);
    const btn = row.querySelector('[data-add]');
    btn.onclick = async (e) => {
      e.stopPropagation(); btn.disabled = true;
      if (inSet.has(pl.id)) {
        await sb.from('playlist_tracks').delete().eq('playlist_id', pl.id).eq('track_id', t.id);
        inSet.delete(pl.id); btn.classList.add('primary'); btn.textContent = 'Añadir';
      } else {
        await sb.from('playlist_tracks').insert({ playlist_id: pl.id, track_id: t.id });
        inSet.add(pl.id); btn.classList.remove('primary'); btn.textContent = 'Quitar';
      }
      btn.disabled = false;
    };
    return row;
  };
  const draw = (arr) => { listWrap.innerHTML = ''; if (!arr.length) listWrap.innerHTML = `<div class="empty" style="padding:14px"><p>Crea tu primera playlist arriba.</p></div>`; else arr.forEach(pl => listWrap.appendChild(renderItem(pl))); };
  draw(lists || []);
  m.querySelector('#plPickNew').onclick = async () => {
    const title = prompt('Nombre de la nueva playlist:');
    if (!title || !title.trim()) return;
    const { data, error } = await sb.from('playlists').insert({ user_id: state.user.id, title: title.trim() }).select('id,title').single();
    if (error) { toast('No se pudo crear'); return; }
    await sb.from('playlist_tracks').insert({ playlist_id: data.id, track_id: t.id });
    inSet.add(data.id);
    toast('Añadida a ' + data.title);
    draw([{ ...data, playlist_tracks: [{ track_id: t.id }] }, ...(lists || [])]);
  };
}

/* =======================================================================
   HISTORIAS (stories) — foto 24h + canción de fondo + enlaces como botón
   ======================================================================= */
let storyAudio = null;

async function loadStoriesBar() {
  const bar = document.getElementById('storiesBar');
  if (!bar) return;
  bar.innerHTML = `<div class="story-circle add" id="storyAddBtn"><span class="story-ring add-ring"><span class="story-av">${avatarHTML(state.profile, '')}</span><span class="story-add-badge"><svg fill="none" stroke="#fff"><use href="#i-plus"/></svg></span></span><span class="story-name">Tu historia</span></div>`;
  const addBtn = bar.querySelector('#storyAddBtn');
  addBtn.onclick = () => openAddStory();

  const ids = [state.user.id, ...state.follows];
  const { data } = await sb.from('stories')
    .select('*, profiles!stories_user_id_fkey(*), tracks(id,title,audio_url,cover_url,artist,profiles!tracks_user_id_fkey(display_name,username))')
    .in('user_id', ids).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true });
  const stories = data || [];
  if (!stories.length) return;
  const { data: views } = await sb.from('story_views').select('story_id').eq('viewer_id', state.user.id);
  const seen = new Set((views || []).map(v => v.story_id));
  state._storySeen = seen;

  const groups = new Map();
  stories.forEach(s => {
    if (!groups.has(s.user_id)) groups.set(s.user_id, { userId: s.user_id, user: s.profiles, items: [] });
    groups.get(s.user_id).items.push(s);
  });
  let arr = [...groups.values()];
  arr.forEach(g => g.allSeen = g.items.every(s => seen.has(s.id)));
  arr.sort((a, b) => {
    if (a.userId === state.user.id) return -1; if (b.userId === state.user.id) return 1;
    return (a.allSeen ? 1 : 0) - (b.allSeen ? 1 : 0);
  });

  const myGroup = arr.find(g => g.userId === state.user.id);
  if (myGroup) {
    addBtn.classList.add('has-story');
    addBtn.querySelector('.add-ring').classList.toggle('seen', myGroup.allSeen);
    addBtn.onclick = (e) => { if (e.target.closest('.story-add-badge')) { openAddStory(); return; } openStoryViewer(myGroup); };
  }
  arr.filter(g => g.userId !== state.user.id).forEach(g => {
    const c = el(`<div class="story-circle"><span class="story-ring ${g.allSeen ? 'seen' : ''}"><span class="story-av">${avatarHTML(g.user, '')}</span></span><span class="story-name">${esc(g.user.display_name || g.user.username)}</span></div>`);
    c.onclick = () => openStoryViewer(g);
    bar.appendChild(c);
  });
}

function pickTrackModal(cb) {
  const m = openModal(`<div class="modal-head"><h3>Elegir canción</h3><button class="close">&times;</button></div><div class="modal-body"><input type="text" id="stSearch" placeholder="Buscar pista…" style="width:100%;padding:10px 12px;border:1px solid var(--line-soft);border-radius:10px;margin-bottom:10px;background:var(--glass);color:var(--ink)" /><div id="stResults"><div class="loading" style="padding:16px"><div class="spinner"></div></div></div></div>`);
  const results = m.querySelector('#stResults');
  const run = async (q) => {
    let query = sb.from('tracks').select('id,title,cover_url,artist,profiles!tracks_user_id_fkey(display_name,username)');
    query = q ? query.ilike('title', `%${q}%`).limit(30) : query.order('plays', { ascending: false }).limit(30);
    const { data } = await query;
    const list = data || [];
    if (!list.length) { results.innerHTML = `<div class="empty" style="padding:14px"><p>Sin resultados.</p></div>`; return; }
    results.innerHTML = '';
    list.forEach(t => {
      const row = el(`<div class="follow-row"><div class="st-tc-cover" style="${t.cover_url ? `background-image:url('${czUrl(t.cover_url)}')` : ''}"></div><div class="fr-info"><div class="fr-name">${esc(t.title)}</div><div class="fr-handle">${esc(t.profiles?.display_name || t.profiles?.username || t.artist || '')}</div></div></div>`);
      row.onclick = () => { cb(t); m.remove(); };
      results.appendChild(row);
    });
  };
  let to; const inp = m.querySelector('#stSearch');
  inp.oninput = () => { clearTimeout(to); to = setTimeout(() => run(inp.value.trim()), 250); };
  run('');
}

function openAddStory() {
  let imgFile = null, pickedTrack = null;
  const m = openModal(`
    <div class="modal-head"><h3>Nueva historia</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="cover-pick" id="stDz">
        <div class="cover-prev" id="stPrev"><svg width="24" height="24" fill="none" stroke="currentColor"><use href="#i-image"/></svg></div>
        <div class="cover-pick-txt"><b id="stPickTxt">Elige una foto</b><span>Se borra sola a las 24h</span></div>
      </div>
      <input type="file" id="stFile" accept="image/*" hidden />
      <div class="field"><label>Canción de fondo (opcional)</label>
        <button class="btn" id="stTrackBtn" style="width:100%"><svg fill="none" stroke="currentColor"><use href="#i-music"/></svg> Elegir canción</button>
        <div id="stTrackChip"></div>
      </div>
      <div class="field"><label>Enlaces (se muestran como botón)</label><div id="stLinks"></div><button class="btn sm" id="stAddLink" type="button">＋ Añadir enlace</button></div>
      <button class="btn primary" id="stPublish" disabled style="width:100%">Publicar historia</button>
      <div class="auth-msg" id="stMsg"></div>
    </div>`);
  const fileInput = m.querySelector('#stFile');
  const prev = m.querySelector('#stPrev');
  const publish = m.querySelector('#stPublish');
  const chip = m.querySelector('#stTrackChip');
  const linksWrap = m.querySelector('#stLinks');
  m.querySelector('#stDz').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files[0]; if (!f) return;
    imgFile = f;
    prev.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`;
    m.querySelector('#stPickTxt').textContent = 'Cambiar foto';
    publish.disabled = false;
  };
  m.querySelector('#stTrackBtn').onclick = () => pickTrackModal((t) => {
    pickedTrack = t;
    chip.innerHTML = `<div class="st-track-chip"><div class="st-tc-cover" style="${t.cover_url ? `background-image:url('${czUrl(t.cover_url)}')` : ''}"></div><div class="st-tc-info"><b>${esc(t.title)}</b><span>${esc(t.profiles?.display_name || t.profiles?.username || t.artist || '')}</span></div><button class="st-tc-x" type="button" aria-label="Quitar">&times;</button></div>`;
    chip.querySelector('.st-tc-x').onclick = () => { pickedTrack = null; chip.innerHTML = ''; };
  });
  function addLinkRow() {
    if (linksWrap.children.length >= 4) { toast('Máximo 4 enlaces'); return; }
    const row = el(`<div class="st-link-row"><input type="url" class="st-link-url" placeholder="https://..." /><input type="text" class="st-link-label" maxlength="24" placeholder="Texto del botón" /><button class="st-link-x" type="button" aria-label="Quitar">&times;</button></div>`);
    row.querySelector('.st-link-x').onclick = () => row.remove();
    linksWrap.appendChild(row);
  }
  m.querySelector('#stAddLink').onclick = addLinkRow;
  publish.onclick = async () => {
    if (!imgFile) return;
    publish.disabled = true; publish.textContent = 'Publicando…';
    try {
      const ext = (imgFile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${state.user.id}/story_${Date.now()}.${ext}`;
      const up = await sb.storage.from('posts').upload(path, imgFile, { contentType: imgFile.type, upsert: false });
      if (up.error) throw up.error;
      const image_url = sb.storage.from('posts').getPublicUrl(path).data.publicUrl;
      const links = [...linksWrap.querySelectorAll('.st-link-row')]
        .map(r => ({ url: czHref(r.querySelector('.st-link-url').value.trim()), label: r.querySelector('.st-link-label').value.trim() || 'Ver enlace' }))
        .filter(l => l.url);
      const { error } = await sb.from('stories').insert({ user_id: state.user.id, image_url, track_id: pickedTrack?.id || null, links });
      if (error) throw error;
      m.remove(); toast('📸 Historia publicada'); loadStoriesBar();
    } catch (e) {
      m.querySelector('#stMsg').textContent = 'No se pudo publicar la historia';
      publish.disabled = false; publish.textContent = 'Publicar historia';
    }
  };
}

function openStoryViewer(group, startIdx = 0) {
  if (!group || !group.items.length) return;
  try { if (audio && !audio.paused) audio.pause(); } catch (_) {}
  const STORY_MS = 7000;
  let idx = startIdx, timer = null;
  const overlay = el(`
    <div class="story-viewer">
      <div class="sv-bars"></div>
      <div class="sv-head">
        <span class="sv-av">${avatarHTML(group.user, '')}</span>
        <div class="sv-who"><b>${esc(group.user.display_name || group.user.username)}</b><span class="sv-time"></span></div>
        <button class="sv-x" type="button" aria-label="Cerrar">&times;</button>
      </div>
      <div class="sv-stage"><img class="sv-img" alt="" /></div>
      <div class="sv-music"></div>
      <div class="sv-links"></div>
      <button class="sv-tap left" type="button" aria-label="Anterior"></button>
      <button class="sv-tap right" type="button" aria-label="Siguiente"></button>
    </div>`);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const barsEl = overlay.querySelector('.sv-bars');
  barsEl.innerHTML = group.items.map(() => `<div class="sv-bar"><i></i></div>`).join('');
  const bars = [...barsEl.querySelectorAll('.sv-bar i')];
  const isOwner = group.userId === state.user.id;

  const stopAudio = () => { if (storyAudio) { try { storyAudio.pause(); } catch (_) {} storyAudio = null; } };
  const close = () => { clearTimeout(timer); stopAudio(); overlay.remove(); document.body.style.overflow = ''; loadStoriesBar(); };
  const nextItem = () => { if (idx < group.items.length - 1) show(idx + 1); else close(); };
  const prevItem = () => { show(idx > 0 ? idx - 1 : 0); };

  function show(i) {
    clearTimeout(timer); stopAudio(); idx = i;
    const s = group.items[idx];
    overlay.querySelector('.sv-img').src = s.image_url;
    const ageH = Math.floor((Date.now() - new Date(s.created_at)) / 3600000);
    overlay.querySelector('.sv-time').textContent = ageH <= 0 ? 'hace un momento' : `hace ${ageH} h`;
    bars.forEach((fill, k) => { fill.style.transition = 'none'; fill.style.width = k < idx ? '100%' : '0%'; });
    const mus = overlay.querySelector('.sv-music');
    if (s.tracks) {
      mus.innerHTML = `<svg fill="none" stroke="#fff"><use href="#i-music"/></svg> <span>${esc(s.tracks.title)} · ${esc(s.tracks.profiles?.display_name || s.tracks.profiles?.username || s.tracks.artist || '')}</span>`;
      try { storyAudio = new Audio(s.tracks.audio_url); storyAudio.play().catch(() => {}); } catch (_) {}
    } else mus.innerHTML = '';
    const links = Array.isArray(s.links) ? s.links : [];
    overlay.querySelector('.sv-links').innerHTML = links.map(l => `<a class="sv-link" href="${esc(czHref(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label || 'Ver enlace')}</a>`).join('');
    markStoryViewed(s.id);
    const cur = bars[idx];
    requestAnimationFrame(() => { cur.style.transition = `width ${STORY_MS}ms linear`; cur.style.width = '100%'; });
    timer = setTimeout(nextItem, STORY_MS);
  }
  overlay.querySelector('.sv-x').onclick = close;
  overlay.querySelector('.sv-tap.right').onclick = nextItem;
  overlay.querySelector('.sv-tap.left').onclick = prevItem;
  if (isOwner) {
    const del = el(`<button class="sv-del" type="button" aria-label="Eliminar"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg></button>`);
    del.onclick = async () => { const s = group.items[idx]; if (!confirm('¿Eliminar esta historia?')) return; await sb.from('stories').delete().eq('id', s.id); toast('Historia eliminada'); close(); };
    overlay.querySelector('.sv-head').insertBefore(del, overlay.querySelector('.sv-x'));
  }
  show(startIdx);
}
async function markStoryViewed(id) {
  if (state._storySeen && state._storySeen.has(id)) return;
  if (state._storySeen) state._storySeen.add(id);
  try { await sb.from('story_views').upsert({ story_id: id, viewer_id: state.user.id }, { onConflict: 'story_id,viewer_id' }); } catch (_) {}
}

/* =======================================================================
   ESTUDIO — panel del artista (stats internas + redes/enlaces del perfil)
   ======================================================================= */
function nfmt(n) { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K'; return String(n); }
function platformOf(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('spotify')) return { name: 'Spotify', color: '#1db954' };
  if (u.includes('instagram')) return { name: 'Instagram', color: '#e1306c' };
  if (u.includes('youtu')) return { name: 'YouTube', color: '#ff0000' };
  if (u.includes('tiktok')) return { name: 'TikTok', color: '#69C9D0' };
  if (u.includes('soundcloud')) return { name: 'SoundCloud', color: '#ff5500' };
  if (u.includes('twitter') || /\/\/(x\.com|x\.)/.test(u)) return { name: 'X', color: '#1d9bf0' };
  if (u.includes('music.apple')) return { name: 'Apple Music', color: '#fa57c1' };
  return null;
}
function hostOf(url) { try { return new URL(/^https?:\/\//.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch (_) { return url; } }
function spotifyEmbedHtml(links) {
  const sp = (links || []).map(l => l.url).find(u => /open\.spotify\.com|spotify:/.test((u || '').toLowerCase()));
  if (!sp) return '';
  let type = '', id = '';
  let m = sp.match(/spotify\.com\/(?:intl-[a-z]+\/)?(artist|album|track|playlist|show|episode)\/([a-zA-Z0-9]+)/i);
  if (m) { type = m[1].toLowerCase(); id = m[2]; }
  else { const u = sp.match(/spotify:(artist|album|track|playlist|show|episode):([a-zA-Z0-9]+)/i); if (u) { type = u[1].toLowerCase(); id = u[2]; } }
  if (!type || !id) return '';
  const h = (type === 'track' || type === 'episode') ? 152 : 352;
  return `<div class="dash-section"><h3>Tu Spotify</h3><iframe class="spotify-embed" src="https://open.spotify.com/embed/${type}/${esc(id)}?utm_source=underbro" width="100%" height="${h}" style="border:0;border-radius:14px" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe></div>`;
}

async function renderDashboard() {
  setActiveNav('dashboard');
  const main = $('main');
  main.innerHTML = `<div class="main-head"><div><h2>Estudio</h2><div class="sub">Tu panel de artista</div></div></div><div id="dashBody"><div class="loading" style="padding:30px"><div class="spinner"></div></div></div>`;
  const uid = state.user.id;
  const [tracksRes, followersRes, postsRes, refRes] = await Promise.all([
    sb.from('tracks').select('id,title,cover_url,plays,likes_count,reposts_count,created_at').eq('user_id', uid).order('plays', { ascending: false }),
    sb.from('follows').select('created_at').eq('following_id', uid),
    sb.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    sb.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', uid),
  ]);
  const invitedCount = refRes.count || 0;
  const inviteUrl = `${location.origin}/?ref=${encodeURIComponent(state.profile.username || '')}`;
  const tracks = tracksRes.data || [];
  const followerDates = (followersRes.data || []).map(r => r.created_at);
  const totalPlays = tracks.reduce((a, t) => a + (t.plays || 0), 0);
  const totalLikes = tracks.reduce((a, t) => a + (t.likes_count || 0), 0);
  const totalReposts = tracks.reduce((a, t) => a + (t.reposts_count || 0), 0);
  const followers = followerDates.length;
  const theme = (state.profile.theme && typeof state.profile.theme === 'object') ? state.profile.theme : {};
  const links = Array.isArray(theme.links) ? theme.links : [];

  // crecimiento de seguidores (últimos 14 días)
  const days = 14, buckets = new Array(days).fill(0), labels = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) { const d = new Date(today); d.setDate(d.getDate() - (days - 1 - i)); labels.push(d); }
  followerDates.forEach(iso => {
    const d = new Date(iso); d.setHours(0, 0, 0, 0);
    const idx = Math.round((d - labels[0]) / 86400000);
    if (idx >= 0 && idx < days) buckets[idx]++;
  });
  const maxB = Math.max(1, ...buckets);
  const newLast14 = buckets.reduce((a, b) => a + b, 0);

  const body = $('dashBody');
  body.innerHTML = `
    <div class="dash-kpis">
      <div class="kpi"><div class="kpi-n">${nfmt(totalPlays)}</div><div class="kpi-l"><svg fill="none" stroke="currentColor"><use href="#i-headphones"/></svg> Reproducciones</div></div>
      <div class="kpi"><div class="kpi-n">${nfmt(followers)}</div><div class="kpi-l"><svg fill="none" stroke="currentColor"><use href="#i-people"/></svg> Seguidores</div></div>
      <div class="kpi"><div class="kpi-n">${nfmt(totalLikes)}</div><div class="kpi-l"><svg fill="none" stroke="currentColor"><use href="#i-heart"/></svg> Me gusta</div></div>
      <div class="kpi"><div class="kpi-n">${nfmt(totalReposts)}</div><div class="kpi-l"><svg fill="none" stroke="currentColor"><use href="#i-repeat"/></svg> Reposts</div></div>
      <div class="kpi"><div class="kpi-n">${nfmt(tracks.length)}</div><div class="kpi-l"><svg fill="none" stroke="currentColor"><use href="#i-music"/></svg> Pistas</div></div>
    </div>

    <div class="dash-section">
      <h3>Seguidores nuevos (últimos 14 días) · +${newLast14}</h3>
      <div class="dash-chart">
        ${buckets.map((b, i) => `<div class="dc-col" title="${labels[i].toLocaleDateString('es-ES',{day:'numeric',month:'short'})}: ${b}"><div class="dc-bar" style="height:${Math.round((b / maxB) * 100)}%"></div><span class="dc-x">${labels[i].getDate()}</span></div>`).join('')}
      </div>
    </div>

    <div class="dash-section">
      <h3>Insignias</h3>
      <p class="dash-hint" style="margin:6px 0 12px">La que elijas se mostrará junto a tu nombre. Activa abajo si quieres exhibir tu colección en el perfil.</p>
      <div class="badge-grid">
        ${Object.keys(BADGES).map(key => {
          const b = BADGES[key];
          const owned = state.badges.has(key);
          const active = (state.profile.displayed_badge || 'alpha') === key;
          return `<button class="badge-item ${owned ? '' : 'locked'} ${active ? 'active' : ''}" data-badge="${key}" ${owned ? '' : 'disabled'}>
            <span class="bdg ${b.cls} big">${b.glyph}</span>
            <span class="bi-name">${b.name}</span>
            <span class="bi-state">${owned ? (active ? '✓ En tu nombre' : 'Mostrar esta') : '🔒 Invita a un amigo'}</span>
          </button>`;
        }).join('')}
      </div>
      <label class="badge-toggle"><input type="checkbox" id="showBadgesChk" ${state.profile.show_badges ? 'checked' : ''} /> <span>Exhibir mi colección de insignias en el perfil</span></label>
    </div>

    <div class="dash-section">
      <div class="dash-sec-head"><h3>Tus redes y enlaces</h3><button class="btn sm" id="editLinksBtn"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg> Editar</button></div>
      <p class="dash-hint" style="margin:6px 0 12px">Los mismos que se ven en tu perfil. Si añades tu Spotify, se reproducirá abajo.</p>
      <div class="dash-socials">
        ${links.length ? links.map(l => { const p = platformOf(l.url); return `<a class="social-card" href="${esc(czHref(l.url))}" target="_blank" rel="noopener noreferrer" style="--sc:${p ? p.color : '#3e57fc'}"><div class="sc-dot"></div><div class="sc-info"><div class="sc-name">${esc(l.label || (p ? p.name : 'Enlace'))}</div><div class="sc-n">${esc(hostOf(l.url))}</div></div></a>`; }).join('') : '<div class="empty" style="padding:14px;grid-column:1/-1"><p>Aún no has añadido enlaces. Pulsa <b>Editar</b> para poner tus redes.</p></div>'}
      </div>
    </div>

    ${spotifyEmbedHtml(links)}

    <div class="dash-section">
      <h3>Invita y crece · <span style="color:var(--accent)">${invitedCount}</span> ${invitedCount === 1 ? 'invitado' : 'invitados'}</h3>
      <p class="dash-hint" style="margin-bottom:10px">Comparte tu enlace. Quien entre por él contará como invitación tuya.</p>
      <div class="share-link"><input type="text" id="inviteUrl" readonly value="${esc(inviteUrl)}" /><button class="btn sm primary" id="copyInvite">Copiar</button></div>
      <button class="btn" id="shareInvite" style="width:100%;margin-top:8px"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg> Compartir invitación</button>
    </div>

    <div class="dash-section">
      <h3>Top pistas</h3>
      <div class="dash-top">
        ${tracks.slice(0, 8).map((t, i) => `
          <div class="dt-row" data-tid="${t.id}">
            <span class="dt-rank">${i + 1}</span>
            <div class="dt-cover" style="${t.cover_url ? `background-image:url('${czUrl(t.cover_url)}')` : ''}"></div>
            <div class="dt-title">${esc(t.title)}</div>
            <span class="dt-stat"><svg fill="none" stroke="currentColor"><use href="#i-headphones"/></svg> ${nfmt(t.plays || 0)}</span>
            <span class="dt-stat"><svg fill="currentColor" stroke="none"><use href="#i-heart"/></svg> ${nfmt(t.likes_count || 0)}</span>
          </div>`).join('') || '<div class="empty"><p>Aún no has subido pistas.</p></div>'}
      </div>
    </div>`;

  const copyInvite = body.querySelector('#copyInvite');
  copyInvite.onclick = async () => { try { await navigator.clipboard.writeText(inviteUrl); } catch { const i = body.querySelector('#inviteUrl'); i.select(); try { document.execCommand('copy'); } catch {} } copyInvite.textContent = 'Copiado ✓'; toast('Enlace de invitación copiado'); };
  body.querySelector('#shareInvite').onclick = () => { if (navigator.share) navigator.share({ title: 'Únete a UnderBro', text: 'Sígueme en UnderBro 🎧', url: inviteUrl }).catch(() => {}); else { navigator.clipboard?.writeText(inviteUrl); toast('Enlace copiado'); } };
  body.querySelector('#editLinksBtn').onclick = () => editLinksModal(() => renderDashboard());
  body.querySelectorAll('.dt-row').forEach(r => r.onclick = () => { const t = tracks.find(x => x.id === r.dataset.tid); if (t) openProfile(uid); });
  body.querySelectorAll('.badge-item:not(.locked)').forEach(bi => bi.onclick = async () => {
    const key = bi.dataset.badge;
    if ((state.profile.displayed_badge || 'alpha') === key) return;
    const { error } = await sb.from('profiles').update({ displayed_badge: key }).eq('id', uid);
    if (error) { toast('No se pudo cambiar la insignia'); return; }
    state.profile.displayed_badge = key;
    toast('✨ Insignia actualizada');
    renderMe();
    renderDashboard();
  });
  const showChk = body.querySelector('#showBadgesChk');
  if (showChk) showChk.onchange = async () => {
    const val = showChk.checked;
    const { error } = await sb.from('profiles').update({ show_badges: val }).eq('id', uid);
    if (error) { toast('No se pudo guardar'); showChk.checked = !val; return; }
    state.profile.show_badges = val;
    toast(val ? 'Insignias visibles en tu perfil' : 'Insignias ocultas en tu perfil');
  };
}

function editLinksModal(onSaved) {
  const theme = (state.profile.theme && typeof state.profile.theme === 'object') ? JSON.parse(JSON.stringify(state.profile.theme)) : {};
  const links = Array.isArray(theme.links) ? theme.links.slice() : [];
  const m = openModal(`
    <div class="modal-head"><h3>Tus redes y enlaces</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <p class="dash-note" style="margin-bottom:12px">Estos enlaces aparecen también en tu perfil. Pega la URL (Spotify, Instagram, YouTube, TikTok…).</p>
      <div id="linkRows"></div>
      <button class="btn sm" id="addLinkRow" type="button">＋ Añadir enlace</button>
      <button class="btn primary" id="saveLinks" style="width:100%;margin-top:12px">Guardar</button>
      <div class="auth-msg" id="lnMsg"></div>
    </div>`);
  const rows = m.querySelector('#linkRows');
  function addRow(label = '', url = '') {
    const row = el(`<div class="st-link-row"><input type="text" class="st-link-label ln-label" maxlength="24" placeholder="Nombre (Spotify…)" value="${esc(label)}" /><input type="url" class="st-link-url ln-url" placeholder="https://..." value="${esc(url)}" /><button class="st-link-x" type="button" aria-label="Quitar">&times;</button></div>`);
    row.querySelector('.st-link-x').onclick = () => row.remove();
    rows.appendChild(row);
  }
  links.forEach(l => addRow(l.label, l.url));
  if (!links.length) addRow();
  m.querySelector('#addLinkRow').onclick = () => addRow();
  m.querySelector('#saveLinks').onclick = async () => {
    const newLinks = [...rows.querySelectorAll('.st-link-row')]
      .map(r => ({ label: r.querySelector('.ln-label').value.trim() || 'Enlace', url: czHref(r.querySelector('.ln-url').value.trim()) }))
      .filter(l => l.url && l.url !== '#');
    theme.links = newLinks;
    const { error } = await sb.from('profiles').update({ theme }).eq('id', state.user.id);
    if (error) { m.querySelector('#lnMsg').textContent = 'No se pudo guardar'; return; }
    state.profile.theme = theme;
    m.remove(); toast('Enlaces actualizados');
    if (onSaved) onSaved();
  };
}

/* =======================================================================
   EVENTOS (tablón) — flyer + fecha/hora + lugar + guardar con aviso
   ======================================================================= */
function fmtEventDate(iso) {
  try { return new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return iso; }
}
function fmtEventFull(iso) {
  try { return new Date(iso).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return iso; }
}
async function renderEvents() {
  setActiveNav('events');
  const main = $('main');
  main.innerHTML = `<div class="main-head"><div><h2>Eventos</h2><div class="sub">Conciertos, quedadas y fechas de la comunidad</div></div><button class="btn primary" id="newEventBtn"><svg fill="none" stroke="#fff"><use href="#i-plus"/></svg> Crear</button></div><div id="evList"><div class="loading" style="padding:30px"><div class="spinner"></div></div></div>`;
  $('newEventBtn').onclick = () => createEventModal();
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data } = await sb.from('events').select('*, profiles!events_user_id_fkey(*)').gte('starts_at', since).order('starts_at', { ascending: true }).limit(80);
  const list = $('evList');
  const evs = data || [];
  if (!evs.length) { list.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-calendar"/></svg><p>No hay eventos próximos. ¡Crea el primero con el botón <b>Crear</b>!</p></div>`; return; }
  list.className = 'ev-list'; list.innerHTML = '';
  evs.forEach(ev => list.appendChild(eventCard(ev)));
}
function eventCard(ev) {
  const saved = state.eventSaves.has(ev.id);
  const cover = ev.flyer_url
    ? `<div class="ev-flyer" style="background-image:url('${czUrl(ev.flyer_url)}')"></div>`
    : `<div class="ev-flyer ev-flyer-empty"><svg fill="none" stroke="#fff"><use href="#i-calendar"/></svg></div>`;
  const card = el(`
    <div class="ev-card" data-id="${ev.id}">
      ${cover}
      <div class="ev-info">
        <div class="ev-date"><svg fill="none" stroke="currentColor"><use href="#i-clock"/></svg> ${esc(fmtEventDate(ev.starts_at))}</div>
        <div class="ev-title">${esc(ev.title)}</div>
        ${ev.location ? `<div class="ev-loc"><svg fill="none" stroke="currentColor"><use href="#i-pin"/></svg> ${esc(ev.location)}</div>` : ''}
        <div class="ev-foot">
          <button class="btn sm ${saved ? '' : 'primary'}" data-ev-save><svg fill="none" stroke="currentColor"><use href="#i-bookmark"/></svg> <span>${saved ? 'Guardado' : 'Guardar'}</span></button>
          <span class="ev-saves"><b>${ev.saves_count || 0}</b> guardados</span>
        </div>
      </div>
    </div>`);
  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-ev-save]')) { e.stopPropagation(); toggleEventSave(ev, card); return; }
    openEvent(ev.id);
  });
  return card;
}
async function toggleEventSave(ev, card) {
  const btn = card.querySelector('[data-ev-save]');
  const saved = state.eventSaves.has(ev.id);
  if (saved) {
    state.eventSaves.delete(ev.id);
    ev.saves_count = Math.max(0, (ev.saves_count || 0) - 1);
    if (btn) { btn.classList.add('primary'); btn.querySelector('span').textContent = 'Guardar'; }
    await sb.from('event_saves').delete().eq('event_id', ev.id).eq('user_id', state.user.id);
  } else {
    state.eventSaves.add(ev.id);
    ev.saves_count = (ev.saves_count || 0) + 1;
    if (btn) { btn.classList.remove('primary'); btn.querySelector('span').textContent = 'Guardado'; }
    await sb.from('event_saves').insert({ event_id: ev.id, user_id: state.user.id });
    toast('🔖 Guardado · te avisaremos cuando se acerque');
    // asegurar que pueda recibir el aviso
    if (pushSupported() && typeof Notification !== 'undefined' && Notification.permission === 'default') enablePush();
  }
  document.querySelectorAll(`.ev-card[data-id="${ev.id}"] .ev-saves b, .ev-detail[data-id="${ev.id}"] .ev-saves b`).forEach(e => e.textContent = ev.saves_count);
}
async function openEvent(id) {
  const m = openModal(`<div class="modal-head"><h3>Evento</h3><button class="close">&times;</button></div><div class="modal-body" id="evDetailBody"><div class="loading" style="padding:24px"><div class="spinner"></div></div></div>`);
  const body = m.querySelector('#evDetailBody');
  const { data: ev } = await sb.from('events').select('*, profiles!events_user_id_fkey(*)').eq('id', id).maybeSingle();
  if (!ev) { body.innerHTML = '<div class="empty"><p>Este evento ya no existe.</p></div>'; return; }
  const isOwner = ev.user_id === state.user.id;
  const saved = state.eventSaves.has(ev.id);
  const who = ev.profiles?.display_name || ev.profiles?.username || '';
  body.innerHTML = `
    <div class="ev-detail" data-id="${ev.id}">
      ${ev.flyer_url ? `<div class="ev-detail-flyer"><img src="${esc(ev.flyer_url)}" alt="" /></div>` : ''}
      <h2 class="ev-detail-title">${esc(ev.title)}</h2>
      <div class="ev-detail-row"><svg fill="none" stroke="currentColor"><use href="#i-clock"/></svg> ${esc(fmtEventFull(ev.starts_at))}${ev.ends_at ? ' → ' + esc(fmtEventFull(ev.ends_at)) : ''}</div>
      ${ev.location ? `<div class="ev-detail-row"><svg fill="none" stroke="currentColor"><use href="#i-pin"/></svg> ${esc(ev.location)}</div>` : ''}
      <div class="ev-detail-row"><svg fill="none" stroke="currentColor"><use href="#i-people"/></svg> Publicado por <a id="evOwner">${esc(who)}</a> · <span class="ev-saves"><b>${ev.saves_count || 0}</b> guardados</span></div>
      ${ev.description ? `<p class="ev-detail-desc">${linkifyMentions(ev.description)}</p>` : ''}
      ${ev.link ? `<a class="btn" href="${esc(czHref(ev.link))}" target="_blank" rel="noopener noreferrer" style="width:100%;margin-bottom:10px"><svg fill="none" stroke="currentColor"><use href="#i-globe"/></svg> Más info / entradas</a>` : ''}
      <div class="ev-detail-actions">
        <button class="btn primary" id="evSaveBtn" style="flex:1">${saved ? '🔖 Guardado' : '🔖 Guardar y avisarme'}</button>
        ${isOwner ? `<button class="btn" id="evEditBtn"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg></button><button class="btn danger-btn" id="evDelBtn"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg></button>` : ''}
      </div>
    </div>`;
  const evOwner = body.querySelector('#evOwner'); if (evOwner) evOwner.onclick = () => { m.remove(); openProfile(ev.user_id); };
  const saveBtn = body.querySelector('#evSaveBtn');
  const paintSave = () => { saveBtn.textContent = state.eventSaves.has(ev.id) ? '🔖 Guardado' : '🔖 Guardar y avisarme'; saveBtn.classList.toggle('primary', !state.eventSaves.has(ev.id)); };
  saveBtn.onclick = async () => { await toggleEventSave(ev, m.querySelector('.ev-detail')); paintSave(); };
  if (isOwner) {
    body.querySelector('#evEditBtn').onclick = () => { m.remove(); createEventModal(ev); };
    body.querySelector('#evDelBtn').onclick = async () => {
      if (!confirm('¿Eliminar este evento?')) return;
      await sb.from('events').delete().eq('id', ev.id);
      m.remove(); toast('Evento eliminado'); if (state.view === 'events') renderEvents();
    };
  }
}
function createEventModal(existing) {
  const editing = !!existing;
  const toLocal = (iso) => { try { const d = new Date(iso); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); } catch (_) { return ''; } };
  let flyerFile = null;
  const m = openModal(`
    <div class="modal-head"><h3>${editing ? 'Editar evento' : 'Nuevo evento'}</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="cover-pick" id="evDz">
        <div class="cover-prev" id="evPrev">${existing?.flyer_url ? `<img src="${esc(existing.flyer_url)}" alt="" />` : `<svg width="24" height="24" fill="none" stroke="currentColor"><use href="#i-image"/></svg>`}</div>
        <div class="cover-pick-txt"><b id="evPickTxt">${existing?.flyer_url ? 'Cambiar flyer' : 'Sube el flyer'}</b><span>Cartel del evento (imagen)</span></div>
      </div>
      <input type="file" id="evFile" accept="image/*" hidden />
      <div class="field"><label>Título *</label><input type="text" id="evTitle" maxlength="100" value="${esc(existing?.title || '')}" placeholder="Nombre del evento" /></div>
      <div class="field"><label>Fecha y hora *</label><input type="datetime-local" id="evStart" value="${existing ? toLocal(existing.starts_at) : ''}" /></div>
      <div class="field"><label>Fin (opcional)</label><input type="datetime-local" id="evEnd" value="${existing?.ends_at ? toLocal(existing.ends_at) : ''}" /></div>
      <div class="field"><label>Lugar</label><input type="text" id="evLoc" maxlength="140" value="${esc(existing?.location || '')}" placeholder="Sala, ciudad, dirección…" /></div>
      <div class="field"><label>Descripción</label><textarea id="evDesc" maxlength="800" placeholder="Line-up, precio, detalles…">${esc(existing?.description || '')}</textarea></div>
      <div class="field"><label>Enlace (entradas/info, opcional)</label><input type="url" id="evLink" value="${esc(existing?.link || '')}" placeholder="https://..." /></div>
      <button class="btn primary" id="evPublish" style="width:100%">${editing ? 'Guardar cambios' : 'Publicar evento'}</button>
      <div class="auth-msg" id="evMsg"></div>
    </div>`);
  const fileInput = m.querySelector('#evFile');
  m.querySelector('#evDz').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files[0]; if (!f) return;
    flyerFile = f;
    m.querySelector('#evPrev').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`;
    m.querySelector('#evPickTxt').textContent = 'Cambiar flyer';
  };
  m.querySelector('#evPublish').onclick = async () => {
    const title = m.querySelector('#evTitle').value.trim();
    const startVal = m.querySelector('#evStart').value;
    if (!title) { m.querySelector('#evMsg').textContent = 'Pon un título'; return; }
    if (!startVal) { m.querySelector('#evMsg').textContent = 'Pon la fecha y hora'; return; }
    const btn = m.querySelector('#evPublish'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      let flyer_url = existing?.flyer_url || null;
      if (flyerFile) {
        const ext = (flyerFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${state.user.id}/event_${Date.now()}.${ext}`;
        const up = await sb.storage.from('posts').upload(path, flyerFile, { contentType: flyerFile.type, upsert: false });
        if (up.error) throw up.error;
        flyer_url = sb.storage.from('posts').getPublicUrl(path).data.publicUrl;
      }
      const endVal = m.querySelector('#evEnd').value;
      const payload = {
        title,
        flyer_url,
        starts_at: new Date(startVal).toISOString(),
        ends_at: endVal ? new Date(endVal).toISOString() : null,
        location: m.querySelector('#evLoc').value.trim(),
        description: m.querySelector('#evDesc').value.trim(),
        link: m.querySelector('#evLink').value.trim() || null,
      };
      if (editing) {
        const { error } = await sb.from('events').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        payload.user_id = state.user.id;
        const { error } = await sb.from('events').insert(payload);
        if (error) throw error;
      }
      m.remove(); toast(editing ? 'Evento actualizado' : '🎟️ Evento publicado');
      if (state.view === 'events') renderEvents();
    } catch (e) {
      m.querySelector('#evMsg').textContent = 'No se pudo guardar el evento';
      btn.disabled = false; btn.textContent = editing ? 'Guardar cambios' : 'Publicar evento';
    }
  };
}

/* =======================================================================
   SETTINGS
   ======================================================================= */
async function adminDeleteUser(userId, username, onDone) {
  if (!state.profile.is_admin) return;
  if (!confirm(`¿ELIMINAR por completo a @${username}?\n\nSe borrarán su cuenta, sus pistas y TODOS sus datos. No se puede deshacer.`)) return;
  toast('Eliminando usuario…');
  try {
    const { data, error } = await sb.functions.invoke('admin-delete-user', { body: { user_id: userId } });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    toast('Usuario @' + username + ' eliminado');
    if (onDone) onDone();
  } catch (err) { toast('No se pudo eliminar: ' + (err.message || err)); }
}

async function deleteAccount() {
  const msg = $('delMsg'); msg.className = 'auth-msg';
  const typed = prompt('Esta acción es PERMANENTE: borrará tu cuenta y TODOS tus archivos y datos.\n\nEscribe BORRAR para confirmar:');
  if (typed == null) return;
  if (typed.trim().toUpperCase() !== 'BORRAR') { msg.className = 'auth-msg error'; msg.textContent = 'Confirmación incorrecta. Escribe BORRAR.'; return; }
  const btn = $('deleteAccount'); btn.disabled = true;
  msg.className = 'auth-msg'; msg.textContent = 'Eliminando tu cuenta y archivos…';
  try {
    const { data, error } = await sb.functions.invoke('delete-account');
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    try { await sb.auth.signOut(); } catch {}
    localStorage.clear();
    alert('Tu cuenta y todos tus datos se han eliminado. ¡Gracias por usar UnderBro!');
    location.reload();
  } catch (err) {
    msg.className = 'auth-msg error'; msg.textContent = 'No se pudo eliminar: ' + (err.message || err);
    btn.disabled = false;
  }
}

function renderSettings() {
  setActiveNav('settings');
  const p = state.profile;
  $('main').innerHTML = `
    <div class="main-head"><div><h2>Settings</h2><div class="sub">Edita tu perfil de UnderBro</div></div></div>
    <div class="track" style="display:block;max-width:520px">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px">
        <div id="setAvatar">${avatarHTML(p,'').replace('class="avatar ','class="avatar " style="width:72px;height:72px;font-size:24px" data-x="')}</div>
        <div><button class="btn sm" id="changeAvatar"><svg fill="none" stroke="currentColor"><use href="#i-upload"/></svg> Cambiar foto</button>
        <button class="btn sm" id="avatarFrame" style="margin-top:6px"><svg fill="none" stroke="currentColor"><use href="#i-image"/></svg> Ajustar encuadre</button>
        <input type="file" id="avatarFile" accept="image/*" hidden /></div>
      </div>
      <div class="field"><label>Nombre para mostrar</label><input type="text" id="setName" value="${esc(p.display_name||'')}" /></div>
      <div class="field"><label>Usuario</label><input type="text" id="setUser" value="${esc(p.username||'')}" /></div>
      <div class="field"><label>Bio</label><textarea id="setBio" placeholder="Cuéntanos algo sobre ti…">${esc(p.bio||'')}</textarea></div>
      <button class="btn" id="openCustomize" style="width:100%;margin-bottom:12px"><svg fill="none" stroke="currentColor"><use href="#i-palette"/></svg> Personalizar perfil (banner, colores, enlaces)</button>
      <button class="btn primary" id="saveProfile">Guardar cambios</button>
      <div class="auth-msg" id="setMsg"></div>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:20px 0" />
      <div class="field"><label>Nueva contraseña</label><input type="password" id="setPass" placeholder="Mínimo 6 caracteres" autocomplete="new-password" /></div>
      <button class="btn" id="savePass">Cambiar contraseña</button>
      <div class="auth-msg" id="passMsg"></div>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:20px 0" />
      <button class="btn" id="settingsLogout" style="width:100%"><svg fill="none" stroke="currentColor"><use href="#i-logout"/></svg> Cerrar sesión</button>
      <div class="danger-zone">
        <h4>Eliminar cuenta</h4>
        <p>Borra para siempre tu cuenta, tu perfil y <b>todo</b> lo que has subido: pistas, portadas, comentarios, "me gusta", seguidores y mensajes. No se puede deshacer.</p>
        <button class="btn danger-btn" id="deleteAccount"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg> Eliminar mi cuenta y mis datos</button>
        <div class="auth-msg" id="delMsg"></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:20px 0" />
      <div class="field"><label>Privacidad y seguridad</label>
        <button class="btn" id="manageBlocks" style="width:100%"><svg fill="none" stroke="currentColor"><use href="#i-people"/></svg> Cuentas bloqueadas</button>
        ${p.is_admin ? `<button class="btn" id="modReports" style="width:100%;margin-top:8px"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg> Moderación · Reportes</button>` : ''}
        <div class="sub" style="margin-top:6px">Gestiona a quién has bloqueado${p.is_admin ? ' y revisa los reportes de la comunidad.' : '.'}</div>
      </div>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:20px 0" />
      <div class="field"><label>Apariencia</label>
        <button class="btn" id="setThemeBtn" style="width:100%"></button>
        <div class="sub" style="margin-top:6px">Cambia entre tema claro y oscuro.</div>
      </div>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:20px 0" />
      <div class="field"><label>Notificaciones</label>
        <button class="btn" id="setPushBtn" style="width:100%"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg> Activar avisos de chat</button>
        <div class="sub" style="margin-top:6px">Recibe un aviso cuando te escriban, aunque tengas la app cerrada.</div>
      </div>
      <div style="text-align:center;margin-top:16px"><a id="policyLink" style="font-size:12px;color:var(--ink-soft);cursor:pointer">Política de privacidad y cookies</a></div>
      <div style="text-align:center;margin-top:10px;font-size:12px;color:var(--ink-soft)">UnderBro · versión ${APP_VERSION} · <a id="checkUpdate" style="cursor:pointer;text-decoration:underline">Buscar actualizaciones</a></div>
    </div>`;
  $('policyLink').onclick = showPrivacyPolicy;
  $('manageBlocks').onclick = openBlockedList;
  if ($('modReports')) $('modReports').onclick = openReportsAdmin;
  const themeBtn = $('setThemeBtn');
  const paintThemeBtn = () => { themeBtn.innerHTML = currentTheme() === 'dark' ? '☀️ Cambiar a tema claro' : '🌙 Cambiar a tema oscuro'; };
  paintThemeBtn();
  themeBtn.onclick = () => { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); paintThemeBtn(); };
  const setPushBtn = $('setPushBtn');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { setPushBtn.textContent = '🔔 Avisos activados'; setPushBtn.disabled = true; }
  setPushBtn.onclick = enablePush;
  $('checkUpdate').onclick = async () => { toast('Buscando actualización…'); await checkForUpdate(); setTimeout(() => location.reload(), 700); };
  $('openCustomize').onclick = openProfileCustomizer;
  $('settingsLogout').onclick = logout;
  $('deleteAccount').onclick = deleteAccount;

  const avatarFile = $('avatarFile');
  $('changeAvatar').onclick = () => avatarFile.click();
  let newAvatarFile = null, avatarPos = czPos(p.theme?.avatarPos) || '', avatarZoom = czZoom(p.theme?.avatarZoom);
  const applyAvatarPos = () => { const img = $('setAvatar').querySelector('img'); if (img) { if (avatarPos) img.style.objectPosition = avatarPos; if (avatarZoom > 1) img.style.transform = `scale(${avatarZoom})`; } };
  applyAvatarPos();
  avatarFile.onchange = () => {
    newAvatarFile = avatarFile.files[0];
    if (newAvatarFile) { avatarPos = ''; avatarZoom = 1; const url = URL.createObjectURL(newAvatarFile); $('setAvatar').innerHTML = `<div class="avatar" style="width:72px;height:72px"><img src="${url}"/></div>`; }
  };
  $('avatarFrame').onclick = () => {
    const imgUrl = newAvatarFile ? URL.createObjectURL(newAvatarFile) : (state.profile.avatar_url ? czUrl(state.profile.avatar_url) : '');
    if (!imgUrl) { toast('Primero pon una foto de perfil'); return; }
    openFramePicker(imgUrl, 'avatar', { pos: avatarPos || '50% 50%', zoom: avatarZoom }, ({ pos, zoom }) => { avatarPos = pos; avatarZoom = zoom; applyAvatarPos(); });
  };

  $('saveProfile').onclick = async () => {
    const msg = $('setMsg'); msg.className='auth-msg';
    const display_name = $('setName').value.trim();
    const username = $('setUser').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    const bio = $('setBio').value.trim();
    if (username.length < 3) { msg.className='auth-msg error'; msg.textContent='El usuario debe tener al menos 3 caracteres.'; return; }
    const btn = $('saveProfile'); btn.disabled = true;
    try {
      let avatar_url = state.profile.avatar_url;
      if (newAvatarFile) {
        const ext = (newAvatarFile.name.split('.').pop()||'jpg').toLowerCase();
        const path = `${state.user.id}/${Date.now()}.${ext}`;
        const up = await sb.storage.from('avatars').upload(path, newAvatarFile, { contentType: newAvatarFile.type });
        if (up.error) throw up.error;
        avatar_url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
      const theme = { ...(state.profile.theme && typeof state.profile.theme === 'object' ? state.profile.theme : {}), avatarPos: avatarPos || null, avatarZoom: avatarZoom > 1 ? avatarZoom : null };
      const { data, error } = await sb.from('profiles').update({ display_name, username, bio, avatar_url, theme }).eq('id', state.user.id).select().single();
      if (error) throw error;
      state.profile = data;
      renderMe();
      msg.className='auth-msg ok'; msg.textContent='Perfil actualizado ✓';
      toast('Perfil guardado');
    } catch (err) {
      msg.className='auth-msg error'; msg.textContent = traducirError(err.message);
    } finally { btn.disabled = false; }
  };

  $('savePass').onclick = async () => {
    const pass = $('setPass').value;
    const msg = $('passMsg'); msg.className = 'auth-msg';
    if (pass.length < 6) { msg.className = 'auth-msg error'; msg.textContent = 'Mínimo 6 caracteres.'; return; }
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) { msg.className = 'auth-msg error'; msg.textContent = traducirError(error.message); return; }
    $('setPass').value = '';
    msg.className = 'auth-msg ok'; msg.textContent = 'Contraseña actualizada ✓';
    toast('Contraseña cambiada');
  };
}

/* =======================================================================
   NOTIFICACIONES (derivadas: seguidores, likes y comentarios en mis pistas)
   ======================================================================= */
async function loadNotifBadge() {
  const seen = +(localStorage.getItem('ub_notif_seen') || 0);
  const items = await fetchNotifications();
  const unseen = items.filter(i => new Date(i.ts).getTime() > seen).length;
  const badge = $('notifBadge');
  if (unseen > 0) { badge.textContent = unseen; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}
async function fetchNotifications() {
  const { data: myTracks } = await sb.from('tracks').select('id,title').eq('user_id', state.user.id);
  const ids = (myTracks||[]).map(t => t.id);
  const titleById = Object.fromEntries((myTracks||[]).map(t => [t.id, t.title]));
  const out = [];
  // nuevos seguidores
  const { data: fol } = await sb.from('follows').select('created_at, profiles!follows_follower_id_fkey(*)').eq('following_id', state.user.id).order('created_at',{ascending:false}).limit(20);
  (fol||[]).forEach(f => out.push({ ts: f.created_at, type:'follow', who: f.profiles, text: 'empezó a seguirte' }));
  if (ids.length) {
    const { data: lk } = await sb.from('likes').select('created_at, track_id, profiles(*)').in('track_id', ids).neq('user_id', state.user.id).order('created_at',{ascending:false}).limit(20);
    (lk||[]).forEach(l => out.push({ ts: l.created_at, type:'like', who: l.profiles, text: `marcó ♥ tu pista "${titleById[l.track_id]||''}"` }));
    const { data: cm } = await sb.from('comments').select('created_at, track_id, body, profiles(*)').in('track_id', ids).neq('user_id', state.user.id).order('created_at',{ascending:false}).limit(20);
    (cm||[]).forEach(c => out.push({ ts: c.created_at, type:'comment', who: c.profiles, text: `comentó en "${titleById[c.track_id]||''}": ${c.body}` }));
  }
  out.sort((a,b) => new Date(b.ts) - new Date(a.ts));
  return out.slice(0, 40);
}
async function renderNotifications() {
  setActiveNav('notifications');
  $('main').innerHTML = `<div class="main-head"><div><h2>Notifications</h2><div class="sub">Actividad sobre ti y tus pistas</div></div></div><div id="notifList" class="loading"><div class="spinner"></div></div>`;
  const items = await fetchNotifications();
  localStorage.setItem('ub_notif_seen', String(Date.now()));
  $('notifBadge').classList.add('hidden');
  const list = $('notifList'); list.className = '';
  if (!items.length) { list.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-bell"/></svg><p>Sin notificaciones todavía.</p></div>`; return; }
  list.innerHTML = '';
  items.forEach(i => {
    const row = el(`<div class="notif-item">${avatarHTML(i.who)}<div class="ntext"><b>${esc(i.who?.display_name||i.who?.username||'alguien')}</b> ${esc(i.text)}<div class="when">${timeAgo(i.ts)}</div></div></div>`);
    row.onclick = () => i.who && openProfile(i.who.id);
    list.appendChild(row);
  });
}

/* =======================================================================
   CHAT GLOBAL (realtime)
   ======================================================================= */
async function initChat() {
  const box = $('chatMsgs');
  attachMentionAutocomplete($('chatInput'));
  const { data } = await sb.from('messages').select('*, profiles(*)').order('created_at', { ascending: false }).limit(40);
  const msgs = (data||[]).reverse();
  box.innerHTML = '';
  msgs.forEach(m => appendChatMsg(m));
  scrollChat();

  sb.channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
      const m = payload.new;
      let prof = m.user_id === state.user.id ? state.profile : null;
      if (!prof) { const { data: p } = await sb.from('profiles').select('*').eq('id', m.user_id).single(); prof = p; }
      appendChatMsg({ ...m, profiles: prof });
      scrollChat();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
      const node = document.querySelector(`.chat-msg[data-mid="${payload.old.id}"]`);
      if (node) node.remove();
    })
    .subscribe();

  $('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireNotBanned()) return;
    const input = $('chatInput');
    const body = input.value.trim(); if (!body) return;
    input.value = '';
    const { error } = await sb.from('messages').insert({ user_id: state.user.id, body });
    if (error) toast('No se pudo enviar el mensaje');
  });
}
function appendChatMsg(m) {
  if (isHidden(m.user_id)) return; // ocultar mensajes de usuarios bloqueados
  const box = $('chatMsgs');
  const canDel = m.user_id === state.user.id || state.profile.is_admin;
  const mine = m.user_id === state.user.id;
  const rep = (!mine && !state.profile.is_admin) ? `<button class="act sm" data-rep-msg style="float:right;padding:0 5px" title="Reportar">⚐</button>` : '';
  const row = el(`<div class="chat-msg" data-mid="${m.id}"><span class="who" data-uid="${m.user_id}">${esc(m.profiles?.display_name||m.profiles?.username||'anónimo')}</span><span class="when">${timeAgo(m.created_at)}</span>${canDel?`<button class="act sm" data-del-msg style="float:right;padding:0 5px" title="Borrar mensaje">✕</button>`:''}${rep}<p>${linkifyMentions(m.body)}</p></div>`);
  const who = row.querySelector('.who');
  who.onclick = () => openProfile(m.user_id);
  who.style.cursor = 'pointer';
  const repBtn = row.querySelector('[data-rep-msg]');
  if (repBtn) repBtn.onclick = () => openReportModal('chat', m.id, m.user_id, 'este mensaje del chat');
  const del = row.querySelector('[data-del-msg]');
  if (del) del.onclick = async () => {
    const { error } = await sb.from('messages').delete().eq('id', m.id);
    if (error) { toast('No se pudo borrar'); return; }
    row.remove();
  };
  box.appendChild(row);
}
function scrollChat() { const b = $('chatMsgs'); b.scrollTop = b.scrollHeight; }

/* =======================================================================
   MENSAJES DIRECTOS (1 a 1)
   ======================================================================= */
/* =======================================================================
   CHAT DIRECTO (DM) — mensajería completa estilo WhatsApp
   ======================================================================= */
const DM_QUICK_EMOJI = ['❤️', '😂', '👍', '😮', '😢', '🙏'];
const DM_EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤩','🥳','😅','😆','😇','🙂','🙃','😉','😌','😋','😜','🤪','😝','🤗','🤔','🤨','😐','😶','😏','😒','🙄','😬','😴','😪','😮','😯','😲','😳','🥺','😢','😭','😤','😠','😡','🤬','🤯','😱','😨','😰','😥','🥶','🥵','🤤','🤥','🤐','🤢','🤮','🤧','😷','🤒','🤕','😈','👻','💀','👽','🤖','🎃','😺','🙈','🙉','🙊','💋','👍','👎','👌','✌️','🤞','🤟','🤘','👏','🙌','🙏','💪','🫶','👋','🤙','🖐️','✋','🤝','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💞','💓','💗','💖','💘','💝','🔥','✨','⭐','🌟','💫','⚡','💯','🎉','🎊','🎵','🎶','🎁','🏆','👑','💎','🌈','☀️','🌙','⚽','🏀','🎮','🎧','🎤','🎸','🍻','🍕','☕','✅','❌','❓','❗'];

let dmVoiceEl = null, dmMediaRec = null, dmRecChunks = [], dmRecStart = 0, dmRecTimer = null, dmRecStream = null;
let dmRecAudioCtx = null, dmRecAnalyser = null, dmRecRAF = null, dmRecLevels = [];
let dmTypingThrottle = 0, dmTypingStopTimer = null, dmTypingHideTimer = null;

function initDM() {
  refreshDmBadge();
  attachMentionAutocomplete($('dmInput'));
  $('dmBack').onclick = closeDmScreen;
  $('dmAttach').onclick = () => $('dmFile').click();
  $('dmFile').onchange = () => { const f = $('dmFile').files[0]; if (f) setDmPending(f); };
  $('dmForm').addEventListener('submit', sendDm);
  $('dmEmoji').onclick = dmToggleEmoji;
  $('dmMic').onclick = () => dmStartRec();
  $('dmRecCancel').onclick = () => dmStopRec(false);
  $('dmRecSend').onclick = () => dmStopRec(true);
  $('dmSearchBtn').onclick = dmToggleSearch;
  $('dmSearchClose').onclick = dmCloseSearch;
  $('dmSearchInput').addEventListener('input', (e) => dmRunSearch(e.target.value));
  $('dmMenuBtn').onclick = dmHeaderMenu;
  $('dmScrollFab').onclick = () => dmScrollBottom();
  $('dmThread').addEventListener('scroll', dmOnThreadScroll);
  $('dmInput').addEventListener('input', dmTypingPing);
  dmBuildEmojiPanel();

  sb.channel('dm-inbox-' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${state.user.id}` }, async (payload) => {
      const msg = payload.new;
      if (state.dmPeer === msg.sender_id) {
        dmAppendMessage(msg, { scroll: true }); markDmRead(msg.sender_id); dmShowTyping(false);
      } else {
        refreshDmBadge();
        let p = null; try { ({ data: p } = await sb.from('profiles').select('username,display_name').eq('id', msg.sender_id).single()); } catch {}
        const snip = (msg.deleted ? 'mensaje' : (msg.body || mediaLabel(msg) || 'Adjunto')).slice(0, 38);
        toast('💬 ' + (p?.display_name || p?.username || 'Mensaje') + ': ' + snip);
        if (state.view === 'messages') renderMessages();
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${state.user.id}` }, (payload) => {
      const m = payload.new;
      if (state.dmMsgs.has(m.id)) { state.dmMsgs.set(m.id, m); replaceRow(m); }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${state.user.id}` }, (payload) => {
      const r = document.querySelector(`.dm-row[data-mid="${payload.old.id}"]`); if (r) r.remove();
    })
    .subscribe();
}

/* ---- helpers ---- */
function dmConvKey(a, b) { return [a, b].sort().join(':'); }
function dmTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function dmDayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
function dmDayLabel(ts) {
  const d = new Date(ts), now = new Date(); const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dmDayKey(ts) === dmDayKey(now)) return 'Hoy';
  if (dmDayKey(ts) === dmDayKey(y)) return 'Ayer';
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
function fmtDur(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function safeMeta(msg) { try { return JSON.parse(msg.attachment_name || '{}'); } catch { return {}; } }
function mediaLabel(m) {
  if (!m) return '';
  if (m.attachment_type === 'image') return '📷 Foto';
  if (m.attachment_type === 'video') return '🎬 Vídeo';
  if (m.attachment_type === 'audio') return '🎙️ Nota de voz';
  if (m.attachment_type === 'track') return '🎵 ' + (safeMeta(m).title || 'Pista');
  if (m.attachment_url) return '📎 ' + (m.attachment_name || 'Archivo');
  return '';
}
function dmStatusText() {
  const p = state.dmPeerProfile; if (!p) return '';
  const online = state.online.some(u => u.id === p.id);
  return online ? '<span class="dot-online"></span> en línea' : '@' + esc(p.username || '');
}

/* ---- render de burbujas ---- */
function quotedHTML(id) {
  const q = state.dmMsgs.get(id);
  const who = q ? (q.sender_id === state.user.id ? 'Tú' : (state.dmPeerProfile?.display_name || state.dmPeerProfile?.username || '')) : '';
  const snip = q ? (q.deleted ? 'mensaje eliminado' : (q.body || mediaLabel(q))) : 'Mensaje';
  return `<button class="dm-quote" data-jump="${esc(id)}"><span class="dq-who">${esc(who)}</span><span class="dq-snip">${esc((snip || '').slice(0, 90))}</span></button>`;
}
function statusTicks(msg) {
  return msg.read
    ? `<svg class="dm-tick read"><use href="#i-check-double"/></svg>`
    : `<svg class="dm-tick"><use href="#i-check"/></svg>`;
}
function mediaHTML(msg) {
  if (!msg.attachment_url) return '';
  const t = msg.attachment_type;
  if (t === 'image') return `<img class="dm-img" src="${esc(msg.attachment_url)}" alt="" data-full="${esc(msg.attachment_url)}" />`;
  if (t === 'video') return `<video class="dm-video" src="${esc(msg.attachment_url)}" controls playsinline preload="metadata"></video>`;
  if (t === 'audio') {
    let info = {}; try { info = JSON.parse(msg.attachment_name || '{}'); } catch (_) {}
    let secs = info.d, peaks = info.w;
    if (secs == null) { const n = parseInt(msg.attachment_name, 10); secs = isNaN(n) ? 0 : n; }
    if (!Array.isArray(peaks) || !peaks.length) peaks = dmPlaceholderPeaks(msg.id, 32);
    const bars = peaks.map(p => `<span style="--h:${Math.max(8, Math.min(100, p | 0))}%"></span>`).join('');
    return `<div class="dm-voice" data-audio="${esc(msg.attachment_url)}" data-dur="${secs || 0}"><button class="dm-voice-play" data-vplay aria-label="Reproducir"><svg class="ci-play"><use href="#i-play"/></svg><svg class="ci-pause"><use href="#i-pause"/></svg></button><div class="dm-voice-wave">${bars}</div><span class="dm-voice-time">${fmtDur(secs || 0)}</span></div>`;
  }
  if (t === 'track') {
    const meta = safeMeta(msg);
    const cover = meta.cover_url
      ? `<div class="dm-track-cover" style="background-image:url('${czUrl(meta.cover_url)}')"></div>`
      : `<div class="dm-track-cover"><svg fill="none" stroke="#fff"><use href="#i-music"/></svg></div>`;
    return `<div class="dm-track" data-track-id="${esc(meta.id || '')}">${cover}<div class="dm-track-info"><div class="dm-track-title">${esc(meta.title || 'Pista')}</div><div class="dm-track-artist">${esc(meta.artist || '')}</div></div><button class="dm-track-play" data-dmplay aria-label="Reproducir"><svg class="ci-play"><use href="#i-play"/></svg><svg class="ci-pause"><use href="#i-pause"/></svg></button></div>`;
  }
  return `<a class="dm-filechip" href="${esc(msg.attachment_url)}" target="_blank" rel="noopener"><svg fill="none"><use href="#i-file"/></svg><span class="fn">${esc(msg.attachment_name || 'archivo')}</span></a>`;
}
function bubbleHTML(msg) {
  const mine = msg.sender_id === state.user.id;
  if (msg.deleted) {
    return `<div class="dm-bubble ${mine ? 'me' : 'them'} dm-deleted"><svg class="dm-del-ico"><use href="#i-x"/></svg><i>Se eliminó este mensaje</i><span class="t">${dmTime(msg.created_at)}</span></div>`;
  }
  const quote = msg.reply_to ? quotedHTML(msg.reply_to) : '';
  const media = mediaHTML(msg);
  const isTrack = msg.attachment_type === 'track';
  const cap = (msg.body && !isTrack) ? `<div class="dm-cap">${linkifyMentions(msg.body)}</div>` : '';
  const edited = msg.edited ? `<span class="dm-edited">editado</span>` : '';
  const ticks = mine ? statusTicks(msg) : '';
  const meta = `<span class="t">${edited}${dmTime(msg.created_at)}${ticks}</span>`;
  return `<div class="dm-bubble ${mine ? 'me' : 'them'} ${media ? 'has-media' : ''}">${quote}${media}${cap}${meta}</div>`;
}
function reactionsInner(messageId) {
  const map = state.dmReacts.get(messageId); if (!map) return '';
  const uid = state.user.id;
  return Object.entries(map).filter(([, s]) => s.size).map(([e, s]) =>
    `<button class="dm-react ${s.has(uid) ? 'mine' : ''}" data-emoji="${esc(e)}">${e}<span class="rc">${s.size}</span></button>`).join('');
}
function makeBubble(msg) {
  const mine = msg.sender_id === state.user.id;
  const row = el(`<div class="dm-row ${mine ? 'me' : 'them'}"></div>`);
  row.dataset.mid = msg.id; row.dataset.sender = msg.sender_id; row.dataset.ts = +new Date(msg.created_at);
  row.appendChild(el(bubbleHTML(msg)));
  const rx = el(`<div class="dm-reacts"></div>`); rx.innerHTML = reactionsInner(msg.id); row.appendChild(rx);
  wireBubble(row, msg);
  return row;
}
function wireBubble(row, msg) {
  const bub = row.querySelector('.dm-bubble');
  const img = row.querySelector('.dm-img'); if (img) img.onclick = () => openImageViewer(img.dataset.full);
  const vplay = row.querySelector('[data-vplay]'); if (vplay) vplay.onclick = (e) => { e.stopPropagation(); dmToggleVoice(row.querySelector('.dm-voice')); };
  const wave = row.querySelector('.dm-voice-wave');
  if (wave) wave.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const box = row.querySelector('.dm-voice');
    dmSeekVoice(box, e, false);
    const mv = (ev) => dmSeekVoice(box, ev, true);
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
  const dmPlay = row.querySelector('[data-dmplay]'); if (dmPlay) dmPlay.onclick = (e) => { e.stopPropagation(); playSharedTrack(safeMeta(msg), msg.attachment_url); };
  const jump = row.querySelector('[data-jump]'); if (jump) jump.onclick = (e) => { e.stopPropagation(); dmJumpTo(jump.dataset.jump); };
  wireReactChips(row, msg);
  if (!msg.deleted) attachBubbleGestures(bub, msg);
}
function wireReactChips(row, msg) {
  row.querySelectorAll('.dm-react').forEach(b => b.onclick = (e) => { e.stopPropagation(); toggleReaction(msg.id, b.dataset.emoji); });
}
function replaceRow(msg) {
  const old = document.querySelector(`.dm-row[data-mid="${msg.id}"]`); if (!old) return;
  const row = makeBubble(msg); if (old.classList.contains('cont')) row.classList.add('cont');
  old.replaceWith(row);
}
function dmNearBottom() { const t = $('dmThread'); return t.scrollHeight - t.scrollTop - t.clientHeight < 140; }
function dmScrollBottom(instant) {
  const t = $('dmThread'); t.scrollTop = t.scrollHeight;
  if (!instant) t.scrollTo({ top: t.scrollHeight, behavior: 'smooth' });
  $('dmScrollFab').classList.add('hidden');
}
function dmOnThreadScroll() { $('dmScrollFab').classList.toggle('hidden', dmNearBottom()); }
function dmAppendMessage(msg, { scroll = true } = {}) {
  const thread = $('dmThread'); const empty = thread.querySelector('.dm-empty'); if (empty) empty.remove();
  state.dmMsgs.set(msg.id, msg);
  const day = dmDayKey(msg.created_at);
  if (thread.dataset.lastDay !== day) { thread.appendChild(el(`<div class="dm-day">${esc(dmDayLabel(msg.created_at))}</div>`)); thread.dataset.lastDay = day; }
  const rows = thread.querySelectorAll('.dm-row'); const prev = rows[rows.length - 1];
  const contiguous = thread.lastElementChild && thread.lastElementChild.classList.contains('dm-row');
  const wasNear = dmNearBottom();
  const row = makeBubble(msg);
  if (prev && contiguous && prev.dataset.sender === msg.sender_id && (+new Date(msg.created_at) - (+prev.dataset.ts)) < 300000) row.classList.add('cont');
  thread.appendChild(row);
  if (scroll && (wasNear || msg.sender_id === state.user.id)) dmScrollBottom(true);
  else $('dmScrollFab').classList.toggle('hidden', dmNearBottom());
  return row;
}
function renderThread(messages) {
  const thread = $('dmThread'); thread.innerHTML = ''; thread.dataset.lastDay = '';
  state.dmMsgs.clear();
  if (!messages.length) { thread.innerHTML = `<div class="dm-empty"><svg fill="none"><use href="#i-comment"/></svg><p>Aún no hay mensajes.<br>¡Escribe el primero! 👋</p></div>`; return; }
  messages.forEach(m => dmAppendMessage(m, { scroll: false }));
  dmScrollBottom(true);
}

/* ---- gestos: deslizar para responder + mantener pulsado para menú ---- */
function attachBubbleGestures(node, msg) {
  let sx = 0, sy = 0, dx = 0, drag = false, moved = false, lpTimer = null;
  const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
  node.addEventListener('pointerdown', (e) => {
    sx = e.clientX; sy = e.clientY; dx = 0; drag = true; moved = false;
    lpTimer = setTimeout(() => { clearLp(); if (!moved) { haptic(14); openMsgMenu(msg, node); } }, 480);
  });
  node.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const ddx = e.clientX - sx, ddy = e.clientY - sy;
    if (Math.abs(ddx) > 6 || Math.abs(ddy) > 6) { moved = true; clearLp(); }
    if (Math.abs(ddy) > Math.abs(ddx)) return;
    dx = Math.max(0, Math.min(92, ddx));
    node.style.transform = `translateX(${dx}px)`;
    node.classList.toggle('reply-ready', dx > 52);
  });
  const end = () => {
    if (!drag) return; drag = false; clearLp();
    node.style.transition = 'transform .18s var(--ease)'; node.style.transform = '';
    setTimeout(() => { node.style.transition = ''; }, 190);
    if (dx > 52) { haptic(14); startReply(msg); }
    node.classList.remove('reply-ready'); dx = 0;
  };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('pointerleave', end);
}
function openMsgMenu(msg, node) {
  const mine = msg.sender_id === state.user.id;
  const quick = DM_QUICK_EMOJI.map(e => `<button class="as-react" data-e="${e}">${e}</button>`).join('') + `<button class="as-react more" data-more aria-label="Más emojis"><svg fill="none" stroke="currentColor"><use href="#i-plus"/></svg></button>`;
  const items = [`<button class="as-item" data-a="reply"><svg fill="none" stroke="currentColor"><use href="#i-reply"/></svg> Responder</button>`];
  if (msg.body) items.push(`<button class="as-item" data-a="copy"><svg fill="none" stroke="currentColor"><use href="#i-copy"/></svg> Copiar</button>`);
  if (mine && msg.body) items.push(`<button class="as-item" data-a="edit"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg> Editar</button>`);
  if (mine) items.push(`<button class="as-item danger" data-a="del"><svg fill="none" stroke="currentColor"><use href="#i-trash"/></svg> Eliminar para todos</button>`);
  if (!mine && !msg.deleted) items.push(`<button class="as-item danger" data-a="report"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg> Reportar mensaje</button>`);
  const sheet = el(`<div class="modal-backdrop sheet"><div class="action-sheet"><div class="as-reactbar">${quick}</div>${items.join('')}<button class="as-item cancel" data-a="cancel">Cancelar</button></div></div>`);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelectorAll('.as-react[data-e]').forEach(b => b.onclick = () => { close(); toggleReaction(msg.id, b.dataset.e); });
  sheet.querySelector('[data-more]').onclick = () => { close(); openReactPicker(msg); };
  sheet.querySelector('[data-a="cancel"]').onclick = close;
  sheet.querySelector('[data-a="reply"]').onclick = () => { close(); startReply(msg); };
  const cp = sheet.querySelector('[data-a="copy"]'); if (cp) cp.onclick = () => { close(); copyMessage(msg); };
  const ed = sheet.querySelector('[data-a="edit"]'); if (ed) ed.onclick = () => { close(); editMessage(msg); };
  const dl = sheet.querySelector('[data-a="del"]'); if (dl) dl.onclick = () => { close(); softDeleteMessage(msg); };
  const rp = sheet.querySelector('[data-a="report"]'); if (rp) rp.onclick = () => { close(); openReportModal('message', msg.id, msg.sender_id, 'este mensaje'); };
  $('modalRoot').appendChild(sheet);
}
function openReactPicker(msg) {
  const grid = DM_EMOJIS.map(e => `<button type="button" class="em" data-e="${e}">${e}</button>`).join('');
  const sheet = el(`<div class="modal-backdrop sheet"><div class="action-sheet"><div class="as-emoji-grid">${grid}</div><button class="as-item cancel">Cancelar</button></div></div>`);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelector('.cancel').onclick = close;
  sheet.querySelectorAll('.em').forEach(b => b.onclick = () => { close(); toggleReaction(msg.id, b.dataset.e); });
  $('modalRoot').appendChild(sheet);
}
function startReply(msg) {
  state.dmReplyTo = msg;
  const who = msg.sender_id === state.user.id ? 'Tú' : (state.dmPeerProfile?.display_name || state.dmPeerProfile?.username || '');
  const snip = (msg.deleted ? 'mensaje eliminado' : (msg.body || mediaLabel(msg))) || '';
  const bar = $('dmReplyBar');
  bar.innerHTML = `<svg class="rb-ico"><use href="#i-reply"/></svg><div class="rb-main"><div class="rb-who">${esc(who)}</div><div class="rb-snip">${esc(snip.slice(0, 120))}</div></div><button class="rb-x" title="Cancelar"><svg><use href="#i-x"/></svg></button>`;
  bar.classList.remove('hidden');
  bar.querySelector('.rb-x').onclick = cancelReply;
  $('dmInput').focus();
}
function cancelReply() { state.dmReplyTo = null; const bar = $('dmReplyBar'); if (bar) { bar.classList.add('hidden'); bar.innerHTML = ''; } }
function copyMessage(msg) {
  try { navigator.clipboard.writeText(msg.body || ''); toast('Copiado'); haptic(8); }
  catch { toast('No se pudo copiar'); }
}
function editMessage(msg) {
  const m = openModal(`
    <div class="modal-head"><h3>Editar mensaje</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="field"><textarea id="edBody" maxlength="2000">${esc(msg.body)}</textarea></div>
      <button class="btn primary" id="edSave">Guardar cambios</button>
    </div>`);
  setTimeout(() => m.querySelector('#edBody')?.focus(), 60);
  m.querySelector('#edSave').onclick = async () => {
    const nb = m.querySelector('#edBody').value.trim();
    if (!nb) { toast('El mensaje no puede quedar vacío'); return; }
    const { error } = await sb.from('direct_messages').update({ body: nb, edited: true }).eq('id', msg.id);
    if (error) { toast('No se pudo editar'); return; }
    msg.body = nb; msg.edited = true; state.dmMsgs.set(msg.id, msg); replaceRow(msg);
    m.remove(); toast('Mensaje editado');
  };
}
async function softDeleteMessage(msg) {
  if (!confirm('¿Eliminar este mensaje para todos?')) return;
  const { error } = await sb.from('direct_messages').update({ deleted: true }).eq('id', msg.id);
  if (error) { toast('No se pudo eliminar'); return; }
  msg.deleted = true; state.dmMsgs.set(msg.id, msg); replaceRow(msg);
}
function dmJumpTo(id) {
  const r = document.querySelector(`.dm-row[data-mid="${id}"]`); if (!r) return;
  r.scrollIntoView({ block: 'center', behavior: 'smooth' });
  r.classList.add('dm-flash'); setTimeout(() => r.classList.remove('dm-flash'), 1200);
}

/* ---- reacciones ---- */
async function dmLoadReactions(ids) {
  if (!ids.length) return;
  const { data } = await sb.from('dm_reactions').select('message_id,user_id,emoji').in('message_id', ids);
  (data || []).forEach(r => {
    let m = state.dmReacts.get(r.message_id); if (!m) { m = {}; state.dmReacts.set(r.message_id, m); }
    (m[r.emoji] || (m[r.emoji] = new Set())).add(r.user_id);
  });
}
function dmRefreshReactions(messageId) {
  const row = document.querySelector(`.dm-row[data-mid="${messageId}"]`); if (!row) return;
  const rx = row.querySelector('.dm-reacts'); if (!rx) return;
  rx.innerHTML = reactionsInner(messageId);
  const msg = state.dmMsgs.get(messageId); if (msg) wireReactChips(row, msg);
}
async function toggleReaction(messageId, emoji) {
  const uid = state.user.id;
  let map = state.dmReacts.get(messageId); if (!map) { map = {}; state.dmReacts.set(messageId, map); }
  const set = map[emoji] || (map[emoji] = new Set());
  const had = set.has(uid);
  if (had) { set.delete(uid); if (!set.size) delete map[emoji]; }
  else { set.add(uid); }
  dmRefreshReactions(messageId); haptic(10);
  if (state.dmConv) state.dmConv.send({ type: 'broadcast', event: 'react', payload: { message_id: messageId, emoji, user_id: uid, op: had ? 'remove' : 'add' } });
  try {
    if (had) await sb.from('dm_reactions').delete().eq('message_id', messageId).eq('user_id', uid).eq('emoji', emoji);
    else await sb.from('dm_reactions').insert({ message_id: messageId, user_id: uid, emoji });
  } catch (_) {}
}
function applyRemoteReaction({ message_id, emoji, user_id, op }) {
  let map = state.dmReacts.get(message_id); if (!map) { map = {}; state.dmReacts.set(message_id, map); }
  const set = map[emoji] || (map[emoji] = new Set());
  if (op === 'remove') { set.delete(user_id); if (!set.size) delete map[emoji]; }
  else set.add(user_id);
  dmRefreshReactions(message_id);
}

/* ---- pista compartida (reproductor principal) ---- */
async function playSharedTrack(meta, audioUrl) {
  if (meta && meta.id) {
    if (state.current?.id === meta.id) { togglePlay(); return; }
    const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').eq('id', meta.id).maybeSingle();
    if (data) { state.tracks = [data]; state.queue = [data.id]; playTrack(data); return; }
  }
  if (!audioUrl) { toast('Esta pista ya no está disponible'); return; }
  const t = { id: meta.id || audioUrl, title: meta.title || 'Pista', artist: meta.artist || '', cover_url: meta.cover_url || '', audio_url: audioUrl, duration: 0 };
  state.tracks = [t]; state.queue = [t.id]; playTrack(t);
}
/* ---- nota de voz (mini-reproductor con onda) ---- */
function dmPlaceholderPeaks(seed, n) {
  let s = 0; const str = String(seed || '');
  for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; out.push(22 + (s % 60)); }
  return out;
}
function dmComputePeaks(levels, n) {
  if (!levels || !levels.length) return [];
  let maxv = 0.02; for (let i = 0; i < levels.length; i++) if (levels[i] > maxv) maxv = levels[i];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * levels.length / n), b = Math.max(a + 1, Math.floor((i + 1) * levels.length / n));
    let m = 0; for (let j = a; j < b && j < levels.length; j++) if (levels[j] > m) m = levels[j];
    out.push(Math.min(100, Math.max(10, Math.round(m / maxv * 100))));
  }
  return out;
}
function dmVoiceProgress(box, frac, cur) {
  const wave = box.querySelector('.dm-voice-wave'); const fill = box.querySelector('.dm-voice-fill');
  const tlabel = box.querySelector('.dm-voice-time');
  if (wave) { const bars = wave.children, n = bars.length, upto = Math.round(frac * n); for (let i = 0; i < n; i++) bars[i].classList.toggle('on', i < upto); }
  else if (fill) { fill.style.width = (frac * 100) + '%'; }
  if (tlabel) tlabel.textContent = fmtDur(cur);
}
function dmSeekVoice(box, e, dragging) {
  if (!box) return;
  const wave = box.querySelector('.dm-voice-wave'); if (!wave) return;
  const rect = wave.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const dur0 = parseFloat(box.dataset.dur) || 0;
  if (!dragging && !(dmVoiceEl && dmVoiceEl._box === box)) dmToggleVoice(box);
  const a = dmVoiceEl;
  if (!a || a._box !== box) { dmVoiceProgress(box, frac, frac * dur0); return; }
  const apply = () => { const d = (a.duration && isFinite(a.duration)) ? a.duration : dur0; if (d) { a.currentTime = frac * d; dmVoiceProgress(box, frac, a.currentTime); } };
  if (a.readyState >= 1) apply(); else a.addEventListener('loadedmetadata', apply, { once: true });
}
function dmToggleVoice(box) {
  if (!box) return;
  const dur0 = parseFloat(box.dataset.dur) || 0;
  if (dmVoiceEl && dmVoiceEl._box === box) { if (dmVoiceEl.paused) dmVoiceEl.play(); else dmVoiceEl.pause(); return; }
  if (dmVoiceEl) { dmVoiceEl.pause(); dmVoiceEl._box?.classList.remove('playing'); }
  const a = new Audio(box.dataset.audio); dmVoiceEl = a; a._box = box;
  a.ontimeupdate = () => { const d = (a.duration && isFinite(a.duration)) ? a.duration : dur0; if (d) dmVoiceProgress(box, a.currentTime / d, a.currentTime); };
  a.onended = () => { box.classList.remove('playing'); dmVoiceProgress(box, 0, dur0); };
  a.onplay = () => box.classList.add('playing');
  a.onpause = () => box.classList.remove('playing');
  a.play();
}
function openImageViewer(url) {
  const v = el(`<div class="img-viewer"><img src="${esc(url)}" alt="" /></div>`);
  v.onclick = () => v.remove();
  document.body.appendChild(v);
}

/* ---- adjuntos ---- */
function setDmPending(file) {
  if (file.size > 26214400) { toast('Máximo 25 MB'); $('dmFile').value = ''; return; }
  state.dmPendingFile = file;
  const prev = $('dmAttachPreview');
  const isImg = file.type.startsWith('image');
  prev.innerHTML = `${isImg ? `<img src="${URL.createObjectURL(file)}" alt="" />` : `<svg width="34" height="34" fill="none" stroke="var(--ink-soft)"><use href="#i-file"/></svg>`}<span class="ap-name">${esc(file.name)}</span><button type="button" class="ap-x" id="dmApX">&times;</button>`;
  prev.classList.remove('hidden');
  $('dmApX').onclick = clearDmPending;
}
function clearDmPending() {
  state.dmPendingFile = null;
  $('dmFile').value = '';
  $('dmAttachPreview').classList.add('hidden');
  $('dmAttachPreview').innerHTML = '';
}
async function sendDm(e) {
  e.preventDefault();
  if (!requireNotBanned()) return;
  const other = state.dmPeer; if (!other) return;
  if (state.blocked.has(other)) { toast('Has bloqueado a este usuario. Desbloquéalo para escribirle.'); return; }
  if (state.hidden.has(other)) { toast('No puedes enviar mensajes a este usuario.'); return; }
  const input = $('dmInput'); const body = input.value.trim(); const file = state.dmPendingFile;
  if (!body && !file) return;
  input.value = ''; dmHideEmoji();
  const reply_to = state.dmReplyTo?.id || null; cancelReply();
  if (state.dmConv) state.dmConv.send({ type: 'broadcast', event: 'stop', payload: {} });
  let attachment_url = null, attachment_type = null, attachment_name = null;
  if (file) {
    const sendBtn = $('dmForm').querySelector('.dm-send'); sendBtn.disabled = true;
    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `${state.user.id}/${Date.now()}.${ext}`;
      const up = await sb.storage.from('chat').upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (up.error) throw up.error;
      attachment_url = sb.storage.from('chat').getPublicUrl(path).data.publicUrl;
      attachment_type = file.type.startsWith('image') ? 'image' : file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'file';
      attachment_name = file.name;
    } catch (err) { toast('No se pudo subir el archivo'); sendBtn.disabled = false; return; }
    sendBtn.disabled = false; clearDmPending();
  }
  const { data: sent, error } = await sb.from('direct_messages')
    .insert({ sender_id: state.user.id, recipient_id: other, body, attachment_url, attachment_type, attachment_name, reply_to })
    .select().single();
  if (error) { toast('No se pudo enviar'); return; }
  dmAppendMessage(sent, { scroll: true });
}
async function dmSendAudio(blob, secs, peaks) {
  const other = state.dmPeer; if (!other || !requireNotBanned()) return;
  try {
    const path = `${state.user.id}/${Date.now()}.webm`;
    const up = await sb.storage.from('chat').upload(path, blob, { contentType: blob.type || 'audio/webm' });
    if (up.error) throw up.error;
    const url = sb.storage.from('chat').getPublicUrl(path).data.publicUrl;
    const reply_to = state.dmReplyTo?.id || null; cancelReply();
    const name = JSON.stringify({ d: secs, w: (peaks && peaks.length) ? peaks : undefined });
    const { data: sent, error } = await sb.from('direct_messages')
      .insert({ sender_id: state.user.id, recipient_id: other, body: '', attachment_url: url, attachment_type: 'audio', attachment_name: name, reply_to })
      .select().single();
    if (error) { toast('No se pudo enviar'); return; }
    dmAppendMessage(sent, { scroll: true });
  } catch (err) { toast('No se pudo enviar la nota de voz'); }
}

/* ---- grabación de voz ---- */
async function dmStartRec() {
  if (dmMediaRec) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Tu navegador no soporta notas de voz'); return; }
  try { dmRecStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('No se pudo acceder al micrófono'); return; }
  dmRecChunks = [];
  try { dmMediaRec = new MediaRecorder(dmRecStream); }
  catch (e) { dmMediaRec = new MediaRecorder(dmRecStream, { mimeType: 'audio/webm' }); }
  dmMediaRec.ondataavailable = (ev) => { if (ev.data && ev.data.size) dmRecChunks.push(ev.data); };
  dmMediaRec.start(); dmRecStart = Date.now();
  $('dmRec').classList.remove('hidden'); $('dmForm').classList.add('hidden'); dmHideEmoji();
  $('dmRecTime').textContent = '0:00';
  dmRecTimer = setInterval(() => { $('dmRecTime').textContent = fmtDur((Date.now() - dmRecStart) / 1000); }, 200);
  dmWaveStart(dmRecStream);
  haptic(12);
}
function dmStopRec(send) {
  if (!dmMediaRec) return;
  clearInterval(dmRecTimer);
  const peaks = dmComputePeaks(dmRecLevels, 32);
  dmWaveStop();
  const secs = Math.max(1, Math.round((Date.now() - dmRecStart) / 1000));
  const rec = dmMediaRec; dmMediaRec = null;
  rec.addEventListener('stop', () => {
    if (dmRecStream) { dmRecStream.getTracks().forEach(t => t.stop()); dmRecStream = null; }
    $('dmRec').classList.add('hidden'); $('dmForm').classList.remove('hidden');
    if (send && dmRecChunks.length) dmSendAudio(new Blob(dmRecChunks, { type: rec.mimeType || 'audio/webm' }), secs, peaks);
    dmRecChunks = [];
  }, { once: true });
  try { rec.stop(); } catch (_) {}
}
/* onda de audio en vivo durante la grabación */
function dmWaveStart(stream) {
  const cv = $('dmRecWave'); if (!cv) return;
  try {
    dmRecAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = dmRecAudioCtx.createMediaStreamSource(stream);
    dmRecAnalyser = dmRecAudioCtx.createAnalyser();
    dmRecAnalyser.fftSize = 512;
    src.connect(dmRecAnalyser);
  } catch (e) { return; }
  dmRecLevels = [];
  const ctx = cv.getContext('2d');
  const data = new Uint8Array(dmRecAnalyser.frequencyBinCount);
  const draw = () => {
    dmRecRAF = requestAnimationFrame(draw);
    const dpr = window.devicePixelRatio || 1;
    const cw = cv.clientWidth || 200, ch = cv.clientHeight || 34;
    if (cv.width !== Math.round(cw * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    dmRecAnalyser.getByteTimeDomainData(data);
    let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / data.length);
    dmRecLevels.push(rms);
    const W = cv.width, H = cv.height;
    const barW = 3 * dpr, gap = 2 * dpr, step = barW + gap;
    const maxBars = Math.floor(W / step);
    if (dmRecLevels.length > maxBars) dmRecLevels = dmRecLevels.slice(-maxBars);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#3e57fc';
    for (let i = 0; i < dmRecLevels.length; i++) {
      const h = Math.max(2 * dpr, Math.min(H, dmRecLevels[i] * H * 2.6));
      const x = W - (dmRecLevels.length - i) * step;
      const r = barW / 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, (H - h) / 2, barW, h, r); else ctx.rect(x, (H - h) / 2, barW, h);
      ctx.fill();
    }
  };
  draw();
}
function dmWaveStop() {
  if (dmRecRAF) cancelAnimationFrame(dmRecRAF); dmRecRAF = null;
  if (dmRecAudioCtx) { try { dmRecAudioCtx.close(); } catch (_) {} dmRecAudioCtx = null; }
  dmRecAnalyser = null; dmRecLevels = [];
  const cv = $('dmRecWave'); if (cv && cv.getContext) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
}

/* ---- emoji ---- */
function dmBuildEmojiPanel() {
  const p = $('dmEmojiPanel'); if (!p || p.dataset.built) return; p.dataset.built = '1';
  p.innerHTML = DM_EMOJIS.map(e => `<button type="button" class="em">${e}</button>`).join('');
  p.querySelectorAll('.em').forEach(b => b.onclick = () => insertAtCursor($('dmInput'), b.textContent));
}
function dmToggleEmoji() { $('dmEmojiPanel').classList.toggle('hidden'); if (!$('dmEmojiPanel').classList.contains('hidden')) $('dmInput').focus(); }
function dmHideEmoji() { $('dmEmojiPanel').classList.add('hidden'); }
function insertAtCursor(inp, text) {
  const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
  inp.selectionStart = inp.selectionEnd = s + text.length; inp.focus();
}

/* ---- indicador de "escribiendo" ---- */
function dmTypingPing() {
  if (!state.dmConv) return;
  const now = Date.now();
  if (now - dmTypingThrottle > 1500) { dmTypingThrottle = now; state.dmConv.send({ type: 'broadcast', event: 'typing', payload: {} }); }
  clearTimeout(dmTypingStopTimer);
  dmTypingStopTimer = setTimeout(() => state.dmConv && state.dmConv.send({ type: 'broadcast', event: 'stop', payload: {} }), 2500);
}
function dmShowTyping(on) {
  const t = $('dmTyping'); if (!t) return;
  t.classList.toggle('hidden', !on);
  const st = $('dmStatus'); if (st) { st.innerHTML = on ? 'escribiendo…' : dmStatusText(); st.classList.toggle('typing', on); }
  if (on) { clearTimeout(dmTypingHideTimer); dmTypingHideTimer = setTimeout(() => dmShowTyping(false), 4500); if (dmNearBottom()) dmScrollBottom(true); }
}

/* ---- búsqueda en la conversación ---- */
function dmToggleSearch() { const b = $('dmSearchBar'); b.classList.toggle('hidden'); if (!b.classList.contains('hidden')) $('dmSearchInput').focus(); else dmClearSearchHl(); }
function dmCloseSearch() { $('dmSearchBar').classList.add('hidden'); $('dmSearchInput').value = ''; $('dmSearchCount').textContent = ''; dmClearSearchHl(); }
function dmClearSearchHl() { $('dmThread').querySelectorAll('.dm-row').forEach(r => r.classList.remove('dm-hit', 'dm-dim')); }
function dmRunSearch(q) {
  q = (q || '').trim().toLowerCase();
  const rows = [...$('dmThread').querySelectorAll('.dm-row')];
  if (!q) { dmClearSearchHl(); $('dmSearchCount').textContent = ''; return; }
  let hits = 0, last = null;
  rows.forEach(r => {
    const m = state.dmMsgs.get(r.dataset.mid);
    const has = m && (m.body || '').toLowerCase().includes(q);
    r.classList.toggle('dm-hit', !!has); r.classList.toggle('dm-dim', !has);
    if (has) { hits++; last = r; }
  });
  $('dmSearchCount').textContent = hits ? `${hits}` : '0';
  if (last) last.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ---- menú de cabecera ---- */
function dmHeaderMenu() {
  const other = state.dmPeer;
  const blocked = state.blocked.has(other);
  const peerName = state.dmPeerProfile ? (state.dmPeerProfile.display_name || state.dmPeerProfile.username) : '';
  const sheet = el(`<div class="modal-backdrop sheet"><div class="action-sheet">
    <button class="as-item" data-a="profile"><svg fill="none" stroke="currentColor"><use href="#i-people"/></svg> Ver perfil</button>
    <button class="as-item" data-a="search"><svg fill="none" stroke="currentColor"><use href="#i-search"/></svg> Buscar en el chat</button>
    <button class="as-item" data-a="block"><svg fill="none" stroke="currentColor"><use href="#i-x"/></svg> ${blocked ? 'Desbloquear' : 'Bloquear'}</button>
    <button class="as-item danger" data-a="report"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg> Reportar usuario</button>
    <button class="as-item cancel" data-a="cancel">Cancelar</button>
  </div></div>`);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelector('[data-a="cancel"]').onclick = close;
  sheet.querySelector('[data-a="profile"]').onclick = () => { close(); closeDmScreen(); openProfile(other); };
  sheet.querySelector('[data-a="search"]').onclick = () => { close(); $('dmSearchBar').classList.remove('hidden'); $('dmSearchInput').focus(); };
  sheet.querySelector('[data-a="block"]').onclick = () => { close(); if (blocked) unblockUser(other); else blockUser(other, peerName); };
  sheet.querySelector('[data-a="report"]').onclick = () => { close(); openReportModal('user', other, other, '@' + (state.dmPeerProfile?.username || '')); };
  $('modalRoot').appendChild(sheet);
}

function closeDmScreen() {
  $('dmScreen').classList.remove('open');
  if (state.dmConv) { try { sb.removeChannel(state.dmConv); } catch (_) {} state.dmConv = null; }
  if (dmMediaRec) dmStopRec(false);
  if (dmVoiceEl) { dmVoiceEl.pause(); dmVoiceEl = null; }
  state.dmPeer = null; state.dmPeerProfile = null; state.dmMsgs.clear(); state.dmReacts.clear();
  cancelReply(); clearDmPending(); dmCloseSearch(); dmHideEmoji(); dmShowTyping(false);
  if (state.view === 'messages') renderMessages();
}
async function refreshDmBadge() {
  const { count } = await sb.from('direct_messages').select('id', { count: 'exact', head: true })
    .eq('recipient_id', state.user.id).eq('read', false);
  const n = count || 0;
  const badge = $('dmBadge'), side = $('dmCount');
  if (n > 0) { badge.textContent = n; badge.classList.remove('hidden'); if (side) side.textContent = n; }
  else { badge.classList.add('hidden'); if (side) side.textContent = ''; }
}
function markDmRead(other) {
  sb.from('direct_messages').update({ read: true })
    .eq('sender_id', other).eq('recipient_id', state.user.id).eq('read', false)
    .then(() => refreshDmBadge());
  if (state.dmConv) state.dmConv.send({ type: 'broadcast', event: 'read', payload: {} });
}
function dmMarkAllMineRead() {
  document.querySelectorAll('.dm-row.me').forEach(r => {
    const m = state.dmMsgs.get(r.dataset.mid); if (m && !m.read) m.read = true;
    const tick = r.querySelector('.dm-tick'); if (tick) { tick.classList.add('read'); tick.querySelector('use')?.setAttribute('href', '#i-check-double'); }
  });
}
function openCommunityChat() {
  const r = rightEl();
  if (!r.classList.contains('open')) toggleRight();
}
function convoRow(c, p) {
  const mine = c.last.sender_id === state.user.id;
  const online = state.online.some(u => u.id === c.other);
  let snip = c.last.body;
  if (c.last.deleted) snip = '🚫 Mensaje eliminado';
  else if (c.last.attachment_url) {
    if (c.last.attachment_type === 'track') snip = c.last.body || '🎵 Pista';
    else { const lbl = c.last.attachment_type === 'image' ? '📷 Foto' : c.last.attachment_type === 'video' ? '🎬 Vídeo' : c.last.attachment_type === 'audio' ? '🎙️ Nota de voz' : '📎 Archivo'; snip = lbl + (c.last.body ? ' · ' + c.last.body : ''); }
  }
  const row = el(`
    <div class="convo" data-uid="${c.other}">
      ${avatarHTML(p)}
      <div class="c-main">
        <div class="c-top"><span class="c-name">${esc(p.display_name || p.username || 'usuario')}</span><span class="c-when">${timeAgo(c.last.created_at)}</span></div>
        <div class="c-snippet ${c.unread ? 'unread' : ''}">${mine ? 'Tú: ' : ''}${esc(snip || '')}</div>
      </div>
      ${c.unread ? '<span class="c-unread"></span>' : (online ? '<span class="conv-dot" title="En línea"></span>' : '')}
    </div>`);
  row.onclick = () => openDM(c.other);
  return row;
}
async function renderMessages() {
  setActiveNav('messages');
  $('main').innerHTML = `<div class="main-head"><div><h2>Chats</h2><div class="sub">Tus conversaciones</div></div><div id="pushBtnWrap" class="push-btn-wrap"></div></div><div id="convoList" class="loading"><div class="spinner"></div></div>`;
  renderPushButton();
  const { data } = await sb.from('direct_messages').select('*')
    .or(`sender_id.eq.${state.user.id},recipient_id.eq.${state.user.id}`)
    .order('created_at', { ascending: false }).limit(400);
  const convos = new Map();
  (data || []).forEach(mm => {
    const other = mm.sender_id === state.user.id ? mm.recipient_id : mm.sender_id;
    if (isHidden(other)) return; // ocultar conversaciones con usuarios bloqueados
    if (!convos.has(other)) convos.set(other, { other, last: mm, unread: 0 });
    if (mm.recipient_id === state.user.id && !mm.read) convos.get(other).unread++;
  });
  const list = $('convoList'); list.className = '';
  list.innerHTML = '';

  // Chat general (comunidad) fijado arriba
  const comm = el(`
    <div class="convo convo-community">
      <div class="avatar"><svg width="22" height="22" fill="none" stroke="#fff"><use href="#i-comment"/></svg></div>
      <div class="c-main"><div class="c-top"><span class="c-name">Chat general</span></div>
      <div class="c-snippet">Conversación de toda la comunidad</div></div>
    </div>`);
  comm.onclick = openCommunityChat;
  list.appendChild(comm);

  if (convos.size === 0) {
    list.appendChild(el(`<div class="empty"><svg fill="none"><use href="#i-mail"/></svg><p>Aún no tienes conversaciones privadas.<br>Pulsa <b>Mensaje</b> en alguien de <b>Bro's</b> o en su perfil para empezar.</p></div>`));
    return;
  }
  const ids = [...convos.keys()];
  const { data: profs } = await sb.from('profiles').select('*').in('id', ids);
  const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
  const onlineIds = new Set(state.online.map(u => u.id));
  const all = [...convos.values()];
  const online = all.filter(c => onlineIds.has(c.other));
  const offline = all.filter(c => !onlineIds.has(c.other));

  if (online.length) {
    list.appendChild(el(`<div class="convo-section"><span class="dot-online"></span> En línea (${online.length})</div>`));
    online.forEach(c => list.appendChild(convoRow(c, byId[c.other] || {})));
  }
  if (offline.length) {
    list.appendChild(el(`<div class="convo-section">Desconectados (${offline.length})</div>`));
    offline.forEach(c => list.appendChild(convoRow(c, byId[c.other] || {})));
  }
}

async function openDM(other) {
  if (!other || other === state.user.id) return;
  const { data: prof } = await sb.from('profiles').select('*').eq('id', other).single();
  if (!prof) { toast('Usuario no encontrado'); return; }
  state.dmPeer = other; state.dmPeerProfile = prof;
  cancelReply(); clearDmPending(); dmCloseSearch(); dmHideEmoji();
  const name = prof.display_name || prof.username;
  const online = state.online.some(u => u.id === other);
  $('dmPeerHead').innerHTML = `${avatarHTML(prof)}<div class="dm-peer-meta"><div class="dm-name">${esc(name)}${verifiedBadge(prof)}</div><div class="dm-status" id="dmStatus">${online ? '<span class="dot-online"></span> en línea' : '@' + esc(prof.username)}</div></div>`;
  $('dmPeerHead').onclick = () => { closeDmScreen(); openProfile(other); };
  $('dmInput').placeholder = `Mensaje para ${name}...`;
  const thread = $('dmThread');
  thread.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  $('dmScreen').classList.add('open');
  hideDrawers();

  if (state.dmConv) { try { sb.removeChannel(state.dmConv); } catch (_) {} state.dmConv = null; }
  const ch = sb.channel('dmconv:' + dmConvKey(state.user.id, other), { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'typing' }, () => dmShowTyping(true))
    .on('broadcast', { event: 'stop' }, () => dmShowTyping(false))
    .on('broadcast', { event: 'read' }, () => dmMarkAllMineRead())
    .on('broadcast', { event: 'react' }, ({ payload }) => applyRemoteReaction(payload))
    .subscribe();
  state.dmConv = ch;

  const { data } = await sb.from('direct_messages').select('*')
    .or(`and(sender_id.eq.${state.user.id},recipient_id.eq.${other}),and(sender_id.eq.${other},recipient_id.eq.${state.user.id})`)
    .order('created_at', { ascending: true }).limit(400);
  const msgs = data || [];
  state.dmReacts.clear();
  await dmLoadReactions(msgs.map(m => m.id));
  renderThread(msgs);
  markDmRead(other);
  setTimeout(() => $('dmInput')?.focus(), 120);
}

/* =======================================================================
   PRESENCIA (People Online)
   ======================================================================= */
function initPresence() {
  const channel = sb.channel('online-users', { config: { presence: { key: state.user.id } } });
  state.presence = channel;
  channel.on('presence', { event: 'sync' }, () => {
    const st = channel.presenceState();
    const users = [];
    Object.values(st).forEach(arr => { if (arr[0]) users.push(arr[0]); });
    state.online = users;
    renderOnline(users);
  });
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({
        id: state.user.id,
        username: state.profile.username,
        display_name: state.profile.display_name || state.profile.username,
        avatar_url: state.profile.avatar_url || null,
        online_at: new Date().toISOString(),
      });
    }
  });
}
function renderOnline(users) {
  users = (users || []).filter(u => !isHidden(u.id));
  $('onlineCount').textContent = users.length;
  const list = $('onlineList');
  list.innerHTML = users.map(u => `
    <div class="online-item" data-uid="${u.id}">
      ${avatarHTML(u)}
      <div class="meta"><div class="n">${esc(u.display_name||u.username)}</div><div class="s">en línea</div></div>
      <span class="dot-online"></span>
    </div>`).join('') || '<div class="sub" style="font-size:12px;color:var(--ink-soft)">Nadie más conectado.</div>';
  list.querySelectorAll('.online-item').forEach(it => it.onclick = () => openProfile(it.dataset.uid));
}

/* =======================================================================
   COOKIES / POLÍTICA DE PRIVACIDAD
   ======================================================================= */
function initCookies() {
  const banner = $('cookieBanner');
  if (!banner) return;
  if (!localStorage.getItem('ub_cookie_ok')) banner.classList.remove('hidden');
  $('ckAccept').onclick = () => { localStorage.setItem('ub_cookie_ok', '1'); banner.classList.add('hidden'); };
  $('ckPolicyBtn').onclick = showPrivacyPolicy;
  $('ckPolicyLink').onclick = showPrivacyPolicy;
}
function showPrivacyPolicy() {
  openModal(`
    <div class="modal-head"><h3>Política de privacidad y cookies</h3><button class="close">&times;</button></div>
    <div class="modal-body policy-body">
      <p><b>UnderBro</b> es una plataforma social de música. Aquí explicamos qué datos tratamos y cómo controlarlos.</p>
      <h4>Datos que guardamos</h4>
      <ul>
        <li>Cuenta: tu correo y una contraseña cifrada (gestionada por Supabase Auth).</li>
        <li>Perfil: nombre, usuario, biografía y foto.</li>
        <li>Contenido: pistas que subes, portadas, comentarios, "me gusta", seguidores, mensajes del chat y mensajes directos.</li>
      </ul>
      <h4>Cookies y almacenamiento local</h4>
      <p>Usamos almacenamiento local del navegador para mantener tu sesión iniciada, recordar el volumen y tus preferencias. No usamos cookies de publicidad ni de rastreo de terceros.</p>
      <h4>Dónde se procesan</h4>
      <p>Los datos se almacenan en <b>Supabase</b> (base de datos y archivos) y la web se sirve mediante <b>Vercel</b>, actuando como encargados del tratamiento.</p>
      <h4>Seguridad y moderación</h4>
      <p>Puedes <b>bloquear</b> a cualquier usuario (deja de poder escribirte y ocultas su contenido) y <b>reportar</b> perfiles, pistas, fotos y mensajes. El contenido que infrinja derechos o las normas puede ser retirado por moderación.</p>
      <h4>Tus derechos</h4>
      <p>Puedes editar tu perfil en cualquier momento y <b>eliminar tu cuenta y todos tus datos y archivos</b> desde <b>Ajustes → Eliminar cuenta</b>. Esa acción es permanente.</p>
      <p style="color:var(--ink-soft);font-size:12px;margin-top:14px">Versión completa en <a href="/privacy" target="_blank" rel="noopener">underbro.app/privacy</a> · Última actualización: ${new Date().toLocaleDateString('es-ES')}.</p>
    </div>`);
}

/* =======================================================================
   NOTIFICACIONES PUSH (avisos de chat aunque la app esté cerrada)
   ======================================================================= */
const VAPID_PUBLIC_KEY = 'BBJ5UnpZOyR3TkdAjWbqtxZcmJAz4N2Q-3ewRRnRoVGCz_ZdPV__mnX_xGAd165aLrwzGoyFTVUwLAqcCWo8xaw';
let swRegistration = null;

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function setupPush() {
  if (!pushSupported()) return;
  try { swRegistration = await navigator.serviceWorker.register('/sw.js'); } catch (_) { return; }
  if (Notification.permission === 'granted') { try { await subscribeAndSave(); } catch (_) {} }
}
async function subscribeAndSave() {
  if (!swRegistration) swRegistration = await navigator.serviceWorker.ready;
  let sub = await swRegistration.pushManager.getSubscription();
  if (!sub) {
    sub = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await sb.from('push_subscriptions').upsert(
    { user_id: state.user.id, endpoint: sub.endpoint, subscription: sub.toJSON() },
    { onConflict: 'endpoint' }
  );
  return sub;
}
async function enablePush() {
  if (!pushSupported()) { toast('Tu navegador no soporta notificaciones'); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Permiso de notificaciones denegado'); renderPushButton(); return; }
    await setupPush();
    await subscribeAndSave();
    toast('🔔 Notificaciones activadas');
  } catch (_) { toast('No se pudieron activar las notificaciones'); }
  renderPushButton();
}
function renderPushButton() {
  const wrap = document.getElementById('pushBtnWrap');
  if (!wrap) return;
  if (!pushSupported() || Notification.permission === 'granted') { wrap.innerHTML = ''; return; }
  if (Notification.permission === 'denied') {
    wrap.innerHTML = `<span class="push-hint">🔕 Notificaciones bloqueadas en el navegador</span>`;
    return;
  }
  wrap.innerHTML = `<button class="btn primary" id="enablePushBtn"><svg fill="none" stroke="#fff"><use href="#i-bell"/></svg> Activar avisos</button>`;
  const b = document.getElementById('enablePushBtn');
  if (b) b.onclick = enablePush;
}

/* =======================================================================
   AUTO-ACTUALIZACIÓN (si hay versión nueva publicada, recarga sola)
   ======================================================================= */
async function checkForUpdate() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const { v } = await r.json();
    if (v && v !== APP_VERSION && sessionStorage.getItem('ub_reload_for') !== v) {
      sessionStorage.setItem('ub_reload_for', v); // evita bucles de recarga
      location.reload();
    }
  } catch {}
}
// comprobar al cargar, al volver a la app, al recuperar foco y cada 45s
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
window.addEventListener('focus', checkForUpdate);
window.addEventListener('online', checkForUpdate);
setInterval(checkForUpdate, 45000);

/* ----------------------------------------------------------------------- */
setTheme(currentTheme());
initCookies();
init();
checkForUpdate();
})();
