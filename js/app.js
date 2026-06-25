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
  hiddenConvos: new Set(JSON.parse(localStorage.getItem('ub_hidden_convos') || '[]')), // chats ocultados localmente
  groupId: null,       // id de la conversación de grupo abierta (null = DM 1-a-1)
  groupConv: null,     // datos de la conversación de grupo abierta
  groupMembers: {},    // miembros del grupo abierto (id → perfil)
  call: null,          // llamada en curso (audio/vídeo) o null
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

// Modal "Invitar amigos": enlace personal con ?ref= + compartir nativo + contador.
function openInviteModal() {
  const uname = (state.profile && state.profile.username) || '';
  const url = uname ? `${location.origin}/?ref=${encodeURIComponent(uname)}` : location.origin + '/';
  const text = 'Únete a mí en UnderBro, la red social de la música. Sube tus pistas gratis 🎵🚀';
  const m = openModal(`
    <div class="modal-head"><h3>Invitar amigos</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="invite-hero">
        <div class="invite-ic"><svg fill="none" stroke="#fff"><use href="#i-people"/></svg></div>
        <p class="invite-txt">Comparte tu enlace. Cuando alguien entre y se una con él, contará como tu invitado y harás crecer tu comunidad.</p>
        <div class="invite-count" id="inviteCount">—</div>
        <div class="invite-count-l">amigos invitados</div>
      </div>
      <button class="btn primary share-big" id="inviteShare"><svg fill="none" stroke="#fff"><use href="#i-share"/></svg> Compartir invitación</button>
      <div class="share-link"><input type="text" id="inviteUrl" readonly value="${esc(url)}" onclick="this.select()" /><button class="btn sm primary" id="inviteCopy">Copiar</button></div>
    </div>`);
  sb.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', state.user.id)
    .then(({ count }) => { const e = m.querySelector('#inviteCount'); if (e) e.textContent = count || 0; }).catch(() => {});
  m.querySelector('#inviteShare').onclick = async () => {
    haptic(12);
    if (navigator.share) { try { await navigator.share({ title: 'UnderBro', text, url }); return; } catch (err) { if (err && err.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Enlace de invitación copiado'); } catch (_) { toast(url); }
  };
  const cp = m.querySelector('#inviteCopy');
  cp.onclick = async () => { try { await navigator.clipboard.writeText(url); } catch { const i = m.querySelector('#inviteUrl'); i.select(); try { document.execCommand('copy'); } catch {} } cp.textContent = 'Copiado ✓'; toast('Enlace copiado'); };
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
function skeletonGrid(n=8) { let s = ''; for (let i=0;i<n;i++) s += `<div class="sk" style="aspect-ratio:1;border-radius:var(--r)"></div>`; return s; }
function skeletonProfile() {
  return `<div class="profile-view"><div class="sk" style="height:200px;border-radius:var(--r-lg)"></div>
    <div style="display:flex;flex-direction:column;align-items:center;margin-top:-60px">
      <div class="sk" style="width:120px;height:120px;border-radius:50%;border:5px solid var(--panel)"></div>
      <div class="sk sk-line" style="width:160px;height:20px;margin-top:14px"></div>
      <div class="sk sk-line" style="width:100px"></div>
      <div class="sk" style="width:240px;height:46px;border-radius:16px;margin-top:14px"></div>
    </div>${skeletonFeed(3)}</div>`;
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
  if (url) return `<div class="avatar ${cls}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async"${st} /></div>`;
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
$('googleBtn').onclick = signInWithGoogle;

async function signInWithGoogle() {
  const btn = $('googleBtn'); const msg = $('authMsg');
  msg.className = 'auth-msg'; msg.textContent = '';
  btn.disabled = true;
  try {
    // conserva el ?ref= de invitación al volver del login de Google
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.search },
    });
    if (error) throw error;
    // el navegador redirige a Google; al volver, onAuthStateChange arranca la sesión
  } catch (err) {
    msg.className = 'auth-msg error';
    msg.textContent = 'No se pudo iniciar con Google. ' + traducirError(err.message || '');
    btn.disabled = false;
  }
}

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
let bootDone = false;
/* =======================================================================
   PERSONALIZACIÓN GLOBAL (publicada desde /editor por el admin)
   ======================================================================= */
async function applySiteConfig() {
  let g = null, u = null;
  try { const { data } = await sb.from('site_config').select('config').eq('id', 1).maybeSingle(); g = data && data.config; } catch (_) {}
  if (state.user) { try { const { data } = await sb.from('user_site_config').select('config').eq('user_id', state.user.id).maybeSingle(); u = data && data.config; } catch (_) {} }
  const eff = mergeSiteConfigs(g || {}, u || {});
  if (eff && Object.keys(eff).length) { try { renderSiteConfig(eff); } catch (_) {} }
}
// fusiona la config global con la personal del usuario (la personal manda)
function mergeSiteConfigs(g, u) {
  const e = (g && typeof g === 'object') ? JSON.parse(JSON.stringify(g)) : {};
  if (!u || typeof u !== 'object') return e;
  for (const k in u) {
    if (k === 'colors' || k === 'tabs' || k === 'nav' || k === 'font' || k === 'bg') e[k] = Object.assign({}, e[k] || {}, u[k]);
    else if (k === 'el') e.el = Object.assign({}, e.el || {}, u.el);
    else if (k === 'add') e.add = [...(e.add || []), ...(u.add || [])];
    else e[k] = u[k];
  }
  return e;
}
const SITE_FONTS = {
  Poppins: 'Poppins', Inter: 'Inter', Montserrat: 'Montserrat', Roboto: 'Roboto',
  Nunito: 'Nunito', Lato: 'Lato', 'Space Grotesk': 'Space Grotesk', Oswald: 'Oswald',
  'Playfair Display': 'Playfair Display', 'DM Sans': 'DM Sans',
};
function loadSiteFont(name) {
  if (!name || name === 'system' || !SITE_FONTS[name]) return null;
  const id = 'site-font-link';
  if (!document.getElementById(id)) {
    const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}:wght@400;500;600;700;800&display=swap`;
    document.head.appendChild(l);
  }
  return `'${SITE_FONTS[name]}', var(--font)`;
}
const _hex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
function renderSiteConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  const root = document.documentElement, body = document.body, set = (k, v) => root.style.setProperty(k, v);
  // FONDO
  const bg = cfg.bg || {};
  let bgVal = '';
  const safeImg = bg.image ? String(bg.image).replace(/["\\]/g, '') : '';
  const dim = Math.max(0, Math.min(85, +bg.dim || 0)) / 100;
  if (bg.mode === 'color' && bg.color) bgVal = bg.color;
  else if (bg.mode === 'gradient' && bg.c1 && bg.c2) bgVal = `linear-gradient(${bg.angle != null ? bg.angle : 135}deg, ${bg.c1}, ${bg.c2})`;
  else if (bg.mode === 'image' && safeImg) bgVal = `${dim ? `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),` : ''}#0a0d18 url("${safeImg}") center/cover fixed no-repeat`;
  if (bgVal) { body.style.background = bgVal; document.querySelector('.app')?.style.setProperty('background', 'transparent'); }
  // COLORES
  const c = cfg.colors || {};
  const acc = c.accent || cfg.accent;
  if (_hex(acc)) { set('--blue', acc); set('--blue-deep', acc); set('--blue-2', acc); set('--accent', acc); }
  if (_hex(acc)) {
    const acc2 = _hex(c.accent2) ? c.accent2 : acc;
    const grad = `linear-gradient(120deg, ${acc} 0%, ${acc2} 100%)`;
    set('--accent-grad', grad); set('--aqua-grad', grad); set('--cover-grad', grad);
  }
  if (_hex(c.ink)) set('--ink', c.ink);
  if (_hex(c.ink2)) set('--ink-2', c.ink2);
  if (_hex(c.inkSoft)) set('--ink-soft', c.inkSoft);
  if (_hex(c.panel)) set('--panel', c.panel);
  if (_hex(c.panel2)) set('--panel-2', c.panel2);
  if (_hex(c.line)) { set('--line', c.line); set('--line-soft', c.line); }
  if (_hex(c.appbg)) { set('--bg', c.appbg); set('--bg-2', c.appbg); }
  // TIPOGRAFÍA
  const fam = loadSiteFont(cfg.font && cfg.font.family);
  if (fam) set('--font', fam);
  // FORMAS (redondez)
  if (cfg.radius != null && +cfg.radius >= 0) {
    const r = +cfg.radius;
    set('--r-sm', Math.round(r * 0.7) + 'px'); set('--r', r + 'px');
    set('--r-lg', Math.round(r * 1.3) + 'px'); set('--r-xl', Math.round(r * 1.7) + 'px');
  }
  // MARCA: logo / nombre / eslogan
  if (cfg.logo) {
    const src = String(cfg.logo).replace(/["\\]/g, '');
    document.querySelectorAll('.logo').forEach((l) => { l.innerHTML = `<img src="${src}" alt="${(cfg.name || 'logo')}" style="height:1.15em;width:auto;vertical-align:middle;display:inline-block">`; });
  } else if (cfg.name) {
    document.querySelectorAll('.logo').forEach((l) => { l.textContent = cfg.name; });
  }
  if (cfg.name) document.title = cfg.name;
  if (cfg.tagline) document.querySelectorAll('[data-tagline]').forEach((t) => { t.textContent = cfg.tagline; });
  // ORDEN / VISIBILIDAD de pestañas del feed y secciones del menú
  applyOrderHide('#feedTabs', 'button[data-tab]', 'tab', cfg.tabs);
  applyOrderHide('#sidebar', '.nav-item[data-view]', 'view', cfg.nav);
  // OVERRIDES POR ELEMENTO (editor visual: arrastrar/editar elementos)
  applyElementOverrides(cfg.el);
  // ELEMENTOS CREADOS en el editor (texto/imagen/caja/botón)
  applyAddedElements(cfg.add);
  if (document.body) ensureAnimCss(document);
}
const UB_ANIMS = { fade:{kf:'ubFade',ease:'ease',count:'1',both:true,def:.6}, slide:{kf:'ubSlideUp',ease:'cubic-bezier(.22,.61,.36,1)',count:'1',both:true,def:.6}, zoom:{kf:'ubZoom',ease:'ease',count:'1',both:true,def:.5}, float:{kf:'ubFloat',ease:'ease-in-out',count:'infinite',def:3}, pulse:{kf:'ubPulse',ease:'ease-in-out',count:'infinite',def:2}, spin:{kf:'ubSpin',ease:'linear',count:'infinite',def:6}, shake:{kf:'ubShake',ease:'ease',count:'infinite',def:1} };
const UB_ANIM_KF = '@keyframes ubFade{from{opacity:0}to{opacity:1}}@keyframes ubSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}@keyframes ubZoom{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:none}}@keyframes ubFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}@keyframes ubPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}@keyframes ubSpin{to{transform:rotate(360deg)}}@keyframes ubShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}';
function ensureAnimCss(doc) { if (doc.getElementById('ub-anim-kf')) return; const s = doc.createElement('style'); s.id = 'ub-anim-kf'; s.textContent = UB_ANIM_KF; doc.head.appendChild(s); }
function ubComposeDecls(o, important) {
  const bang = important ? ' !important' : '';
  const d = [];
  if (o.hide) d.push('display:none' + bang);
  const tr = [];
  if (o.move && (o.move.x || o.move.y)) tr.push(`translate(${+o.move.x || 0}px, ${+o.move.y || 0}px)`);
  if (o.rot) tr.push(`rotate(${+o.rot}deg)`);
  if (o.scale != null && +o.scale !== 1) tr.push(`scale(${+o.scale})`);
  if (tr.length) d.push(`transform:${tr.join(' ')}${bang}`);
  const fl = [];
  if (o.blur) fl.push(`blur(${+o.blur}px)`);
  if (o.bright != null && +o.bright !== 100) fl.push(`brightness(${+o.bright}%)`);
  if (fl.length) d.push(`filter:${fl.join(' ')}${bang}`);
  if (o.anim && o.anim.name && UB_ANIMS[o.anim.name]) { const a = UB_ANIMS[o.anim.name]; const dur = +o.anim.dur || a.def; d.push(`animation:${a.kf} ${dur}s ${a.ease} ${a.count}${a.both ? ' both' : ''}${bang}`); }
  if (o.style) for (const p in o.style) { if (o.style[p] !== '' && o.style[p] != null) d.push(`${p}:${o.style[p]}${bang}`); }
  return d;
}
function ubMakeAdded(doc, it) {
  if (!it || !it.id || it.hide) return null;
  const tag = it.type === 'button' ? 'a' : (it.type === 'image' ? 'img' : 'div');
  const e = doc.createElement(tag); const s = e.style;
  e.setAttribute('data-ubid', it.id);
  s.position = 'absolute'; s.left = (+it.x || 0) + 'px'; s.top = (+it.y || 0) + 'px'; s.pointerEvents = 'auto';
  if (it.type === 'image') { e.src = it.src || ''; e.alt = ''; s.display = 'block'; s.objectFit = 'cover'; if (!(it.style && it.style.width)) s.width = '200px'; }
  else if (it.type === 'button') { e.textContent = it.text || 'Botón'; if (it.href) { e.href = it.href; e.target = '_blank'; e.rel = 'noopener'; } s.display = 'inline-block'; s.textDecoration = 'none'; s.padding = '10px 18px'; s.borderRadius = '30px'; s.background = 'var(--blue)'; s.color = '#fff'; s.fontWeight = '700'; s.fontSize = '14px'; }
  else if (it.type === 'text') { e.textContent = it.text || 'Texto'; s.fontSize = '20px'; s.fontWeight = '700'; s.color = 'var(--ink)'; }
  else { if (!(it.style && it.style.width)) s.width = '160px'; if (!(it.style && it.style.height)) s.height = '90px'; s.background = 'rgba(95,155,255,.22)'; s.borderRadius = '12px'; }
  ubComposeDecls(it, false).forEach((decl) => { const i = decl.indexOf(':'); try { s.setProperty(decl.slice(0, i), decl.slice(i + 1)); } catch (_) {} });
  return e;
}
function applyAddedElements(list) {
  let layer = document.getElementById('ub-custom');
  if (!Array.isArray(list) || !list.length) { if (layer) layer.remove(); return; }
  if (!layer) { layer = document.createElement('div'); layer.id = 'ub-custom'; document.body.appendChild(layer); }
  layer.style.cssText = 'position:fixed;inset:0;z-index:40;pointer-events:none';
  layer.innerHTML = '';
  list.forEach((it) => { const e = ubMakeAdded(document, it); if (e) layer.appendChild(e); });
}
function applyElementOverrides(el) {
  if (!el || typeof el !== 'object') return;
  let css = ''; const dyn = [];
  for (const sel in el) {
    const o = el[sel]; if (!o) continue;
    const decls = ubComposeDecls(o, true);
    if (decls.length) css += `${sel}{${decls.join(';')}}\n`;
    if (o.text != null || o.img != null) dyn.push([sel, o]);
  }
  let tag = document.getElementById('ub-el-css');
  if (!tag) { tag = document.createElement('style'); tag.id = 'ub-el-css'; document.head.appendChild(tag); }
  tag.textContent = css;
  if (dyn.length) {
    const applyDyn = () => dyn.forEach(([sel, o]) => { try { document.querySelectorAll(sel).forEach((n) => {
      if (o.text != null && n.textContent !== o.text) n.textContent = o.text;
      if (o.img != null && n.tagName === 'IMG' && n.getAttribute('src') !== o.img) n.setAttribute('src', o.img);
    }); } catch (_) {} });
    applyDyn();
    if (!window.__ubTextObs) { window.__ubTextObs = new MutationObserver(() => { clearTimeout(window.__ubTextT); window.__ubTextT = setTimeout(applyDyn, 200); }); try { window.__ubTextObs.observe(document.body, { childList: true, subtree: true }); } catch (_) {} }
    else { window.__ubApplyDyn = applyDyn; }
  }
}
function applyOrderHide(containerSel, itemSel, dataKey, conf) {
  if (!conf) return;
  const cont = document.querySelector(containerSel); if (!cont) return;
  const items = [...cont.querySelectorAll(itemSel)];
  const byKey = {}; items.forEach((el) => { byKey[el.dataset[dataKey]] = el; });
  (conf.hidden || []).forEach((k) => { if (byKey[k]) byKey[k].style.display = 'none'; });
  (conf.order || []).forEach((k) => { const el = byKey[k]; if (el && el.parentNode) el.parentNode.appendChild(el); });
}


// ------------------------------------------------------- onboarding / guía
let ubInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ubInstallPrompt = e; });

const TOUR_STEPS = [
  { t: ['#feedTabs'], title: 'Tu feed 🎧', text: 'Cambia entre <b>Following</b>, <b>Trending</b> y <b>New</b> para descubrir música de la comunidad.' },
  { t: ['#btnSearchToggle', '#searchInput'], title: 'Buscar 🔎', text: 'Encuentra artistas, pistas y gente al instante.' },
  { t: ['#menuToggle', '#btnUpload'], title: 'Menú y Subir ⬆️', text: 'Aquí abres el menú para <b>Subir</b> tu música y entrar en Radio, Beats, Eventos, Fotos y tu biblioteca.' },
  { t: ['#btnMessages'], title: 'Chats 💬', text: 'Habla por privado con otros bros.' },
  { t: ['#btnNotif'], title: 'Notificaciones 🔔', text: 'Mira quién te sigue, comenta o da like a tu música.' },
  { t: ['#meChip'], title: 'Tu perfil 👤', text: 'Edita tu perfil y entra en <b>Ajustes</b> desde aquí.' },
];
function firstVisible(sels) { for (const s of sels) { const el = document.querySelector(s); if (el && el.offsetParent !== null) return el; } return null; }
function ensureOnbCss() {
  if (document.getElementById('ub-onb-css')) return;
  const s = document.createElement('style'); s.id = 'ub-onb-css';
  s.textContent = '.ub-tour{position:fixed;inset:0;z-index:100000;pointer-events:none}.ub-tour .ub-spot{position:fixed;border-radius:12px;box-shadow:0 0 0 9999px rgba(2,5,12,.74);transition:left .25s,top .25s,width .25s,height .25s;pointer-events:none}.ub-tour .ub-pop{position:fixed;left:50%;transform:translateX(-50%);width:min(92vw,420px);background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);pointer-events:auto}.ub-tour .ub-pop.bottom{bottom:22px}.ub-tour .ub-pop.top{top:22px}.ub-tour .ub-pop-t{font-weight:800;font-size:16px;margin-bottom:5px}.ub-tour .ub-pop-x{font-size:13.5px;color:var(--ink-2);line-height:1.5}.ub-tour .ub-dots{display:flex;gap:5px;justify-content:center;margin-top:12px}.ub-tour .ub-dots i{width:6px;height:6px;border-radius:50%;background:var(--line)}.ub-tour .ub-dots i.on{background:var(--blue)}.ub-tour .ub-pop-b{display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:10px}.ub-tour .ub-skip{background:none;border:none;color:var(--ink-soft);font-size:13px;font-weight:600;cursor:pointer}.ub-tour .ub-nav{display:flex;gap:8px}.ub-tour .nv{border:1px solid var(--line);background:var(--panel-2);color:var(--ink);border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer}.ub-tour .nv.primary{background:var(--blue);color:#fff;border:none}.setup-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--line-soft)}.setup-row:last-of-type{border-bottom:none}.setup-row .sub{font-size:12px;color:var(--ink-soft);margin-top:2px}';
  document.head.appendChild(s);
}
function runTour(steps) {
  ensureOnbCss();
  steps = steps.filter((s) => firstVisible(s.t));
  if (!steps.length) { toast('La guía no encontró elementos que mostrar aquí.'); return; }
  let i = 0;
  const ov = document.createElement('div'); ov.className = 'ub-tour';
  ov.innerHTML = `<div class="ub-spot"></div><div class="ub-pop"><div class="ub-pop-t"></div><div class="ub-pop-x"></div><div class="ub-dots"></div><div class="ub-pop-b"><button class="ub-skip">Saltar</button><div class="ub-nav"><button class="nv ub-prev">Atrás</button><button class="nv primary ub-next">Siguiente</button></div></div></div>`;
  document.body.appendChild(ov);
  const spot = ov.querySelector('.ub-spot'), pop = ov.querySelector('.ub-pop');
  const place = () => {
    const el = firstVisible(steps[i].t); if (!el) return;
    const r = el.getBoundingClientRect();
    spot.style.left = (r.left - 6) + 'px'; spot.style.top = (r.top - 6) + 'px'; spot.style.width = (r.width + 12) + 'px'; spot.style.height = (r.height + 12) + 'px';
    pop.classList.toggle('top', (r.top + r.height / 2) > innerHeight / 2);
    pop.classList.toggle('bottom', (r.top + r.height / 2) <= innerHeight / 2);
  };
  const show = () => {
    const el = firstVisible(steps[i].t); if (!el) { return next(); }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ov.querySelector('.ub-pop-t').textContent = steps[i].title;
    ov.querySelector('.ub-pop-x').innerHTML = steps[i].text;
    ov.querySelector('.ub-dots').innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    ov.querySelector('.ub-prev').style.visibility = i ? 'visible' : 'hidden';
    ov.querySelector('.ub-next').textContent = i === steps.length - 1 ? 'Listo ✓' : 'Siguiente';
    setTimeout(place, 220);
  };
  const next = () => { if (i < steps.length - 1) { i++; show(); } else close(); };
  const prev = () => { if (i > 0) { i--; show(); } };
  function close() { ov.remove(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); try { localStorage.setItem('ub_tour_done', '1'); } catch (_) {} }
  ov.querySelector('.ub-next').onclick = next; ov.querySelector('.ub-prev').onclick = prev; ov.querySelector('.ub-skip').onclick = close;
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  show();
}
async function promptInstall() {
  if (ubInstallPrompt) { ubInstallPrompt.prompt(); try { await ubInstallPrompt.userChoice; } catch (_) {} ubInstallPrompt = null; return true; }
  showAddToHome(); return false;
}
function showAddToHome() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  let pasos;
  if (isIOS) pasos = ['Pulsa el botón <b>Compartir</b> (el cuadrado con la flecha ↑) abajo en Safari.', 'Desliza y toca <b>“Añadir a pantalla de inicio”</b>.', 'Pulsa <b>“Añadir”</b> arriba a la derecha.', '¡Listo! UnderBro queda como una app. 🎉'];
  else if (isAndroid) pasos = ['Toca el menú <b>⋮</b> (arriba a la derecha de Chrome).', 'Pulsa <b>“Añadir a pantalla de inicio”</b> o <b>“Instalar app”</b>.', 'Confirma <b>“Añadir / Instalar”</b>.', '¡Listo! Ya tienes UnderBro en tu pantalla. 🎉'];
  else pasos = ['En la barra de dirección, pulsa el icono de <b>instalar</b> (un monitor con ↓) o el menú ⋮.', 'Elige <b>“Instalar UnderBro”</b> y confirma.', '¡Listo! 🎉'];
  const lista = pasos.map((p, i) => `<li><span class="ph-n">${i + 1}</span><span>${p}</span></li>`).join('');
  openModal(`<div class="modal-head"><h3>📲 Añadir a la pantalla de inicio</h3><button class="close">&times;</button></div><div class="modal-body"><ol class="perm-steps">${lista}</ol></div>`);
}
function openSetupWizard() {
  ensureOnbCss();
  try { localStorage.setItem('ub_onboarded', '1'); } catch (_) {}
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const notifGranted = (typeof Notification !== 'undefined' && Notification.permission === 'granted');
  let hapticsOn = true; try { hapticsOn = localStorage.getItem('ub_haptics') !== '0'; } catch (_) {}
  const m = openModal(`
    <div class="modal-head"><h3>🚀 Empezar con UnderBro</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <p class="sub" style="margin:0 0 14px">Déjalo todo listo en unos toques.</p>
      <div class="setup-row"><div><b>🔔 Notificaciones</b><div class="sub">Avisos de chat, likes y seguidores.</div></div><button class="btn sm" id="swNotif">${notifGranted ? 'Activadas ✓' : 'Activar'}</button></div>
      <div class="setup-row"><div><b>📳 Vibración</b><div class="sub">Vibración al tocar (móvil Android).</div></div><button class="btn sm" id="swHap">${hapticsOn ? 'Activada ✓' : 'Activar'}</button></div>
      <div class="setup-row"><div><b>📲 Pantalla de inicio</b><div class="sub">Instala UnderBro como una app.</div></div><button class="btn sm" id="swInstall">${standalone ? 'Instalada ✓' : 'Instalar'}</button></div>
      <button class="btn primary" id="swTour" style="width:100%;margin-top:16px">▶️ Empezar el tour guiado</button>
    </div>`);
  const nb = m.querySelector('#swNotif');
  nb.onclick = async () => { try { await enablePush(); } catch (_) {} if (typeof Notification !== 'undefined' && Notification.permission === 'granted') nb.textContent = 'Activadas ✓'; };
  const hb = m.querySelector('#swHap');
  hb.onclick = () => { let on = true; try { on = localStorage.getItem('ub_haptics') !== '0'; } catch (_) {} on = !on; try { localStorage.setItem('ub_haptics', on ? '1' : '0'); } catch (_) {} hb.textContent = on ? 'Activada ✓' : 'Activar'; if (on && navigator.vibrate) navigator.vibrate(10); };
  m.querySelector('#swInstall').onclick = () => promptInstall();
  m.querySelector('#swTour').onclick = () => { m.remove(); setTimeout(() => runTour(TOUR_STEPS), 250); };
}

async function init() {
  loadSavedSkin();   // aplica el tema/CSS personalizado del usuario antes de pintar
  applySiteConfig(); // aplica la personalización global publicada desde /editor (admin)
  // rutas públicas (sin sesión): ?kit=usuario (press kit) · ?l=slug (smart link)
  const _q = new URLSearchParams(location.search);
  const kitSlug = _q.get('kit');
  if (kitSlug) { renderPublicPressKit(kitSlug); return; }
  const linkSlug = _q.get('l');
  if (linkSlug) { renderPublicSmartLink(linkSlug); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (session) { state.user = session.user; await onAuthenticated(); }
  sb.auth.onAuthStateChange(async (event, sess) => {
    if (event === 'SIGNED_OUT') { if (state.user) location.reload(); return; }
    // vuelta de un login OAuth (Google): arranca la app si aún no lo hizo
    if (sess && !bootDone) { state.user = sess.user; await onAuthenticated(); }
  });
}

async function onAuthenticated() {
  if (bootDone) return;
  bootDone = true;
  const { data: { session } } = await sb.auth.getSession();
  state.user = session.user;
  applySiteConfig(); // re-aplica con la capa personal del usuario (si la tiene)
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
  initCalls();
  setupPush();
  loadNotifBadge();
  if (state.profile && state.profile.is_admin) $('navAdmin')?.classList.remove('hidden');
  ubBack.init();
  switchView('feed');
  setTimeout(warmFeeds, 1500);   // precarga following/trending/new para que pasar de pestaña sea instantáneo
  startFeedAutoRefresh();        // Trending y artistas se actualizan solos en segundo plano
  initDuelInvites();             // aviso en vivo cuando te invitan a un duelo
  handleDeepLink();
  maybeOnboard();
}
// muestra el onboarding solo a usuarios nuevos (sin seguir a nadie y sin haberlo visto)
function maybeOnboard() {
  try {
    if (localStorage.getItem('ub_onboarded')) return;
    if (state.follows.size > 0) { localStorage.setItem('ub_onboarded', '1'); return; }
    const p = new URLSearchParams(location.search);
    if (p.get('track') || p.get('post') || p.get('playlist') || p.get('ucall')) return; // no tapar un enlace compartido
    setTimeout(openOnboarding, 700);
  } catch (_) {}
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
  if (!state.profile) return;
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
      if (b.classList.contains('active') && state.view === 'feed') return; // ya está, no recargues
      state.tab = b.dataset.tab;
      document.querySelectorAll('#feedTabs button').forEach(x => x.classList.toggle('active', x===b));
      // pinta YA el estado activo del botón; el render pesado va en el siguiente frame
      requestAnimationFrame(() => switchView('feed'));
    };
  });
  $('btnUpload').onclick = openCreateChooser;
  $('btnNotif').onclick = () => switchView('notifications');
  { const b = $('btnMessages'); if (b) b.onclick = () => { switchView('messages'); hideDrawers(); }; }
  $('meChip').onclick = () => openProfile(state.user.id);
  $('menuToggle').onclick = () => { const open = $('sidebar').classList.toggle('open'); $('drawerBackdrop').classList.toggle('show', open); };
  $('btnChatToggle').onclick = toggleRight;
  // plegar paneles en escritorio (menú lateral y chat) para ver la feed a pantalla completa
  const appEl = $('app');
  if (localStorage.getItem('ub_side_collapsed') === '1') appEl.classList.add('side-collapsed');
  if (localStorage.getItem('ub_right_collapsed') === '1') appEl.classList.add('right-collapsed');
  // el logo de UnderBro pliega/despliega el menú (en escritorio) o abre el cajón (en móvil)
  $('brandToggle').onclick = () => {
    if (window.innerWidth > 720) { const on = appEl.classList.toggle('side-collapsed'); localStorage.setItem('ub_side_collapsed', on ? '1' : '0'); }
    else { const open = $('sidebar').classList.toggle('open'); $('drawerBackdrop').classList.toggle('show', open); }
  };
  { const b = $('toggleChatBtn'); if (b) b.onclick = () => { const on = appEl.classList.toggle('right-collapsed'); localStorage.setItem('ub_right_collapsed', on ? '1' : '0'); }; }
  $('chatClose').onclick = () => { const r = rightEl(); if (appEl.classList.contains('right-collapsed')) r.classList.remove('peek'); else closeRightPanel(); };
  // rail de chat (derecha): abrir/cerrar con CLIC (no hover) para no estorbar el scroll
  document.addEventListener('click', (e) => {
    const r = rightEl(); if (!r || !appEl.classList.contains('right-collapsed')) return;
    if (!r.classList.contains('peek')) {
      if (r.contains(e.target) && !e.target.closest('.online-item')) r.classList.add('peek');
    } else if (!r.contains(e.target)) { r.classList.remove('peek'); }
  });
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
      if (b._wheelJustClosed) return;   // se acaba de usar la ruleta: ignora el clic
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
  initMeWheel();

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
let ubSwiping = false, _afterSwipeQ = [];
// ejecuta fn cuando termine el deslizamiento (o ya mismo si no hay ninguno),
// para no bloquear la animación con renders pesados
function afterSwipe(fn) { if (ubSwiping) _afterSwipeQ.push(fn); else fn(); }
function flushAfterSwipe() { const q = _afterSwipeQ; _afterSwipeQ = []; q.forEach((f) => { try { f(); } catch (_) {} }); }
async function switchView(view) {
  ubRecord({ kind: 'view', view });
  state.view = view;
  const main = $('main');
  $('feedTabs')?.classList.toggle('hidden', view !== 'feed');
  if (!ubSwiping) { main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap'); }
  if (['feed','feed-trending','all','favorites','mytracks','downloads','search'].includes(view)) setActiveNav(view === 'search' ? '' : view);
  else setActiveNav(view);

  if (view === 'settings') return renderSettings();
  if (view === 'admin') return renderAdmin();
  if (view === 'notifications') return renderNotifications();
  if (view === 'people') return renderPeople();
  if (view === 'messages') return renderMessages();
  if (view === 'posts') return renderPosts();
  if (view === 'search') return renderSearch();
  if (view === 'playlists') return renderPlaylists();
  if (view === 'dashboard') return renderDashboard();
  if (view === 'events') return renderEvents();
  if (view === 'beats') return renderBeats();
  if (view === 'tools') return renderTools();
  if (view === 'ecosystems') return renderEcosystems();
  if (view === 'uploads') return renderUploads();
  if (view === 'partners') return renderPartnersView();
  if (view === 'skins') return renderSkins();
  if (view === 'contracts') return renderContratos();
  if (view === 'presskit') return renderPressKit();
  if (view === 'smartlinks') return renderSmartLinks();
  if (view === 'smartlink') return renderSmartLinkBuilder();
  if (view === 'splits') return renderSplitSheets();
  if (view === 'split') return renderSplitBuilder();
  if (view === 'analyzer') return renderAudioAnalyzer();
  if (view === 'radio') return startRadio();

  return loadFeedView(view);
}

/* Carga de feeds con caché "stale-while-revalidate": si ya tenemos datos los
   pintamos al instante (sin espera) y refrescamos en segundo plano; solo
   re-renderizamos si el contenido cambió. Permite además precargar al detectar
   un deslizamiento, para que no haya retraso al pasar de pantalla. */
function feedSpec(view, tab) {
  if (view === 'feed') {
    if (tab === 'trending') return { key: 'trending', fetch: () => fetchTrending(), head: { title: 'Trending', sub: 'Lo que está pegando estos días' } };
    if (tab === 'new') return { key: 'new', fetch: () => fetchTracks({ order: 'created_at' }), head: { title: 'New', sub: 'Lo último que se ha subido' } };
    return { key: 'following', fetch: () => fetchFollowingTracks(), head: { title: 'Following', sub: 'Pistas de gente que sigues' } };
  }
  if (view === 'feed-trending') return { key: 'trending', fetch: () => fetchTrending(), head: { title: 'Trending', sub: 'Lo que está pegando estos días' } };
  if (view === 'all') return { key: 'all', fetch: () => fetchTracks({ order: 'created_at' }), head: { title: 'All Tracks', sub: 'Toda la biblioteca' } };
  if (view === 'favorites') return { key: 'favorites', fetch: () => fetchFavorites(), head: { title: 'Favorites', sub: 'Tus pistas favoritas' } };
  if (view === 'mytracks') return { key: 'mytracks', fetch: () => fetchTracks({ order: 'created_at', userId: state.user.id }), head: { title: 'My Uploads', sub: 'Pistas que has subido' } };
  if (view === 'downloads') return { key: 'downloads', fetch: () => fetchByIds([...state.downloads]), head: { title: 'Downloads', sub: 'Pistas que descargaste' } };
  return null;
}
const feedCache = new Map();   // key -> { tracks, ts }
const feedDomCache = new Map(); // key -> { sig, node }  (DOM ya pintado por pestaña)
let trendingArtists = [];      // artistas mejor valorados (derivados del Trending) para las tarjetas de artista
const feedInflight = new Map(); // key -> Promise (evita peticiones duplicadas)
function feedFetch(spec) {
  if (feedInflight.has(spec.key)) return feedInflight.get(spec.key);
  const p = spec.fetch().then((tracks) => { feedCache.set(spec.key, { tracks, ts: Date.now() }); feedInflight.delete(spec.key); return tracks; })
    .catch((err) => { feedInflight.delete(spec.key); throw err; });
  feedInflight.set(spec.key, p);
  return p;
}
function sameTracks(a, b) { return a && b && a.length === b.length && a.every((t, i) => t.id === b[i].id); }
// como sameTracks pero detecta también cambios de estadísticas (para el auto-refresh)
function feedChanged(a, b) {
  if (!sameTracks(a, b)) return true;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if ((x.plays || 0) !== (y.plays || 0) || (x.likes_count || 0) !== (y.likes_count || 0) || (x.reposts_count || 0) !== (y.reposts_count || 0)) return true;
  }
  return false;
}
async function loadFeedView(view) {
  const spec = feedSpec(view, state.tab);
  if (!spec) return;
  const cached = feedCache.get(spec.key);
  // Si venimos de un deslizamiento, pintar 50 tarjetas de golpe bloquea la
  // animación. Mostramos skeleton ligero durante el slide y pintamos las
  // tarjetas al terminar (igual que Fotos/Chat, que van fluidos).
  const deferred = ubSwiping;
  const stillHere = () => { const h = feedSpec(state.view, state.tab); return h && h.key === spec.key; };
  const paint = (tracks) => { if (stillHere()) { state.tracks = tracks; renderFeed(spec.head, tracks, view); } };
  if (cached && !deferred) { paint(cached.tracks); }                 // clic: instantáneo
  else { $('main').innerHTML = skeletonFeed(); if (cached) afterSwipe(() => paint(cached.tracks)); }
  try {
    const tracks = await feedFetch(spec);
    if (stillHere() && !sameTracks(cached && cached.tracks, tracks)) afterSwipe(() => paint(tracks));
  } catch (err) {
    console.error(err);
    if (!cached) afterSwipe(() => { if (stillHere()) { toast('Error al cargar pistas'); state.tracks = []; renderFeed(spec.head, [], view); } });
  }
}
// precarga los datos de una pantalla del carrusel (al detectar el deslizamiento)
function prefetchScreen(idx) {
  if (idx < 0 || idx >= SWIPE_SEQ.length) return;
  const key = SWIPE_SEQ[idx];
  if (idx <= 2) { const spec = feedSpec('feed', key); const c = feedCache.get(spec.key); if (!c || Date.now() - c.ts > 20000) feedFetch(spec).catch(() => {}); }
  else if (key === 'posts' && typeof prefetchPosts === 'function') prefetchPosts();
}
// precarga TODAS las pantallas del feed una vez tras arrancar (sin bloquear)
function warmFeeds() { ['following', 'trending', 'new'].forEach((k) => { const s = feedSpec('feed', k); if (!feedCache.has(s.key)) feedFetch(s).catch(() => {}); }); }

// Auto-actualización del feed (Trending incluido): cada cierto tiempo refresca
// los datos en segundo plano, así los artistas en tendencia y sus estadísticas
// se van actualizando solos según suben las reproducciones / aparecen nuevos.
let _feedAutoTimer = null;
function startFeedAutoRefresh() {
  if (_feedAutoTimer) return;
  _feedAutoTimer = setInterval(() => {
    if (document.hidden) return;
    if (state.view !== 'feed' && state.view !== 'feed-trending') return;
    const spec = feedSpec(state.view, state.tab);
    if (!spec) return;
    feedFetch(spec).then((tracks) => {                      // refresca caché + trendingArtists
      const cur = feedSpec(state.view, state.tab);
      if (!cur || cur.key !== spec.key) return;             // el usuario cambió de pantalla
      if (!feedChanged(state.tracks, tracks)) return;       // sin novedades (ni de orden ni de stats)
      const main = $('main');
      if (main && main.scrollTop > 120) return;             // no interrumpir si está leyendo más abajo
      state.tracks = tracks; renderFeed(spec.head, tracks, state.view);
    }).catch(() => {});
  }, 60000);
  // al volver a la app, refresca de inmediato la pantalla de feed visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (state.view !== 'feed' && state.view !== 'feed-trending') return;
    const spec = feedSpec(state.view, state.tab); if (!spec) return;
    feedFetch(spec).then((tracks) => {
      const cur = feedSpec(state.view, state.tab);
      if (cur && cur.key === spec.key && feedChanged(state.tracks, tracks)) {
        const main = $('main'); if (main && main.scrollTop > 120) return;
        state.tracks = tracks; renderFeed(spec.head, tracks, state.view);
      }
    }).catch(() => {});
  });
}

/* =======================================================================
   NAVEGACIÓN POR GESTOS (deslizar entre pantallas, solo móvil)
   ======================================================================= */
const SWIPE_SEQ = ['following', 'trending', 'new', 'posts', 'chat'];
// Rueda radial estilo GTA V al mantener pulsado el botón "Yo": se abre una
// ruleta de accesos directos; deslizando hacia una opción y soltando se abre.
function initMeWheel() {
  if (initMeWheel._done) return; initMeWheel._done = true;
  const btn = document.querySelector('#bottomNav button[data-bnav="me"]');
  if (!btn) return;
  const ITEMS = [
    { label: 'Invitar',      icon: 'i-share',    run: () => openInviteModal() },
    { label: 'Personalizar', icon: 'i-palette',  run: () => openProfileCustomizer() },
    { label: 'Subir',        icon: 'i-plus',     run: () => openCreateChooser() },
    { label: 'Mis listas',   icon: 'i-list',     run: () => switchView('playlists') },
    { label: 'Herramientas', icon: 'i-tools',    run: () => switchView('tools') },
    { label: 'Duelo',        icon: 'i-radio',    run: () => openGamesHub() },
    { label: 'Estadísticas', icon: 'i-chart',    run: () => switchView('dashboard') },
    { label: 'Ajustes',      icon: 'i-settings', run: () => switchView('settings') },
  ];
  let overlay = null, items = [], sel = -1, holdTimer = 0, opened = false, active = false, sx = 0, sy = 0, cx = 0, cy = 0, R = 0;

  const open = () => {
    opened = true; haptic(28);
    overlay = el(`<div class="gta-wheel"><div class="gtw-ring"></div><div class="gtw-ring gtw-ring2"></div><div class="gtw-hub"><span class="gtw-hub-av">${avatarHTML(state.profile)}</span><span class="gtw-hub-label">Desliza</span></div></div>`);
    document.body.appendChild(overlay);
    const W = window.innerWidth, Hh = window.innerHeight;
    cx = W / 2; cy = Math.min(Hh - 168, Hh / 2 + 22);
    // radio máximo que cabe sin salirse por los lados/arriba/abajo (half = mitad del icono)
    const half = 40, m = 12;
    const maxRW = W / 2 - half - m;
    const maxRH = Math.min(cy - 62, Hh - 62 - cy);
    R = Math.min(190, maxRW, maxRH);
    if (R < 124) R = Math.min(maxRW, maxRH);   // pantallas muy estrechas: lo máximo posible
    const r1 = overlay.querySelector('.gtw-ring'); r1.style.cssText += `left:${cx}px;top:${cy}px;width:${R*2}px;height:${R*2}px;`;
    const r2 = overlay.querySelector('.gtw-ring2'); r2.style.cssText += `left:${cx}px;top:${cy}px;width:${R*2+44}px;height:${R*2+44}px;`;
    const hub = overlay.querySelector('.gtw-hub'); hub.style.left = cx + 'px'; hub.style.top = cy + 'px';
    items = ITEMS.map((it, i) => {
      const ang = (-90 + i * 45) * Math.PI / 180;
      const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
      const node = el(`<button class="gtw-item" style="left:${x}px;top:${y}px"><span class="gtw-ic"><svg fill="none" stroke="currentColor"><use href="#${it.icon}"/></svg></span><span class="gtw-lb">${esc(it.label)}</span></button>`);
      node.style.setProperty('--dx', (x - cx) + 'px'); node.style.setProperty('--dy', (y - cy) + 'px');
      overlay.appendChild(node); return node;
    });
    requestAnimationFrame(() => overlay.classList.add('show'));
  };

  const updateSel = (px, py) => {
    if (!opened) return;
    // la selección va por la DIRECCIÓN del deslizamiento desde el punto inicial
    // de pulsación (como el stick en GTA), no desde el centro de la rueda.
    const dx = px - sx, dy = py - sy, dist = Math.hypot(dx, dy);
    const lbl = overlay.querySelector('.gtw-hub-label');
    if (dist < 34) { if (sel >= 0) { items[sel].classList.remove('sel'); sel = -1; lbl.textContent = 'Desliza'; overlay.classList.remove('has-sel'); } return; }
    let a = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;
    a = ((a % 360) + 360) % 360;
    const idx = Math.round(a / 45) % 8;
    if (idx !== sel) {
      if (sel >= 0) items[sel].classList.remove('sel');
      sel = idx; items[sel].classList.add('sel'); lbl.textContent = ITEMS[idx].label; overlay.classList.add('has-sel'); haptic(9);
    }
  };

  const close = (activate) => {
    clearTimeout(holdTimer);
    if (opened && overlay) {
      const chosen = (activate && sel >= 0) ? ITEMS[sel] : null;
      const ov = overlay; ov.classList.remove('show'); setTimeout(() => ov.remove(), 170);
      overlay = null; opened = false;
      if (chosen) { haptic(22); try { chosen.run(); } catch (e) { console.error(e); } }
    }
    sel = -1; active = false;
  };

  btn.addEventListener('pointerdown', (e) => {
    active = true; sx = e.clientX; sy = e.clientY;
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    clearTimeout(holdTimer); holdTimer = setTimeout(open, 260);
  });
  btn.addEventListener('pointermove', (e) => {
    if (!active) return;
    if (opened) updateSel(e.clientX, e.clientY);
    else if (Math.hypot(e.clientX - sx, e.clientY - sy) > 16) clearTimeout(holdTimer);
  });
  btn.addEventListener('pointerup', () => {
    if (!active) return;
    if (opened) { btn._wheelJustClosed = true; setTimeout(() => { btn._wheelJustClosed = false; }, 400); }
    close(true);
  });
  btn.addEventListener('pointercancel', () => { clearTimeout(holdTimer); close(false); });
}

/* =======================================================================
   JUEGOS 1v1 — "EL DUELO" (reflejos): suena una pista; al cortarse, dispara.
   El primero en tocar gana. Disparar antes del corte = pierdes.
   Cada móvil mide su reacción localmente (justo sin importar el ping).
   ======================================================================= */
// Motor de efectos de sonido del duelo (sintetizados con Web Audio, sin archivos).
const DuelSFX = (() => {
  let ac = null;
  const ctx = () => {
    try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  const on = () => { try { return localStorage.getItem('ub_sfx') !== '0'; } catch (_) { return true; } };
  function tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null) {
    const a = ctx(); if (!a) return; const t0 = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function noise(dur, gain = 0.5, filterFreq = 2000) {
    const a = ctx(); if (!a) return; const t0 = a.currentTime;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = a.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(a.destination); src.start(t0); src.stop(t0 + dur + 0.03);
  }
  const seq = (notes, type, gain) => { const a = ctx(); if (!a) return; notes.forEach(([f, d], i) => setTimeout(() => tone(f, d, type, gain), i * 90)); };
  return {
    unlock() { ctx(); },
    tick() { if (on()) tone(680, 0.07, 'square', 0.1); },
    ready() { if (on()) { tone(520, 0.06, 'triangle', 0.13); setTimeout(() => tone(800, 0.08, 'triangle', 0.13), 60); } },
    draw() { if (on()) tone(1500, 0.16, 'sawtooth', 0.18, 380); },   // alerta "¡DISPARA!"
    bang() { if (on()) { noise(0.18, 0.6, 2400); tone(95, 0.18, 'sine', 0.5, 38); } },
    falseStart() { if (on()) tone(320, 0.4, 'sawtooth', 0.22, 80); },
    win() { if (on()) seq([[523, .16], [659, .16], [784, .16], [1047, .26]], 'triangle', 0.2); },
    lose() { if (on()) seq([[420, .2], [330, .22], [247, .3]], 'sine', 0.2); },
    toggle() { try { const v = localStorage.getItem('ub_sfx') === '0'; localStorage.setItem('ub_sfx', v ? '1' : '0'); return !v ? false : true; } catch (_) { return true; } },
    get enabled() { return on(); },
  };
})();

let gameChan = null;
function gmCloseChan() { try { gameChan && sb.removeChannel(gameChan); } catch (_) {} gameChan = null; }
const gmName = (p) => (p && (p.display_name || p.username)) || 'Tú';

async function pickRandomTrack() {
  try {
    const { data } = await sb.from('tracks').select('id,title,audio_url,cover_url').not('audio_url', 'is', null).order('created_at', { ascending: false }).limit(80);
    const pool = (data || []).filter(t => t.audio_url);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  } catch (_) { return null; }
}

function openGamesHub() {
  const me = state.profile;
  const m = openModal(`
    <div class="modal-head"><h3>El Duelo</h3><button class="close">&times;</button></div>
    <div class="modal-body game-hub">
      <div class="gh-hero">
        <div class="gh-cross"><i></i><i></i></div>
        <h2>EL DUELO</h2>
        <p>Suena una pista… cuando <b>se corta de golpe</b>, el primero en disparar gana.<br><span class="gh-warn">Si disparas antes de tiempo, pierdes.</span></p>
      </div>
      <button class="btn primary share-big" id="ghQuick"><svg fill="none" stroke="#fff"><use href="#i-people"/></svg> <span class="ig-tx"><b>Partida rápida</b><i>Te emparejamos con cualquiera</i></span></button>
      <button class="btn share-big" id="ghInvite"><svg fill="none" stroke="currentColor"><use href="#i-mail"/></svg> <span class="ig-tx"><b>Invitar a un amigo</b><i>Elige a quién retar</i></span></button>
      <div id="ghInvites"></div>
    </div>`);
  m.querySelector('#ghQuick').onclick = () => { m.remove(); quickMatch(); };
  m.querySelector('#ghInvite').onclick = () => { m.remove(); openGameInvitePicker(); };
  const box = m.querySelector('#ghInvites');
  sb.from('game_matches').select('*').eq('guest', state.user.id).eq('status', 'invited').order('created_at', { ascending: false }).limit(10).then(({ data: invs }) => {
    if (!invs || !invs.length || !box.isConnected) return;
    box.innerHTML = `<div class="gh-sec">Te han invitado</div>` + invs.map(g => `
      <button class="gh-inv" data-id="${esc(g.id)}"><span class="gh-inv-av" style="${g.host_avatar ? `background-image:url('${esc(czUrl(g.host_avatar))}')` : ''}">${g.host_avatar ? '' : esc((g.host_name || '?').slice(0, 1).toUpperCase())}</span><span class="gh-inv-m"><b>${esc(g.host_name || 'Alguien')}</b><i>te invita a un duelo</i></span><span class="gh-inv-go">Jugar →</span></button>`).join('');
    box.querySelectorAll('.gh-inv').forEach(b => b.onclick = () => { m.remove(); acceptInvite(b.dataset.id); });
  });
}

async function openGameInvitePicker() {
  const m = openModal(`
    <div class="modal-head"><h3>Invitar a un duelo</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <input type="text" id="gipSearch" class="inp" placeholder="Busca por nombre o @usuario…" autocomplete="off" style="width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:11px;background:var(--bg-soft);color:var(--ink);margin-bottom:10px" />
      <div id="gipList" class="gip-list"></div>
    </div>`);
  const list = m.querySelector('#gipList');
  const render = (people) => {
    people = (people || []).filter(p => p.id !== state.user.id && !isHidden(p.id));
    if (!people.length) { list.innerHTML = '<p class="eco-hint" style="padding:14px;text-align:center">Sin resultados.</p>'; return; }
    list.innerHTML = people.map(p => `
      <button class="gip-row" data-id="${esc(p.id)}" data-name="${esc(p.display_name || p.username)}" data-av="${esc(p.avatar_url || '')}">
        <span class="gip-av" style="${p.avatar_url ? `background-image:url('${esc(czUrl(p.avatar_url))}')` : ''}">${p.avatar_url ? '' : esc((p.display_name || p.username || '?').slice(0, 1).toUpperCase())}</span>
        <span class="gip-m"><b>${esc(p.display_name || p.username)}</b><i>@${esc(p.username || '')}</i></span>
        <span class="gip-go">Retar</span>
      </button>`).join('');
    list.querySelectorAll('.gip-row').forEach(b => b.onclick = () => { m.remove(); createInviteMatch(b.dataset.id, b.dataset.name, b.dataset.av); });
  };
  // por defecto: a quién sigues
  try {
    const ids = [...state.follows].slice(0, 40);
    if (ids.length) { const { data } = await sb.from('profiles').select('id,username,display_name,avatar_url').in('id', ids); render(data); }
    else list.innerHTML = '<p class="eco-hint" style="padding:14px;text-align:center">Busca a alguien para retarle.</p>';
  } catch (_) {}
  let st; m.querySelector('#gipSearch').addEventListener('input', (e) => {
    clearTimeout(st); const term = e.target.value.trim();
    st = setTimeout(async () => {
      if (!term) return;
      try { const { data } = await sb.from('profiles').select('id,username,display_name,avatar_url').or(`username.ilike.%${term}%,display_name.ilike.%${term}%`).limit(20); render(data); } catch (_) {}
    }, 280);
  });
}

async function createInviteMatch(guestId, guestName, guestAvatar) {
  const me = state.profile;
  const { data, error } = await sb.from('game_matches').insert({
    game: 'duel', host: state.user.id, guest: guestId, status: 'invited', is_public: false,
    host_name: gmName(me), host_avatar: me.avatar_url || null, guest_name: guestName || null, guest_avatar: guestAvatar || null,
  }).select().single();
  if (error || !data) { toast('No se pudo crear el duelo'); return; }
  openMatch(data.id);
}

async function quickMatch() {
  const me = state.profile;
  toast('Buscando rival…');
  try {
    const { data: open } = await sb.from('game_matches').select('*').eq('status', 'open').eq('is_public', true).is('guest', null).neq('host', state.user.id).order('created_at', { ascending: true }).limit(1);
    if (open && open[0]) {
      const { data, error } = await sb.from('game_matches').update({ guest: state.user.id, guest_name: gmName(me), guest_avatar: me.avatar_url || null, status: 'ready' }).eq('id', open[0].id).eq('status', 'open').is('guest', null).select().single();
      if (!error && data) { openMatch(data.id); return; }
    }
  } catch (_) {}
  const { data, error } = await sb.from('game_matches').insert({ game: 'duel', host: state.user.id, status: 'open', is_public: true, host_name: gmName(me), host_avatar: me.avatar_url || null }).select().single();
  if (error || !data) { toast('No se pudo crear la partida'); return; }
  openMatch(data.id);
}

async function acceptInvite(id) {
  const me = state.profile;
  const { data, error } = await sb.from('game_matches').update({ status: 'ready', guest_name: gmName(me), guest_avatar: me.avatar_url || null }).eq('id', id).eq('status', 'invited').select().single();
  if (error || !data) { toast('La invitación ya no está disponible'); return; }
  openMatch(id);
}

async function openMatch(id) {
  gmCloseChan();
  document.getElementById('gameScreen')?.remove();
  const scr = el('<div id="gameScreen" class="game-screen"><div class="gs-body" id="gsBody"></div><button class="gs-mute" id="gsMute" aria-label="Sonido"></button><button class="gs-exit" id="gsExit" aria-label="Salir">&times;</button></div>');
  document.body.appendChild(scr);
  const muteBtn = scr.querySelector('#gsMute');
  const paintMute = () => { muteBtn.textContent = DuelSFX.enabled ? '🔊' : '🔇'; };
  paintMute();
  muteBtn.onclick = () => { DuelSFX.toggle(); paintMute(); haptic(8); };
  const body = scr.querySelector('#gsBody');
  try { window.audio && audio.pause(); } catch (_) {}

  let cur = null, dAudio = null, fireT = 0, armed = false, myReacted = false, playedRound = 0, fireTimer = 0, startTimer = 0, pollTimer = 0, lastSig = '', resolvedRound = 0;
  const isHost = () => cur && cur.host === state.user.id;
  const myReactCol = () => isHost() ? 'host_reaction' : 'guest_reaction';

  const stopAudio = () => { try { dAudio && dAudio.pause(); } catch (_) {} clearTimeout(fireTimer); clearTimeout(startTimer); };
  const cleanup = () => { stopAudio(); gmCloseChan(); clearInterval(pollTimer); };
  const close = async () => {
    cleanup();
    // si la partida no terminó, márcala cancelada para que el rival no espere
    try { if (cur && cur.status !== 'done') await sb.from('game_matches').update({ status: 'cancelled' }).eq('id', id); } catch (_) {}
    scr.remove();
  };
  scr.querySelector('#gsExit').onclick = close;

  const avHtml = (url, name) => url ? `<span class="duel-av" style="background-image:url('${esc(czUrl(url))}')"></span>` : `<span class="duel-av duel-av-ph">${esc((name || '?').slice(0, 1).toUpperCase())}</span>`;
  const oppAvatar = (g) => isHost() ? g.guest_avatar : g.host_avatar;
  const oppName = (g) => (isHost() ? g.guest_name : g.host_name) || 'Rival';
  // escena low-poly + enemigo stickman (cabeza = foto de perfil del rival)
  function sceneHTML(g, pose, reticle) {
    const av = oppAvatar(g);
    const headStyle = av ? `style="background-image:url('${esc(czUrl(av))}')"` : '';
    const init = esc((oppName(g) || '?').trim().slice(0, 1).toUpperCase());
    const ret = reticle ? `<div class="duel-cross sm-reticle" id="duelCross"><i></i><i></i><span class="duel-ring"></span><span class="duel-ring2"></span><span class="duel-dot"></span></div>` : '';
    return `
      <div class="lp-sky"></div>
      <div class="lp-stars"></div>
      <div class="lp-sun"></div>
      <div class="lp-mts lp-mts-3"></div>
      <div class="lp-mts lp-mts-2"></div>
      <div class="lp-mts lp-mts-1"></div>
      <div class="lp-ground"></div>
      <div class="lp-road"></div>
      <div class="duel-enemy ${pose || ''}" id="duelEnemy">
        <div class="sm-shadow"></div>
        <div class="sm-leg sm-leg-l"></div><div class="sm-leg sm-leg-r"></div>
        <div class="sm-body"></div>
        <div class="sm-arm sm-arm-l"></div>
        <div class="sm-arm sm-arm-r"><span class="sm-gun"></span></div>
        <div class="sm-head ${av ? '' : 'sm-head-ph'}" ${headStyle}>${av ? '' : init}</div>
        ${ret}
      </div>`;
  }

  // -------- escenas estáticas (no se redibujan durante una ronda) --------
  function renderWaiting(g) {
    body.innerHTML = `<div class="duel-wait"><div class="duel-spinner"></div><h3>Buscando rival…</h3><p class="duel-sub">Comparte la app para encontrar a alguien, o invita a un amigo.</p></div>`;
  }
  function renderInvited(g) {
    if (isHost()) body.innerHTML = `<div class="duel-wait"><div class="duel-spinner"></div><h3>Esperando a ${esc(g.guest_name || 'tu rival')}…</h3><p class="duel-sub">Le ha llegado la invitación al duelo.</p></div>`;
    else body.innerHTML = `<div class="duel-wait"><h3>${esc(g.host_name || 'Alguien')} te reta a un duelo</h3><button class="btn primary" id="acceptNow">Aceptar duelo</button></div>`;
    const a = body.querySelector('#acceptNow'); if (a) a.onclick = () => sb.from('game_matches').update({ status: 'ready', guest_name: gmName(state.profile), guest_avatar: state.profile.avatar_url || null }).eq('id', id);
  }
  function renderLobby(g) {
    const meReady = isHost() ? g.host_ready : g.guest_ready;
    const oppReady = isHost() ? g.guest_ready : g.host_ready;
    const oppName = isHost() ? g.guest_name : g.host_name;
    const oppAv = isHost() ? g.guest_avatar : g.host_avatar;
    body.innerHTML = `
      <div class="duel-lobby">
        <h2 class="duel-vs-t">PREPARADOS</h2>
        <div class="duel-vs">
          <div class="duel-side"><div class="duel-av-wrap ${meReady ? 'on' : ''}">${avHtml(state.profile.avatar_url, gmName(state.profile))}</div><b>Tú</b><span class="${meReady ? 'rdy' : ''}">${meReady ? 'Listo' : 'Sin confirmar'}</span></div>
          <div class="duel-vs-x">VS</div>
          <div class="duel-side"><div class="duel-av-wrap ${oppReady ? 'on' : ''}">${avHtml(oppAv, oppName)}</div><b>${esc(oppName || 'Rival')}</b><span class="${oppReady ? 'rdy' : ''}">${oppReady ? 'Listo' : 'Esperando…'}</span></div>
        </div>
        <p class="duel-tip">Cuando la música pare, <b>toca la pantalla</b> lo más rápido que puedas. No dispares antes.</p>
        <button class="btn primary duel-ready ${meReady ? 'done' : ''}" id="readyBtn" ${meReady ? 'disabled' : ''}>${meReady ? 'Esperando al rival…' : '¡Estoy listo!'}</button>
      </div>`;
    const r = body.querySelector('#readyBtn');
    if (r && !meReady) r.onclick = async () => {
      haptic(14); DuelSFX.unlock(); DuelSFX.ready();
      const col = isHost() ? 'host_ready' : 'guest_ready';
      if (cur) cur[col] = true;       // optimista: el botón cambia al instante
      lastSig = '';                    // fuerza reproceso en el próximo sondeo
      renderLobby(cur);
      const { error } = await sb.from('game_matches').update({ [col]: true, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) toast('No se pudo marcar listo: ' + (error.message || error.code || 'error'));
    };
  }
  function computeWinner(g) {
    const h = g.host_reaction, gu = g.guest_reaction, hOk = h >= 0, gOk = gu >= 0;
    if (hOk && gOk) return h <= gu ? g.host : g.guest;
    if (hOk) return g.host;
    if (gOk) return g.guest;
    return null;
  }
  function renderResult(g) {
    if (resolvedRound === g.round) return;   // ya pintado este round (evita repintar)
    resolvedRound = g.round;
    stopAudio();
    const winner = (g.status === 'done') ? g.winner : computeWinner(g);
    const meWin = winner === state.user.id;
    const draw = !winner;
    const myR = isHost() ? g.host_reaction : g.guest_reaction;
    const opR = isHost() ? g.guest_reaction : g.host_reaction;
    let myWins = isHost() ? (g.host_wins || 0) : (g.guest_wins || 0);
    let opWins = isHost() ? (g.guest_wins || 0) : (g.host_wins || 0);
    // si aún no se ha persistido (resolución local), suma este round al marcador
    if (g.status !== 'done' && winner) { if (meWin) myWins++; else opWins++; }
    const oppName = (isHost() ? g.guest_name : g.host_name) || 'Rival';
    const rtxt = (v) => v == null ? '—' : (v < 0 ? 'Antes de tiempo ✗' : v + ' ms');
    const myFaster = (myR >= 0) && (opR == null || opR < 0 || myR <= opR);
    const opFaster = (opR >= 0) && (myR == null || myR < 0 || opR < myR);
    if (meWin) { haptic(60); DuelSFX.win(); } else if (!draw) { DuelSFX.lose(); }
    // pose del enemigo: derrotado (caído) si gano, de pie/victorioso si pierdo
    const pose = meWin ? 'down' : (draw ? 'aim' : 'victor');
    body.innerHTML = `
      <div class="duel-arena duel-end ${draw ? 'draw' : meWin ? 'win' : 'lose'}" id="duelArena">
        ${sceneHTML(g, pose)}
        <div class="duel-scan"></div>
        <div class="duel-vig"></div>
        <div class="duel-bar duel-bar-top"></div>
        <div class="duel-bar duel-bar-bot"></div>
        <div class="duel-end-panel ${draw ? 'draw' : meWin ? 'win' : 'lose'}">
          <div class="duel-res-badge">${draw ? 'EMPATE' : meWin ? '¡GANASTE!' : 'ELIMINADO'}</div>
          <div class="duel-score"><span class="ds-n ${myWins > opWins ? 'lead' : ''}">${myWins}</span><span class="ds-sep">—</span><span class="ds-n ${opWins > myWins ? 'lead' : ''}">${opWins}</span></div>
          <div class="duel-score-l">Tú · ${esc(oppName)}</div>
          ${g.cover_url || g.track_title ? `<div class="duel-song"><span class="duel-song-cov" style="${g.cover_url ? `background-image:url('${esc(czUrl(g.cover_url))}')` : ''}"></span><span class="duel-song-m"><i>Sonaba</i><b>${esc(g.track_title || 'una pista')}</b></span></div>` : ''}
          <div class="duel-res-rows">
            <div class="duel-res-row ${myFaster ? 'fast' : ''}"><span>Tú</span><b>${rtxt(myR)}</b></div>
            <div class="duel-res-row ${opFaster ? 'fast' : ''}"><span>${esc(oppName)}</span><b>${rtxt(opR)}</b></div>
          </div>
          <div class="duel-res-actions">
            <button class="btn primary" id="rematchBtn">Revancha</button>
            <button class="btn" id="leaveBtn">Salir</button>
          </div>
        </div>
      </div>`;
    if (meWin) { const fl = body.querySelector('#duelArena'); if (fl) { fl.classList.add('kick'); setTimeout(() => fl.classList.remove('kick'), 300); } }
    body.querySelector('#leaveBtn').onclick = close;
    body.querySelector('#rematchBtn').onclick = async () => {
      haptic(14);
      const btn = body.querySelector('#rematchBtn'); btn.disabled = true; btn.textContent = 'Esperando al rival…';
      // revancha mutua: vuelve al lobby (ambos confirman "listo")
      const col = isHost() ? 'host_ready' : 'guest_ready';
      lastSig = '';
      await sb.from('game_matches').update({ status: 'ready', host_ready: false, guest_ready: false, host_reaction: null, guest_reaction: null, winner: null, round: (g.round || 1) + 1, [col]: true }).eq('id', id);
    };
  }

  async function startNewRound(nextRound) {
    const t = await pickRandomTrack();
    if (!t) { toast('No hay pistas para jugar'); return; }
    const stop = 2600 + Math.floor(Math.random() * 5200); // corte entre 2.6s y 7.8s
    await sb.from('game_matches').update({
      status: 'playing', round: nextRound, track_id: t.id, audio_url: t.audio_url, cover_url: t.cover_url || null, track_title: t.title || null,
      stop_offset: stop, host_reaction: null, guest_reaction: null, winner: null,
    }).eq('id', id);
  }

  // -------- la ronda del duelo (con audio + medición local) --------
  function startRound(g) {
    playedRound = g.round; myReacted = false; armed = false;
    DuelSFX.unlock();
    body.innerHTML = `
      <div class="duel-arena" id="duelArena">
        ${sceneHTML(g, 'aim', true)}
        <div class="duel-scan"></div>
        <div class="duel-vig"></div>
        <div class="duel-bar duel-bar-top"></div>
        <div class="duel-bar duel-bar-bot"></div>
        <div class="duel-enemy-tag"><b>${esc(oppName(g))}</b><span id="oppState">en posición…</span></div>
        <div class="duel-hud"><div class="duel-status" id="duelStatus">PREPARADO…</div><div class="duel-rt" id="duelRt"></div></div>
        <div class="duel-gun" id="duelGun">
          <svg class="dg-svg" viewBox="0 0 240 220" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
            <!-- flancos de la corredera (perspectiva, simétricos) -->
            <polygon class="dg-side" points="66,216 106,48 99,48 56,216"/>
            <polygon class="dg-side2" points="174,216 134,48 141,48 184,216"/>
            <!-- corredera -->
            <polygon class="dg-slide" points="66,216 174,216 134,48 106,48"/>
            <!-- brillo central -->
            <polygon class="dg-slide-hi" points="111,214 129,214 124,56 116,56"/>
            <!-- serraciones traseras -->
            <g class="dg-serr">
              <rect x="80" y="184" width="80" height="5" rx="2"/>
              <rect x="84" y="172" width="72" height="5" rx="2"/>
              <rect x="88" y="160" width="64" height="5" rx="2"/>
            </g>
            <!-- capucha / boca del cañón al fondo -->
            <rect class="dg-hood" x="108" y="46" width="24" height="13" rx="4"/>
            <circle class="dg-muzzle-hole" cx="120" cy="54" r="5"/>
            <!-- mira trasera: dos postes simétricos con muesca centrada -->
            <rect class="dg-iron" x="88" y="184" width="22" height="26" rx="3"/>
            <rect class="dg-iron" x="130" y="184" width="22" height="26" rx="3"/>
            <circle class="dg-dot" cx="99" cy="197" r="3.4"/>
            <circle class="dg-dot" cx="141" cy="197" r="3.4"/>
            <!-- mira delantera centrada (con brillo) -->
            <rect class="dg-iron dg-front" x="113" y="34" width="14" height="24" rx="2"/>
            <rect class="dg-front-hi" x="116" y="37" width="8" height="20" rx="2"/>
            <circle class="dg-dot dg-dot-front" cx="120" cy="44" r="3.4"/>
          </svg>
        </div>
        <div class="duel-smoke" id="duelSmoke"></div>
        <div class="duel-muzzle" id="duelMuzzle"></div>
        <div class="duel-bottom"><span class="duel-me-tag">TÚ</span></div>
        <div class="duel-flash" id="duelFlash"></div>
        <div class="duel-slate" id="duelSlate"><span class="ds-round">RONDA ${g.round || 1}</span><span class="ds-go">PREPÁRATE</span></div>
      </div>`;
    const arena = body.querySelector('#duelArena');
    const statusEl = body.querySelector('#duelStatus');
    const crossEl = body.querySelector('#duelCross');
    const rtEl = body.querySelector('#duelRt');
    const flashEl = body.querySelector('#duelFlash');
    const gunEl = body.querySelector('#duelGun');
    const muzEl = body.querySelector('#duelMuzzle');
    const smokeEl = body.querySelector('#duelSmoke');
    const pulse = (node, cls, ms) => { if (!node) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); if (ms) setTimeout(() => node.classList.remove(cls), ms); };
    const grade = (ms) => ms < 200 ? ['INSANO', 'g-insane'] : ms < 280 ? ['RAPIDÍSIMO', 'g-fast'] : ms < 380 ? ['RÁPIDO', 'g-ok'] : ms < 500 ? ['BIEN', 'g-mid'] : ['LENTO', 'g-slow'];

    let live = false;   // los toques durante la intro no cuentan
    const onShoot = () => {
      if (myReacted || !live) return;
      if (!armed) { // salida en falso
        myReacted = true; haptic(40); DuelSFX.falseStart(); stopAudio();
        arena.classList.add('falsestart'); statusEl.textContent = '¡ANTES DE TIEMPO!'; rtEl.textContent = 'Has fallado el disparo';
        submitReaction(-1);
        return;
      }
      myReacted = true; haptic(30); DuelSFX.bang();
      const rt = Math.round(performance.now() - fireT);
      const [gtxt, gcls] = grade(rt);
      crossEl.classList.add('shot'); statusEl.textContent = '¡DISPARO!';
      rtEl.className = 'duel-rt ' + gcls; rtEl.innerHTML = `<span class="rt-ms">${rt} ms</span><span class="rt-grade">${gtxt}</span>`;
      pulse(gunEl, 'recoil', 320); pulse(muzEl, 'go', 320); pulse(arena, 'kick', 300); pulse(smokeEl, 'go', 1400);
      submitReaction(rt);
    };
    arena.addEventListener('pointerdown', onShoot);

    // intro cinematográfica de ronda, luego cuenta atrás 3·2·1 y la pista
    statusEl.textContent = '';
    const slate = body.querySelector('#duelSlate');
    startTimer = setTimeout(() => {
      if (slate) slate.classList.add('hide');
      live = true;
      let n = 3; statusEl.textContent = String(n); statusEl.classList.add('count'); DuelSFX.tick();
      const cd = setInterval(() => {
        n--;
        if (n > 0) { statusEl.textContent = String(n); haptic(8); DuelSFX.tick(); }
        else { clearInterval(cd); statusEl.classList.remove('count'); beginAudio(); }
      }, 800);
    }, 1150);

    function beginAudio() {
      statusEl.textContent = 'NO DISPARES…';
      try { dAudio = new Audio(czHref(g.audio_url)); dAudio.play().catch(() => {}); } catch (_) {}
      // momento del corte → ¡DISPARA!
      fireTimer = setTimeout(() => {
        stopAudio(); armed = true; fireT = performance.now();
        arena.classList.add('fire'); statusEl.textContent = '¡DISPARA!';
        if (flashEl) { flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go'); }
        haptic(50); DuelSFX.draw();
      }, Math.max(1200, g.stop_offset || 4000));
    }
  }

  function submitReaction(rt) {
    sb.from('game_matches').update({ [myReactCol()]: rt }).eq('id', id).then(() => {}).catch(() => {});
  }

  function paintOpp(g) {
    const el2 = body.querySelector('#oppState'); if (!el2) return;
    const opR = isHost() ? g.guest_reaction : g.host_reaction;
    if (opR != null) el2.textContent = opR < 0 ? 'disparó antes ✗' : 'disparó · ' + opR + ' ms';
  }

  function maybeResolve(g) {
    if (g.status !== 'playing') return;
    if (g.host_reaction == null || g.guest_reaction == null) return;
    if (!isHost()) return; // solo el anfitrión escribe el resultado (evita carrera)
    const h = g.host_reaction, gu = g.guest_reaction, hOk = h >= 0, gOk = gu >= 0;
    let winner = null;
    if (hOk && gOk) winner = h <= gu ? g.host : g.guest;
    else if (hOk) winner = g.host;
    else if (gOk) winner = g.guest;
    const patch = { status: 'done', winner };
    if (winner === g.host) patch.host_wins = (g.host_wins || 0) + 1;
    else if (winner === g.guest) patch.guest_wins = (g.guest_wins || 0) + 1;
    sb.from('game_matches').update(patch).eq('id', id);
  }

  function onUpdate(g) {
    if (!g) return;
    // anti-rebote: ignora actualizaciones idénticas (sondeo/realtime duplicados)
    const sig = [g.status, g.host_ready, g.guest_ready, g.host_reaction, g.guest_reaction, g.round, g.winner, g.guest, g.stop_offset].join('|');
    if (sig === lastSig) return; lastSig = sig;
    const prev = cur; cur = g;
    if (g.status === 'cancelled') { if (prev && prev.status !== 'cancelled') { toast('El rival salió de la partida'); } stopAudio(); body.innerHTML = `<div class="duel-wait"><h3>Partida cancelada</h3><button class="btn primary" id="bk">Volver</button></div>`; const b = body.querySelector('#bk'); if (b) b.onclick = close; return; }
    if (g.status === 'open') return renderWaiting(g);
    if (g.status === 'invited') return renderInvited(g);
    if (g.status === 'ready') {
      renderLobby(g);
      if (g.host_ready && g.guest_ready && isHost()) startNewRound(g.round || 1);
      return;
    }
    if (g.status === 'playing') {
      if (playedRound !== g.round) { startRound(g); return; }
      paintOpp(g);
      // en cuanto AMBOS han disparado, los dos móviles muestran el resultado ya
      if (g.host_reaction != null && g.guest_reaction != null) {
        if (isHost()) maybeResolve(g);   // el anfitrión persiste resultado + marcador
        renderResult(g);                 // ambos pintan el resultado al instante
      }
      return;
    }
    if (g.status === 'done') return renderResult(g);
  }

  gameChan = sb.channel('gm:' + id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_matches', filter: 'id=eq.' + id }, (p) => onUpdate(p.new))
    .subscribe();
  const { data: g0 } = await sb.from('game_matches').select('*').eq('id', id).single();
  onUpdate(g0);
  // sondeo de respaldo: si el realtime falla (redes móviles), la partida avanza igual
  pollTimer = setInterval(async () => {
    try { const { data } = await sb.from('game_matches').select('*').eq('id', id).single(); if (data) onUpdate(data); } catch (_) {}
  }, 1500);
}

// aviso en vivo cuando te invitan a un duelo (suscripción ligera global)
function initDuelInvites() {
  if (initDuelInvites._done || !state.user) return; initDuelInvites._done = true;
  try {
    sb.channel('gm-invites:' + state.user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_matches', filter: 'guest=eq.' + state.user.id }, (p) => {
        const g = p.new; if (!g || g.status !== 'invited') return;
        const t = el(`<div class="duel-invite-pop"><span class="dip-ic"><svg fill="none" stroke="#fff"><use href="#i-people"/></svg></span><div class="dip-m"><b>${esc(g.host_name || 'Alguien')}</b><i>te invita a un duelo</i></div><button class="dip-go">Jugar</button><button class="dip-x" aria-label="Cerrar">&times;</button></div>`);
        document.body.appendChild(t);
        const kill = () => t.remove();
        t.querySelector('.dip-go').onclick = () => { kill(); acceptInvite(g.id); };
        t.querySelector('.dip-x').onclick = kill;
        setTimeout(kill, 12000);
        haptic(30);
      }).subscribe();
  } catch (_) {}
}

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
function haptic(ms) {
  try {
    if (localStorage.getItem('ub_haptics') === '0') return;
    if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(ms || 18);
  } catch (_) {}
}
// Cubre prácticamente cualquier control interactivo (sin incluir contenedores
// que se desplazan, como la tarjeta de pista entera, para no vibrar al hacer scroll).
const HAPTIC_SEL = [
  'button', 'a[href]', '[role="button"]', 'label', 'select', 'summary',
  'input[type="checkbox"]', 'input[type="radio"]', 'input[type="range"]', 'input[type="file"]',
  '[data-act]', '[data-view]', '[data-tab]', '[data-ptab]', '[data-bnav]', '[data-collab]',
  '[data-i]', '[data-send]', '[data-add]', '[data-ev-save]', '[data-cancel]', '[data-g]', '[data-f]',
  '.btn', '.icon-btn', '.act', '.play-lg', '.nav-item', '.bottom-nav button', '.tabs button',
  '.profile-tabs button', '.pstat', '.badge-item:not(.locked)', '.dm-track-play', '.story-circle',
  '.pl-card', '.ev-card', '.social-card', '.dt-row', '.mention', '.avatar-chip', '.chip', '.pill',
  '.seg button', '.onb-chip', '.as-item', '.grp-pick', '.follow-row', '.person-row', '.dm-row',
  '.notif-row', '.story', '.lib-it', '.mk-card', '.layer-row', '.ord-item button', '.t-genre',
  '.cover-pick', '.upload-cta', '.fab', '.close', '.modal-backdrop .btn', '.action-sheet button',
].join(',');
// Vibración al TOCAR un control, pero NO al deslizar/hacer scroll: esperamos al
// "pointerup" y solo vibramos si el dedo apenas se movió (fue un toque, no un
// gesto de desplazamiento).
let _hapDown = null, _hapX = 0, _hapY = 0, _hapMoved = false;
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') { _hapDown = null; return; }
  _hapDown = (e.target.closest && e.target.closest(HAPTIC_SEL)) ? e.target : null;
  _hapX = e.clientX; _hapY = e.clientY; _hapMoved = false;
}, { passive: true });
document.addEventListener('pointermove', (e) => {
  if (!_hapDown || e.pointerType !== 'touch') return;
  if (Math.abs(e.clientX - _hapX) > 10 || Math.abs(e.clientY - _hapY) > 10) _hapMoved = true;
}, { passive: true });
document.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'touch') return;
  if (_hapDown && !_hapMoved && e.target.closest && e.target.closest(HAPTIC_SEL)) haptic(22);
  _hapDown = null;
}, { passive: true });
document.addEventListener('pointercancel', () => { _hapDown = null; }, { passive: true });

// Sin zoom en móvil: iOS ignora user-scalable=no, así que bloqueamos el pellizco.
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

function initSwipeNav() {
  if (initSwipeNav._done) return; initSwipeNav._done = true;
  const EXCLUDE = '.seek, .vol-slider, .wave, #npWave, .stories-bar, .dm-bubble, .dm-thread, .pl-cover-grid, input, textarea, select, .mention-dd, .post-grid';
  const main = $('main');
  let sx = 0, sy = 0, st = 0, ignore = true, decided = false, horizontal = false, dragging = false, cur = -1;
  const W = () => window.innerWidth;
  const overlayOpen = () =>
    document.querySelector('.modal-backdrop, .story-viewer, .right.open') ||
    (typeof npIsOpen === 'function' && npIsOpen()) ||
    $('dmScreen')?.classList.contains('open') ||
    $('sidebar')?.classList.contains('open');
  const clearStyle = () => { main.style.transition = ''; main.style.transform = ''; main.style.opacity = ''; main.style.willChange = ''; document.body.classList.remove('ub-swiping'); };
  document.addEventListener('touchstart', (e) => {
    if (W() > 720 || e.touches.length !== 1 || overlayOpen() || ubSwiping) { ignore = true; return; }
    const t = e.target;
    if (t && t.closest && t.closest(EXCLUDE)) { ignore = true; return; }
    ignore = false; decided = false; horizontal = false; dragging = false;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
    cur = curScreenIdx();
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (ignore) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      decided = true;
      horizontal = Math.abs(dx) > Math.abs(dy) * 1.25;
      if (horizontal && cur >= 0) {
        dragging = true; main.style.willChange = 'transform'; main.style.transition = ''; document.body.classList.add('ub-swiping');
        prefetchScreen(cur + (dx < 0 ? 1 : -1));   // empieza a cargar la pantalla destino ya
      }
      else { ignore = true; return; }   // intención vertical → dejar pasar el scroll
    }
    if (!dragging) return;
    e.preventDefault();                  // bloquea el scroll vertical mientras arrastras en horizontal
    let d = dx;
    const atStart = cur <= 0, atEnd = cur >= SWIPE_SEQ.length - 1;
    if ((d > 0 && atStart) || (d < 0 && atEnd)) d *= 0.32;   // resistencia en los extremos
    main.style.transform = `translateX(${d}px)`;
  }, { passive: false });
  document.addEventListener('touchend', (e) => {
    if (ignore || !dragging) { ignore = true; return; }
    dragging = false; ignore = true;
    const dx = e.changedTouches[0].clientX - sx, dt = Date.now() - st;
    const vel = Math.abs(dx) / Math.max(dt, 1);
    const pass = Math.abs(dx) > W() * 0.30 || (vel > 0.5 && Math.abs(dx) > 50);
    const dir = dx < 0 ? 1 : -1, target = cur + dir;
    // borde izquierdo (estás en Following): un swipe extra hacia la pantalla
    // anterior despliega el menú lateral izquierdo
    if (pass && cur === 0 && dir === -1) {
      $('sidebar').classList.add('open'); $('drawerBackdrop')?.classList.add('show');
      main.style.transition = 'transform .26s cubic-bezier(.22,.61,.36,1)';
      main.style.transform = 'translateX(0)';
      setTimeout(clearStyle, 280);
      return;
    }
    if (pass && target >= 0 && target < SWIPE_SEQ.length) {
      ubSwiping = true;
      // Render del contenido nuevo PRIMERO (el trabajo pesado pasa aquí, antes de
      // animar) y lo colocamos al instante en el borde de entrada: como JS es
      // síncrono no hay parpadeo. Luego una sola transición fluida lo desliza.
      gotoScreenIdx(target);
      main.style.transition = 'none';
      main.style.transform = `translateX(${dir === 1 ? 100 : -100}%)`;
      main.style.opacity = '0.5';
      void main.offsetWidth;                                  // fija el punto de partida
      requestAnimationFrame(() => {
        main.style.transition = 'transform .28s cubic-bezier(.22,.61,.36,1), opacity .28s ease-out';
        main.style.transform = 'translateX(0)';
        main.style.opacity = '1';
        // pinta el contenido en cuanto el deslizamiento termina (primer instante
        // seguro sin tirón), no con un temporizador fijo
        let fin = false;
        const finish = () => { if (fin) return; fin = true; main.removeEventListener('transitionend', onEnd); clearStyle(); ubSwiping = false; flushAfterSwipe(); };
        const onEnd = (ev) => { if (ev.target === main && ev.propertyName === 'transform') finish(); };
        main.addEventListener('transitionend', onEnd);
        setTimeout(finish, 320);                              // respaldo por si no dispara transitionend
      });
    } else {
      // no llega al umbral → vuelve a su sitio con un rebote suave
      main.style.transition = 'transform .28s cubic-bezier(.22,.61,.36,1)';
      main.style.transform = 'translateX(0)';
      setTimeout(clearStyle, 300);
    }
  }, { passive: true });

  // cerrar el cajón izquierdo deslizando (en móvil)
  let dsx = 0, dsy = 0, drawerSwipe = false;
  document.addEventListener('touchstart', (e) => {
    drawerSwipe = e.touches.length === 1 && W() <= 720 && $('sidebar')?.classList.contains('open');
    if (drawerSwipe) { dsx = e.touches[0].clientX; dsy = e.touches[0].clientY; }
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!drawerSwipe) return; drawerSwipe = false;
    const dx = e.changedTouches[0].clientX - dsx, dy = e.changedTouches[0].clientY - dsy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {   // swipe horizontal claro → cerrar
      $('sidebar').classList.remove('open'); $('drawerBackdrop')?.classList.remove('show');
    }
  }, { passive: true });
}

/* =======================================================================
   BOTÓN ATRÁS DE ANDROID (PWA) — navega dentro de la app en vez de salir.
   Técnica: mantenemos siempre una entrada "trampa" en el historial; al pulsar
   atrás decidimos en vivo qué hacer (cerrar overlay → retroceder vista → salir
   con doble pulsación). Así nunca se sale por accidente y no hay desincronías.
   ======================================================================= */
let ubViewStack = [];
let ubNavigating = false;
function ubRecord(entry) {
  if (ubNavigating) return;
  const t = ubViewStack[ubViewStack.length - 1];
  if (t && t.kind === entry.kind && t.view === entry.view && t.id === entry.id) return;
  ubViewStack.push(entry);
  if (ubViewStack.length > 60) ubViewStack.shift();
}
function ubGoBackTo(entry) {
  ubNavigating = true;
  try {
    if (entry.kind === 'profile') openProfile(entry.id);
    else switchView(entry.view);
  } finally { setTimeout(() => { ubNavigating = false; }, 0); }
}
// Cierra el overlay superior (si lo hay). Devuelve true si cerró algo.
function ubCloseTopOverlay() {
  const sv = document.querySelector('.story-viewer');
  if (sv) { sv.querySelector('.sv-x')?.click(); return true; }
  const iv = document.querySelector('.img-viewer');
  if (iv) { iv.remove(); return true; }
  const mods = document.querySelectorAll('#modalRoot .modal-backdrop');
  if (mods.length) { mods[mods.length - 1].remove(); return true; }
  if ($('dmScreen') && $('dmScreen').classList.contains('open')) { try { closeDmScreen(); } catch (_) {} return true; }
  const right = document.querySelector('.right.open'); if (right) { right.classList.remove('open'); return true; }
  const sb2 = $('sidebar'); if (sb2 && sb2.classList.contains('open')) { sb2.classList.remove('open'); return true; }
  if (typeof npIsOpen === 'function' && npIsOpen()) { closeNowPlaying(); return true; }
  return false;
}
const ubBack = {
  lastHome: 0,
  init() {
    // Solo en PWA instalada o en táctil (donde el "atrás" puede cerrar la app).
    // En navegador de escritorio dejamos el botón atrás como siempre.
    const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
    const touch = matchMedia('(pointer: coarse)').matches;
    if (!standalone && !touch) return;
    try {
      history.replaceState({ ub: 'base' }, '');
      history.pushState({ ub: 'guard' }, '');
      window.addEventListener('popstate', () => this.onPop());
    } catch (_) {}
  },
  refill() { try { history.pushState({ ub: 'guard' }, ''); } catch (_) {} },
  onPop() {
    // 1) cerrar overlay superior
    if (ubCloseTopOverlay()) { this.refill(); return; }
    // 2) retroceder una vista en la pila
    if (ubViewStack.length > 1) {
      ubViewStack.pop();
      const prev = ubViewStack[ubViewStack.length - 1];
      this.refill();
      ubGoBackTo(prev);
      return;
    }
    // 2b) seguridad: si no estamos en casa, vuelve a casa
    if (state.view && state.view !== 'feed') {
      this.refill();
      ubGoBackTo({ kind: 'view', view: 'feed' });
      ubViewStack = [{ kind: 'view', view: 'feed' }];
      return;
    }
    // 3) en casa: doble pulsación para salir
    if (Date.now() - this.lastHome < 2000) { try { history.back(); } catch (_) {} return; }
    this.lastHome = Date.now();
    toast('Pulsa atrás otra vez para salir');
    this.refill();
  },
};

async function fetchTracks({ order='created_at', userId=null, limit=50 } = {}) {
  let q = sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)');
  if (userId) q = q.eq('user_id', userId);
  q = q.order(order, { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  // ocultar pistas programadas (publish_at futuro) a todos menos a su autor
  const now = Date.now();
  return (data || []).filter(t => !t.publish_at || new Date(t.publish_at).getTime() <= now || t.user_id === state.user.id);
}
// Trending dinámico vía RPC (hot score con ventana reciente). Embebe el perfil;
// si el embed no estuviera disponible, lo adjunta con una segunda consulta.
async function fetchTrending({ days = 1, limit = 50 } = {}) {
  let list = [];
  try {
    const { data, error } = await sb.rpc('trending_tracks', { p_days: days, p_limit: limit })
      .select('*, profiles!tracks_user_id_fkey(*)');
    if (!error && Array.isArray(data)) list = data;
  } catch (_) {}
  if (!list.length) {
    const { data: rows } = await sb.rpc('trending_tracks', { p_days: days, p_limit: limit });
    if (rows && rows.length) {
      const ids = [...new Set(rows.map(t => t.user_id))];
      const { data: profs } = await sb.from('profiles').select('*').in('id', ids);
      const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
      list = rows.map(t => ({ ...t, profiles: byId[t.user_id] || null }));
    }
  }
  const out = await withFeatured(list);
  trendingArtists = computeTopArtists(out);
  return out;
}
// agrupa las pistas en tendencia por artista y devuelve los mejor valorados,
// cada uno con su mejor pista (para la tarjeta de artista del Trending)
function computeTopArtists(tracks) {
  const by = new Map();
  for (const t of (tracks || [])) {
    if (!t || !t.user_id || !t.profiles || isHidden(t.user_id)) continue;
    const score = (t.plays || 0) + (t.likes_count || 0) * 2 + (t.reposts_count || 0) * 3;
    let e = by.get(t.user_id);
    if (!e) { e = { profile: t.profiles, score: 0, plays: 0, tracks: 0, best: t }; by.set(t.user_id, e); }
    e.score += score; e.plays += (t.plays || 0); e.tracks += 1;
    if ((t.plays || 0) > (e.best.plays || 0)) e.best = t;
  }
  return [...by.values()].sort((a, b) => b.score - a.score).slice(0, 6);
}
// antepone las pistas destacadas por un admin (columna tracks.featured)
async function withFeatured(list) {
  try {
    const { data: feat, error } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').eq('featured', true).order('created_at', { ascending: false }).limit(12);
    if (!error && feat && feat.length) { const seen = new Set(feat.map(t => t.id)); return [...feat.map(t => ({ ...t, _featured: true })), ...list.filter(t => !seen.has(t.id))]; }
  } catch (_) {}
  return list;
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

// alterna seguir/dejar de seguir con actualización optimista y reversión si falla
async function toggleFollow(userId, btn) {
  const was = state.follows.has(userId);
  const paint = (following) => {
    if (!btn || !btn.isConnected) return;
    btn.classList.toggle('primary', !following);
    btn.textContent = following ? 'Siguiendo ✓' : '+ Seguir';
  };
  if (was) state.follows.delete(userId); else state.follows.add(userId);
  paint(!was);
  const { error } = was
    ? await sb.from('follows').delete().eq('follower_id', state.user.id).eq('following_id', userId)
    : await sb.from('follows').insert({ follower_id: state.user.id, following_id: userId });
  if (error) {
    if (was) state.follows.add(userId); else state.follows.delete(userId);
    paint(was);
    toast('No se pudo actualizar el seguimiento');
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
  fb.onclick = (e) => { e.stopPropagation(); toggleFollow(p.id, fb); };
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
  // caché de DOM por pestaña del feed → cambiar entre Following/Trending/New es
  // instantáneo (reutiliza las tarjetas ya pintadas si no cambiaron)
  const isTrending = (view === 'feed' && state.tab === 'trending') || view === 'feed-trending';
  const arts = isTrending ? (trendingArtists || []) : [];
  const cacheKey = (view === 'feed') ? ('feed:' + state.tab) : null;
  const sig = tracks.map(t => t.id + ':' + (t.likes_count || 0) + ':' + (t.reposts_count || 0)).join('|')
    + '#A:' + arts.map(a => a.profile.id + ':' + a.score).join(',');
  if (cacheKey) {
    const c = feedDomCache.get(cacheKey);
    if (c && c.sig === sig && c.node) { list.replaceWith(c.node); if (state.current && audio && !audio.paused) markPlayingCard(); return; }
  }
  const frag = document.createDocumentFragment();
  let artsInserted = false;
  const insertArtists = () => {
    if (artsInserted || !arts.length) return;
    artsInserted = true;
    frag.appendChild(el('<div class="feed-section-head">Artistas en tendencia</div>'));
    arts.forEach(a => frag.appendChild(artistCard(a)));
  };
  tracks.forEach((t, i) => {
    frag.appendChild(trackCard(t, { featured: isTrending && i === 0 }));
    if (isTrending && i === 2) insertArtists(); // tras las 3 primeras pistas
  });
  if (isTrending) insertArtists(); // por si hay menos de 3 pistas
  list.appendChild(frag);   // un solo reflow en vez de uno por tarjeta
  if (cacheKey) feedDomCache.set(cacheKey, { sig, node: list });
  if (state.current && audio && !audio.paused) markPlayingCard();
}

/* =======================================================================
   TARJETA DE PISTA
   ======================================================================= */
/* =======================================================================
   MENÚ CONTEXTUAL — mantener pulsado (táctil) o clic derecho (ratón) para
   abrir un menú de acciones. Reutiliza el estilo de action-sheet de los
   mensajes para que sea consistente en toda la app.
   ======================================================================= */
function openActionSheet(menu) {
  const items = (menu.items || []).filter(Boolean);
  if (!items.length) return null;
  const head = (menu.title || menu.subtitle)
    ? `<div class="as-head">${menu.title ? `<div class="as-title">${esc(menu.title)}</div>` : ''}${menu.subtitle ? `<div class="as-sub">${esc(menu.subtitle)}</div>` : ''}</div>`
    : '';
  const rows = items.map((it, i) => `<button class="as-item${it.danger ? ' danger' : ''}${it.on ? ' on' : ''}" data-i="${i}"><svg fill="none" stroke="currentColor"><use href="#i-${it.icon || 'plus'}"/></svg> ${esc(it.label)}</button>`).join('');
  const sheet = el(`<div class="modal-backdrop sheet"><div class="action-sheet">${head}${rows}<button class="as-item cancel" data-cancel>Cancelar</button></div></div>`);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelector('[data-cancel]').onclick = close;
  items.forEach((it, i) => { const b = sheet.querySelector(`[data-i="${i}"]`); if (b) b.onclick = () => { close(); haptic(8); try { it.onClick && it.onClick(); } catch (err) { console.error(err); } }; });
  $('modalRoot').appendChild(sheet);
  haptic(12);
  return sheet;
}
function attachLongPress(node, build, opts = {}) {
  const delay = opts.delay || 480;
  let timer = 0, sx = 0, sy = 0, fired = false, active = false;
  node.classList.add('lp-target');
  const cancel = () => { clearTimeout(timer); timer = 0; active = false; };
  const fire = () => { fired = true; const menu = build(); if (menu) openActionSheet(menu); };
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;            // en ratón se usa clic derecho
    e.stopPropagation();                              // evita que un lp-target padre también dispare
    active = true; fired = false; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { if (active) fire(); }, delay);
  });
  node.addEventListener('pointermove', (e) => { if (active && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel(); });
  node.addEventListener('pointerup', () => {
    if (fired) { const sup = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; node.addEventListener('click', sup, { capture: true, once: true }); setTimeout(() => node.removeEventListener('click', sup, { capture: true }), 350); }
    cancel();
  });
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); fire(); });
}
function trackMenu(t, card) {
  const mine = t.user_id === state.user.id;
  const liked = state.likes.has(t.id);
  const reposted = state.reposts.has(t.id);
  return { title: t.title, subtitle: t.profiles?.display_name || t.profiles?.username || t.artist || '', items: [
    { label: 'Reproducir', icon: 'play', onClick: () => playTrack(t) },
    { label: liked ? 'Quitar me gusta' : 'Me gusta', icon: 'heart', on: liked, onClick: () => toggleLike(t, card) },
    mine ? null : { label: reposted ? 'Quitar resubida' : 'Resubir', icon: 'repeat', on: reposted, onClick: () => toggleRepost(t, card) },
    { label: 'Reproducir a continuación', icon: 'next', onClick: () => enqueue(t, true) },
    { label: 'Añadir a la cola', icon: 'list', onClick: () => enqueue(t) },
    { label: 'Añadir a playlist', icon: 'listadd', onClick: () => openPlaylistPicker(t) },
    { label: 'Compartir', icon: 'share', onClick: () => shareTrack(t) },
    { label: 'Estadísticas', icon: 'chart', onClick: () => openTrackStats(t) },
    { label: 'Descargar', icon: 'download', onClick: () => downloadTrack(t) },
    mine ? { label: 'Editar', icon: 'settings', onClick: () => openEditTrack(t, card) } : null,
    mine ? null : { label: 'Reportar', icon: 'bell', onClick: () => openReportModal('track', t.id, t.user_id, '“' + (t.title || 'pista') + '”') },
    (mine || state.profile.is_admin) ? { label: mine ? 'Borrar' : 'Borrar (mod)', icon: 'trash', danger: true, onClick: () => deleteTrack(t, card) } : null,
  ] };
}
function postMenu(p, card) {
  const mine = p.user_id === state.user.id;
  const liked = card.querySelector('[data-act="like"]')?.classList.contains('on');
  return { title: p.profiles?.display_name || p.profiles?.username || 'Publicación', subtitle: p.caption || '', items: [
    { label: liked ? 'Quitar me gusta' : 'Me gusta', icon: 'heart', on: liked, onClick: () => togglePostLike(p, card) },
    { label: 'Comentar', icon: 'comment', onClick: () => togglePostComments(p, card) },
    { label: 'Compartir', icon: 'share', onClick: () => sharePost(p) },
    mine ? { label: 'Editar pie de foto', icon: 'settings', onClick: () => openEditPost(p, card) } : null,
    mine ? null : { label: 'Reportar', icon: 'bell', onClick: () => openReportModal('post', p.id, p.user_id, 'esta publicación') },
    (mine || state.profile.is_admin) ? { label: mine ? 'Borrar' : 'Borrar (mod)', icon: 'trash', danger: true, onClick: () => deletePost(p, card) } : null,
  ] };
}
// menú para una fila de comentario (sirve para pistas y publicaciones)
function commentMenu(box, c, canDel, onDelete) {
  return { title: c.profiles?.display_name || c.profiles?.username || 'Comentario', items: [
    { label: 'Responder', icon: 'reply', onClick: () => { const i = box.querySelector('.comment-form input'); if (i) { const u = c.profiles?.username; i.value = u ? `@${u} ` : ''; i.focus(); } } },
    c.body ? { label: 'Copiar', icon: 'copy', onClick: () => { try { navigator.clipboard.writeText(c.body); toast('Copiado'); } catch {} } } : null,
    canDel ? { label: 'Borrar', icon: 'trash', danger: true, onClick: onDelete } : null,
  ] };
}

function trackCard(t, opts = {}) {
  const liked = state.likes.has(t.id);
  const reposted = state.reposts.has(t.id);
  const prof = t.profiles || {};
  const collabs = Array.isArray(t.collaborators) ? t.collaborators : [];
  const ft = collabs.length ? ` ft. ${collabs.map(c => `<a data-collab="${esc(c.id)}">${esc(c.display_name || c.username)}</a>`).join(', ')}` : '';
  const mine = t.user_id === state.user.id;
  const feat = !!opts.featured;
  let cov = t.cover_url ? czUrl(t.cover_url) : '';
  // pista destacada sin portada → usa la foto del artista como respaldo
  if (feat && !cov && prof.avatar_url) cov = czUrl(prof.avatar_url);
  const card = el(`
    <div class="track ${cov ? 'has-bg' : ''}${feat ? ' featured-top' : ''}" data-id="${t.id}" ${cov ? `style="background-image:url('${cov}')"` : ''}>
      ${feat ? '<div class="top-ribbon">TOP 1</div>' : ''}
      ${t._repostedBy ? `<div class="repost-badge"><svg fill="none" stroke="currentColor"><use href="#i-repeat"/></svg> Reposteado por <a data-act="repostby">${esc(t._repostedBy)}</a></div>` : ''}
      <div class="t-head">
        <div class="t-titles">
          <div class="t-title">${esc(t.title)}</div>
          <div class="t-artist">por <a data-act="profile">${esc(prof.display_name || prof.username || t.artist || 'anónimo')}</a>${verifiedBadge(prof)}${displayBadgeHtml(prof)}${ft}</div>
        </div>
        ${t.genre ? `<span class="t-genre">${esc(t.genre)}</span>` : ''}
        ${t.is_beat ? `<span class="t-genre beat-tag">BEAT${t.bpm ? ' · ' + t.bpm + ' BPM' : ''}${t.song_key ? ' · ' + esc(t.song_key) : ''}</span>` : ''}
        ${(t.publish_at && new Date(t.publish_at).getTime() > Date.now()) ? `<span class="t-genre sched-tag">Programada · ${schedLabel(t.publish_at)}</span>` : ''}
      </div>
      ${t.description ? `<div class="t-desc">${esc(t.description)}</div>` : ''}
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
        <button class="act" data-act="queue" title="Añadir a la cola"><svg fill="none" stroke="currentColor"><use href="#i-list"/></svg>Cola</button>
        <button class="act" data-act="download"><svg><use href="#i-download"/></svg>Descargar</button>
        ${mine ? `<button class="act" data-act="edit"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg>Editar</button>` : ''}
        ${mine ? '' : `<button class="act" data-act="report"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg>Reportar</button>`}
        ${(mine || state.profile.is_admin) ? `<button class="act danger" data-act="delete"><svg fill="none" stroke="currentColor"><use href="#i-trash"/></svg>${mine ? 'Borrar' : 'Borrar (mod)'}</button>` : ''}
      </div>
      <div class="comments hidden" data-comments></div>
    </div>`);

  card.querySelectorAll('[data-collab]').forEach(a => a.onclick = (e) => { e.stopPropagation(); openProfile(a.dataset.collab); });
  card.addEventListener('click', (e) => handleTrackClick(e, t, card));
  attachLongPress(card, () => trackMenu(t, card));
  return card;
}

// Tarjeta de artista para el Trending: mini perfil + su mejor pista.
function artistCard(e) {
  const p = e.profile || {}, best = e.best || null;
  const mine = p.id === state.user.id;
  const following = state.follows.has(p.id);
  const av = p.avatar_url ? czUrl(p.avatar_url) : '';
  const initials = (p.display_name || p.username || '?').trim().slice(0, 1).toUpperCase();
  const bestCov = best && best.cover_url ? czUrl(best.cover_url) : '';
  const card = el(`
    <div class="artist-card" data-uid="${esc(p.id)}">
      <div class="ac-top">
        <div class="ac-av" data-act="profile" style="${av ? `background-image:url('${av}')` : ''}">${av ? '' : esc(initials)}</div>
        <div class="ac-id" data-act="profile">
          <div class="ac-name">${esc(p.display_name || p.username || 'Artista')}${verifiedBadge(p)}${displayBadgeHtml(p)}</div>
          <div class="ac-sub">@${esc(p.username || '')} · ${nfmt(e.plays)} reproducciones</div>
        </div>
        ${mine ? '' : `<button class="ac-follow ${following ? 'on' : ''}" data-act="follow">${following ? 'Siguiendo' : 'Seguir'}</button>`}
      </div>
      ${best ? `
      <div class="ac-track" data-act="playbest">
        <div class="ac-tk-cover" style="${bestCov ? `background-image:url('${bestCov}')` : ''}">${bestCov ? '' : '<svg fill="none" stroke="#fff"><use href="#i-music"/></svg>'}</div>
        <div class="ac-tk-meta"><span class="ac-tk-lbl">Mejor pista</span><b>${esc(best.title || '')}</b></div>
        <button class="ac-tk-play" data-act="playbest" aria-label="Reproducir"><svg class="ci-play"><use href="#i-play"/></svg><svg class="ci-pause"><use href="#i-pause"/></svg></button>
      </div>` : ''}
    </div>`);
  card.querySelectorAll('[data-act="profile"]').forEach(n => n.onclick = (ev) => { ev.stopPropagation(); openProfile(p.id); });
  const fb = card.querySelector('[data-act="follow"]'); if (fb) fb.onclick = (ev) => { ev.stopPropagation(); toggleFollow(p.id, fb); };
  if (best) card.querySelectorAll('[data-act="playbest"]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); haptic(10); playTrack(best); });
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
      <div class="field"><label>Descripción</label><textarea id="eDesc" maxlength="600" placeholder="Cuéntale a la gente sobre esta pista…">${esc(t.description || '')}</textarea></div>
      <div class="field"><label class="pk-tg" style="font-weight:600"><input type="checkbox" id="eIsBeat" style="width:auto" ${t.is_beat ? 'checked' : ''} /> <span>Es un <b>beat</b> · permitir descarga gratis</span></label></div>
      <div class="pk-row2 ${t.is_beat ? '' : 'hidden'}" id="eBeatRow">
        <div><label class="pk-l">BPM</label><input type="number" id="eBpm" min="40" max="300" value="${t.bpm || ''}" placeholder="140" /></div>
        <div><label class="pk-l">Tonalidad</label><input type="text" id="eKey" maxlength="16" value="${esc(t.song_key || '')}" placeholder="C min, F#…" /></div>
      </div>
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
  m.querySelector('#eIsBeat').onchange = (e) => m.querySelector('#eBeatRow').classList.toggle('hidden', !e.target.checked);
  const collab = mountCollab(m, t.collaborators || []);
  m.querySelector('#eSave').onclick = async () => {
    const title = m.querySelector('#eTitle').value.trim();
    const genre = m.querySelector('#eGenre').value.trim();
    const description = m.querySelector('#eDesc').value.trim();
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
      const patch = { title, genre: genre || null, description: description || null, cover_url, collaborators: collab.get(),
        is_beat: m.querySelector('#eIsBeat').checked,
        bpm: parseInt(m.querySelector('#eBpm').value, 10) || null,
        song_key: m.querySelector('#eKey').value.trim() || null };
      if (!Array.isArray(t.waveform) || !t.waveform.length) {
        eMsg.textContent = 'Generando la onda real…';
        try { const r = await fetch(t.audio_url); const wf = await computeWaveformPeaks(await r.blob()); if (wf) patch.waveform = wf; } catch {}
      }
      let { data, error } = await sb.from('tracks').update(patch)
        .eq('id', t.id).select('*, profiles!tracks_user_id_fkey(*)').single();
      if (error && /description/i.test(error.message || '')) { delete patch.description; ({ data, error } = await sb.from('tracks').update(patch).eq('id', t.id).select('*, profiles!tracks_user_id_fkey(*)').single()); }
      if (error) throw error;
      Object.assign(t, data);
      if (card) card.replaceWith(trackCard(t));
      m.remove(); toast('Pista actualizada ✓');
    } catch (err) { eMsg.className = 'auth-msg error'; eMsg.textContent = 'Error: ' + (err.message || err); btn.disabled = false; }
  };
}

// dibuja el waveform real (si existe) o uno de respaldo
// remuestrea la onda a N barras (interpolación) para que en PC se vea igual de
// densa que en móvil, independientemente de cuántos puntos tenga guardados
function resamplePeaks(peaks, n) {
  if (!Array.isArray(peaks) || !peaks.length) return [];
  if (peaks.length < 2) return new Array(n).fill(peaks[0] || 40);
  if (peaks.length === n) return peaks;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const idx = i * (peaks.length - 1) / (n - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx), f = idx - lo;
    out[i] = peaks[lo] * (1 - f) + peaks[hi] * f;
  }
  return out;
}
function waveHTML(t) {
  let peaks = Array.isArray(t.waveform) && t.waveform.length ? t.waveform : waveBars(t.id, 100);
  peaks = resamplePeaks(peaks, 100);
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
  else if (act === 'queue') enqueue(t);
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
function trackShareUrl(t) { return `${location.origin}/t/${t.id}`; }
const SHARE_ICONS = {
  wa: '<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>',
  tg: '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 5.94 2 10.8c0 2.78 1.46 5.26 3.75 6.88-.13 1.13-.6 2.55-1.5 3.62-.16.19-.04.5.21.47 1.9-.25 3.6-1.04 4.83-1.86.86.2 1.76.3 2.71.3 5.52 0 10-3.94 10-8.81S17.52 2 12 2z"/></svg>'
};
function shareQuickRow(url, title) {
  return `<div class="share-label">Compartir con</div>
  <div class="share-row">
    <button class="share-q" data-q="wa"><span class="sqi brand" style="--c:#25d366">${SHARE_ICONS.wa}</span><span>WhatsApp</span></button>
    <button class="share-q" data-q="tg"><span class="sqi brand" style="--c:#29a9ea">${SHARE_ICONS.tg}</span><span>Telegram</span></button>
    <button class="share-q" data-q="x"><span class="sqi brand" style="--c:#15181c">${SHARE_ICONS.x}</span><span>X</span></button>
    <button class="share-q" data-q="chat"><span class="sqi brand" style="--c:var(--blue)">${SHARE_ICONS.chat}</span><span>Chat</span></button>
    <button class="share-q" data-q="copy"><span class="sqi soft"><svg fill="none" stroke="currentColor"><use href="#i-copy"/></svg></span><span>Copiar</span></button>
    ${navigator.share ? `<button class="share-q" data-q="more"><span class="sqi soft"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg></span><span>Más</span></button>` : ''}
  </div>`;
}
function wireQuickRow(m, url, title, onChat) {
  const txt = encodeURIComponent(title + ' 🎵 en UnderBro'), u = encodeURIComponent(url);
  const open = (href) => window.open(href, '_blank', 'noopener');
  m.querySelectorAll('.share-q').forEach((b) => b.onclick = async () => {
    const q = b.dataset.q;
    if (q === 'copy') { try { await navigator.clipboard.writeText(url); } catch (_) {} toast('Enlace copiado'); }
    else if (q === 'wa') open(`https://wa.me/?text=${txt}%20${u}`);
    else if (q === 'tg') open(`https://t.me/share/url?url=${u}&text=${txt}`);
    else if (q === 'x') open(`https://twitter.com/intent/tweet?text=${txt}&url=${u}`);
    else if (q === 'more') { navigator.share({ title, text: title, url }).catch(() => {}); }
    else if (q === 'chat') onChat();
  });
}
function shareTrack(t) {
  const url = trackShareUrl(t);
  const who = t.profiles?.display_name || t.profiles?.username || t.artist || 'UnderBro';
  const title = `${t.title} — ${who}`;
  const embedCode = `<iframe src="${location.origin}/embed/${t.id}" width="100%" height="160" frameborder="0" loading="lazy" allow="autoplay" style="border:0;border-radius:14px;max-width:480px"></iframe>`;
  const m = openModal(`
    <div class="modal-head"><h3>Compartir</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="share-hero">
        ${t.cover_url ? `<div class="share-hero-bg" style="background-image:url('${esc(czUrl(t.cover_url))}')"></div>` : ''}
        <div class="share-hero-cover">${t.cover_url ? `<img src="${esc(czUrl(t.cover_url))}" alt="">` : '<svg fill="none" stroke="#fff"><use href="#i-music"/></svg>'}</div>
        <div class="share-hero-meta"><b>${esc(t.title)}</b><span><svg viewBox="0 0 24 24" width="13" height="13" style="fill:currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg> ${esc(who)}</span></div>
      </div>
      <button class="btn btn-ig share-big" id="shareStory">
        <span class="ig-ic"><svg fill="none" stroke="#fff"><use href="#i-camera"/></svg></span>
        <span class="ig-tx"><b>Crear historia</b><i>Compártela en tu historia de Instagram</i></span>
        <svg class="ig-chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      ${shareQuickRow(url, title)}
      <div class="share-link"><input type="text" id="shareUrl" readonly value="${esc(url)}" /><button class="btn sm primary" id="copyLink">Copiar</button></div>
      <div class="share-embed">
        <button class="btn sm" id="embedToggle"><svg fill="none" stroke="currentColor"><use href="#i-globe"/></svg> Insertar en una web</button>
        <div class="share-embed-box hidden" id="embedBox">
          <p class="pk-hint2" style="margin:0 0 6px">Pega este código en tu Linktree, blog o web para mostrar la pista:</p>
          <textarea id="embedCode" readonly rows="2" onclick="this.select()">${esc(embedCode)}</textarea>
          <button class="btn sm primary" id="copyEmbed" style="margin-top:6px">Copiar código</button>
        </div>
      </div>
    </div>`);
  m.querySelector('#shareStory').onclick = () => { m.remove(); shareStory(t); };
  const embedToggle = m.querySelector('#embedToggle'), embedBox = m.querySelector('#embedBox');
  if (embedToggle) embedToggle.onclick = () => embedBox.classList.toggle('hidden');
  const copyEmbed = m.querySelector('#copyEmbed');
  if (copyEmbed) copyEmbed.onclick = async () => { try { await navigator.clipboard.writeText(embedCode); } catch { const i = m.querySelector('#embedCode'); i.select(); try { document.execCommand('copy'); } catch {} } copyEmbed.textContent = 'Copiado ✓'; toast('Código copiado'); };
  const copyBtn = m.querySelector('#copyLink');
  copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(url); } catch { const i = m.querySelector('#shareUrl'); i.select(); try { document.execCommand('copy'); } catch {} } copyBtn.textContent = 'Copiado ✓'; toast('Enlace copiado'); };
  wireQuickRow(m, url, title, () => { m.remove(); shareToChatPicker(t); });
}

/* ---- HISTORIA / STORY: genera una tarjeta 1080x1920 muy vistosa ---- */
function _loadImg(url) {
  return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
}
function _roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function _fitText(ctx, text, max, size, weight) {
  ctx.font = `${weight} ${size}px Poppins, system-ui, sans-serif`;
  while (size > 30 && ctx.measureText(text).width > max) { size -= 4; ctx.font = `${weight} ${size}px Poppins, system-ui, sans-serif`; }
  let t = text;
  if (ctx.measureText(t).width > max) { while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1); t += '…'; }
  return t;
}
async function ensurePoppins() {
  try { loadFont('Poppins'); await Promise.race([Promise.all([document.fonts.load('800 80px Poppins'), document.fonts.load('600 46px Poppins')]), new Promise(r => setTimeout(r, 1500))]); } catch (_) {}
}
function trackWho(t) { return t.profiles?.display_name || t.profiles?.username || t.artist || 'UnderBro'; }
function fmtClock(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function hexA(c, a) {
  if (!c) return `rgba(62,87,252,${a})`;
  if (c[0] === '#') { const h = c.slice(1), n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h; return `rgba(${parseInt(n.slice(0, 2), 16)},${parseInt(n.slice(2, 4), 16)},${parseInt(n.slice(4, 6), 16)},${a})`; }
  if (c.indexOf('rgb(') === 0) return c.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  return c;
}
function _measureTracked(ctx, t, ls) { let w = 0; for (const ch of t) w += ctx.measureText(ch).width + ls; return w - ls; }
function _fillTracked(ctx, t, cx, y, ls) { const w = _measureTracked(ctx, t, ls); let x = cx - w / 2; const prev = ctx.textAlign; ctx.textAlign = 'left'; for (const ch of t) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + ls; } ctx.textAlign = prev; }
function _rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h, s, l = (mx + mn) / 2; if (mx === mn) { h = s = 0; } else { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function _hsl2rgb(h, s, l) { let r, g, b; if (s === 0) { r = g = b = l; } else { const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3); } return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`; }
// extrae un color de acento vibrante (normalizado en HSL) y un tinte oscuro de la carátula
function storyAccent(img) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 30; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 30, 30);
    const d = x.getImageData(0, 0, 30, 30).data; let best = { score: -1, h: 0.62, s: 0.8, l: 0.56 };
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; const [h, s, l] = _rgb2hsl(d[i], d[i + 1], d[i + 2]); const score = s * (1 - Math.abs(l - 0.55) * 1.6); if (score > best.score && l > 0.18 && l < 0.92) best = { score, h, s, l }; }
    const h = best.h, s = Math.min(0.92, Math.max(0.62, best.s)), l = Math.min(0.62, Math.max(0.5, best.l));
    return { a: _hsl2rgb(h, s, l), a2: _hsl2rgb((h + 0.05) % 1, Math.min(0.95, s + 0.06), Math.min(0.72, l + 0.12)), tint: _hsl2rgb(h, Math.min(0.5, s * 0.7), 0.11) };
  } catch (_) { return null; }
}
// Dibuja la tarjeta de historia 1080x1920. shape: 'square' (pista) | 'circle' (perfil) | 'photo' (foto)
const STORY_S = 720, STORY_CY = 432;
function _storyWaveY() { return STORY_CY + STORY_S + 320; }
function drawStoryCard(ctx, o) {
  _drawStoryBase(ctx, o);
  _drawStoryWave(ctx, o, o.freq || null);
  if (o.progress != null) _drawStoryTimeline(ctx, o, o.progress);
}
// CAPA ESTÁTICA — todo lo costoso (blurs) se dibuja una sola vez
function _drawStoryBase(ctx, o) {
  const W = 1080, H = 1920;
  const { shape = 'square', coverImg = null, avatarImg = null, title = '', subtitle = '', cta = 'Escúchalo en UnderBro', footer = 'underbro.app', label = '♫  Sonando en UnderBro', accent = '#3e57fc', accent2 = '#27c0ff', tint = null } = o;
  const S = STORY_S, cx = (W - S) / 2, cy = STORY_CY, ccy = cy + S / 2;
  const grad = (x0, y0, x1, y1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, accent); g.addColorStop(1, accent2); return g; };
  // fondo difuminado de la carátula
  if (coverImg) { const sc = Math.max(W / coverImg.width, H / coverImg.height) * 1.3, cw = coverImg.width * sc, ch = coverImg.height * sc; ctx.filter = 'blur(90px)'; ctx.drawImage(coverImg, (W - cw) / 2, (H - ch) / 2, cw, ch); ctx.filter = 'none'; }
  else { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#141b35'); g.addColorStop(1, '#1c1140'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  ctx.fillStyle = 'rgba(6,8,16,.5)'; ctx.fillRect(0, 0, W, H);
  if (tint) { ctx.save(); ctx.globalAlpha = 0.4; ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  const halo = ctx.createRadialGradient(W / 2, cy + S * 0.25, 40, W / 2, cy + S * 0.25, 820); halo.addColorStop(0, hexA(accent, .32)); halo.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
  const gv = ctx.createLinearGradient(0, H * 0.48, 0, H); gv.addColorStop(0, 'rgba(6,8,16,0)'); gv.addColorStop(1, 'rgba(6,8,16,.97)'); ctx.fillStyle = gv; ctx.fillRect(0, 0, W, H);
  const gt = ctx.createLinearGradient(0, 0, 0, 320); gt.addColorStop(0, 'rgba(6,8,16,.55)'); gt.addColorStop(1, 'rgba(6,8,16,0)'); ctx.fillStyle = gt; ctx.fillRect(0, 0, W, 320);
  ctx.textAlign = 'center';
  // etiqueta superior
  const lab = label.toUpperCase(); ctx.font = '700 30px Poppins, system-ui, sans-serif';
  const lw = _measureTracked(ctx, lab, 2.5), plw = lw + 72;
  ctx.fillStyle = 'rgba(255,255,255,.1)'; _roundRect(ctx, (W - plw) / 2, 116, plw, 62, 31); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 1; _roundRect(ctx, (W - plw) / 2, 116, plw, 62, 31); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.95)'; _fillTracked(ctx, lab, W / 2, 155, 2.5);
  // glow detrás de la carátula
  const pathMedia = () => { if (shape === 'circle') { ctx.beginPath(); ctx.arc(W / 2, ccy, S / 2, 0, Math.PI * 2); } else { _roundRect(ctx, cx, cy, S, S, 52); } };
  ctx.save(); ctx.filter = 'blur(85px)'; ctx.fillStyle = grad(cx, cy, cx + S, cy + S); ctx.globalAlpha = 0.55; _roundRect(ctx, cx + 25, cy + 55, S - 50, S - 50, 90); ctx.fill(); ctx.restore();
  // sombra + carátula
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 80; ctx.shadowOffsetY = 34; pathMedia(); ctx.fillStyle = '#0d1120'; ctx.fill(); ctx.restore();
  ctx.save(); pathMedia(); ctx.clip();
  if (coverImg) {
    if (shape === 'photo') { const r = Math.min(S / coverImg.width, S / coverImg.height), iw = coverImg.width * r, ih = coverImg.height * r; ctx.fillStyle = '#0b0f1c'; ctx.fillRect(cx, cy, S, S); ctx.drawImage(coverImg, cx + (S - iw) / 2, cy + (S - ih) / 2, iw, ih); }
    else { const r = Math.max(S / coverImg.width, S / coverImg.height), iw = coverImg.width * r, ih = coverImg.height * r; ctx.drawImage(coverImg, W / 2 - iw / 2, ccy - ih / 2, iw, ih); }
  } else { ctx.fillStyle = grad(cx, cy, cx + S, cy + S); ctx.fillRect(cx, cy, S, S); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '800 230px system-ui'; ctx.fillText(shape === 'circle' ? '👤' : '♪', W / 2, ccy + 82); }
  const sh = ctx.createLinearGradient(0, cy, 0, cy + S * 0.5); sh.addColorStop(0, 'rgba(255,255,255,.13)'); sh.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = sh; ctx.fillRect(cx, cy, S, S);
  ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.18)'; pathMedia(); ctx.stroke();
  // título
  ctx.fillStyle = '#fff'; const tt = _fitText(ctx, title || '', W - 150, 84, '800'); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 2; ctx.fillText(tt, W / 2, cy + S + 148); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  // artista
  if (subtitle) {
    ctx.font = '600 42px Poppins, system-ui, sans-serif';
    const sub = _fitText(ctx, subtitle, W - 320, 42, '600');
    const tw = ctx.measureText(sub).width, av = avatarImg ? 58 : 0, gpx = av ? 16 : 0, bW = av + gpx + tw, sX = (W - bW) / 2, ry = cy + S + 214;
    if (avatarImg) { ctx.save(); ctx.beginPath(); ctx.arc(sX + av / 2, ry - 15, av / 2, 0, Math.PI * 2); ctx.clip(); const r = Math.max(av / avatarImg.width, av / avatarImg.height); ctx.drawImage(avatarImg, sX + av / 2 - avatarImg.width * r / 2, ry - 15 - avatarImg.height * r / 2, avatarImg.width * r, avatarImg.height * r); ctx.restore(); ctx.lineWidth = 2; ctx.strokeStyle = hexA(accent, .9); ctx.beginPath(); ctx.arc(sX + av / 2, ry - 15, av / 2, 0, Math.PI * 2); ctx.stroke(); }
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 10; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText(sub, sX + av + gpx, ry); ctx.restore(); ctx.textAlign = 'center';
  }
  // CTA con brillo + footer
  const pw = 640, ph = 108, px = (W - pw) / 2, py = H - 244;
  ctx.save(); ctx.shadowColor = hexA(accent, .5); ctx.shadowBlur = 40; ctx.shadowOffsetY = 14; ctx.fillStyle = grad(px, 0, px + pw, 0); _roundRect(ctx, px, py, pw, ph, 54); ctx.fill(); ctx.restore();
  ctx.save(); _roundRect(ctx, px, py, pw, ph, 54); ctx.clip(); const cg = ctx.createLinearGradient(0, py, 0, py + ph / 2); cg.addColorStop(0, 'rgba(255,255,255,.28)'); cg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = cg; ctx.fillRect(px, py, pw, ph / 2); ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = '700 41px Poppins, system-ui, sans-serif'; ctx.fillText(cta, W / 2, py + ph / 2 + 14);
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '600 27px Poppins, system-ui, sans-serif'; _fillTracked(ctx, footer.toUpperCase(), W / 2, H - 86, 2);
}
// CAPA DINÁMICA — barata, se dibuja cada fotograma
function _drawStoryWave(ctx, o, freq) {
  const W = 1080, wy = _storyWaveY(), accent = o.accent || '#3e57fc', accent2 = o.accent2 || '#27c0ff';
  const nb = 56, bw = 7, gap = 8, tot = nb * (bw + gap) - gap, sx = (W - tot) / 2;
  const g = ctx.createLinearGradient(sx, 0, sx + tot, 0); g.addColorStop(0, accent); g.addColorStop(1, accent2); ctx.fillStyle = g;
  for (let i = 0; i < nb; i++) { let v; if (freq) v = freq[Math.floor(i / nb * freq.length)] / 255; else v = 0.12 + Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.16)) * 0.62; const h = 12 + v * 128, x = sx + i * (bw + gap); _roundRect(ctx, x, wy - h / 2, bw, h, bw / 2); ctx.fill(); }
}
function _drawStoryTimeline(ctx, o, progress) {
  const W = 1080, wy = _storyWaveY(), accent = o.accent || '#3e57fc', accent2 = o.accent2 || '#27c0ff', clip = o.clip || 10;
  const tlw = 640, tlx = (W - tlw) / 2, tly = wy + 96, pp = Math.max(0, Math.min(1, progress));
  ctx.fillStyle = 'rgba(255,255,255,.18)'; _roundRect(ctx, tlx, tly, tlw, 8, 4); ctx.fill();
  const g = ctx.createLinearGradient(tlx, 0, tlx + tlw, 0); g.addColorStop(0, accent); g.addColorStop(1, accent2); ctx.fillStyle = g; _roundRect(ctx, tlx, tly, tlw * pp, 8, 4); ctx.fill();
  ctx.save(); ctx.shadowColor = hexA(accent, .7); ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(tlx + tlw * pp, tly + 4, 12, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 27px Poppins, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(fmtClock(pp * clip), tlx, tly + 52); ctx.textAlign = 'right'; ctx.fillText(fmtClock(clip), tlx + tlw, tly + 52); ctx.textAlign = 'center';
}
async function generateStoryImage(o) {
  await ensurePoppins();
  if (o.coverImg && !o.accent) { const ac = storyAccent(o.coverImg); if (ac) o = { ...o, accent: ac.a, accent2: ac.a2, tint: ac.tint }; }
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920;
  drawStoryCard(cv.getContext('2d'), o);
  return await new Promise((res) => cv.toBlob((b) => res(b), 'image/png', 0.95));
}
async function shareBlob(blob, name, text) {
  if (!blob) { toast('No se pudo generar la historia'); return; }
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Guardado · súbelo a tu historia de Instagram 📸');
}
function pickVideoMime() {
  const c = ['video/mp4;codecs=h264,aac', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of c) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (_) {} }
  return '';
}
// graba un vídeo vertical (tarjeta animada + el clip de audio elegido) en tiempo real.
// Método PROBADO: captureStream(fps) + dibujar en cada frame de animación (esto
// ya animaba en el dispositivo del usuario). Único cambio respecto al original:
// se graba a 720x1280 (más ligero → más fluido). La capa estática se dibuja a
// 1080x1920 y se reescala, así no pierde nitidez.
async function renderTrackStoryVideo(t, coverImg, avatarImg, buffer, start, clip, onProgress) {
  await ensurePoppins();
  const who = trackWho(t);
  const acc = coverImg ? storyAccent(coverImg) : null;
  const o = { shape: 'square', coverImg, avatarImg, title: t.title, subtitle: who, cta: '▶  Escúchala en UnderBro', footer: 'underbro.app', label: '♫  Sonando en UnderBro', clip, accent: acc ? acc.a : undefined, accent2: acc ? acc.a2 : undefined, tint: acc ? acc.tint : undefined };
  const VW = 720, VH = 1280, SCALE = VW / 1080;
  // capa estática (cara, fondo, blur) a resolución completa, se dibuja UNA vez
  const stat = document.createElement('canvas'); stat.width = 1080; stat.height = 1920; _drawStoryBase(stat.getContext('2d'), o);
  const cv = document.createElement('canvas'); cv.width = VW; cv.height = VH; const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.scale(SCALE, SCALE); // el resto del dibujo sigue usando coords 1080x1920
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') { try { await ac.resume(); } catch (_) {} }
  const dest = ac.createMediaStreamDestination();
  const analyser = ac.createAnalyser(); analyser.fftSize = 128; analyser.smoothingTimeConstant = 0.78;
  const src = ac.createBufferSource(); src.buffer = buffer; src.connect(analyser); analyser.connect(dest);
  const vstream = cv.captureStream(30);
  const mixed = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = pickVideoMime();
  const rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);
  const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; setTimeout(res, 4000); });
  const freq = new Uint8Array(analyser.frequencyBinCount);
  rec.start(100); src.start(0, start, clip);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const frame = () => {
      const el = (performance.now() - t0) / 1000, pr = Math.min(1, el / clip);
      analyser.getByteFrequencyData(freq);
      ctx.drawImage(stat, 0, 0, 1080, 1920);
      _drawStoryWave(ctx, o, freq);
      _drawStoryTimeline(ctx, o, pr);
      if (onProgress) onProgress(pr);
      if (el < clip) requestAnimationFrame(frame); else resolve();
    };
    frame();
  });
  try { rec.stop(); } catch (_) {} try { src.stop(); } catch (_) {}
  await stopped; try { ac.close(); } catch (_) {}
  if (!chunks.length) return null; // sin datos → el llamador comparte la imagen
  return new Blob(chunks, { type: mime || 'video/webm' });
}
// selector de los 10s + creación de la historia (vídeo con sonido) para una pista
function shareStory(t) { openTrackStoryPicker(t); }
function peaksFromBuffer(buffer, n) {
  const ch = buffer.getChannelData(0), block = Math.max(1, Math.floor(ch.length / n)), out = [];
  for (let i = 0; i < n; i++) { let mx = 0; const s = i * block; for (let j = 0; j < block; j += 64) { const v = Math.abs(ch[s + j] || 0); if (v > mx) mx = v; } out.push(mx); }
  const peak = Math.max(...out, 0.001); return out.map((p) => p / peak);
}
async function openTrackStoryPicker(t) {
  const canVideo = !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && t.audio_url);
  const who = trackWho(t);
  const m = openModal(`<div class="modal-head"><h3>Historia para Instagram</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="st-head"><div class="st-cover">${t.cover_url ? `<img src="${esc(czUrl(t.cover_url))}" alt="">` : '<svg fill="none" stroke="#fff"><use href="#i-music"/></svg>'}</div><div class="st-meta"><b>${esc(t.title)}</b><span>${esc(who)}</span></div></div>
      <p class="eco-hint">${canVideo ? 'Arrastra sobre la onda para elegir los 10 s que sonarán 🔊' : 'Tu navegador no permite vídeo con sonido; comparte como imagen.'}</p>
      <div id="stStatus" class="eco-hint">${canVideo ? 'Cargando audio…' : ''}</div>
      <div id="stCtrls" style="display:none">
        <canvas id="stWave" class="st-wave"></canvas>
        <div class="st-times"><span id="stFrom">0:00</span><span id="stTo">0:10</span></div>
        <div class="st-actions">
          <button class="btn" id="stPrev"><svg fill="none" stroke="currentColor"><use href="#i-play"/></svg> Escuchar</button>
          <button class="btn btn-ig" id="stMake">🎬 Crear historia</button>
        </div>
        <div class="progress-bar hidden" id="stBar"><div></div></div>
      </div>
      <button class="btn" id="stImg" style="width:100%;margin-top:10px">Compartir solo imagen</button>
    </div>`);
  let cover = null, avatar = null, buffer = null, clip = 10, peaks = [], start = 0, playhead = null;
  if (t.cover_url) _loadImg(czUrl(t.cover_url)).then((im) => { cover = im; }).catch(() => {});
  if (t.profiles?.avatar_url) _loadImg(czUrl(t.profiles.avatar_url)).then((im) => { avatar = im; }).catch(() => {});
  m.querySelector('#stImg').onclick = async () => {
    m.remove(); toast('Generando historia…');
    let cov = cover; if (!cov && t.cover_url) { try { cov = await _loadImg(czUrl(t.cover_url)); } catch (_) {} }
    const blob = await generateStoryImage({ shape: 'square', coverImg: cov, avatarImg: avatar, title: t.title, subtitle: who, cta: '▶  Escúchala en UnderBro', footer: 'underbro.app', label: '♫  Sonando en UnderBro' });
    shareBlob(blob, 'underbro-story.png', `${t.title} en UnderBro`);
  };
  if (!canVideo) { m.querySelector('#stStatus').textContent = ''; return; }
  try {
    const r = await fetch(czUrl(t.audio_url)); const ab = await r.arrayBuffer();
    const dc = new (window.AudioContext || window.webkitAudioContext)(); buffer = await dc.decodeAudioData(ab); try { dc.close(); } catch (_) {}
  } catch (e) { console.error('[story audio]', e); m.querySelector('#stStatus').textContent = 'No se pudo cargar el audio. Comparte como imagen.'; return; }
  const dur = buffer.duration; clip = Math.min(10, dur); peaks = peaksFromBuffer(buffer, 170);
  m.querySelector('#stStatus').style.display = 'none'; m.querySelector('#stCtrls').style.display = '';
  const cv = m.querySelector('#stWave'), wctx = cv.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
  let cw = 0; const CH = 96;
  const sizeCv = () => { cw = cv.clientWidth || 520; cv.width = cw * dpr; cv.height = CH * dpr; wctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  const drawWave = () => {
    if (!cw) sizeCv();
    wctx.clearRect(0, 0, cw, CH);
    const n = peaks.length, bw = cw / n, x0 = (start / dur) * cw, x1 = ((start + clip) / dur) * cw;
    for (let i = 0; i < n; i++) { const h = Math.max(3, peaks[i] * (CH * 0.84)), x = i * bw, cxb = x + bw / 2, inW = cxb >= x0 && cxb <= x1; wctx.fillStyle = inW ? '#3e57fc' : 'rgba(255,255,255,.16)'; _roundRect(wctx, x + 1, (CH - h) / 2, Math.max(1, bw - 2), h, 2); wctx.fill(); }
    wctx.fillStyle = 'rgba(62,87,252,.12)'; wctx.fillRect(x0, 0, x1 - x0, CH);
    wctx.strokeStyle = 'rgba(62,87,252,.95)'; wctx.lineWidth = 2; wctx.strokeRect(x0 + 1, 2, Math.max(2, x1 - x0 - 2), CH - 4);
    if (playhead != null) { const px = ((start + playhead) / dur) * cw; wctx.strokeStyle = '#fff'; wctx.lineWidth = 2; wctx.beginPath(); wctx.moveTo(px, 0); wctx.lineTo(px, CH); wctx.stroke(); }
  };
  const updTimes = () => { m.querySelector('#stFrom').textContent = fmtClock(start); m.querySelector('#stTo').textContent = fmtClock(start + clip); };
  const setFromX = (clientX) => { const r = cv.getBoundingClientRect(); const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width)); start = Math.max(0, Math.min(dur - clip, frac * dur - clip / 2)); updTimes(); drawWave(); };
  let drag = false;
  cv.addEventListener('pointerdown', (e) => { drag = true; try { cv.setPointerCapture(e.pointerId); } catch (_) {} setFromX(e.clientX); });
  cv.addEventListener('pointermove', (e) => { if (drag) setFromX(e.clientX); });
  cv.addEventListener('pointerup', () => { drag = false; });
  cv.addEventListener('pointercancel', () => { drag = false; });
  const onResize = () => drawWave();
  window.addEventListener('resize', onResize);
  setTimeout(() => { sizeCv(); updTimes(); drawWave(); }, 40);
  let prevCtx = null, prevSrc = null, prevRAF = 0;
  const setPrevIcon = (playing) => { const b = m.querySelector('#stPrev'); b.innerHTML = `<svg fill="none" stroke="currentColor"><use href="#i-${playing ? 'pause' : 'play'}"/></svg> ${playing ? 'Parar' : 'Escuchar'}`; };
  const stopPrev = () => { try { prevSrc && prevSrc.stop(); } catch (_) {} try { prevCtx && prevCtx.close(); } catch (_) {} prevSrc = null; prevCtx = null; cancelAnimationFrame(prevRAF); playhead = null; drawWave(); setPrevIcon(false); };
  m.querySelector('#stPrev').onclick = () => {
    if (prevSrc) { stopPrev(); return; }
    prevCtx = new (window.AudioContext || window.webkitAudioContext)(); prevSrc = prevCtx.createBufferSource(); prevSrc.buffer = buffer; prevSrc.connect(prevCtx.destination);
    const t0 = prevCtx.currentTime; prevSrc.start(0, start, clip); setPrevIcon(true);
    const tick = () => { if (!prevCtx) return; playhead = Math.min(clip, prevCtx.currentTime - t0); drawWave(); if (playhead < clip) prevRAF = requestAnimationFrame(tick); else stopPrev(); }; tick();
  };
  m.querySelector('#stMake').onclick = async () => {
    stopPrev();
    const mk = m.querySelector('#stMake'); mk.disabled = true; mk.textContent = 'Generando vídeo… (10s)';
    const bar = m.querySelector('#stBar'); bar.classList.remove('hidden'); const fill = bar.querySelector('div');
    let cov = cover; if (!cov && t.cover_url) { try { cov = await _loadImg(czUrl(t.cover_url)); } catch (_) {} }
    try {
      const blob = await renderTrackStoryVideo(t, cov, avatar, buffer, start, clip, (p) => { fill.style.width = (p * 100) + '%'; });
      window.removeEventListener('resize', onResize); m.remove();
      if (blob && blob.size > 1000) {
        const ext = (blob.type.indexOf('mp4') >= 0) ? 'mp4' : 'webm';
        await shareBlob(blob, 'underbro-story.' + ext, `${t.title} — escúchala en UnderBro`);
      } else {
        // red de seguridad: si el vídeo no se pudo grabar, comparte la imagen
        toast('Vídeo no disponible en este navegador · comparto la imagen');
        const img = await generateStoryImage({ shape: 'square', coverImg: cov, avatarImg: avatar, title: t.title, subtitle: who, cta: '▶  Escúchala en UnderBro', footer: 'underbro.app', label: '♫  Sonando en UnderBro' });
        await shareBlob(img, 'underbro-story.png', `${t.title} en UnderBro`);
      }
    } catch (e) { console.error('[story video]', e); toast('No se pudo generar el vídeo'); mk.disabled = false; mk.textContent = '🎬 Crear historia'; }
  };
}
async function sharePhotoStory(p) {
  toast('Generando historia…');
  let im = null; if (p.image_url) { try { im = await _loadImg(czUrl(p.image_url)); } catch (_) {} }
  let av = null; if (p.profiles?.avatar_url) { try { av = await _loadImg(czUrl(p.profiles.avatar_url)); } catch (_) {} }
  const blob = await generateStoryImage({ shape: 'photo', coverImg: im, avatarImg: av, title: (p.profiles?.display_name || p.profiles?.username || 'UnderBro'), subtitle: '@' + (p.profiles?.username || ''), cta: 'Míralo en UnderBro', footer: 'underbro.app', label: '📸  Foto en UnderBro' });
  shareBlob(blob, 'underbro-foto.png', 'Mira esto en UnderBro');
}
/* ---- COMPARTIR FOTO ---- */
function postShareUrl(p) { return `${location.origin}/p/${p.id}`; }
function sharePost(p) {
  const url = postShareUrl(p);
  const who = p.profiles?.display_name || p.profiles?.username || 'UnderBro';
  const title = `Foto de ${who}`;
  const m = openModal(`
    <div class="modal-head"><h3>Compartir foto</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="share-hero share-hero-photo">
        <div class="share-hero-bg" style="background-image:url('${esc(p.image_url)}')"></div>
        <div class="share-hero-cover"><img src="${esc(p.image_url)}" alt=""></div>
        <div class="share-hero-meta"><b>Foto</b><span>${esc(who)}</span></div>
      </div>
      <button class="btn btn-ig share-big" id="sharePhotoStory">
        <span class="ig-ic"><svg fill="none" stroke="#fff"><use href="#i-camera"/></svg></span>
        <span class="ig-tx"><b>Crear historia</b><i>Compártela en tu historia de Instagram</i></span>
        <svg class="ig-chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      ${shareQuickRow(url, title)}
      <div class="share-link"><input type="text" id="shareUrl" readonly value="${esc(url)}" /><button class="btn sm primary" id="copyLink">Copiar</button></div>
    </div>`);
  const copyBtn = m.querySelector('#copyLink');
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(url); }
    catch { const i = m.querySelector('#shareUrl'); i.select(); try { document.execCommand('copy'); } catch {} }
    copyBtn.textContent = 'Copiado ✓'; toast('Enlace copiado');
  };
  m.querySelector('#sharePhotoStory').onclick = () => sharePhotoStory(p);
  wireQuickRow(m, url, title, () => {
    m.remove();
    openSharePicker(() => ({ body: p.caption ? p.caption.slice(0, 80) : '', attachment_type: 'image', attachment_url: p.image_url, attachment_name: 'foto' }), 'Foto enviada');
  });
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
  const pay = params.get('pay');
  if (pay) { history.replaceState(null, '', location.pathname); handlePayReturn(pay, params.get('sid')); return; }
  const trackId = params.get('track');
  const postId = params.get('post');
  const playlistId = params.get('playlist');
  const uname = params.get('u');
  const query = params.get('q');
  if (!trackId && !postId && !playlistId && !uname && !query) return;
  history.replaceState(null, '', location.pathname);
  if (trackId) {
    const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').eq('id', trackId).maybeSingle();
    if (data) { state.tracks = [data]; state.queue = [data.id]; playTrack(data); openNowPlaying(); }
    else toast('La pista no existe o fue eliminada');
  } else if (query) {
    state.search = query.trim(); switchView('search');
  } else if (uname) {
    openProfileByUsername(uname);
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
  const busy = (toggleLike._busy ||= new Set());
  if (busy.has(t.id)) return;            // ignora toques repetidos mientras se procesa
  busy.add(t.id);
  const btn = card.querySelector('[data-act="like"]');
  const cntEl = card.querySelector('.likecount');
  const liked = state.likes.has(t.id);
  const setLn = (txt) => { const ln = btn?.querySelector('.ln'); if (ln) ln.textContent = txt; };
  try {
    if (liked) {
      state.likes.delete(t.id);
      t.likes_count = Math.max(0, (t.likes_count || 0) - 1);
      btn?.classList.remove('on'); setLn('Me gusta');
      await sb.from('likes').delete().eq('track_id', t.id).eq('user_id', state.user.id);
    } else {
      state.likes.add(t.id);
      t.likes_count = (t.likes_count || 0) + 1;
      btn?.classList.add('on'); setLn('Te gusta');
      await sb.from('likes').insert({ track_id: t.id, user_id: state.user.id });
    }
    if (cntEl) cntEl.textContent = t.likes_count;
    updateCounts();
  } finally { busy.delete(t.id); }
}

/* ---- REPOST ---- */
async function toggleRepost(t, card) {
  if (typeof requireNotBanned === 'function' && !requireNotBanned()) return;
  if (t.user_id === state.user.id) { toast('No puedes repostear tu propia pista'); return; }
  const busy = (toggleRepost._busy ||= new Set());
  if (busy.has(t.id)) return;
  busy.add(t.id);
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
  busy.delete(t.id);
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
  const close = () => { if (dd) { dd.remove(); dd = null; window.removeEventListener('resize', place); } };
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
    window.addEventListener('resize', place);
  });
  input.addEventListener('blur', () => setTimeout(close, 160));
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
  box.querySelectorAll('.comment').forEach(row => {
    const c = comments.find(x => String(x.id) === String(row.dataset.cid)); if (!c) return;
    const canDel = c.user_id === state.user.id || state.profile.is_admin;
    attachLongPress(row, () => commentMenu(box, c, canDel, async () => {
      const { error } = await sb.from('comments').delete().eq('id', c.id);
      if (error) { toast('No se pudo borrar el comentario'); return; }
      renderComments(box, t, comments.filter(x => x.id !== c.id));
    }));
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
  $('pClose').onclick = (e) => { e.stopPropagation(); closePlayer(); };

  // deslizar el reproductor hacia abajo para cerrarlo
  (function () {
    const pl = $('player'); let sy = 0, sx = 0, dragging = false, moved = false;
    pl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.seek, .vol-slider, button')) return;
      sy = e.clientY; sx = e.clientX; dragging = true; moved = false;
    });
    pl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - sy, dx = e.clientX - sx;
      if (Math.abs(dy) > 6 || Math.abs(dx) > 6) moved = true;
      if (dy > 0 && Math.abs(dy) > Math.abs(dx)) { pl.style.transform = `translateY(${Math.min(dy, 220)}px)`; pl.style.opacity = String(Math.max(.2, 1 - dy / 240)); }
    });
    const end = (e) => {
      if (!dragging) return; dragging = false;
      const dy = (e.clientY || sy) - sy;
      pl.style.transition = 'transform .2s var(--ease), opacity .2s';
      if (dy > 70) { pl.style.transform = 'translateY(130%)'; pl.style.opacity = '0'; setTimeout(() => { pl.style.transition = ''; pl.style.transform = ''; pl.style.opacity = ''; closePlayer(); }, 190); }
      else { pl.style.transform = ''; pl.style.opacity = ''; setTimeout(() => { pl.style.transition = ''; }, 200); }
      if (moved) { const sup = (ev) => { if (ev.target.closest('.now')) { ev.stopPropagation(); ev.preventDefault(); } pl.removeEventListener('click', sup, true); }; pl.addEventListener('click', sup, true); }
    };
    pl.addEventListener('pointerup', end);
    pl.addEventListener('pointercancel', () => { if (dragging) { dragging = false; pl.style.transform = ''; pl.style.opacity = ''; } });
  })();

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
  audio.addEventListener('ended', () => { if (npRepeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); } else step(1); });
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
  // cacheamos el rect al empezar a interactuar (no se mueve durante el gesto):
  // evita leer getBoundingClientRect en cada pointermove (layout thrash)
  let seekRect = null;
  const refreshSeekRect = () => { seekRect = seek.getBoundingClientRect(); };
  const pctFromX = (clientX) => { const r = seekRect || seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - r.left) / r.width)); };
  seek.addEventListener('pointerenter', refreshSeekRect);
  const paint = (pct) => { fill.style.width = (pct*100)+'%'; knob.style.left = (pct*100)+'%'; };
  const preview = (pct) => { ghost.style.width = (pct*100)+'%'; tip.style.left = (pct*100)+'%'; if (audio.duration) tip.textContent = fmtTime(pct*audio.duration); };
  let rafSeek = 0, pendingPct = null;
  const commitLive = () => { rafSeek = 0; if (audio.duration && pendingPct != null) audio.currentTime = pendingPct * audio.duration; };
  const queueLive = (p) => { pendingPct = p; if (!rafSeek) rafSeek = requestAnimationFrame(commitLive); };
  seek.addEventListener('pointerdown', (e) => {
    seeking = true; seek.classList.add('scrub'); refreshSeekRect();
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
let npRepeat = 'off', npShuffle = false, npRate = 1, npShowRemaining = false;
const NP_RATES = [1, 1.25, 1.5, 2, 0.75];
function initNowPlaying() {
  $('npPlay').onclick = togglePlay;
  $('npPrev').onclick = () => step(-1);
  $('npNext').onclick = () => step(1);
  $('npClose').onclick = closeNowPlaying;
  $('player').querySelector('.now').addEventListener('click', openNowPlaying);

  // aleatorio
  $('npShuffle').onclick = () => { npShuffle = !npShuffle; $('npShuffle').classList.toggle('on', npShuffle); haptic(10); toast(npShuffle ? '🔀 Aleatorio activado' : 'Aleatorio desactivado'); };
  // repetir: off → all → one → off
  $('npRepeat').onclick = () => {
    npRepeat = npRepeat === 'off' ? 'all' : npRepeat === 'all' ? 'one' : 'off';
    const b = $('npRepeat'); b.classList.toggle('on', npRepeat !== 'off'); b.classList.toggle('one', npRepeat === 'one');
    haptic(10); toast(npRepeat === 'all' ? '🔁 Repetir toda la cola' : npRepeat === 'one' ? '🔂 Repetir esta pista' : 'Repetir desactivado');
  };
  // velocidad
  $('npRate').onclick = () => {
    const i = (NP_RATES.indexOf(npRate) + 1) % NP_RATES.length; npRate = NP_RATES[i];
    try { audio.playbackRate = npRate; } catch {}
    $('npRate').textContent = npRate + 'x';
    $('npRate').classList.toggle('on', npRate !== 1); updateMediaPositionState(); haptic(8);
  };
  // tocar el tiempo total alterna restante / total
  $('npDur').onclick = () => { npShowRemaining = !npShowRemaining; updateNpProgress(audio.duration ? audio.currentTime / audio.duration : 0); };

  // panel de cola ("a continuación")
  $('npQueueBtn').onclick = () => {
    const open = $('npQueuePanel').classList.toggle('open');
    $('npQueueBtn').classList.toggle('on', open);
    if (open) renderQueuePanel();
    haptic(8);
  };
  $('npQueueClose').onclick = () => { $('npQueuePanel').classList.remove('open'); $('npQueueBtn').classList.remove('on'); };

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
function openNowPlaying() { if (!state.current) return; $('nowPlaying').classList.add('open'); syncNowPlaying(); }
function closeNowPlaying() { $('nowPlaying').classList.remove('open'); $('npQueuePanel')?.classList.remove('open'); $('npQueueBtn')?.classList.remove('on'); }
function closePlayer() {
  try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) {}
  state.current = null; state.queue = [];
  closeNowPlaying();
  $('player').classList.add('hidden');
  document.body.classList.remove('has-player');
  document.querySelectorAll('.track.playing, .dm-track.playing').forEach(c => c.classList.remove('playing'));
}
function setNpPlayIcon(playing) { const u = $('npPlay').querySelector('use'); if (u) u.setAttribute('href', playing ? '#i-pause' : '#i-play'); }
function syncNowPlaying() {
  const t = state.current; if (!t) return;
  $('npTitle').textContent = t.title;
  $('npArtist').textContent = t.profiles?.display_name || t.profiles?.username || t.artist || '';
  $('npCover').innerHTML = t.cover_url ? `<img src="${esc(t.cover_url)}" alt="" />` : `<svg fill="none" stroke="#fff"><use href="#i-music"/></svg>`;
  $('npBg').style.backgroundImage = t.cover_url ? `url('${czUrl(t.cover_url)}')` : 'none';
  const rawPeaks = Array.isArray(t.waveform) && t.waveform.length ? t.waveform : waveBars(t.id, 80);
  const npPeaks = resamplePeaks(rawPeaks, 80); // nº fijo de barras → siempre cabe y queda centrada
  $('npWave').innerHTML = npPeaks.map(h => `<div class="bar" style="--h:${czNum(h)}%"></div>`).join('');
  setNpPlayIcon(!audio.paused);
  updateNpProgress(audio.duration ? audio.currentTime / audio.duration : 0);
}
function updateNpProgress(pct) {
  if (!npIsOpen()) return;
  const bars = $('npWave').querySelectorAll('.bar');
  const upto = Math.floor(pct * bars.length);
  bars.forEach((b, i) => b.classList.toggle('played', i <= upto));
  $('npCur').textContent = fmtTime(audio.currentTime);
  const dur = audio.duration || state.current?.duration || 0;
  $('npDur').textContent = (npShowRemaining && dur) ? '-' + fmtTime(Math.max(0, dur - audio.currentTime)) : fmtTime(dur);
}
function setPlayIcon(playing) {
  const u = $('pPlay')?.querySelector('use'); if (u) u.setAttribute('href', playing ? '#i-pause' : '#i-play');
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

const playLogged = new Set();
function schedLabel(ts) { try { const d = new Date(ts); return d.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } }
async function playTrack(t) {
  if (state.current?.id === t.id) { togglePlay(); return; }
  state.current = t;
  $('player').classList.remove('hidden');
  document.body.classList.add('has-player');
  $('pTitle').textContent = t.title;
  $('pArtist').textContent = (t.profiles?.display_name || t.profiles?.username || t.artist || '');
  $('pCover').innerHTML = t.cover_url ? `<img src="${esc(t.cover_url)}" alt="" />` : `<svg width="22" height="22" fill="none" stroke="#fff" style="margin:15px"><use href="#i-music"/></svg>`;
  updateMediaSession();
  if (npIsOpen()) syncNowPlaying();
  audio.src = t.audio_url;
  try { audio.playbackRate = npRate; } catch {}
  try { await audio.play(); } catch {}
  // contar reproducción
  sb.rpc('increment_plays', { track: t.id }).then(() => { t.plays = (t.plays||0)+1; }).catch(() => {});
  // registrar evento para insights de audiencia (una vez por pista y sesión)
  if (!playLogged.has(t.id)) { playLogged.add(t.id); sb.from('track_plays').insert({ track_id: t.id, user_id: state.user.id }).catch(() => {}); }
  // si no está en la cola actual, crear cola con la vista
  if (!state.queue.includes(t.id)) state.queue = [t.id];
  if ($('npQueuePanel')?.classList.contains('open')) renderQueuePanel();
}

/* ---- Cola visible: "a continuación", saltar y quitar pistas ---- */
function enqueue(t, playNext = false) {
  if (!state.tracks.find(x => x.id === t.id)) state.tracks.push(t);
  if (!state.current) { state.queue = [t.id]; playTrack(t); openNowPlaying(); return; }
  if (state.queue.includes(t.id)) { toast('Ya está en la cola'); return; }
  if (playNext) {
    const idx = state.queue.indexOf(state.current.id);
    state.queue.splice(idx + 1, 0, t.id);
    toast('⏭️ Se reproduce a continuación');
  } else {
    state.queue.push(t.id);
    toast('➕ Añadido a la cola');
  }
  haptic(10);
  if ($('npQueuePanel')?.classList.contains('open')) renderQueuePanel();
}
function removeFromQueue(id) {
  if (id === state.current?.id) return;        // la pista actual no se quita
  const i = state.queue.indexOf(id);
  if (i >= 0) state.queue.splice(i, 1);
  renderQueuePanel();
}
function renderQueuePanel() {
  const list = $('npqList'); if (!list) return;
  const curIdx = state.queue.indexOf(state.current?.id);
  list.innerHTML = '';
  state.queue.forEach((id, i) => {
    const t = state.tracks.find(x => x.id === id);
    if (!t) return;
    const isCur = id === state.current?.id;
    const isPast = curIdx >= 0 && i < curIdx;
    const who = t.profiles?.display_name || t.profiles?.username || t.artist || '';
    const row = el(`<div class="npq-row${isCur ? ' cur' : ''}${isPast ? ' past' : ''}" data-id="${esc(String(id))}">
      <div class="npq-cover"${t.cover_url ? ` style="background-image:url('${esc(t.cover_url)}')"` : ''}>${isCur ? '<span class="npq-eq"><i></i><i></i><i></i></span>' : ''}</div>
      <div class="npq-info"><div class="npq-title">${esc(t.title)}</div><div class="npq-artist">${esc(who)}</div></div>
      ${isCur ? '<span class="npq-now">sonando</span>' : `<button class="npq-x" data-rm title="Quitar de la cola"><svg><use href="#i-x"/></svg></button>`}
    </div>`);
    attachQueueRow(row, id, isCur, isPast);
    list.appendChild(row);
  });
  if (!list._noCtx) { list.addEventListener('contextmenu', (e) => e.preventDefault()); list._noCtx = true; }
  const upcoming = curIdx >= 0 ? state.queue.length - curIdx - 1 : state.queue.length;
  $('npqCount').textContent = upcoming > 0 ? `${upcoming} a continuación` : 'Fin de la cola';
}

/* ---- Reordenar la cola: mantener pulsado para "levantar" y arrastrar ----
   Funciona con toque y ratón. Bloquea el menú nativo de selección y el scroll
   mientras se arrastra. Las pistas "a continuación" no pueden subir por encima
   de la que está sonando. ------------------------------------------------- */
let qDrag = null;
function attachQueueRow(row, id, isCur, isPast) {
  const rm = row.querySelector('[data-rm]');
  if (rm) rm.addEventListener('click', (e) => { e.stopPropagation(); removeFromQueue(id); });
  const canDrag = !isCur && !isPast;
  let timer = 0, sx = 0, sy = 0, lastE = null, longFired = false, moved = false, downId = null;
  row.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-rm]')) return;
    downId = e.pointerId; sx = e.clientX; sy = e.clientY; lastE = e; moved = false; longFired = false;
    if (canDrag) { row.classList.add('press'); timer = setTimeout(() => { longFired = true; row.classList.remove('press'); beginQueueDrag(lastE, row); }, 230); }
  });
  row.addEventListener('pointermove', (e) => {
    if (downId == null) return;
    lastE = e;
    if (!longFired && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) { moved = true; clearTimeout(timer); row.classList.remove('press'); }
    if (longFired) qDragMove(e);
  });
  const finish = () => {
    if (downId == null) return;
    clearTimeout(timer); row.classList.remove('press');
    if (longFired) qDragEnd();
    else if (!moved && !isCur) { const tt = state.tracks.find(x => x.id === id); if (tt) playTrack(tt); }
    downId = null; longFired = false; moved = false;
  };
  row.addEventListener('pointerup', finish);
  row.addEventListener('pointercancel', finish);
}
// Reordenado determinista basado en transforms: las vecinas se apartan a una
// posición FIJA (no hay animaciones que se pisen). Solo se reordena el DOM al
// soltar. La región reordenable son las pistas "a continuación".
function beginQueueDrag(e, row) {
  const list = $('npqList'); if (!list) return;
  const allRows = [...list.querySelectorAll('.npq-row')];
  const curRow = list.querySelector('.npq-row.cur');
  const curIdx = curRow ? allRows.indexOf(curRow) : -1;
  const upcoming = allRows.filter((r, i) => i > curIdx && !r.classList.contains('past') && !r.classList.contains('cur'));
  const fromIdx = upcoming.indexOf(row);
  if (fromIdx < 0 || upcoming.length < 2) { qDrag = null; return; }   // nada que reordenar
  const homes = upcoming.map(r => { const b = r.getBoundingClientRect(); return { top: b.top, h: b.height }; });
  const slotH = Math.abs(homes[1].top - homes[0].top) || homes[0].h;
  qDrag = { list, row, upcoming, homes, slotH, fromIdx, toIdx: fromIdx, lastDy: 0, startY: e.clientY, prevent: (ev) => ev.preventDefault() };
  row.classList.add('dragging');
  document.body.classList.add('q-dragging');
  haptic(18);
  try { row.setPointerCapture(e.pointerId); } catch {}
  document.addEventListener('touchmove', qDrag.prevent, { passive: false });
  upcoming.forEach(r => { if (r !== row) r.style.transition = 'transform .18s var(--ease)'; });
  qDragMove(e);
}
function qDragMove(e) {
  if (!qDrag) return;
  const { row, upcoming, homes, slotH, fromIdx } = qDrag;
  // limitar el arrastre a la banda "a continuación"
  const minTop = homes[0].top, maxTop = homes[upcoming.length - 1].top;
  let top = homes[fromIdx].top + (e.clientY - qDrag.startY);
  top = Math.max(minTop, Math.min(maxTop, top));
  const dy = top - homes[fromIdx].top;
  qDrag.lastDy = dy;
  const center = top + homes[fromIdx].h / 2;
  // índice destino comparando con los centros "home" (referencia fija → estable)
  let toIdx = fromIdx;
  while (toIdx < upcoming.length - 1 && center > homes[toIdx + 1].top + homes[toIdx + 1].h / 2) toIdx++;
  while (toIdx > 0 && center < homes[toIdx - 1].top + homes[toIdx - 1].h / 2) toIdx--;
  qDrag.toIdx = toIdx;
  // apartar las vecinas hacia un desplazamiento fijo (±slotH) para abrir hueco
  upcoming.forEach((r, i) => {
    if (r === row) return;
    let shift = 0;
    if (fromIdx < toIdx && i > fromIdx && i <= toIdx) shift = -slotH;
    else if (fromIdx > toIdx && i < fromIdx && i >= toIdx) shift = slotH;
    r.style.transform = shift ? `translateY(${shift}px)` : 'translateY(0)';
  });
  // la fila arrastrada sigue al dedo (sin transición → 1:1)
  row.style.transform = `translateY(${dy.toFixed(1)}px) scale(1.03)`;
}
function qDragEnd() {
  if (!qDrag) return;
  const { list, row, upcoming, homes, fromIdx, toIdx, lastDy, prevent } = qDrag;
  document.removeEventListener('touchmove', prevent, { passive: false });
  document.body.classList.remove('q-dragging');
  // nuevo orden de la región y reinserción en el DOM (una sola vez)
  const newOrder = upcoming.slice();
  newOrder.splice(toIdx, 0, newOrder.splice(fromIdx, 1)[0]);
  const anchor = upcoming[upcoming.length - 1].nextSibling;
  upcoming.forEach(r => { if (r !== row) { r.style.transition = ''; r.style.transform = ''; } });
  newOrder.forEach(r => list.insertBefore(r, anchor));
  // reconstruir state.queue desde el orden del DOM (conservando el tipo de id)
  const orig = new Map(state.queue.map(q => [String(q), q]));
  const ids = [...list.querySelectorAll('.npq-row')].map(r => r.dataset.id);
  const rebuilt = ids.map(s => orig.get(s)).filter(v => v != null);
  if (rebuilt.length === state.queue.length) state.queue = rebuilt;
  // aterrizaje animado de la fila arrastrada hasta su nuevo hueco
  row.style.transition = 'none';
  row.style.transform = 'none';
  const newTop = row.getBoundingClientRect().top;
  const delta = (homes[fromIdx].top + lastDy) - newTop;
  row.style.transform = `translateY(${delta.toFixed(1)}px) scale(1.02)`;
  requestAnimationFrame(() => { row.style.transition = 'transform .18s var(--ease)'; row.style.transform = 'none'; });
  setTimeout(() => { row.classList.remove('dragging'); row.style.transition = ''; row.style.transform = ''; }, 210);
  qDrag = null;
  const ci = state.queue.indexOf(state.current?.id);
  const up = ci >= 0 ? state.queue.length - ci - 1 : state.queue.length;
  const c = $('npqCount'); if (c) c.textContent = up > 0 ? `${up} a continuación` : 'Fin de la cola';
}
async function step(dir) {
  if (!state.current) return;
  let idx = state.queue.indexOf(state.current.id);
  let nextId;
  if (npShuffle && dir > 0 && state.queue.length > 1) {
    let r; do { r = Math.floor(Math.random() * state.queue.length); } while (state.queue[r] === state.current.id);
    nextId = state.queue[r];
  } else {
    nextId = state.queue[idx + dir];
  }
  // repetir toda la cola: al llegar al final, vuelve al principio
  if (!nextId && dir > 0 && npRepeat === 'all' && state.queue.length) {
    const t0 = state.tracks.find(x => x.id === state.queue[0]);
    if (t0) { playTrack(t0); return; }
  }
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
    const beatsOnly = state._radioMode === 'beats';
    const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').order('plays', { ascending: false }).limit(200);
    let pool = (data || []).filter(t => !exclude.has(t.id) && (beatsOnly ? t.is_beat : !t.is_beat));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const batch = pool.slice(0, 20);
    batch.forEach(t => { if (!state.tracks.find(x => x.id === t.id)) state.tracks.push(t); });
    state.queue.push(...batch.map(t => t.id));
    return batch.length;
  } catch (_) { return 0; }
  finally { _radioLoading = false; }
}
// inicia una sesión de radio (mezcla sin fin) desde cero
async function startRadio(beatsOnly = false) {
  toast(beatsOnly ? '📻 Radio de beats…' : '📻 Iniciando radio…');
  state._radioMode = beatsOnly ? 'beats' : 'tracks';
  const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').order('created_at', { ascending: false }).limit(200);
  let pool = (data || []).filter(t => beatsOnly ? t.is_beat : !t.is_beat);
  if (!pool.length) { toast(beatsOnly ? 'Aún no hay beats para la radio' : 'Aún no hay pistas para la radio'); return; }
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
async function computeWaveformPeaks(file, n = 140) {
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

function openUploadModal(prefill) {
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
        <input type="file" id="fAudio" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.wma,.alac" hidden />
        <audio id="audioPreview" class="up-preview hidden" controls preload="metadata"></audio>
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
      <div class="field"><label>Descripción <span style="color:var(--ink-faint);font-weight:400">(opcional)</span></label><textarea id="uDesc" maxlength="600" placeholder="Cuéntale a la gente sobre esta pista…"></textarea></div>
      <div class="field"><label class="pk-tg" style="font-weight:600"><input type="checkbox" id="uSchedule" style="width:auto" /> <span>📅 Programar publicación</span></label><input type="datetime-local" id="uScheduleAt" style="display:none;margin-top:8px" /></div>
      <div class="pk-row2" id="uBeatRow">
        <div><label class="pk-l">BPM <span class="auto-tag" id="uAutoTag"></span></label><input type="number" id="uBpm" min="40" max="300" placeholder="140" /></div>
        <div><label class="pk-l">Tonalidad</label><input type="text" id="uKey" maxlength="16" placeholder="C min, F#…" /></div>
      </div>
      <div class="field"><label class="pk-tg" style="font-weight:600"><input type="checkbox" id="uIsBeat" style="width:auto" /> <span>Es un <b>beat</b> · permitir descarga gratis</span></label></div>
      <div class="field">
        <label>Colaboradores (ft.)</label>
        <div class="collab-chips" id="collabChips"></div>
        <div class="collab-add"><input type="text" id="collabInput" placeholder="usuario o nombre…" autocomplete="off" /><button type="button" class="btn sm" id="collabAdd">Añadir</button></div>
      </div>
      <div class="progress-bar hidden" id="upBar"><div></div></div>
      <button class="btn primary" id="uSubmit"><svg stroke="#fff"><use href="#i-upload"/></svg> Publicar pista</button>
      <div class="auth-msg" id="uMsg"></div>
    </div>`);

  let audioFile = null, coverFile = null, duration = 0, audioPreviewUrl = null;
  const schedChk = m.querySelector('#uSchedule'); if (schedChk) schedChk.onchange = (e) => { m.querySelector('#uScheduleAt').style.display = e.target.checked ? '' : 'none'; };
  const dzA = m.querySelector('#dzAudio'), fA = m.querySelector('#fAudio');
  const dzC = m.querySelector('#dzCover'), fC = m.querySelector('#fCover');

  dzA.onclick = () => fA.click();
  dzC.onclick = () => fC.click();
  fA.onchange = () => { if (fA.files[0]) setAudio(fA.files[0]); };
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
    // iOS a veces entrega el archivo con type vacío o genérico (sobre todo WAV),
    // así que aceptamos también por extensión.
    const okType = !!(f && f.type && f.type.startsWith('audio'));
    const okExt = !!(f && /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|aif|aiff|wma|alac)$/i.test(f.name || ''));
    if (!f || (!okType && !okExt)) { toast('Selecciona un archivo de audio'); return; }
    audioFile = f;
    m.querySelector('#audioName').textContent = f.name;
    if (!m.querySelector('#uTitle').value) m.querySelector('#uTitle').value = f.name.replace(/\.[^.]+$/,'');
    // preview: escucha la pista antes de subirla para confirmar que es la correcta
    const prev = m.querySelector('#audioPreview');
    if (audioPreviewUrl) { try { URL.revokeObjectURL(audioPreviewUrl); } catch (_) {} }
    audioPreviewUrl = URL.createObjectURL(f);
    prev.src = audioPreviewUrl;
    prev.classList.remove('hidden');
    prev.onloadedmetadata = () => { duration = prev.duration || 0; };
    analyzeUploadAudio(f);
  }
  // Pasa la pista por el analizador y autocompleta BPM/tono (sin pisar lo que el
  // usuario ya haya escrito). Para que subir sea más fácil y con más info.
  async function analyzeUploadAudio(f) {
    const tag = m.querySelector('#uAutoTag');
    const bpmEl = m.querySelector('#uBpm'), keyEl = m.querySelector('#uKey');
    if (tag) { tag.textContent = '· analizando…'; tag.className = 'auto-tag busy'; }
    try {
      const arr = await f.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const buf = await ctx.decodeAudioData(arr);
      const sr = buf.sampleRate;
      const { mono } = analyzeLevels(buf);
      try { ctx.close(); } catch {}
      const slice = mono.length > sr * 120 ? mono.subarray(0, sr * 120) : mono;
      await new Promise(r => setTimeout(r, 10));
      const key = detectKey(slice, sr);
      const bpm = detectBPM(slice, sr);
      const note = NOTE_NAMES[key.tonic];
      const keyTag = `${note}${key.mode === 'minor' ? 'm' : ''}`;
      if (bpm && !bpmEl.value) bpmEl.value = bpm;
      if (keyTag && !keyEl.value) keyEl.value = keyTag;
      if (tag) { tag.textContent = '· detectado'; tag.className = 'auto-tag ok'; }
    } catch (e) {
      if (tag) { tag.textContent = ''; tag.className = 'auto-tag'; }
    }
  }
  // prerelleno desde el Analizador de audio (tono/BPM detectados)
  if (prefill) {
    if (prefill.isBeat) m.querySelector('#uIsBeat').checked = true;
    if (prefill.bpm) m.querySelector('#uBpm').value = prefill.bpm;
    if (prefill.key) m.querySelector('#uKey').value = prefill.key;
    if (prefill.title && !m.querySelector('#uTitle').value) m.querySelector('#uTitle').value = prefill.title;
  }
  const collab = mountCollab(m);

  m.querySelector('#uSubmit').onclick = async () => {
    const title = m.querySelector('#uTitle').value.trim();
    const genre = m.querySelector('#uGenre').value.trim();
    const description = m.querySelector('#uDesc').value.trim();
    const schedOn = m.querySelector('#uSchedule').checked;
    const schedVal = m.querySelector('#uScheduleAt').value;
    const publish_at = (schedOn && schedVal) ? new Date(schedVal).toISOString() : null;
    const isBeat = m.querySelector('#uIsBeat').checked;
    const bpm = parseInt(m.querySelector('#uBpm').value, 10) || null;
    const songKey = m.querySelector('#uKey').value.trim() || null;
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
      // iOS suele dar type vacío en WAV: deducimos el content-type por extensión
      const AUDIO_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', aif: 'audio/aiff', aiff: 'audio/aiff', wma: 'audio/x-ms-wma', alac: 'audio/mp4' };
      const audioCT = uploadFile.type || AUDIO_MIME[ext] || 'audio/mpeg';
      const up = await sb.storage.from('tracks').upload(audioPath, uploadFile, { contentType: audioCT, upsert: false });
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

      const payload = {
        user_id: uid, title, genre: genre || null, description: description || null, publish_at,
        artist: state.profile.display_name || state.profile.username,
        audio_url: audioUrl, cover_url: coverUrl, duration: Math.round(duration),
        waveform, collaborators: collab.get(),
        is_beat: isBeat, bpm, song_key: songKey,
      };
      let { error } = await sb.from('tracks').insert(payload);
      if (error && /description|publish_at|column/i.test(error.message || '')) { delete payload.description; delete payload.publish_at; ({ error } = await sb.from('tracks').insert(payload)); }
      if (error) throw error;
      fill.style.width = '100%';
      toast(publish_at ? '¡Programada! Se publicará en la fecha elegida. 🗓️' : '¡Pista publicada! 🎵');
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
      invalidatePosts();
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
  try { posts = await prefetchPosts(); }
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

// caché corta + dedupe para las fotos (permite precargar al deslizar hacia Fotos)
let _postsCache = null, _postsInflight = null;
function prefetchPosts() {
  if (_postsInflight) return _postsInflight;
  if (_postsCache && Date.now() - _postsCache.ts < 10000) return Promise.resolve(_postsCache.posts);
  _postsInflight = fetchPosts().then((p) => { _postsCache = { posts: p || [], ts: Date.now() }; _postsInflight = null; return _postsCache.posts; })
    .catch((e) => { _postsInflight = null; throw e; });
  return _postsInflight;
}
function invalidatePosts() { _postsCache = null; }
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
  attachLongPress(card, () => postMenu(p, card));
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
  const busy = (togglePostLike._busy ||= new Set());
  if (busy.has(p.id)) return;
  busy.add(p.id);
  const btn = card.querySelector('[data-act="like"]');
  const cntEl = card.querySelector('.likecount');
  const liked = btn ? btn.classList.contains('on') : false;
  const setLn = (txt) => { const ln = btn?.querySelector('.ln'); if (ln) ln.textContent = txt; };
  try {
    if (liked) {
      p.likes_count = Math.max(0, (p.likes_count || 0) - 1);
      btn?.classList.remove('on'); setLn('Me gusta');
      await sb.from('post_likes').delete().eq('post_id', p.id).eq('user_id', state.user.id);
    } else {
      p.likes_count = (p.likes_count || 0) + 1;
      btn?.classList.add('on'); setLn('Te gusta');
      await sb.from('post_likes').insert({ post_id: p.id, user_id: state.user.id });
    }
    if (cntEl) cntEl.textContent = p.likes_count;
  } finally { busy.delete(p.id); }
}

async function deletePost(p, card) {
  if (!confirm('¿Borrar esta publicación? No se puede deshacer.')) return;
  const { error } = await sb.from('posts').delete().eq('id', p.id);
  if (error) { toast('No se pudo borrar'); return; }
  invalidatePosts();
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

/* =======================================================================
   TIENDA DEL PERFIL — beats/packs, merch, entradas.
   Cobro DENTRO de UnderBro con Stripe (UnderBro se lleva comisión) o, como
   alternativa, enlace externo del artista; descarga directa si es gratis.
   ======================================================================= */
const SHOP_TYPES = { beat: { label: 'Beat / pack', icon: 'i-music' }, merch: { label: 'Merch', icon: 'i-files' }, ticket: { label: 'Entrada', icon: 'i-calendar' } };

// ---- Pagos in-app (Stripe Connect) ----
async function payAuthHeaders() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const tok = session && session.access_token;
    return tok ? { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' } : null;
  } catch (_) { return null; }
}
function fmtEur(cents, cur) {
  if (cents == null) return '';
  try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: (cur || 'eur').toUpperCase() }).format(cents / 100); }
  catch (_) { return (cents / 100).toFixed(2) + ' €'; }
}
// Estado de cobros del vendedor (cacheado por sesión)
let _sellerStatus = null;
async function fetchSellerStatus(force) {
  if (_sellerStatus && !force) return _sellerStatus;
  const h = await payAuthHeaders(); if (!h) return { connected: false, ready: false };
  try {
    const r = await fetch('/api/pay/status', { headers: h });
    _sellerStatus = await r.json();
  } catch (_) { _sellerStatus = { connected: false, ready: false }; }
  return _sellerStatus;
}
async function startSellerConnect(btn) {
  const h = await payAuthHeaders();
  if (!h) { toast('Inicia sesión primero'); return; }
  if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = 'Abriendo Stripe…'; }
  try {
    const r = await fetch('/api/pay/connect', { method: 'POST', headers: h });
    const d = await r.json();
    if (d && d.url) { location.href = d.url; return; }
    toast('No se pudo abrir Stripe: ' + (d.error || ''));
  } catch (e) { toast('Error de conexión'); }
  if (btn) { btn.disabled = false; btn.textContent = btn.dataset.t || 'Configurar cobros'; }
}
async function buyInApp(p, btn) {
  if (!state.user) { toast('Inicia sesión para comprar'); return; }
  const h = await payAuthHeaders();
  if (!h) { toast('Inicia sesión para comprar'); return; }
  haptic(12);
  if (btn) { btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.textContent = 'Conectando…'; }
  try {
    const r = await fetch('/api/pay/checkout', { method: 'POST', headers: h, body: JSON.stringify({ product_id: p.id }) });
    const d = await r.json();
    if (d && d.url) { location.href = d.url; return; }
    const map = { seller_not_ready: 'El vendedor aún no tiene los cobros activados.', own_product: 'No puedes comprar tu propio producto.', not_payable: 'Producto no disponible para compra.' };
    toast(map[d.error] || 'No se pudo iniciar el pago.');
  } catch (e) { toast('Error de conexión'); }
  if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.t || 'Comprar'; }
}
// Vuelta desde Stripe (?pay=...)
async function handlePayReturn(pay, sid) {
  if (pay === 'cancel') { toast('Pago cancelado'); return; }
  if (pay === 'connect_done' || pay === 'connect_refresh') {
    _sellerStatus = null;
    const st = await fetchSellerStatus(true);
    toast(st.ready ? '✅ Cobros activados' : 'Alta guardada — Stripe está verificando tus datos');
    return;
  }
  if (pay === 'ok' && sid) { openPurchaseResult(sid); }
}
async function openPurchaseResult(sid) {
  const m = openModal(`<div class="modal-head"><h3>Compra</h3><button class="close">&times;</button></div><div class="modal-body" id="buyRes"><div class="loading" style="padding:24px"><div class="spinner"></div></div></div>`);
  const box = m.querySelector('#buyRes');
  let d = null;
  for (let i = 0; i < 6; i++) { // el webhook puede tardar 1-2s en confirmar
    try { const r = await fetch('/api/pay/order?sid=' + encodeURIComponent(sid)); d = await r.json(); } catch (_) {}
    if (d && d.status === 'paid') break;
    await new Promise(r => setTimeout(r, 1200));
  }
  if (!d || d.status !== 'paid') {
    box.innerHTML = `<div class="empty"><p>Estamos confirmando tu pago. Si ya pagaste, lo recibirás en unos segundos — revisa “Mis compras”.</p></div>`;
    return;
  }
  haptic(20);
  const isTicket = d.type === 'ticket';
  box.innerHTML = `
    <div class="buy-ok">
      <div class="buy-ok-ic">✅</div>
      <h3>¡Pago completado!</h3>
      <p class="buy-ok-sub">${esc(d.title || '')} · ${esc(fmtEur(d.amount_cents, d.currency))}</p>
      ${isTicket ? `
        <div class="buy-ticket">
          <span class="buy-ticket-l">Tu entrada</span>
          <span class="buy-ticket-code">${esc(d.ticket_code || '')}</span>
          ${d.event_date ? `<span class="buy-ticket-meta">${esc(new Date(d.event_date).toLocaleString('es-ES'))}${d.event_place ? ' · ' + esc(d.event_place) : ''}</span>` : ''}
          <span class="buy-ticket-hint">Muestra este código en la entrada.</span>
        </div>` : (d.file_url ? `<a class="btn primary" id="buyDl" href="${esc(czHref(d.file_url))}" target="_blank" rel="noopener"><svg fill="none" stroke="#fff"><use href="#i-download"/></svg> Descargar</a>` : `<p class="buy-ok-sub">El artista te entregará el producto. Te avisaremos por mensaje.</p>`)}
    </div>`;
}

async function loadProfileShop(userId, container, isMe) {
  container.innerHTML = `<div class="loading" style="padding:24px"><div class="spinner"></div></div>`;
  let items = [];
  try { const { data } = await sb.from('shop_products').select('*').eq('user_id', userId).order('sort', { ascending: true }).order('created_at', { ascending: false }); items = data || []; }
  catch (e) { console.error(e); }
  const render = () => {
    container.innerHTML = '';
    if (isMe) {
      container.appendChild(shopPayBar(userId, () => loadProfileShop(userId, container, isMe)));
      const add = el(`<button class="btn primary shop-add" id="shopAdd"><svg fill="none" stroke="#fff"><use href="#i-plus"/></svg> Añadir producto</button>`);
      add.onclick = () => openShopEdit(null, userId, () => loadProfileShop(userId, container, isMe));
      container.appendChild(add);
    }
    if (!items.length) {
      container.appendChild(el(`<div class="empty"><svg fill="none"><use href="#i-bookmark"/></svg><p>${isMe ? 'Tu tienda está vacía. Añade beats, merch o entradas.' : 'Este artista aún no tiene tienda.'}</p></div>`));
      return;
    }
    const grid = el(`<div class="shop-grid"></div>`);
    items.forEach(p => grid.appendChild(shopProductCard(p, isMe, () => loadProfileShop(userId, container, isMe))));
    container.appendChild(grid);
  };
  render();
}

function shopProductCard(p, isMe, refresh) {
  const t = SHOP_TYPES[p.type] || SHOP_TYPES.merch;
  const img = p.image_url ? czUrl(p.image_url) : '';
  const free = p.is_free && p.file_url;
  const inapp = !p.is_free && p.pay_inapp && p.price_cents >= 50;
  const cta = p.type === 'ticket' ? 'Conseguir' : 'Comprar';
  const priceTxt = p.is_free ? 'Gratis' : (inapp ? fmtEur(p.price_cents, p.currency) : (p.price || ''));
  const card = el(`
    <div class="shop-card">
      <div class="shop-cover" ${img ? `style="background-image:url('${esc(img)}')"` : ''}>${img ? '' : `<svg fill="none" stroke="#fff"><use href="#${t.icon}"/></svg>`}<span class="shop-type">${esc(t.label)}</span>${isMe ? '<button class="shop-edit" data-act="edit" aria-label="Editar">⋯</button>' : ''}</div>
      <div class="shop-body">
        <div class="shop-title">${esc(p.title || '')}</div>
        ${p.type === 'ticket' && p.event_date ? `<div class="shop-meta">${esc(schedLabel ? schedLabel(p.event_date) : new Date(p.event_date).toLocaleDateString('es-ES'))}${p.event_place ? ' · ' + esc(p.event_place) : ''}</div>` : ''}
        ${p.description ? `<div class="shop-desc">${esc(p.description)}</div>` : ''}
        ${inapp ? '<div class="shop-secure"><svg fill="none" stroke="currentColor"><use href="#i-lock"/></svg> Pago seguro en UnderBro</div>' : ''}
        <div class="shop-foot">
          <span class="shop-price">${esc(priceTxt)}</span>
          ${free ? `<button class="btn sm primary" data-act="download"><svg fill="none" stroke="#fff"><use href="#i-download"/></svg> Descargar</button>`
                 : (inapp ? `<button class="btn sm primary" data-act="paybuy">${cta}</button>`
                 : (p.buy_url ? `<button class="btn sm primary" data-act="buy">${cta}</button>` : ''))}
        </div>
      </div>
    </div>`);
  card.querySelector('[data-act="paybuy"]')?.addEventListener('click', (e) => buyInApp(p, e.currentTarget));
  card.querySelector('[data-act="buy"]')?.addEventListener('click', () => { haptic(10); window.open(czHref(p.buy_url), '_blank', 'noopener'); });
  card.querySelector('[data-act="download"]')?.addEventListener('click', () => { haptic(10); const a = document.createElement('a'); a.href = czHref(p.file_url); a.download = ''; a.target = '_blank'; a.rel = 'noopener'; a.click(); });
  card.querySelector('[data-act="edit"]')?.addEventListener('click', () => openShopEdit(p, p.user_id, refresh));
  return card;
}

// Barra de estado de cobros + ventas para el dueño de la tienda
function shopPayBar(userId, refresh) {
  const bar = el(`<div class="shop-paybar" id="shopPayBar"><div class="spb-line"><span class="spb-ic">💳</span><span class="spb-txt">Comprobando cobros…</span></div></div>`);
  (async () => {
    const st = await fetchSellerStatus(true);
    let sales = null;
    try {
      const { data } = await sb.from('shop_orders').select('amount_cents,fee_cents,status').eq('seller_id', userId).eq('status', 'paid');
      sales = data || [];
    } catch (_) {}
    const net = (sales || []).reduce((s, o) => s + (o.amount_cents - (o.fee_cents || 0)), 0);
    const count = (sales || []).length;
    if (!st.connected) {
      bar.innerHTML = `<div class="spb-line"><span class="spb-ic">💳</span><div class="spb-body"><b>Cobra dentro de UnderBro</b><span>Activa los pagos con tarjeta para vender beats, packs y entradas. UnderBro retiene un 10% por venta.</span></div></div><button class="btn sm primary" id="spbConnect">Activar cobros</button>`;
    } else if (!st.ready) {
      bar.innerHTML = `<div class="spb-line"><span class="spb-ic">⏳</span><div class="spb-body"><b>Verificación en curso</b><span>Stripe está revisando tus datos. Completa el alta si quedó algo pendiente.</span></div></div><button class="btn sm ghost" id="spbConnect">Continuar alta</button>`;
    } else {
      bar.innerHTML = `<div class="spb-line"><span class="spb-ic">✅</span><div class="spb-body"><b>Cobros activados</b><span>${count} venta${count === 1 ? '' : 's'} · ${esc(fmtEur(net, 'eur'))} netos para ti</span></div></div><button class="btn sm ghost" id="spbConnect">Gestionar</button>`;
    }
    bar.querySelector('#spbConnect')?.addEventListener('click', (e) => startSellerConnect(e.currentTarget));
  })();
  return bar;
}

async function openShopEdit(p, userId, onSaved) {
  const edit = !!p; p = p || { type: 'beat', is_free: false };
  const m = openModal(`
    <div class="modal-head"><h3>${edit ? 'Editar producto' : 'Nuevo producto'}</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <label class="pk-l">Tipo</label>
      <div class="seg" id="shType">${Object.entries(SHOP_TYPES).map(([k, v]) => `<button data-ty="${k}" class="${(p.type || 'beat') === k ? 'on' : ''}">${esc(v.label)}</button>`).join('')}</div>
      <div class="field"><label>Imagen</label>
        <div class="cover-pick" id="shDz"><div class="cover-prev" id="shPrev">${p.image_url ? `<img src="${esc(czUrl(p.image_url))}" alt="">` : `<svg width="24" height="24" fill="none" stroke="currentColor"><use href="#i-image"/></svg>`}</div><div class="cover-pick-txt"><b>Foto del producto</b><span>cuadrada, JPG/PNG/WebP</span></div></div>
        <input type="file" id="shImg" accept="image/*" hidden />
      </div>
      <div class="field"><label>Título</label><input type="text" id="shTitle" maxlength="80" value="${esc(p.title || '')}" placeholder="Ej: Pack de beats Vol.1" /></div>
      <div class="field"><label class="pk-tg" style="font-weight:600"><input type="checkbox" id="shFree" style="width:auto" ${p.is_free ? 'checked' : ''}/> <span>Es <b>gratis</b> (descarga directa)</span></label></div>
      <div class="field"><label>Descripción</label><textarea id="shDesc" maxlength="400" rows="2" placeholder="Detalles del producto…">${esc(p.description || '')}</textarea></div>
      <div id="shPayWrap">
        <label class="pk-l">¿Cómo cobras?</label>
        <div class="seg" id="shPayMode">
          <button data-pm="inapp" class="${p.pay_inapp || !p.buy_url ? 'on' : ''}">En UnderBro 💳</button>
          <button data-pm="ext" class="${!p.pay_inapp && p.buy_url ? 'on' : ''}">Enlace externo</button>
        </div>
        <div class="field" id="shEurRow"><label>Precio (€)</label><input type="number" id="shPriceEur" min="0.50" step="0.01" inputmode="decimal" value="${p.price_cents ? (p.price_cents / 100) : ''}" placeholder="9,99" /><span class="pk-hint">Cobro con tarjeta dentro de la app. UnderBro retiene un 10%; el resto va a tu cuenta.</span></div>
        <div class="pk-warn" id="shConnNote" style="display:none">Para cobrar en UnderBro primero <b>activa los cobros</b> en tu tienda (botón “Activar cobros”).</div>
        <div class="field" id="shPriceRow"><label>Precio (texto)</label><input type="text" id="shPrice" maxlength="24" value="${esc(p.price || '')}" placeholder="9,99 €" /></div>
        <div class="field" id="shBuyRow"><label>Enlace de compra (tu PayPal/Gumroad/Beatstars/web)</label><input type="text" id="shBuy" value="${esc(p.buy_url || '')}" placeholder="https://…" /></div>
      </div>
      <div class="field" id="shFileRow"><label>Archivo a entregar</label>
        <div class="cover-pick" id="shFileDz"><div class="cover-pick-txt"><b id="shFileName">${p.file_url ? 'Archivo subido ✓' : 'Subir archivo (zip, mp3, wav…)'}</b><span>se entrega tras el pago / al pulsar “Descargar”</span></div></div>
        <input type="file" id="shFile" hidden />
      </div>
      <div class="pk-row2" id="shEvRow" style="${p.type === 'ticket' ? '' : 'display:none'}">
        <div><label class="pk-l">Fecha (entrada)</label><input type="datetime-local" id="shEvDate" value="${p.event_date ? new Date(p.event_date).toISOString().slice(0, 16) : ''}" /></div>
        <div><label class="pk-l">Lugar</label><input type="text" id="shEvPlace" maxlength="80" value="${esc(p.event_place || '')}" placeholder="Sala, ciudad" /></div>
      </div>
      <button class="btn primary" id="shSave">${edit ? 'Guardar cambios' : 'Publicar producto'}</button>
      ${edit ? '<button class="btn danger-btn" id="shDel"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg> Eliminar</button>' : ''}
      <div class="auth-msg" id="shMsg"></div>
    </div>`);
  let type = p.type || 'beat', imgFile = null, dataFile = null;
  let payMode = (p.pay_inapp || !p.buy_url) ? 'inapp' : 'ext';
  const syncRows = () => {
    const free = m.querySelector('#shFree').checked;
    const inapp = !free && payMode === 'inapp';
    const ext = !free && payMode === 'ext';
    m.querySelector('#shPayWrap').style.display = free ? 'none' : '';
    m.querySelector('#shEurRow').style.display = inapp ? '' : 'none';
    m.querySelector('#shPriceRow').style.display = ext ? '' : 'none';
    m.querySelector('#shBuyRow').style.display = ext ? '' : 'none';
    m.querySelector('#shConnNote').style.display = (inapp && _sellerStatus && !_sellerStatus.ready) ? '' : 'none';
    // entrega de archivo: beats/packs gratis o de pago in-app
    m.querySelector('#shFileRow').style.display = (type === 'beat' && (free || inapp)) ? '' : 'none';
    m.querySelector('#shEvRow').style.display = type === 'ticket' ? '' : 'none';
  };
  m.querySelectorAll('#shType button').forEach(b => b.onclick = () => { type = b.dataset.ty; m.querySelectorAll('#shType button').forEach(x => x.classList.toggle('on', x === b)); syncRows(); });
  m.querySelectorAll('#shPayMode button').forEach(b => b.onclick = () => { payMode = b.dataset.pm; m.querySelectorAll('#shPayMode button').forEach(x => x.classList.toggle('on', x === b)); syncRows(); });
  m.querySelector('#shFree').onchange = syncRows;
  syncRows();
  fetchSellerStatus().then(() => syncRows()); // refresca el aviso de “activa cobros”
  m.querySelector('#shDz').onclick = () => m.querySelector('#shImg').click();
  m.querySelector('#shImg').onchange = (e) => { const f = e.target.files[0]; if (!f) return; imgFile = f; m.querySelector('#shPrev').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`; };
  m.querySelector('#shFileDz').onclick = () => m.querySelector('#shFile').click();
  m.querySelector('#shFile').onchange = (e) => { const f = e.target.files[0]; if (!f) return; dataFile = f; m.querySelector('#shFileName').textContent = f.name; };
  if (edit) m.querySelector('#shDel').onclick = async () => { if (!confirm('¿Eliminar este producto?')) return; await sb.from('shop_products').delete().eq('id', p.id); m.remove(); toast('Producto eliminado'); onSaved && onSaved(); };
  m.querySelector('#shSave').onclick = async () => {
    const btn = m.querySelector('#shSave'); const msg = m.querySelector('#shMsg');
    const title = m.querySelector('#shTitle').value.trim();
    if (!title) { msg.className = 'auth-msg error'; msg.textContent = 'Ponle un título.'; return; }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const stamp = Date.now();
      let image_url = p.image_url || null, file_url = p.file_url || null;
      if (imgFile) { const path = `${userId}/shop-${stamp}`; const up = await sb.storage.from('covers').upload(path, imgFile, { contentType: imgFile.type, upsert: true }); if (!up.error) image_url = sb.storage.from('covers').getPublicUrl(path).data.publicUrl; }
      if (dataFile) { const ext = (dataFile.name.split('.').pop() || 'zip').toLowerCase(); const path = `${userId}/shopfile-${stamp}.${ext}`; const up = await sb.storage.from('tracks').upload(path, dataFile, { contentType: dataFile.type || 'application/octet-stream', upsert: true }); if (!up.error) file_url = sb.storage.from('tracks').getPublicUrl(path).data.publicUrl; }
      const free = m.querySelector('#shFree').checked;
      const inapp = !free && payMode === 'inapp';
      let price_cents = null;
      if (inapp) {
        const eur = parseFloat(String(m.querySelector('#shPriceEur').value || '').replace(',', '.'));
        if (!(eur >= 0.5)) { msg.className = 'auth-msg error'; msg.textContent = 'Pon un precio de al menos 0,50 €.'; btn.disabled = false; btn.textContent = edit ? 'Guardar cambios' : 'Publicar producto'; return; }
        price_cents = Math.round(eur * 100);
      }
      const row = {
        user_id: userId, type, title, is_free: free,
        pay_inapp: inapp, price_cents, currency: 'eur',
        price: free ? null : (inapp ? fmtEur(price_cents, 'eur') : (m.querySelector('#shPrice').value.trim() || null)),
        description: m.querySelector('#shDesc').value.trim() || null,
        image_url, file_url,
        buy_url: (!free && payMode === 'ext') ? (m.querySelector('#shBuy').value.trim() || null) : null,
        event_date: type === 'ticket' && m.querySelector('#shEvDate').value ? new Date(m.querySelector('#shEvDate').value).toISOString() : null,
        event_place: type === 'ticket' ? (m.querySelector('#shEvPlace').value.trim() || null) : null,
      };
      let error;
      if (edit) ({ error } = await sb.from('shop_products').update(row).eq('id', p.id));
      else ({ error } = await sb.from('shop_products').insert(row));
      if (error) throw error;
      m.remove(); toast(edit ? 'Producto actualizado' : '🛍️ Producto publicado'); onSaved && onSaved();
    } catch (e) { console.error(e); msg.className = 'auth-msg error'; msg.textContent = 'No se pudo guardar: ' + (e.message || ''); btn.disabled = false; btn.textContent = edit ? 'Guardar cambios' : 'Publicar producto'; }
  };
}

async function loadProfilePosts(userId, grid) {
  grid.innerHTML = skeletonGrid(6);
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

// Pistas que un usuario ha reposteado (pestaña Reposts del perfil)
async function loadProfileReposts(userId, container, isMe) {
  container.innerHTML = skeletonFeed(3);
  let rows = [];
  try {
    const { data } = await sb.from('reposts')
      .select('created_at, tracks(*, profiles!tracks_user_id_fkey(*))')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(60);
    rows = data || [];
  } catch (e) { console.error(e); }
  const tracks = rows.map(r => r.tracks).filter(t => t && !isHidden(t.user_id));
  if (!tracks.length) {
    container.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-repeat"/></svg><p>${isMe ? 'Aún no has reposteado nada. Pulsa “Resubir” en una pista para compartirla con tus seguidores.' : 'Sin reposts todavía.'}</p></div>`;
    return [];
  }
  container.innerHTML = '';
  tracks.forEach(t => container.appendChild(trackCard(t)));
  return tracks;
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
  box.querySelectorAll('.comment').forEach(row => {
    const c = comments.find(x => String(x.id) === String(row.dataset.cid)); if (!c) return;
    const canDel = c.user_id === state.user.id || state.profile.is_admin;
    attachLongPress(row, () => commentMenu(box, c, canDel, async () => {
      const { error } = await sb.from('post_comments').delete().eq('id', c.id);
      if (error) { toast('No se pudo borrar el comentario'); return; }
      renderPostComments(box, p, comments.filter(x => x.id !== c.id));
    }));
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
  if (bg.type === 'image' && czUrl(bg.image)) return `background-image:url('${czUrl(bg.image)}');background-size:cover;background-position:center;`;
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
  'Anton': 'Anton',
  'Audiowide': 'Audiowide',
  'Press Start 2P': 'Press+Start+2P',
  'Permanent Marker': 'Permanent+Marker',
  'Dancing Script': 'Dancing+Script:wght@600;700',
  'Playfair Display': 'Playfair+Display:wght@600;800',
  'Russo One': 'Russo+One',
  'Satisfy': 'Satisfy',
  'Rubik Mono One': 'Rubik+Mono+One',
  'Quicksand': 'Quicksand:wght@500;700',
  'Monoton': 'Monoton',
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
const EFFECTS = { 'none': 'Ninguno', 'aurora': 'Aurora', 'stars': 'Estrellas', 'notes': 'Notas musicales', 'hearts': 'Corazones', 'snow': 'Nieve', 'bubbles': 'Burbujas', 'fireflies': 'Luciérnagas', 'rain': 'Lluvia', 'confetti': 'Confeti' };
const GLOWS = { 'none': 'Ninguno', 'soft': 'Suave', 'neon': 'Neón' };
const CARD_STYLES = { 'default': 'Normal', 'glass': 'Cristal', 'dark': 'Oscuro', 'neon': 'Neón', 'minimal': 'Minimal', 'gradient': 'Degradado', 'outline': 'Contorno' };
const NAME_STYLES = { 'none': 'Normal', 'gradient': 'Degradado', 'neon': 'Neón', 'outline': 'Contorno', 'shadow': 'Sombra 3D' };
const AVATAR_RINGS = { 'none': 'Ninguno', 'accent': 'Acento', 'glow': 'Brillo', 'gradient': 'Degradado', 'rainbow': 'Arcoíris' };
const BANNER_HEIGHTS = { 'normal': 'Normal', 'short': 'Bajo', 'tall': 'Alto' };
// presets de un clic: aplican varias opciones a la vez (luego se pueden retocar)
const THEME_PRESETS = {
  'Neón':       { accent: '#00e5ff', font: 'Orbitron', glow: 'neon', cards: 'neon', effect: 'stars', nameStyle: 'neon', avatarRing: 'glow', bg: { type: 'gradient', c1: '#0a0e23', c2: '#1a1040', animated: true } },
  'Vaporwave':  { accent: '#ff77e9', font: 'Audiowide', glow: 'soft', cards: 'glass', effect: 'bubbles', nameStyle: 'gradient', avatarRing: 'gradient', bg: { type: 'gradient', c1: '#ff77e9', c2: '#7b5cff', animated: true } },
  'Atardecer':  { accent: '#ff7a45', font: 'Poppins', glow: 'soft', cards: 'glass', effect: 'none', nameStyle: 'gradient', avatarRing: 'accent', bg: { type: 'gradient', c1: '#ff9a5a', c2: '#ff5b8d', animated: false } },
  'Minimal':    { accent: '#111418', font: 'Montserrat', glow: 'none', cards: 'minimal', effect: 'none', nameStyle: 'none', avatarRing: 'none', bg: { type: 'solid', c1: '#f7f8fb' } },
  'Oscuro Pro': { accent: '#6f8fc6', font: 'Poppins', glow: 'soft', cards: 'dark', effect: 'fireflies', nameStyle: 'shadow', avatarRing: 'glow', bg: { type: 'gradient', c1: '#0e1320', c2: '#161d33', animated: false } },
  'Romántico':  { accent: '#ff5b8d', font: 'Dancing Script', glow: 'soft', cards: 'glass', effect: 'hearts', nameStyle: 'gradient', avatarRing: 'gradient', bg: { type: 'gradient', c1: '#ffd9e6', c2: '#ffb3d1', animated: false } },
  'Gamer':      { accent: '#7CFC00', font: 'Press Start 2P', glow: 'neon', cards: 'neon', effect: 'confetti', nameStyle: 'neon', avatarRing: 'rainbow', bg: { type: 'gradient', c1: '#0d0d12', c2: '#1a1030', animated: true } },
  'Invierno':   { accent: '#56b6ff', font: 'Quicksand', glow: 'soft', cards: 'glass', effect: 'snow', nameStyle: 'none', avatarRing: 'accent', bg: { type: 'gradient', c1: '#dff1ff', c2: '#bfe0ff', animated: false } },
};
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
  } else if (kind === 'hearts') {
    for (let i = 0; i < 16; i++) { const s = document.createElement('i'); s.textContent = '❤'; s.style.left = (Math.random()*100)+'%'; s.style.animationDelay = (Math.random()*9)+'s'; s.style.animationDuration = (8+Math.random()*8)+'s'; s.style.fontSize = (12+Math.random()*20)+'px'; fx.appendChild(s); }
  } else if (kind === 'snow') {
    for (let i = 0; i < 50; i++) { const s = document.createElement('i'); s.style.left = (Math.random()*100)+'%'; s.style.animationDelay = (Math.random()*8)+'s'; s.style.animationDuration = (6+Math.random()*8)+'s'; s.style.setProperty('--sz', (2+Math.random()*4).toFixed(1)+'px'); s.style.opacity = (0.3+Math.random()*0.6).toFixed(2); fx.appendChild(s); }
  } else if (kind === 'bubbles') {
    for (let i = 0; i < 22; i++) { const s = document.createElement('i'); s.style.left = (Math.random()*100)+'%'; s.style.animationDelay = (Math.random()*10)+'s'; s.style.animationDuration = (9+Math.random()*9)+'s'; const sz = (8+Math.random()*34)|0; s.style.width = sz+'px'; s.style.height = sz+'px'; fx.appendChild(s); }
  } else if (kind === 'fireflies') {
    for (let i = 0; i < 30; i++) { const s = document.createElement('i'); s.style.left = (Math.random()*100)+'%'; s.style.top = (Math.random()*100)+'%'; s.style.animationDelay = (Math.random()*5)+'s'; s.style.animationDuration = (3+Math.random()*5)+'s'; fx.appendChild(s); }
  } else if (kind === 'rain') {
    for (let i = 0; i < 45; i++) { const s = document.createElement('i'); s.style.left = (Math.random()*100)+'%'; s.style.animationDelay = (Math.random()*2)+'s'; s.style.animationDuration = (0.5+Math.random()*0.7).toFixed(2)+'s'; s.style.height = (10+Math.random()*16)+'px'; fx.appendChild(s); }
  } else if (kind === 'confetti') {
    const cols = ['#ff5b8d','#ffd23f','#3ec5ff','#7CFC00','#b06bff','#ff7a45'];
    for (let i = 0; i < 36; i++) { const s = document.createElement('i'); s.style.left = (Math.random()*100)+'%'; s.style.animationDelay = (Math.random()*6)+'s'; s.style.animationDuration = (5+Math.random()*6)+'s'; s.style.background = cols[i % cols.length]; s.style.transform = `rotate(${Math.random()*360}deg)`; fx.appendChild(s); }
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
      <div class="field"><label>Estilos rápidos (presets)</label>
        <div class="preset-row" id="presetRow">${Object.keys(THEME_PRESETS).map(n => `<button type="button" class="preset-chip" data-preset="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      </div>
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
      <div class="field"><label>Estilo del nombre</label><select class="cz-select" id="thName">${Object.entries(NAME_STYLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Borde del avatar</label><select class="cz-select" id="thRing">${Object.entries(AVATAR_RINGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Altura del banner</label><select class="cz-select" id="thBannerH">${Object.entries(BANNER_HEIGHTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
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
  m.querySelector('#thName').value = NAME_STYLES[t.nameStyle] ? t.nameStyle : 'none';
  m.querySelector('#thRing').value = AVATAR_RINGS[t.avatarRing] ? t.avatarRing : 'none';
  m.querySelector('#thBannerH').value = BANNER_HEIGHTS[t.bannerH] ? t.bannerH : 'normal';
  m.querySelector('#bgAnim').checked = !!t.bg.animated;
  // presets: aplican varias opciones a los controles (sin guardar todavía)
  m.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const p = THEME_PRESETS[b.dataset.preset]; if (!p) return;
    if (p.accent) m.querySelector('#thAccent').value = p.accent;
    if (p.font) { m.querySelector('#thFont').value = p.font; loadFont(p.font); }
    if (p.glow) m.querySelector('#thGlow').value = p.glow;
    if (p.effect) m.querySelector('#thEffect').value = p.effect;
    if (p.cards) m.querySelector('#thCards').value = p.cards;
    if (p.nameStyle) m.querySelector('#thName').value = p.nameStyle;
    if (p.avatarRing) m.querySelector('#thRing').value = p.avatarRing;
    if (p.bg) {
      bgType.value = p.bg.type || 'gradient';
      if (p.bg.c1) m.querySelector('#bgC1').value = p.bg.c1;
      if (p.bg.c2) m.querySelector('#bgC2').value = p.bg.c2;
      m.querySelector('#bgAnim').checked = !!p.bg.animated;
      syncBgType(); syncAnim();
    }
    m.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('on', x === b));
    toast('Preset “' + b.dataset.preset + '” aplicado · ajústalo y guarda');
  });
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
        nameStyle: m.querySelector('#thName').value,
        avatarRing: m.querySelector('#thRing').value,
        bannerH: m.querySelector('#thBannerH').value,
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
  ubRecord({ kind: 'profile', id: userId });
  const main = $('main');
  setActiveNav('');
  $('feedTabs')?.classList.add('hidden');
  main.innerHTML = skeletonProfile();
  const { data: prof } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (!prof) { main.innerHTML = '<div class="empty">Perfil no encontrado.</div>'; return; }
  const [{ count: followers }, ownTracks, collabRes, badgesRes] = await Promise.all([
    sb.from('follows').select('follower_id', { count:'exact', head:true }).eq('following_id', userId),
    fetchTracks({ order: 'created_at', userId }),
    sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').contains('collaborators', JSON.stringify([{ id: userId }])).order('created_at', { ascending: false }),
    sb.from('user_badges').select('badge').eq('user_id', userId),
  ]);
  // "likes" del perfil = total de me gusta recibidos en sus pistas
  const totalLikes = (ownTracks || []).reduce((s, t) => s + (t.likes_count || 0), 0);
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
  const nameCls = (theme.nameStyle && theme.nameStyle !== 'none' && NAME_STYLES[theme.nameStyle]) ? 'name-' + theme.nameStyle : '';
  const ringCls = (theme.avatarRing && theme.avatarRing !== 'none' && AVATAR_RINGS[theme.avatarRing]) ? 'ring-' + theme.avatarRing : '';
  const bannerHCls = (theme.bannerH && theme.bannerH !== 'normal' && BANNER_HEIGHTS[theme.bannerH]) ? 'cover-' + theme.bannerH : '';
  const tagline = (typeof theme.tagline === 'string') ? theme.tagline.slice(0, 140) : '';
  const backTo = ['feed','posts','people','messages','favorites','mytracks','all','downloads','notifications','search'].includes(state.view) ? state.view : 'feed';
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = `
    <div class="profile-view ${glowCls} ${cardsCls} ${animCls}" style="--accent:${accent};${fontVar}${bgStyle(theme)}">
      <button class="profile-back" id="profileBack"><svg fill="none" stroke="currentColor"><use href="#i-chevron-left"/></svg> Volver</button>
      ${banner ? `<div class="profile-cover ${bannerHCls}"><img class="cover-img" src="${banner}" alt="" style="object-position:${bannerPos};transform:scale(${bannerZoom})" /></div>` : `<div class="profile-cover profile-cover-grad ${bannerHCls}"></div>`}
      <div class="profile-head ${banner ? 'has-banner' : ''}">
        <div class="ph-avatar ${ringCls}">${avatarHTML(prof)}</div>
        <h2 class="accent-name ${nameCls}" data-name="${esc(prof.display_name || prof.username)}">${esc(prof.display_name || prof.username)}${verifiedBadge(prof)}${displayBadgeHtml(prof)} ${prof.is_admin?'<span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c;vertical-align:middle">MOD</span>':''} ${prof.banned?'<span class="t-genre" style="background:#fae3e0;border-color:#f0c2bc;color:#c0533f;vertical-align:middle">baneado</span>':''}</h2>
        <div class="ph-handle">@${esc(prof.username)}</div>
        ${prof.show_badges ? profBadgesHtml : ''}
        ${tagline ? `<div class="profile-tagline">${esc(tagline)}</div>` : ''}
        ${prof.bio ? `<p class="ph-bio">${esc(prof.bio)}</p>` : ''}
        <div class="pstats">
          <span class="pstat" data-pstat="tracks"><b>${myTracks.length}</b><i>pistas</i></span>
          <span class="pstat" data-pstat="followers"><b>${followers||0}</b><i>seguidores</i></span>
          <span class="pstat" data-pstat="likes"><b>${totalLikes}</b><i>likes</i></span>
        </div>
        <div class="pactions">
          ${isMe ? `<button class="btn primary" id="customizeBtn"><svg fill="none" stroke="#fff"><use href="#i-palette"/></svg> Personalizar</button><button class="btn" id="inviteBtn"><svg fill="none" stroke="currentColor"><use href="#i-people"/></svg> Invitar amigos</button><button class="btn" id="editProfBtn"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg> Editar perfil</button><button class="btn" id="logoutBtn"><svg fill="none" stroke="currentColor"><use href="#i-logout"/></svg> Cerrar sesión</button>`
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
        <button data-ptab="reposts"><svg fill="none" stroke="currentColor"><use href="#i-repeat"/></svg> Reposts</button>
        <button data-ptab="events"><svg fill="none" stroke="currentColor"><use href="#i-calendar"/></svg> Eventos</button>
        <button data-ptab="shop"><svg fill="none" stroke="currentColor"><use href="#i-cart"/></svg> Tienda</button>
      </div>
      <div id="profTop" class="prof-top-wrap"></div>
      <div id="feedList" class="feed-list"></div>
      <div id="postGrid" class="post-grid hidden"></div>
      <div id="featList" class="feed-list hidden"></div>
      <div id="repostList" class="feed-list hidden"></div>
      <div id="profEvents" class="hidden"></div>
      <div id="profShop" class="hidden"></div>
    </div>`;
  $('profileBack').onclick = () => switchView(backTo);
  if (font) loadFont(font);
  if (theme.effect && theme.effect !== 'none' && EFFECTS[theme.effect]) {
    const v = main.querySelector('.profile-view'); if (v) v.prepend(buildEffect(theme.effect));
  }
  if (isMe) { const cb = $('customizeBtn'); if (cb) cb.onclick = openProfileCustomizer; const lo = $('logoutBtn'); if (lo) lo.onclick = logout; const ib = $('inviteBtn'); if (ib) ib.onclick = openInviteModal; }

  const list = $('feedList');
  if (!myTracks.length) list.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-music"/></svg><p>Sin pistas todavía.</p></div>`;
  else myTracks.forEach(t => list.appendChild(trackCard(t)));

  // Destacadas: top de canciones por reproducciones
  const topEl = $('profTop');
  if (topEl && myTracks.length >= 2) {
    const topTracks = myTracks.slice().sort((a, b) => (b.plays || 0) - (a.plays || 0)).slice(0, 3);
    topEl.innerHTML = `<div class="prof-top-h">Destacadas</div>` + topTracks.map((t, i) => `
      <button class="ptop-row" data-tid="${esc(t.id)}">
        <span class="ptop-rank">${i + 1}</span>
        <span class="ptop-cover">${t.cover_url ? `<img src="${esc(czUrl(t.cover_url))}" alt="">` : (prof.avatar_url ? `<img src="${esc(czUrl(prof.avatar_url))}" alt="">` : `<svg fill="none" stroke="currentColor"><use href="#i-music"/></svg>`)}</span>
        <span class="ptop-main">
          <span class="ptop-title">${esc(t.title)}</span>
          <span class="ptop-sub"><svg fill="none" stroke="currentColor"><use href="#i-headphones"/></svg>${t.plays || 0}<span class="ptop-dot">·</span><svg fill="currentColor" stroke="none"><use href="#i-heart"/></svg>${t.likes_count || 0}${t.genre ? `<span class="ptop-dot">·</span>${esc(t.genre)}` : ''}</span>
        </span>
        <span class="ptop-play"><svg fill="none" stroke="#fff"><use href="#i-play"/></svg></span>
      </button>`).join('');
    topEl.querySelectorAll('.ptop-row').forEach(r => r.onclick = () => { const t = myTracks.find(x => x.id === r.dataset.tid); if (t) { state.tracks = myTracks; state.queue = myTracks.map(x => x.id); playTrack(t); } });
  }

  const featEl = $('featList');
  if (!featTracks.length) featEl.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-people"/></svg><p>Sin colaboraciones todavía. Aquí aparecen las canciones en colaboración: las tuyas con invitados (<b>ft.</b>) y las de otros donde te añaden.</p></div>`;
  else featTracks.forEach(t => featEl.appendChild(trackCard(t)));

  // cola de reproducción inicial = pestaña Pistas
  state.tracks = myTracks; state.queue = myTracks.map(t => t.id);

  // pestañas Pistas / Fotos / Feats / Eventos
  const tabsEl = $('profileTabs'), gridEl = $('postGrid'), evEl = $('profEvents'), repEl = $('repostList'), shopEl = $('profShop');
  let postsLoaded = false, eventsLoaded = false, repostsLoaded = false, repostTracks = [], shopLoaded = false;
  tabsEl.querySelectorAll('button').forEach(b => b.onclick = () => {
    tabsEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    const tab = b.dataset.ptab;
    list.classList.toggle('hidden', tab !== 'tracks');
    $('profTop')?.classList.toggle('hidden', tab !== 'tracks');
    gridEl.classList.toggle('hidden', tab !== 'posts');
    featEl.classList.toggle('hidden', tab !== 'feats');
    repEl.classList.toggle('hidden', tab !== 'reposts');
    evEl.classList.toggle('hidden', tab !== 'events');
    shopEl.classList.toggle('hidden', tab !== 'shop');
    if (tab === 'tracks') { state.tracks = myTracks; state.queue = myTracks.map(t => t.id); }
    else if (tab === 'feats') { state.tracks = featTracks; state.queue = featTracks.map(t => t.id); }
    else if (tab === 'reposts' && repostsLoaded) { state.tracks = repostTracks; state.queue = repostTracks.map(t => t.id); }
    if (tab === 'posts' && !postsLoaded) { postsLoaded = true; loadProfilePosts(userId, gridEl); }
    if (tab === 'events' && !eventsLoaded) { eventsLoaded = true; loadProfileEvents(userId, evEl); }
    if (tab === 'shop' && !shopLoaded) { shopLoaded = true; loadProfileShop(userId, shopEl, isMe); }
    if (tab === 'reposts' && !repostsLoaded) {
      repostsLoaded = true;
      loadProfileReposts(userId, repEl, isMe).then(ts => { repostTracks = ts; state.tracks = ts; state.queue = ts.map(t => t.id); });
    }
  });

  // estadísticas clicables: pistas → pestaña Pistas · seguidores → lista · likes → no abre nada
  main.querySelectorAll('.pstat').forEach(s => s.onclick = () => {
    const k = s.dataset.pstat;
    if (k === 'tracks') {
      const tb = tabsEl.querySelector('[data-ptab="tracks"]');
      if (tb) tb.click();
      list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (k === 'followers' || k === 'following') {
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
  if (!isMe) $('followBtn').onclick = () => toggleFollow(userId, $('followBtn'));
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
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => { if (e.target.closest('[data-act]')) return; openProfile(p.id); });
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
    followBtn.onclick = () => toggleFollow(p.id, followBtn);
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
    if (followBtn) followBtn.onclick = (e) => { e.stopPropagation(); toggleFollow(p.id, followBtn); };
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
    .select('*, playlist_tracks(track_id, added_at, tracks(cover_url))')
    .eq('user_id', state.user.id).order('created_at', { ascending: false });
  const grid = $('plGrid');
  const lists = data || [];
  if (!lists.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><svg fill="none"><use href="#i-list"/></svg><p>No tienes playlists todavía. Crea una y añade pistas con el botón <b>Playlist</b> de cada tema.</p></div>`; return; }
  grid.innerHTML = '';
  lists.forEach(pl => grid.appendChild(playlistCard(pl)));
}
function playlistCovers(pl) {
  if (pl.cover_url) return `<div class="pl-cover" style="background-image:url('${czUrl(pl.cover_url)}')"></div>`;
  // por defecto: la portada de la primera pista añadida (ordenando por added_at)
  const rows = (pl.playlist_tracks || []).slice().sort((a, b) => (a.added_at ? +new Date(a.added_at) : 0) - (b.added_at ? +new Date(b.added_at) : 0));
  const cover = rows.map(x => x.tracks?.cover_url).find(Boolean);
  if (!cover) return `<div class="pl-cover pl-cover-empty"><svg fill="none" stroke="#fff"><use href="#i-list"/></svg></div>`;
  return `<div class="pl-cover" style="background-image:url('${czUrl(cover)}')"></div>`;
}
function playlistCard(pl) {
  const n = (pl.playlist_tracks || []).length;
  const card = el(`<div class="pl-card">${playlistCovers(pl)}<div class="pl-info"><div class="pl-title">${esc(pl.title)}</div><div class="pl-count">${n} ${n === 1 ? 'pista' : 'pistas'}</div></div></div>`);
  card.onclick = () => openPlaylist(pl.id);
  const mine = pl.user_id === state.user.id;
  attachLongPress(card, () => ({ title: pl.title, items: [
    { label: 'Abrir', icon: 'play', onClick: () => openPlaylist(pl.id) },
    mine ? { label: 'Renombrar', icon: 'settings', onClick: () => renamePlaylist(pl) } : null,
    mine ? { label: 'Borrar', icon: 'trash', danger: true, onClick: () => deletePlaylist(pl) } : null,
  ] }));
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
    addBtn.onclick = (e) => { if (e.target.closest('.story-add-badge')) { openAddStory(); return; } openStoryViewer(arr, arr.indexOf(myGroup)); };
  }
  arr.filter(g => g.userId !== state.user.id).forEach(g => {
    const c = el(`<div class="story-circle"><span class="story-ring ${g.allSeen ? 'seen' : ''}"><span class="story-av">${avatarHTML(g.user, '')}</span></span><span class="story-name">${esc(g.user.display_name || g.user.username)}</span></div>`);
    c.onclick = () => openStoryViewer(arr, arr.indexOf(g));
    bar.appendChild(c);
  });
}

function pickTrackModal(cb) {
  const m = openModal(`<div class="modal-head"><h3>Elegir canción</h3><button class="close">&times;</button></div><div class="modal-body"><input type="text" id="stSearch" placeholder="Buscar pista…" style="width:100%;padding:10px 12px;border:1px solid var(--line-soft);border-radius:10px;margin-bottom:10px;background:var(--glass);color:var(--ink)" /><div id="stResults"><div class="loading" style="padding:16px"><div class="spinner"></div></div></div></div>`);
  const results = m.querySelector('#stResults');
  const run = async (q) => {
    q = sanitizeTerm(q);
    let query = sb.from('tracks').select('id,title,cover_url,artist,audio_url,profiles!tracks_user_id_fkey(display_name,username)');
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
  let imgFile = null, pickedTrack = null, pickedStart = 0;
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
    pickedTrack = t; pickedStart = 0;
    chip.innerHTML = `<div class="st-track-chip"><div class="st-tc-cover" style="${t.cover_url ? `background-image:url('${czUrl(t.cover_url)}')` : ''}"></div><div class="st-tc-info"><b>${esc(t.title)}</b><span>${esc(t.profiles?.display_name || t.profiles?.username || t.artist || '')}</span></div><button class="st-tc-x" type="button" aria-label="Quitar">&times;</button></div><div class="st-seg" id="stSeg"></div>`;
    chip.querySelector('.st-tc-x').onclick = () => { pickedTrack = null; pickedStart = 0; chip.innerHTML = ''; };
    buildStorySegmentPicker(chip.querySelector('#stSeg'), t, (s) => { pickedStart = s; });
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
      const { error } = await sb.from('stories').insert({ user_id: state.user.id, image_url, track_id: pickedTrack?.id || null, song_start: pickedTrack ? Math.round(pickedStart) : 0, links });
      if (error) throw error;
      m.remove(); toast('📸 Historia publicada'); loadStoriesBar();
    } catch (e) {
      m.querySelector('#stMsg').textContent = 'No se pudo publicar la historia';
      publish.disabled = false; publish.textContent = 'Publicar historia';
    }
  };
}

// selector de fragmento con forma de onda para la canción de la historia
const STORY_WIN = 7; // segundos que dura la historia
async function buildStorySegmentPicker(box, track, onChange) {
  if (!box) return;
  if (!track.audio_url) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="seg-load"><div class="spinner"></div> Cargando onda…</div>`;
  let dur = 0, peaks = [];
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const resp = await fetch(track.audio_url);
    const arr = await resp.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arr);
    dur = audioBuf.duration;
    const ch = audioBuf.getChannelData(0);
    const N = 90, block = Math.max(1, Math.floor(ch.length / N));
    let mx = 0.0001;
    for (let i = 0; i < N; i++) {
      let m = 0; const s = i * block;
      for (let j = 0; j < block; j += 8) { const v = Math.abs(ch[s + j] || 0); if (v > m) m = v; }
      peaks.push(m); if (m > mx) mx = m;
    }
    peaks = peaks.map(p => Math.max(0.08, p / mx));
    try { ctx.close(); } catch (_) {}
  } catch (e) {
    // sin onda: deslizador simple
    box.innerHTML = `<label class="pk-l" style="margin-top:2px">Inicio de la canción</label><input type="range" id="segRange" min="0" max="100" value="0" style="width:100%"><div class="seg-time"><span id="segT">0:00</span></div>`;
    const r = box.querySelector('#segRange'); const tl = box.querySelector('#segT');
    // duración desconocida: estima con un audio element
    const a = new Audio(track.audio_url); a.onloadedmetadata = () => { dur = a.duration || 0; };
    r.oninput = () => { const st = (dur || 0) * (r.value / 100); tl.textContent = fmtDur(st); onChange(st); };
    return;
  }
  const win = Math.min(STORY_WIN, dur);
  const winPct = dur ? Math.min(100, (win / dur) * 100) : 100;
  let start = 0;
  box.innerHTML = `
    <div class="seg-head"><span>Elige el trozo que suena (${STORY_WIN}s)</span><button type="button" class="seg-play" id="segPlay"><svg class="ci-play"><use href="#i-play"/></svg><svg class="ci-pause"><use href="#i-pause"/></svg> Probar</button></div>
    <div class="seg-wave" id="segWave">
      ${peaks.map(p => `<span style="height:${Math.round(p * 100)}%"></span>`).join('')}
      <div class="seg-window" id="segWin" style="width:${winPct}%;left:0"></div>
    </div>
    <div class="seg-time"><span id="segT">0:00</span> – <span id="segE">${fmtDur(win)}</span></div>`;
  const wave = box.querySelector('#segWave');
  const winEl = box.querySelector('#segWin');
  const tStart = box.querySelector('#segT'), tEnd = box.querySelector('#segE');
  const apply = () => {
    const leftPct = dur ? (start / dur) * 100 : 0;
    winEl.style.left = leftPct + '%';
    tStart.textContent = fmtDur(start); tEnd.textContent = fmtDur(Math.min(dur, start + win));
    onChange(start);
  };
  const setFromClientX = (clientX) => {
    const r = wave.getBoundingClientRect();
    let frac = (clientX - r.left) / r.width;       // centro de la ventana donde tocas
    let st = frac * dur - win / 2;
    start = Math.max(0, Math.min(dur - win, st));
    apply();
  };
  let dragging = false;
  wave.addEventListener('pointerdown', (e) => { dragging = true; setFromClientX(e.clientX); });
  wave.addEventListener('pointermove', (e) => { if (dragging) setFromClientX(e.clientX); });
  const endDrag = () => dragging = false;
  wave.addEventListener('pointerup', endDrag);
  wave.addEventListener('pointercancel', endDrag);
  wave.addEventListener('pointerleave', endDrag);
  // probar el fragmento
  let prev = null, prevTimer = null;
  const playBtn = box.querySelector('#segPlay');
  playBtn.onclick = () => {
    if (prev) { prev.pause(); prev = null; clearTimeout(prevTimer); playBtn.classList.remove('playing'); return; }
    prev = new Audio(track.audio_url);
    prev.currentTime = start;
    prev.play().then(() => {
      playBtn.classList.add('playing');
      prevTimer = setTimeout(() => { if (prev) { prev.pause(); prev = null; } playBtn.classList.remove('playing'); }, win * 1000);
    }).catch(() => {});
  };
  apply();
}

function openStoryViewer(groups, gIdx = 0, startIdx = 0) {
  if (groups && !Array.isArray(groups)) { groups = [groups]; gIdx = 0; }
  if (!groups || !groups.length) return;
  try { if (audio && !audio.paused) audio.pause(); } catch (_) {}
  const STORY_MS = 7000;
  let gi = gIdx, idx = startIdx, timer = null;
  let segStart = 0, segRemaining = STORY_MS, curBar = null, isPaused = false, muted = false;
  const overlay = el(`
    <div class="story-viewer">
      <div class="sv-bars"></div>
      <div class="sv-head">
        <span class="sv-av"></span>
        <div class="sv-who"><b class="sv-name"></b><span class="sv-time"></span></div>
        <button class="sv-mute hidden" type="button" aria-label="Silenciar"><svg fill="none" stroke="#fff"><use href="#i-vol"/></svg></button>
        <button class="sv-x" type="button" aria-label="Cerrar">&times;</button>
      </div>
      <div class="sv-stage"><img class="sv-img" alt="" /></div>
      <div class="sv-music"></div>
      <div class="sv-links"></div>
      <div class="sv-foot"></div>
      <div class="sv-pause-ind"><svg fill="none" stroke="#fff"><use href="#i-pause"/></svg></div>
    </div>`);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const barsEl = overlay.querySelector('.sv-bars');
  const stage = overlay.querySelector('.sv-stage');
  let bars = [];

  const stopAudio = () => { if (storyAudio) { try { storyAudio.pause(); } catch (_) {} storyAudio = null; } };
  const close = () => { clearTimeout(timer); stopAudio(); overlay.remove(); document.body.style.overflow = ''; loadStoriesBar(); };
  const curStory = () => groups[gi].items[idx];
  const nextItem = () => {
    const g = groups[gi];
    if (idx < g.items.length - 1) show(gi, idx + 1);
    else if (gi < groups.length - 1) show(gi + 1, 0);
    else close();
  };
  const prevItem = () => {
    if (idx > 0) show(gi, idx - 1);
    else if (gi > 0) show(gi - 1, groups[gi - 1].items.length - 1);
    else show(gi, 0);
  };
  const pause = () => {
    if (isPaused) return; isPaused = true;
    clearTimeout(timer);
    segRemaining = Math.max(0, STORY_MS - (Date.now() - segStart));
    if (curBar) { const w = getComputedStyle(curBar).width; curBar.style.transition = 'none'; curBar.style.width = w; }
    if (storyAudio) { try { storyAudio.pause(); } catch (_) {} }
    overlay.classList.add('paused');
  };
  const resume = () => {
    if (!isPaused) return; isPaused = false;
    overlay.classList.remove('paused');
    if (curBar) { requestAnimationFrame(() => { curBar.style.transition = `width ${segRemaining}ms linear`; curBar.style.width = '100%'; }); }
    segStart = Date.now() - (STORY_MS - segRemaining);
    timer = setTimeout(nextItem, segRemaining);
    if (storyAudio && !muted) { try { storyAudio.play().catch(() => {}); } catch (_) {} }
  };

  function buildFoot(g) {
    const foot = overlay.querySelector('.sv-foot');
    if (g.userId === state.user.id) {
      foot.innerHTML = `<button class="sv-viewers" type="button"><svg fill="none" stroke="#fff"><use href="#i-people"/></svg> <b class="sv-vc">0</b> <span>vistas</span></button>`;
      foot.querySelector('.sv-viewers').onclick = () => { pause(); openStoryViewers(curStory().id, resume); };
    } else {
      const REACTS = ['❤️', '🔥', '😂', '😮', '😢', '👏'];
      foot.innerHTML = `
        <div class="sv-react-bar">${REACTS.map(e => `<button type="button" class="sv-react-b" data-e="${e}">${e}</button>`).join('')}</div>
        <form class="sv-reply"><input type="text" placeholder="Responder a ${esc(g.user.display_name || g.user.username || '')}…" maxlength="500" /><button type="submit" aria-label="Enviar"><svg fill="none" stroke="#fff"><use href="#i-send"/></svg></button></form>`;
      // envía un DM con la miniatura de la historia como contexto
      const sendStoryDM = async (body) => {
        if (!requireNotBanned()) return;
        const s = curStory();
        const { error } = await sb.from('direct_messages').insert({
          sender_id: state.user.id, recipient_id: g.userId, body,
          attachment_url: s.image_url, attachment_type: 'image', attachment_name: 'historia.jpg',
        });
        toast(error ? 'No se pudo enviar' : 'Enviado 💬');
      };
      foot.querySelectorAll('.sv-react-b').forEach(b => b.onclick = () => {
        // animación de emoji flotando
        const fx = el(`<span class="sv-react-fx">${b.dataset.e}</span>`); overlay.appendChild(fx);
        setTimeout(() => fx.remove(), 1100);
        haptic(12);
        sendStoryDM(b.dataset.e);
      });
      const form = foot.querySelector('.sv-reply'); const inp = form.querySelector('input');
      inp.onfocus = pause; inp.onblur = () => resume();
      form.onsubmit = (e) => {
        e.preventDefault();
        const body = inp.value.trim(); if (!body) return; inp.value = ''; inp.blur();
        sendStoryDM('↩️ Respuesta a tu historia: ' + body);
      };
    }
  }

  function rebuildHeader(g) {
    overlay.querySelector('.sv-av').innerHTML = avatarHTML(g.user, '');
    overlay.querySelector('.sv-name').textContent = g.user.display_name || g.user.username || 'usuario';
    barsEl.innerHTML = g.items.map(() => `<div class="sv-bar"><i></i></div>`).join('');
    bars = [...barsEl.querySelectorAll('.sv-bar i')];
    const oldDel = overlay.querySelector('.sv-del'); if (oldDel) oldDel.remove();
    if (g.userId === state.user.id) {
      const del = el(`<button class="sv-del" type="button" aria-label="Eliminar"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg></button>`);
      del.onclick = async () => { const s = curStory(); if (!confirm('¿Eliminar esta historia?')) return; await sb.from('stories').delete().eq('id', s.id); toast('Historia eliminada'); close(); };
      overlay.querySelector('.sv-head').insertBefore(del, overlay.querySelector('.sv-mute'));
    }
    buildFoot(g);
  }

  async function refreshViews(storyId) {
    const vc = overlay.querySelector('.sv-vc'); if (!vc) return;
    const { count } = await sb.from('story_views').select('viewer_id', { count: 'exact', head: true }).eq('story_id', storyId);
    if (curStory().id === storyId && vc.isConnected) vc.textContent = Math.max(0, (count || 1) - 1);
  }

  function show(g, i) {
    clearTimeout(timer); stopAudio(); isPaused = false; overlay.classList.remove('paused');
    if (g !== gi) { gi = g; rebuildHeader(groups[gi]); }
    idx = i;
    const grp = groups[gi]; const s = grp.items[idx];
    overlay.querySelector('.sv-img').src = s.image_url;
    const ageH = Math.floor((Date.now() - new Date(s.created_at)) / 3600000);
    overlay.querySelector('.sv-time').textContent = ageH <= 0 ? 'hace un momento' : `hace ${ageH} h`;
    bars.forEach((fill, k) => { fill.style.transition = 'none'; fill.style.width = k < idx ? '100%' : '0%'; });
    const mus = overlay.querySelector('.sv-music');
    const muteBtn = overlay.querySelector('.sv-mute');
    if (s.tracks) {
      mus.innerHTML = `<svg fill="none" stroke="#fff"><use href="#i-music"/></svg> <span>${esc(s.tracks.title)} · ${esc(s.tracks.profiles?.display_name || s.tracks.profiles?.username || s.tracks.artist || '')}</span>`;
      muteBtn.classList.remove('hidden');
      try {
        storyAudio = new Audio(s.tracks.audio_url); storyAudio.muted = muted;
        const st = +s.song_start || 0;
        if (st > 0) storyAudio.addEventListener('loadedmetadata', () => { try { storyAudio.currentTime = st; } catch (_) {} }, { once: true });
        try { if (st > 0) storyAudio.currentTime = st; } catch (_) {}
        storyAudio.play().catch(() => {});
      } catch (_) {}
    } else { mus.innerHTML = ''; muteBtn.classList.add('hidden'); }
    const links = Array.isArray(s.links) ? s.links : [];
    overlay.querySelector('.sv-links').innerHTML = links.map(l => `<a class="sv-link" href="${esc(czHref(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label || 'Ver enlace')}</a>`).join('');
    markStoryViewed(s.id);
    if (groups[gi].userId === state.user.id) refreshViews(s.id);
    curBar = bars[idx];
    requestAnimationFrame(() => { curBar.style.transition = `width ${STORY_MS}ms linear`; curBar.style.width = '100%'; });
    segStart = Date.now(); segRemaining = STORY_MS;
    timer = setTimeout(nextItem, STORY_MS);
  }

  overlay.querySelector('.sv-x').onclick = close;
  overlay.querySelector('.sv-mute').onclick = () => { muted = !muted; if (storyAudio) storyAudio.muted = muted; overlay.querySelector('.sv-mute').classList.toggle('muted', muted); };

  // gestos: tocar (nav), mantener (pausa), deslizar abajo (cerrar), deslizar lateral (nav)
  let sx = 0, sy = 0, moved = false, downT = 0, holdT = null;
  stage.addEventListener('pointerdown', (e) => {
    sx = e.clientX; sy = e.clientY; moved = false; downT = Date.now();
    holdT = setTimeout(pause, 240);
  });
  stage.addEventListener('pointermove', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) { moved = true; clearTimeout(holdT); }
    if (dy > 0 && Math.abs(dy) > Math.abs(dx)) { overlay.style.transform = `translateY(${Math.min(dy, 500)}px)`; overlay.style.opacity = String(Math.max(.3, 1 - dy / 700)); }
  });
  const onUp = (e) => {
    clearTimeout(holdT);
    const dx = (e.clientX || sx) - sx, dy = (e.clientY || sy) - sy, dt = Date.now() - downT;
    if (overlay.style.transform) { overlay.style.transition = 'transform .2s, opacity .2s'; setTimeout(() => { overlay.style.transition = ''; }, 220); }
    overlay.style.transform = ''; overlay.style.opacity = '';
    if (dy > 110 && Math.abs(dy) > Math.abs(dx)) { close(); return; }
    if (isPaused) { resume(); return; }
    if (moved && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { dx < 0 ? nextItem() : prevItem(); return; }
    if (!moved && dt < 400) { const r = stage.getBoundingClientRect(); (e.clientX - r.left < r.width * 0.30) ? prevItem() : nextItem(); }
  };
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', () => { clearTimeout(holdT); overlay.style.transform = ''; overlay.style.opacity = ''; if (isPaused) resume(); });

  rebuildHeader(groups[gi]);
  show(gi, startIdx);
}
async function openStoryViewers(storyId, onClose) {
  const m = openModal(`<div class="modal-head"><h3>Visto por</h3><button class="close">&times;</button></div><div class="modal-body" id="svvBody"><div class="loading" style="padding:20px"><div class="spinner"></div></div></div>`);
  if (onClose) { m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.close')) onClose(); }); }
  const body = m.querySelector('#svvBody');
  const { data } = await sb.from('story_views').select('viewer_id, created_at').eq('story_id', storyId).order('created_at', { ascending: false }).limit(120);
  const ids = [...new Set((data || []).map(v => v.viewer_id))].filter(x => x !== state.user.id);
  if (!ids.length) { body.innerHTML = `<div class="empty" style="padding:18px"><svg fill="none"><use href="#i-people"/></svg><p>Aún nadie ha visto esta historia.</p></div>`; return; }
  const { data: profs } = await sb.from('profiles').select('id,username,display_name,avatar_url,theme').in('id', ids);
  const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
  body.innerHTML = '';
  ids.forEach(id => {
    const p = byId[id]; if (!p) return;
    const row = el(`<div class="follow-row"><div class="fr-left">${avatarHTML(p)}<div><div class="fr-name">${esc(p.display_name || p.username)}</div><div class="fr-handle">@${esc(p.username)}</div></div></div></div>`);
    row.onclick = () => { m.remove(); if (onClose) onClose(); openProfile(p.id); };
    body.appendChild(row);
  });
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
// Estadísticas por pista (gratis · en SoundCloud esto es de pago)
async function openTrackStats(t) {
  const plays = t.plays || 0, likes = t.likes_count || 0, reposts = t.reposts_count || 0;
  let comments = 0;
  try { const { count } = await sb.from('comments').select('id', { count: 'exact', head: true }).eq('track_id', t.id); comments = count || 0; } catch (_) {}
  const days = Math.max(1, Math.round((Date.now() - new Date(t.created_at)) / 864e5));
  const perDay = Math.round(plays / days);
  const eng = plays ? Math.round(((likes + reposts + comments) / plays) * 100) : 0;
  const card = (n, l, icon) => `<div class="ts-card"><svg fill="none" stroke="currentColor"><use href="#i-${icon}"/></svg><b>${nfmt(n)}</b><span>${l}</span></div>`;
  const isMine = t.user_id === state.user.id;
  const m = openModal(`<div class="modal-head"><h3>Estadísticas</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="ts-track">${t.cover_url ? `<img src="${esc(czUrl(t.cover_url))}" alt="">` : `<div class="ts-ph"><svg fill="none" stroke="currentColor"><use href="#i-music"/></svg></div>`}<div><b>${esc(t.title)}</b><span>${esc(t.profiles?.display_name || t.profiles?.username || t.artist || '')}</span></div></div>
      <div class="ts-grid">${card(plays, 'Reproducciones', 'headphones')}${card(likes, 'Me gusta', 'heart')}${card(reposts, 'Resubidas', 'repeat')}${card(comments, 'Comentarios', 'comment')}</div>
      ${isMine ? '<div id="tsAudience"></div>' : ''}
      <div class="ts-rows">
        <div class="ts-row"><span>Tasa de interacción</span><b>${eng}%</b></div>
        <div class="ts-row"><span>Días publicada</span><b>${days}</b></div>
        <div class="ts-row"><span>Media por día</span><b>${nfmt(perDay)}</b></div>
      </div>
      <p class="hint" style="text-align:center;margin-top:14px">Analíticas gratis en UnderBro — en otras apps esto es de pago.</p>
    </div>`);
  if (isMine) renderAudienceInsights(t.id, m.querySelector('#tsAudience'));
}
// Insights de audiencia: reproducciones por día (30d) + oyentes únicos
async function renderAudienceInsights(trackId, box) {
  if (!box) return;
  box.innerHTML = `<div class="ts-aud-title">Audiencia · últimos 30 días</div><div class="ts-chart loading" style="padding:18px"><div class="spinner"></div></div>`;
  let rows = null;
  try {
    const since = new Date(Date.now() - 29 * 864e5).toISOString();
    const { data, error } = await sb.from('track_plays').select('created_at,user_id').eq('track_id', trackId).gte('created_at', since).limit(8000);
    if (error) throw error; rows = data || [];
  } catch (_) { box.innerHTML = `<div class="ts-aud-title">Audiencia</div><p class="hint" style="margin:0">Aún no hay datos de audiencia (se registran desde ahora).</p>`; return; }
  const days = 30, buckets = new Array(days).fill(0), today = new Date(); today.setHours(0,0,0,0);
  const listeners = new Set();
  rows.forEach(r => {
    if (r.user_id) listeners.add(r.user_id);
    const d = new Date(r.created_at); d.setHours(0,0,0,0);
    const idx = days - 1 - Math.round((today - d) / 864e5);
    if (idx >= 0 && idx < days) buckets[idx]++;
  });
  const max = Math.max(1, ...buckets);
  const total = buckets.reduce((a, b) => a + b, 0);
  const bars = buckets.map((c, i) => `<div class="ts-bar" title="${c} reprod." style="height:${Math.max(3, Math.round(c / max * 100))}%${i === days - 1 ? ';background:var(--accent-grad)' : ''}"></div>`).join('');
  box.innerHTML = `<div class="ts-aud-title">Audiencia · últimos 30 días</div>
    <div class="ts-chart">${bars}</div>
    <div class="ts-rows">
      <div class="ts-row"><span>Reproducciones (30d)</span><b>${nfmt(total)}</b></div>
      <div class="ts-row"><span>Oyentes únicos (30d)</span><b>${nfmt(listeners.size)}</b></div>
    </div>`;
}
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
  setActiveNav('ecosystems');
  const main = $('main');
  main.innerHTML = ecoHead('Stats', 'Tu panel de artista') + `<div id="dashBody"><div class="loading" style="padding:30px"><div class="spinner"></div></div></div>`;
  wireEcoBack();
  const uid = state.user.id;
  const [tracksRes, followersRes, postsRes, refRes] = await Promise.all([
    sb.from('tracks').select('id,title,cover_url,plays,likes_count,reposts_count,created_at,genre').eq('user_id', uid).order('plays', { ascending: false }),
    sb.from('follows').select('follower_id,created_at').eq('following_id', uid),
    sb.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    sb.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', uid),
  ]);
  const invitedCount = refRes.count || 0;
  const postsCount = postsRes.count || 0;
  const inviteUrl = `${location.origin}/?ref=${encodeURIComponent(state.profile.username || '')}`;
  const tracks = tracksRes.data || [];
  const followerRows = followersRes.data || [];
  const followerDates = followerRows.map(r => r.created_at);
  const totalPlays = tracks.reduce((a, t) => a + (t.plays || 0), 0);
  const totalLikes = tracks.reduce((a, t) => a + (t.likes_count || 0), 0);
  const totalReposts = tracks.reduce((a, t) => a + (t.reposts_count || 0), 0);
  const followers = followerDates.length;
  const theme = (state.profile.theme && typeof state.profile.theme === 'object') ? state.profile.theme : {};
  const links = Array.isArray(theme.links) ? theme.links : [];

  // últimos seguidores (caras)
  const recentIds = [...followerRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12).map(r => r.follower_id).filter(Boolean);
  let recentProfiles = [];
  if (recentIds.length) { const { data } = await sb.from('profiles').select('id,username,display_name,avatar_url,theme').in('id', recentIds); const byId = Object.fromEntries((data || []).map(p => [p.id, p])); recentProfiles = recentIds.map(id => byId[id]).filter(Boolean); }

  // destacados
  const star = tracks[0] || null;
  const avgPlays = tracks.length ? Math.round(totalPlays / tracks.length) : 0;
  const likeRatio = totalPlays ? Math.round((totalLikes / totalPlays) * 100) : 0;

  // próximos hitos
  const nextMilestone = (n, steps) => steps.find(s => s > n) || (n + steps[steps.length - 1]);
  const playGoal = nextMilestone(totalPlays, [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000]);
  const followGoal = nextMilestone(followers, [10, 25, 50, 100, 250, 500, 1000, 5000, 10000]);
  const likeGoal = nextMilestone(totalLikes, [25, 50, 100, 250, 500, 1000, 5000, 10000]);

  // nivel de artista (perfil completo)
  const checks = [
    { ok: !!state.profile.avatar_url, label: 'Foto de perfil', act: 'avatar' },
    { ok: !!czUrl(theme.banner), label: 'Banner', act: 'banner' },
    { ok: !!(state.profile.bio && state.profile.bio.trim()), label: 'Biografía', act: 'bio' },
    { ok: links.length > 0, label: 'Redes y enlaces', act: 'links' },
    { ok: links.some(l => /spotify\.com/i.test(l.url || '')), label: 'Spotify conectado', act: 'links' },
    { ok: tracks.length > 0, label: 'Tu primera pista', act: 'upload' },
    { ok: postsCount > 0, label: 'Tu primera foto', act: 'posts' },
  ];
  const doneCount = checks.filter(c => c.ok).length;
  const completePct = Math.round((doneCount / checks.length) * 100);
  const mbar = (label, cur, goal, icon) => {
    const pct = Math.min(100, Math.round((cur / goal) * 100));
    return `<div class="ms-row"><div class="ms-top"><span class="ms-l"><svg fill="none" stroke="currentColor"><use href="${icon}"/></svg> ${label}</span><span class="ms-n">${nfmt(cur)} / ${nfmt(goal)}</span></div><div class="ms-bar"><div class="ms-fill" style="width:${pct}%"></div></div></div>`;
  };


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
      <div class="dash-sec-head"><h3>Destacados</h3><button class="btn sm" id="shareStatsBtn"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg> Compartir números</button></div>
      <div class="dash-highlights">
        <div class="hl-card hl-star">
          <div class="hl-cover" style="${star && star.cover_url ? `background-image:url('${czUrl(star.cover_url)}')` : ''}">${star && star.cover_url ? '' : '<svg fill="none" stroke="#fff"><use href="#i-music"/></svg>'}</div>
          <div class="hl-meta"><div class="hl-k">Pista estrella</div><div class="hl-v">${star ? esc(star.title) : '—'}</div><div class="hl-sub">${star ? nfmt(star.plays || 0) + ' repros' : 'Sube tu primera pista'}</div></div>
        </div>
        <div class="hl-card"><div class="hl-k">Media por pista</div><div class="hl-big">${nfmt(avgPlays)}</div><div class="hl-sub">reproducciones</div></div>
        <div class="hl-card"><div class="hl-k">Ratio de me gusta</div><div class="hl-big">${likeRatio}%</div><div class="hl-sub">de tus oyentes</div></div>
      </div>
    </div>

    <div class="dash-section">
      <h3>Difundir a tus seguidores</h3>
      <p class="dash-hint" style="margin:4px 0 10px">Avisa a tus <b>${nfmt(followers)}</b> seguidores de un lanzamiento o novedad. Reciben <b>notificación</b> y aparece en sus avisos. (Máx. 1 cada 3 h.)</p>
      <textarea id="annBody" maxlength="280" placeholder="Ej: ¡Nuevo tema fuera ya! 🔥 Escúchalo y dime qué te parece."></textarea>
      <button class="btn primary" id="annSend" style="width:100%;margin-top:8px"${followers ? '' : ' disabled'}><svg fill="none" stroke="#fff"><use href="#i-bell"/></svg> ${followers ? 'Enviar difusión' : 'Aún no tienes seguidores'}</button>
    </div>

    <div class="dash-section">
      <h3>Seguidores nuevos (últimos 14 días) · +${newLast14}</h3>
      <div class="dash-chart">
        ${buckets.map((b, i) => `<div class="dc-col" title="${labels[i].toLocaleDateString('es-ES',{day:'numeric',month:'short'})}: ${b}"><div class="dc-bar" style="height:${Math.round((b / maxB) * 100)}%"></div><span class="dc-x">${labels[i].getDate()}</span></div>`).join('')}
      </div>
    </div>

    <div class="dash-section">
      <h3>Próximos hitos</h3>
      ${mbar('Reproducciones', totalPlays, playGoal, '#i-headphones')}
      ${mbar('Seguidores', followers, followGoal, '#i-people')}
      ${mbar('Me gusta', totalLikes, likeGoal, '#i-heart')}
    </div>

    <div class="dash-section">
      <div class="dash-sec-head"><h3>Nivel de artista</h3><span class="dash-pct">${completePct}%</span></div>
      <p class="dash-hint" style="margin:4px 0 12px">Completa tu perfil para destacar más en UnderBro.</p>
      <div class="level-wrap">
        <div class="level-ring" style="--p:${completePct}"><span>${doneCount}/${checks.length}</span></div>
        <div class="level-list">
          ${checks.map(c => `<button class="lv-item ${c.ok ? 'done' : ''}" data-act="${c.act}"><span class="lv-ico">${c.ok ? '✓' : '+'}</span> ${esc(c.label)}</button>`).join('')}
        </div>
      </div>
    </div>

    ${recentProfiles.length ? `<div class="dash-section">
      <h3>Últimos seguidores</h3>
      <div class="dash-faces">
        ${recentProfiles.map(p => `<button class="face" data-uid="${p.id}" title="${esc(p.display_name || p.username || '')}">${avatarHTML(p)}</button>`).join('')}
      </div>
    </div>` : ''}

    <div class="dash-section" id="collabSection">
      <h3>Colaboraciones sugeridas</h3>
      <p class="dash-hint" style="margin:4px 0 10px">Artistas de tu mismo estilo para hacer un <b>feat</b>. Propón la colaboración por mensaje.</p>
      <div id="collabBody"><div class="loading" style="padding:14px"><div class="spinner"></div></div></div>
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
  body.querySelector('#shareStatsBtn').onclick = () => shareStatsCard({ plays: totalPlays, followers, likes: totalLikes, reposts: totalReposts, tracks: tracks.length });
  body.querySelectorAll('.lv-item:not(.done)').forEach(it => it.onclick = () => {
    const a = it.dataset.act;
    if (a === 'links') editLinksModal(() => renderDashboard());
    else if (a === 'banner') openProfileCustomizer();
    else if (a === 'upload') openUploadModal();
    else if (a === 'posts') switchView('posts');
    else switchView('settings');
  });
  body.querySelectorAll('.dash-faces .face').forEach(f => f.onclick = () => openProfile(f.dataset.uid));
  loadCollabSuggestions(tracks);
  const annSend = body.querySelector('#annSend');
  if (annSend && followers) annSend.onclick = async () => {
    const ta = body.querySelector('#annBody'); const txt = ta.value.trim();
    if (!txt) { toast('Escribe un mensaje'); return; }
    annSend.disabled = true;
    const { error } = await sb.from('announcements').insert({ artist_id: uid, body: txt });
    if (error) {
      if (((error.message || '') + (error.details || '')).includes('rate_limited')) toast('Solo puedes difundir una vez cada 3 horas');
      else toast('No se pudo enviar la difusión');
      annSend.disabled = false; return;
    }
    ta.value = '';
    annSend.innerHTML = 'Difusión enviada ✓';
    toast('📣 Difusión enviada a tus seguidores');
  };
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

// genera una tarjeta cuadrada (1080x1080) con tus números para compartir
function shareStatsCard(s) {
  toast('Generando imagen…');
  const S = 1080;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const FB = '800 0px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const font = (w, px) => `${w} ${px}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.fillStyle = '#00020b'; ctx.fillRect(0, 0, S, S);
  let rg = ctx.createRadialGradient(S * 0.5, S * 0.26, 0, S * 0.5, S * 0.26, S * 0.62);
  rg.addColorStop(0, 'rgba(62,87,252,0.38)'); rg.addColorStop(1, 'rgba(62,87,252,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, S, S);
  rg = ctx.createRadialGradient(S * 0.85, S * 0.9, 0, S * 0.85, S * 0.9, S * 0.5);
  rg.addColorStop(0, 'rgba(110,45,245,0.30)'); rg.addColorStop(1, 'rgba(110,45,245,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, S, S);

  const render = (logo) => {
    if (logo) { const lw = 150, lh = logo.height * lw / logo.width; ctx.drawImage(logo, (S - lw) / 2, 96, lw, lh); }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff'; ctx.font = font('800', 60);
    ctx.fillText('@' + (state.profile.username || ''), S / 2, 320);
    ctx.fillStyle = '#aeb8d6'; ctx.font = font('500', 30);
    ctx.fillText('mis números en UnderBro', S / 2, 366);

    const stats = [['Reproducciones', s.plays], ['Seguidores', s.followers], ['Me gusta', s.likes], ['Pistas', s.tracks]];
    const cx = [S * 0.30, S * 0.70], cy = [560, 800];
    stats.forEach((st, i) => {
      const x = cx[i % 2], y = cy[Math.floor(i / 2)];
      ctx.fillStyle = '#ffffff'; ctx.font = font('800', 96);
      ctx.fillText(nfmt(st[1]), x, y);
      ctx.fillStyle = '#8fb4ff'; ctx.font = font('600', 30);
      ctx.fillText(st[0], x, y + 46);
    });

    ctx.fillStyle = '#5f9bff'; ctx.font = font('700', 34);
    ctx.fillText('underbro.app', S / 2, S - 76);

    cv.toBlob(async (blob) => {
      if (!blob) { toast('No se pudo generar la imagen'); return; }
      const file = new File([blob], 'underbro-stats.png', { type: 'image/png' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Mis números en UnderBro', text: '🎧 @' + (state.profile.username || '') + ' en UnderBro' });
          return;
        }
      } catch (_) { /* cancelado o no soportado → descarga */ }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'underbro-stats.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('Imagen guardada');
    }, 'image/png');
  };

  const img = new Image();
  img.onload = () => render(img);
  img.onerror = () => render(null);
  img.src = '/assets/logo-mark.png';
}

// sugiere artistas de tu mismo estilo para colaborar
async function loadCollabSuggestions(myTracks) {
  const sec = $('collabBody'); if (!sec) return;
  const genres = new Set((myTracks || []).map(t => (t.genre || '').trim().toLowerCase()).filter(Boolean));
  if (!genres.size) {
    sec.innerHTML = `<div class="empty" style="padding:10px"><p>Añade un <b>género</b> a tus pistas (Editar pista) y te sugeriremos colaboradores de tu estilo.</p></div>`;
    return;
  }
  const { data } = await sb.from('tracks')
    .select('user_id, genre, profiles!tracks_user_id_fkey(id,username,display_name,avatar_url,theme,verified,is_admin)')
    .neq('user_id', state.user.id).not('genre', 'is', null)
    .order('created_at', { ascending: false }).limit(500);
  const byUser = new Map();
  (data || []).forEach(t => {
    const g = (t.genre || '').trim().toLowerCase();
    if (!genres.has(g) || !t.profiles || isHidden(t.user_id)) return;
    let e = byUser.get(t.user_id);
    if (!e) { e = { prof: t.profiles, genres: new Set(), count: 0 }; byUser.set(t.user_id, e); }
    e.genres.add(t.genre.trim()); e.count++;
  });
  const list = [...byUser.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  if (!list.length) {
    sec.innerHTML = `<div class="empty" style="padding:10px"><p>Aún no encontramos artistas de tu estilo. ¡Vuelve cuando haya más gente con tus géneros!</p></div>`;
    return;
  }
  sec.innerHTML = list.map(e => {
    const p = e.prof; const gtags = [...e.genres].slice(0, 3).map(g => `<span class="cl-tag">${esc(g)}</span>`).join('');
    return `<div class="collab-card">
      <button class="cl-who" data-uid="${p.id}">${avatarHTML(p)}<div class="cl-info"><div class="cl-name">${esc(p.display_name || p.username)}${verifiedBadge(p)}</div><div class="cl-genres">${gtags}</div></div></button>
      <button class="btn sm primary cl-go" data-uid="${p.id}" data-name="${esc(p.display_name || p.username || '')}"><svg fill="none" stroke="#fff"><use href="#i-mail"/></svg> Proponer feat</button>
    </div>`;
  }).join('');
  sec.querySelectorAll('.cl-who').forEach(b => b.onclick = () => openProfile(b.dataset.uid));
  sec.querySelectorAll('.cl-go').forEach(b => b.onclick = () => proposeCollab(b.dataset.uid));
}
function proposeCollab(userId) {
  if (state.blocked.has(userId) || state.hidden.has(userId)) { toast('No puedes escribir a este usuario'); return; }
  openDM(userId);
  setTimeout(() => { const i = $('dmInput'); if (i && !i.value) { i.value = '¡Hey! Me mola tu rollo 🔥 ¿te animas a hacer un feat juntos?'; i.focus(); } }, 420);
}

/* =======================================================================
   BEATS — pistas marcadas como beat, descargables
   ======================================================================= */
async function renderBeats() {
  setActiveNav('beats');
  const main = $('main');
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = `
    <div class="main-head"><div><h2>Beats</h2><div class="sub">Beats que suben los productores · descárgalos gratis</div></div><button class="btn sm" id="beatsRadioBtn"><svg fill="none" stroke="currentColor"><use href="#i-radio"/></svg> Radio de beats</button></div>
    <div class="beats-search"><svg fill="none" stroke="currentColor"><use href="#i-search"/></svg><input type="text" id="beatsSearch" placeholder="Buscar por título, género, BPM o tono…" /></div>
    <div id="beatsList" class="feed-list compact"><div class="loading" style="padding:30px"><div class="spinner"></div></div></div>`;
  const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').eq('is_beat', true).order('created_at', { ascending: false }).limit(80);
  const all = (data || []).filter(t => !isHidden(t.user_id));
  const list = $('beatsList');
  const renderList = (arr) => {
    list.innerHTML = '';
    if (!arr.length) { list.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-headphones"/></svg><p>Aún no hay beats.<br>Sube una pista y marca <b>"Es un beat"</b> para que aparezca aquí.</p></div>`; return; }
    state.tracks = arr; state.queue = arr.map(t => t.id);
    arr.forEach(t => list.appendChild(trackCard(t)));
    if (state.current && audio && !audio.paused) markPlayingCard();
  };
  renderList(all);
  $('beatsRadioBtn').onclick = () => startRadio(true);
  $('beatsSearch').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    renderList(!q ? all : all.filter(t => (t.title || '').toLowerCase().includes(q) || (t.genre || '').toLowerCase().includes(q) || String(t.bpm || '').includes(q) || (t.song_key || '').toLowerCase().includes(q)));
  };
}

/* =======================================================================
   HERRAMIENTAS — Press Kit / EPK
   ======================================================================= */
// Registro central de herramientas: icono, acento e info — fuente única para
// el hub y las cabeceras, para que todo se sienta parte del mismo ecosistema.
const TOOLS = {
  presskit:  { icon: 'i-doc',   accent: '#3e57fc', view: 'presskit',   name: 'Press Kit / EPK', go: 'Crear ahora',
    desc: 'Tu dossier de artista: bio, estadísticas, temas destacados y contacto. Compártelo con salas, sellos y promotores con un enlace o en PDF.' },
  smartlink: { icon: 'i-share', accent: '#8b5cf6', view: 'smartlinks',  name: 'Smart link', go: 'Crear ahora',
    desc: 'Una página por lanzamiento con tu portada y botones a Spotify, YouTube, Apple… Un solo enlace para tu bio.' },
  split:     { icon: 'i-files', accent: '#0ea5e9', view: 'splits',      name: 'Split sheet', go: 'Crear ahora',
    desc: 'Reparto de autoría de una colaboración: quién hizo qué y el % de cada uno. Fírmalo y expórtalo a PDF.' },
  analyzer:  { icon: 'i-mixer', accent: '#10b981', view: 'analyzer',    name: 'Analizador de audio', go: 'Analizar ahora',
    desc: 'Sube una canción y obtén el tono (para el autotune), el BPM y un análisis de volumen, picos y clipping. Todo en tu navegador.' },
};

// Cabecera unificada de cualquier página de herramientas.
// back = { id, label } para el botón de volver (la lógica onclick se asigna fuera).
function toolBar(key, title, sub, back) {
  const t = TOOLS[key] || {};
  return `<div class="tool-bar" style="--ta:${t.accent || '#3e57fc'}">
    ${back ? `<button class="tool-back" id="${back.id}" title="${esc(back.label || 'Atrás')}" aria-label="${esc(back.label || 'Atrás')}"><svg fill="none" stroke="currentColor"><use href="#i-chevron-left"/></svg></button>` : ''}
    <div class="tool-bar-ico"><svg fill="none" stroke="#fff"><use href="#${t.icon || 'i-mixer'}"/></svg></div>
    <div class="tool-bar-txt"><h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
  </div>`;
}

function renderTools() {
  setActiveNav('ecosystems');
  const main = $('main');
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  const card = (key) => { const t = TOOLS[key]; return `
    <button class="tool-card" data-tool="${key}" style="--ta:${t.accent}">
      <div class="tool-ico"><svg fill="none" stroke="#fff"><use href="#${t.icon}"/></svg></div>
      <div class="tool-name">${t.name}</div>
      <div class="tool-desc">${t.desc}</div>
      <span class="tool-go">${t.go} →</span>
    </button>`; };
  main.innerHTML = `
    ${ecoHead('Workflow', 'Tu kit de artista — todo en un mismo sitio')}
    <div class="tools-grid">
      ${['presskit', 'smartlink', 'split', 'analyzer'].map(card).join('')}
      <div class="tool-card soon" style="--ta:#f59e0b">
        <div class="tool-ico"><svg fill="none" stroke="#fff"><use href="#i-image"/></svg></div>
        <div class="tool-name">Portada / flyer</div>
        <div class="tool-desc">Genera carátulas y carteles con tu marca, listos para subir.</div>
        <span class="tool-soon">Próximamente</span>
      </div>
    </div>`;
  main.querySelectorAll('.tool-card[data-tool]').forEach(c => c.onclick = () => switchView(TOOLS[c.dataset.tool].view));
  wireEcoBack();
}

/* =======================================================================
   ECOSYSTEMS — centro de mando del artista (hub con croquis + 6 secciones)
   ======================================================================= */
const ECOSYSTEMS = [
  { key: 'partners',  n: 1, name: 'Partners',  icon: 'i-people',  accent: '#3e57fc', desc: 'Feats, tus partners y artistas que sigues' },
  { key: 'workflow',  n: 2, name: 'Workflow',  icon: 'i-tools',   accent: '#7c5cff', desc: 'Todas tus herramientas de artista' },
  { key: 'contracts', n: 3, name: 'Contratos', icon: 'i-doc',     accent: '#e0a83e', desc: 'Acuerdos con artistas, salas, productores…' },
  { key: 'stats',     n: 4, name: 'Stats',     icon: 'i-chart',   accent: '#2fb344', desc: 'Tus estadísticas y crecimiento' },
  { key: 'skins',     n: 5, name: 'Mercado',   icon: 'i-palette', accent: '#ff5b8d', desc: 'Webs de la comunidad · personaliza la tuya' },
  { key: 'uploads',   n: 6, name: 'Subidas',   icon: 'i-files',   accent: '#27a9ff', desc: 'Pistas, beats, fotos y playlists' },
];
function renderEcosystems() {
  setActiveNav('ecosystems');
  const main = $('main');
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = `
    <div class="main-head"><div><h2>Ecosystems</h2><div class="sub">Tu centro de mando como artista</div></div></div>
    <div class="eco-map">
      ${ECOSYSTEMS.map((e, i) => `
        <button class="eco-node" data-eco="${e.key}" style="--ea:${e.accent}">
          <span class="eco-n">${e.n}</span>
          <span class="eco-ico"><svg fill="none" stroke="#fff"><use href="#${e.icon}"/></svg></span>
          <span class="eco-txt"><b>${e.name}</b><span>${esc(e.desc)}</span></span>
          <span class="eco-go">→</span>
        </button>${i < ECOSYSTEMS.length - 1 ? '<span class="eco-link"></span>' : ''}`).join('')}
    </div>`;
  main.querySelectorAll('.eco-node').forEach(b => b.onclick = () => openEco(b.dataset.eco));
}
function openEco(key) {
  if (key === 'workflow') return switchView('tools');
  if (key === 'stats') return switchView('dashboard');
  switchView(key);
}
function ecoHead(title, sub) {
  return `<div class="main-head"><div class="eco-head-l"><button class="icon-btn" id="ecoBack" title="Volver a Ecosystems"><svg fill="none" stroke="currentColor"><use href="#i-chevron-left"/></svg></button><div><h2>${esc(title)}</h2><div class="sub">${esc(sub)}</div></div></div></div>`;
}
function wireEcoBack() { const b = $('ecoBack'); if (b) b.onclick = () => switchView('ecosystems'); }

/* ---- Subidas ---- */
async function renderUploads() {
  setActiveNav('ecosystems');
  const main = $('main'); main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = ecoHead('Subidas', 'Todo lo que has subido · mantén pulsado para editar') + `
    <div class="tabs eco-tabs" id="upTabs">
      <button class="active" data-ut="tracks">Pistas</button>
      <button data-ut="beats">Beats</button>
      <button data-ut="photos">Fotos</button>
      <button data-ut="playlists">Playlists</button>
    </div>
    <div id="upBody"><div class="loading"><div class="spinner"></div></div></div>`;
  wireEcoBack();
  const uid = state.user.id;
  const load = async (tab) => {
    const body = $('upBody'); body.className = ''; body.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    if (tab === 'tracks' || tab === 'beats') {
      const all = await fetchTracks({ order: 'created_at', userId: uid, limit: 200 });
      const list = all.filter(t => tab === 'beats' ? t.is_beat : !t.is_beat);
      body.innerHTML = '';
      if (!list.length) { body.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-music"/></svg><p>Nada por aquí todavía.</p></div>`; return; }
      state.tracks = list; state.queue = list.map(t => t.id);
      list.forEach(t => body.appendChild(trackCard(t)));
    } else if (tab === 'photos') {
      body.className = 'post-grid';
      await loadProfilePosts(uid, body);
    } else if (tab === 'playlists') {
      const { data } = await sb.from('playlists').select('*, playlist_tracks(track_id, added_at, tracks(cover_url))').eq('user_id', uid).order('created_at', { ascending: false });
      const lists = data || []; body.className = 'pl-grid'; body.innerHTML = '';
      if (!lists.length) { body.innerHTML = `<div class="empty" style="grid-column:1/-1"><svg fill="none"><use href="#i-list"/></svg><p>No tienes playlists.</p></div>`; return; }
      lists.forEach(pl => body.appendChild(playlistCard(pl)));
    }
  };
  $('upTabs').querySelectorAll('button').forEach(b => b.onclick = () => { $('upTabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); load(b.dataset.ut); });
  load('tracks');
}

/* ---- Partners ---- */
function getPartners() { try { return new Set(JSON.parse(localStorage.getItem('ub_partners') || '[]')); } catch { return new Set(); } }
function savePartners(s) { try { localStorage.setItem('ub_partners', JSON.stringify([...s])); } catch (_) {} }
async function renderPartnersView() {
  setActiveNav('ecosystems');
  const main = $('main'); main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = ecoHead('Partners', 'Colaboradores, partners y artistas que sigues') + `<div id="partBody"><div class="loading"><div class="spinner"></div></div></div>`;
  wireEcoBack();
  const body = $('partBody'); const uid = state.user.id; const partners = getPartners();
  const followed = [...state.follows];
  const [profsRes, feats] = await Promise.all([
    followed.length ? sb.from('profiles').select('*').in('id', followed) : Promise.resolve({ data: [] }),
    fetchTracks({ order: 'created_at', userId: uid, limit: 120 }),
  ]);
  const profList = (profsRes.data || []).filter(p => !isHidden(p.id));
  const featTracks = (feats || []).filter(t => Array.isArray(t.collaborators) && t.collaborators.length);
  const partnerProfs = profList.filter(p => partners.has(p.id));
  body.innerHTML = '';
  const sec = (t) => body.appendChild(el(`<h3 class="eco-sec">${t}</h3>`));
  const hint = (t) => body.appendChild(el(`<div class="eco-hint">${t}</div>`));
  sec('⭐ Partners');
  if (!partnerProfs.length) hint('Marca a artistas como partner desde la lista de abajo.');
  partnerProfs.forEach(p => body.appendChild(partnerRow(p, partners)));
  sec('🎚️ Feats');
  if (!featTracks.length) hint('Sin colaboraciones todavía.');
  featTracks.forEach(t => body.appendChild(trackCard(t)));
  sec('👥 Artistas que sigues');
  if (!profList.length) hint('Todavía no sigues a nadie.');
  profList.forEach(p => body.appendChild(partnerRow(p, partners)));
}
function partnerRow(p, partners) {
  const isP = partners.has(p.id);
  const row = el(`<div class="follow-row">${avatarHTML(p)}<div class="fr-info"><div class="fr-name">${esc(p.display_name || p.username)}</div><div class="fr-handle">@${esc(p.username)}</div></div><div class="fr-actions"><button class="btn sm ${isP ? '' : 'primary'}" data-partner>${isP ? '★ Partner' : '+ Partner'}</button></div></div>`);
  row.querySelector('[data-partner]').onclick = (e) => { e.stopPropagation(); const ps = getPartners(); if (ps.has(p.id)) ps.delete(p.id); else ps.add(p.id); savePartners(ps); toast(ps.has(p.id) ? 'Añadido a Partners' : 'Quitado de Partners'); renderPartnersView(); };
  row.addEventListener('click', (e) => { if (e.target.closest('[data-partner]')) return; openProfile(p.id); });
  return row;
}

/* ---- Skins ---- */
const APP_SKINS = {
  'default': { name: 'UnderBro', grad: 'linear-gradient(135deg,#3e57fc,#27a9ff)', vars: {} },
  'sunset':  { name: 'Sunset',   grad: 'linear-gradient(135deg,#ff9a5a,#ff5b8d)', vars: { '--blue': '#ff7a45', '--blue-2': '#ff5b8d', '--accent-grad': 'linear-gradient(135deg,#ff9a5a,#ff5b8d)' } },
  'mint':    { name: 'Mint',     grad: 'linear-gradient(135deg,#34d399,#0ea5a5)', vars: { '--blue': '#10b981', '--blue-2': '#0ea5a5', '--accent-grad': 'linear-gradient(135deg,#34d399,#0ea5a5)' } },
  'grape':   { name: 'Grape',    grad: 'linear-gradient(135deg,#a78bfa,#d946ef)', vars: { '--blue': '#8b5cf6', '--blue-2': '#d946ef', '--accent-grad': 'linear-gradient(135deg,#a78bfa,#d946ef)' } },
  'crimson': { name: 'Crimson',  grad: 'linear-gradient(135deg,#fb7185,#f97316)', vars: { '--blue': '#ef4444', '--blue-2': '#f97316', '--accent-grad': 'linear-gradient(135deg,#fb7185,#f97316)' } },
  'gold':    { name: 'Gold',     grad: 'linear-gradient(135deg,#f6d365,#d4922b)', vars: { '--blue': '#d4922b', '--blue-2': '#f6d365', '--accent-grad': 'linear-gradient(135deg,#f6d365,#d4922b)' } },
};
function applyAppSkin(key) {
  const root = document.documentElement;
  ['--blue', '--blue-2', '--accent-grad'].forEach(v => root.style.removeProperty(v));
  const sk = APP_SKINS[key];
  if (sk && sk.vars) Object.entries(sk.vars).forEach(([k, v]) => root.style.setProperty(k, v));
}
function applyCustomCss(css) {
  let st = document.getElementById('ub-custom-skin');
  if (!st) { st = document.createElement('style'); st.id = 'ub-custom-skin'; document.head.appendChild(st); }
  st.textContent = css || '';
}
function loadSavedSkin() {
  try {
    const k = localStorage.getItem('ub_app_skin'); if (k && APP_SKINS[k]) applyAppSkin(k);
    const css = localStorage.getItem('ub_custom_css'); if (css) applyCustomCss(css);
  } catch (_) {}
}
function renderSkins() {
  setActiveNav('ecosystems');
  const main = $('main'); main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  const isCreator = !!(state.profile && (state.profile.can_customize || state.profile.is_admin));
  main.innerHTML = ecoHead('Mercado de webs', 'Aplica un diseño de la comunidad a tu UnderBro') + `
    <div class="skins-wrap">
      <div class="mkt-top">
        <button class="btn primary" id="becomeCreator">${isCreator ? '🎨 Abrir editor' : '✨ Ser creador'}</button>
        <button class="btn" id="mktReset">Volver a mi diseño normal</button>
      </div>
      <p class="eco-hint">Toca <b>Aplicar</b> para usar un diseño en tu cuenta (solo lo ves tú). ${isCreator ? 'Como creador puedes diseñar el tuyo en el editor y publicarlo aquí.' : 'Hazte creador para diseñar el tuyo y publicarlo.'}</p>
      <div id="mktGrid" class="mkt-grid"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;
  wireEcoBack();
  $('becomeCreator').onclick = isCreator ? () => { location.href = '/editor'; } : openBecomeCreator;
  $('mktReset').onclick = async () => {
    if (!confirm('¿Quitar el diseño aplicado y volver al normal?')) return;
    try { await sb.from('user_site_config').upsert({ user_id: state.user.id, config: {}, updated_at: new Date().toISOString() }); } catch (_) {}
    toast('Diseño restablecido'); setTimeout(() => location.reload(), 500);
  };
  loadMarketGrid();
}
async function loadMarketGrid() {
  const grid = $('mktGrid'); if (!grid) return;
  const { data, error } = await sb.from('theme_market').select('id,author_name,name,config,created_at').order('created_at', { ascending: false }).limit(120);
  if (error) { grid.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-palette"/></svg><p>${/relation|exist|theme_market/i.test(error.message||'') ? 'El mercado aún no está activo.' : 'No se pudo cargar el mercado.'}</p></div>`; return; }
  if (!data || !data.length) { grid.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-palette"/></svg><p>Aún no hay webs en el mercado. ¡Sé el primero en crear una!</p></div>`; return; }
  grid.innerHTML = '';
  data.forEach((t) => {
    const c = t.config || {}, cols = c.colors || {}, acc = cols.accent || '#5f9bff';
    const bg = (c.bg && c.bg.mode === 'color' && c.bg.color) ? c.bg.color
      : (c.bg && c.bg.mode === 'gradient' && c.bg.c1) ? `linear-gradient(135deg, ${c.bg.c1}, ${c.bg.c2 || c.bg.c1})`
      : (cols.appbg || '#0a0d18');
    const card = el(`<div class="mkt-card"><div class="mkt-prev" style="background:${bg}"><span class="mkt-dot" style="background:${acc}"></span><span class="mkt-dot" style="background:${cols.accent2 || acc}"></span></div><div class="mkt-name">${esc(t.name || 'Web')}</div><div class="mkt-author">@${esc(t.author_name || 'anónimo')}</div><button class="btn sm primary" data-apply>Aplicar</button></div>`);
    card.querySelector('[data-apply]').onclick = async () => {
      const { error: e2 } = await sb.from('user_site_config').upsert({ user_id: state.user.id, config: c, updated_at: new Date().toISOString() });
      if (e2) { toast('No se pudo aplicar.'); return; }
      toast('¡Diseño aplicado!'); setTimeout(() => location.reload(), 500);
    };
    grid.appendChild(card);
  });
}
function openBecomeCreator() {
  const m = openModal(`<div class="modal-head"><h3>✨ Hazte creador</h3><button class="close">&times;</button></div><div class="modal-body"><p style="margin:0 0 14px;color:var(--ink-soft);font-size:14px">Como creador podrás diseñar tu propia web de UnderBro en el editor visual y publicarla en el mercado para que otros la usen.</p><button class="btn primary" id="reqCreator" style="width:100%">Solicitar acceso de creador</button><div class="auth-msg" id="reqMsg" style="margin-top:10px"></div></div>`);
  m.querySelector('#reqCreator').onclick = async () => {
    const { error } = await sb.from('creator_requests').upsert({ user_id: state.user.id, username: (state.profile && state.profile.username) || null, created_at: new Date().toISOString() });
    m.querySelector('#reqMsg').textContent = error ? (/relation|exist/i.test(error.message||'') ? 'Función no disponible aún (falta el SQL).' : 'No se pudo enviar la solicitud.') : '¡Solicitud enviada! El administrador la revisará. ✅';
  };
}
function downloadSkinTemplate() {
  const tpl = `/* Plantilla de skin para UnderBro\n   Edita las variables y pega el resultado en Ecosystems > Skins > CSS personalizado. */\n:root{\n  --blue: #3e57fc;       /* color principal */\n  --blue-2: #27a9ff;     /* color secundario */\n  --accent-grad: linear-gradient(135deg,#3e57fc,#27a9ff);\n  --bg: #f3f6fb;         /* fondo */\n  --panel: #ffffff;      /* tarjetas */\n  --ink: #10142a;        /* texto */\n}\n/* Ejemplos libres: */\n/* .track{ border-radius: 20px; } */\n/* .topbar{ backdrop-filter: blur(20px); } */\n`;
  const blob = new Blob([tpl], { type: 'text/css' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'underbro-skin.css'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---- Contratos ---- */
const CONTRACT_TYPES = ['Colaboración (feat)', 'Productor / Beat', 'Sala / Concierto', 'Management', 'Distribución', 'Otro'];
function getContracts() { try { return JSON.parse(localStorage.getItem('ub_contracts') || '[]'); } catch { return []; } }
function saveContracts(a) { try { localStorage.setItem('ub_contracts', JSON.stringify(a)); } catch (_) {} }
function renderContratos() {
  setActiveNav('ecosystems');
  const main = $('main'); main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = ecoHead('Contratos', 'Tus acuerdos legales en un solo sitio') + `
    <div class="ctr-wrap">
      <button class="btn primary" id="ctrNew"><svg fill="none" stroke="#fff"><use href="#i-plus"/></svg> Nuevo contrato</button>
      <div id="ctrList" class="ctr-list"></div>
      <div class="eco-hint" style="margin-top:14px">Se guardan en tu dispositivo. La firma entre usuarios llegará pronto.</div>
    </div>`;
  wireEcoBack();
  renderContractList();
  $('ctrNew').onclick = () => openContractForm();
}
function renderContractList() {
  const box = $('ctrList'); if (!box) return; const list = getContracts();
  if (!list.length) { box.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-doc"/></svg><p>Aún no tienes contratos. Crea el primero.</p></div>`; return; }
  box.innerHTML = '';
  list.forEach((c, i) => { const row = el(`<div class="ctr-card"><div class="ctr-main"><b>${esc(c.title || 'Contrato')}</b><span>${esc(c.type || '')} · ${esc(c.party || '—')}${c.date ? ' · ' + esc(c.date) : ''}</span></div><span class="ctr-status ${c.signed ? 'on' : ''}">${c.signed ? 'Firmado' : 'Borrador'}</span></div>`); row.onclick = () => openContractView(i); box.appendChild(row); });
}
function openContractForm(idx) {
  const list = getContracts();
  const c = (idx != null) ? list[idx] : { title: '', type: CONTRACT_TYPES[0], party: '', date: new Date().toISOString().slice(0, 10), split: '', terms: '', signed: false };
  const m = openModal(`<div class="modal-head"><h3>${idx != null ? 'Editar' : 'Nuevo'} contrato</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label>Título</label><input id="cT" value="${esc(c.title)}" placeholder="Ej. Feat con XXX" /></div>
      <div class="field"><label>Tipo</label><select id="cTy" class="cz-select">${CONTRACT_TYPES.map(x => `<option ${x === c.type ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Contraparte</label><input id="cP" value="${esc(c.party)}" placeholder="Artista, sala, productor, manager…" /></div>
      <div class="field"><label>Fecha</label><input id="cD" type="date" value="${esc(c.date)}" /></div>
      <div class="field"><label>Reparto / % (opcional)</label><input id="cS" value="${esc(c.split || '')}" placeholder="Ej. 50/50, 70% yo…" /></div>
      <div class="field"><label>Términos / cláusulas</label><textarea id="cTerms" rows="6" placeholder="Detalla el acuerdo…">${esc(c.terms || '')}</textarea></div>
      <label class="pk-tg" style="font-weight:600"><input type="checkbox" id="cSigned" style="width:auto" ${c.signed ? 'checked' : ''} /> <span>Marcar como firmado</span></label>
      <button class="btn primary" id="cSave" style="width:100%;margin-top:10px">Guardar</button>
    </div>`);
  m.querySelector('#cSave').onclick = () => {
    const obj = { title: m.querySelector('#cT').value.trim() || 'Contrato', type: m.querySelector('#cTy').value, party: m.querySelector('#cP').value.trim(), date: m.querySelector('#cD').value, split: m.querySelector('#cS').value.trim(), terms: m.querySelector('#cTerms').value.trim(), signed: m.querySelector('#cSigned').checked };
    const arr = getContracts(); if (idx != null) arr[idx] = obj; else arr.unshift(obj); saveContracts(arr); m.remove(); renderContractList(); toast('Contrato guardado');
  };
}
function openContractView(idx) {
  const c = getContracts()[idx]; if (!c) return;
  const m = openModal(`<div class="modal-head"><h3>${esc(c.title)}</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <p><b>Tipo:</b> ${esc(c.type)}</p>
      <p><b>Contraparte:</b> ${esc(c.party || '—')}</p>
      <p><b>Fecha:</b> ${esc(c.date || '—')}</p>
      ${c.split ? `<p><b>Reparto:</b> ${esc(c.split)}</p>` : ''}
      <p><b>Términos:</b></p><p style="white-space:pre-wrap;color:var(--ink-soft)">${esc(c.terms || '—')}</p>
      <p><b>Estado:</b> ${c.signed ? 'Firmado ✓' : 'Borrador'}</p>
      <div class="skin-actions">
        <button class="btn" id="ctrEdit">Editar</button>
        <button class="btn" id="ctrPrint"><svg fill="none" stroke="currentColor"><use href="#i-doc"/></svg> Imprimir / PDF</button>
        <button class="btn danger-btn" id="ctrDel"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg> Eliminar</button>
      </div>
    </div>`);
  m.querySelector('#ctrEdit').onclick = () => { m.remove(); openContractForm(idx); };
  m.querySelector('#ctrPrint').onclick = () => printContract(c);
  m.querySelector('#ctrDel').onclick = () => { const arr = getContracts(); arr.splice(idx, 1); saveContracts(arr); m.remove(); renderContractList(); toast('Contrato eliminado'); };
}
function printContract(c) {
  const w = window.open('', '_blank'); if (!w) { toast('Permite ventanas emergentes para imprimir'); return; }
  w.document.write(`<html><head><title>${esc(c.title)}</title><meta charset="utf-8"><style>body{font-family:system-ui,Arial;max-width:720px;margin:40px auto;padding:0 22px;color:#111;line-height:1.55}h1{font-size:23px;margin:0}.muted{color:#666;margin-top:4px}hr{border:none;border-top:1px solid #ccc;margin:18px 0}</style></head><body><h1>${esc(c.title)}</h1><div class="muted">${esc(c.type)} · ${esc(c.date || '')}</div><hr><p><b>Contraparte:</b> ${esc(c.party || '—')}</p>${c.split ? `<p><b>Reparto:</b> ${esc(c.split)}</p>` : ''}<p><b>Términos:</b></p><p style="white-space:pre-wrap">${esc(c.terms || '')}</p><hr><p>Estado: ${c.signed ? 'Firmado' : 'Borrador'}</p><br><br><p>Firma de las partes:</p><p>______________________&nbsp;&nbsp;&nbsp;&nbsp;______________________</p></body></html>`);
  w.document.close(); setTimeout(() => { try { w.print(); } catch (_) {} }, 350);
}

/* =======================================================================
   ANALIZADOR DE AUDIO — tono (key), BPM y análisis (todo client-side)
   ======================================================================= */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_ES = { 'C': 'Do', 'C#': 'Do#', 'D': 'Re', 'D#': 'Re#', 'E': 'Mi', 'F': 'Fa', 'F#': 'Fa#', 'G': 'Sol', 'G#': 'Sol#', 'A': 'La', 'A#': 'La#', 'B': 'Si' };
// Códigos Camelot (mezcla armónica) por [tonica][modo]
const CAMELOT = {
  'C major': '8B', 'C# major': '3B', 'D major': '10B', 'D# major': '5B', 'E major': '12B', 'F major': '7B', 'F# major': '2B', 'G major': '9B', 'G# major': '4B', 'A major': '11B', 'A# major': '6B', 'B major': '1B',
  'C minor': '5A', 'C# minor': '12A', 'D minor': '7A', 'D# minor': '2A', 'E minor': '9A', 'F minor': '4A', 'F# minor': '11A', 'G minor': '6A', 'G# minor': '1A', 'A minor': '8A', 'A# minor': '3A', 'B minor': '10A',
};

// FFT iterativa radix-2 (in-place sobre re[], im[])
function _fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k + half], ai = im[i + k + half];
        const vr = ar * cr - ai * ci, vi = ar * ci + ai * cr;
        const ur = re[i + k], ui = im[i + k];
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// correlación de Pearson
function _pearson(a, b) {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db);
  return den ? num / den : 0;
}

// Detecta tonalidad con perfiles Krumhansl-Schmuckler sobre el cromagrama.
// Claves para que sea fiable con audio real (no solo tonos puros):
//  · normalización por densidad de bins → elimina el sesgo geométrico de la FFT
//    (los bins lineales se reparten desigual entre las 12 notas y, sin esto,
//     el ruido/percusión empuja SIEMPRE hacia La/La#).
//  · selección de picos espectrales → ignora batería, hats y ruido de banda ancha.
//  · compresión logarítmica → evita que los frames muy fuertes dominen.
function detectKey(mono, sr) {
  const N = 8192, hop = 4096;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); // Hann
  const minF = 65, maxF = 1500; // ~C2..~F#6 (fundamentales)
  const kMin = Math.max(2, Math.floor(minF * N / sr));
  const kMax = Math.min(N / 2 - 2, Math.ceil(maxF * N / sr));
  // nota (pitch class) de cada bin + cuántos bins caen en cada nota
  const pcOf = new Int16Array(N / 2), binCount = new Float64Array(12);
  for (let k = kMin; k <= kMax; k++) {
    const f = k * sr / N;
    const pc = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
    pcOf[k] = pc; binCount[pc]++;
  }
  const chroma = new Float64Array(12);
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float64Array(N / 2);
  for (let off = 0; off + N <= mono.length; off += hop) {
    for (let i = 0; i < N; i++) { re[i] = mono[off + i] * win[i]; im[i] = 0; }
    _fft(re, im);
    for (let k = kMin - 1; k <= kMax + 1; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    for (let k = kMin; k <= kMax; k++) {
      const mk = mag[k];
      if (mk > 0 && mk > mag[k - 1] && mk >= mag[k + 1]) chroma[pcOf[k]] += Math.log(1 + mk); // solo picos
    }
  }
  // corrige el sesgo geométrico y normaliza
  for (let i = 0; i < 12; i++) if (binCount[i] > 0) chroma[i] /= binCount[i];
  let mx = 0; for (let i = 0; i < 12; i++) mx = Math.max(mx, chroma[i]);
  if (mx > 0) for (let i = 0; i < 12; i++) chroma[i] /= mx;
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const cand = [];
  for (let t = 0; t < 12; t++) {
    const rot = new Array(12);
    for (let j = 0; j < 12; j++) rot[j] = chroma[(t + j) % 12];
    cand.push({ score: _pearson(rot, major), tonic: t, mode: 'major' });
    cand.push({ score: _pearson(rot, minor), tonic: t, mode: 'minor' });
  }
  cand.sort((a, b) => b.score - a.score);
  const best = cand[0] || { score: -2, tonic: 0, mode: 'major' };
  best.alt = cand[1] || null;          // 2ª tonalidad más probable (suele ser la relativa)
  best.margin = best.alt ? best.score - best.alt.score : 1;
  return best;
}

// Detecta BPM por autocorrelación de la envolvente de onsets
function detectBPM(mono, sr) {
  const H = 512, fps = sr / H;
  const nF = Math.floor(mono.length / H);
  if (nF < 8) return null;
  const env = new Float32Array(nF);
  for (let i = 0; i < nF; i++) { let s = 0; const o = i * H; for (let j = 0; j < H; j++) { const v = mono[o + j] || 0; s += v * v; } env[i] = s; }
  const onset = new Float32Array(nF);
  for (let i = 1; i < nF; i++) { const d = env[i] - env[i - 1]; onset[i] = d > 0 ? d : 0; }
  let mean = 0; for (let i = 0; i < nF; i++) mean += onset[i]; mean /= nF;
  for (let i = 0; i < nF; i++) onset[i] -= mean;
  let best = -Infinity, bestBpm = 120;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = fps * 60 / bpm, l0 = Math.floor(lag), frac = lag - l0;
    if (l0 + 1 >= nF) continue;
    let sum = 0;
    for (let i = 0; i + l0 + 1 < nF; i++) sum += onset[i] * (onset[i + l0] * (1 - frac) + onset[i + l0 + 1] * frac);
    // peso perceptual (resonancia log-gaussiana centrada en ~125 BPM):
    // resuelve los errores de octava prefiriendo el tempo más natural en vez
    // de forzar a la fuerza el rango con divisiones/multiplicaciones.
    const lg = Math.log2(bpm / 125);
    const w = Math.exp(-0.5 * (lg / 0.55) * (lg / 0.55));
    const score = sum * w;
    if (score > best) { best = score; bestBpm = bpm; }
  }
  return Math.round(bestBpm * 10) / 10;
}

// Mezcla a mono y calcula pico, RMS, clipping
function analyzeLevels(buf) {
  const chs = buf.numberOfChannels;
  const len = buf.length;
  const data = [];
  for (let c = 0; c < chs; c++) data.push(buf.getChannelData(c));
  const mono = new Float32Array(len);
  let peak = 0, sumSq = 0, clipped = 0;
  for (let i = 0; i < len; i++) {
    let s = 0; for (let c = 0; c < chs; c++) s += data[c][i];
    s /= chs; mono[i] = s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sumSq += s * s;
    if (a >= 0.992) clipped++;
  }
  const rms = Math.sqrt(sumSq / (len || 1));
  const toDb = (x) => x > 0 ? 20 * Math.log10(x) : -Infinity;
  return { mono, peakDb: toDb(peak), rmsDb: toDb(rms), peak, clipPct: (clipped / (len || 1)) * 100, crest: toDb(peak) - toDb(rms) };
}

function scaleNotes(tonic, mode) {
  const steps = mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  return steps.map(s => NOTE_NAMES[(tonic + s) % 12]).join(' ');
}

async function renderAudioAnalyzer() {
  setActiveNav('ecosystems');
  const main = $('main');
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = `
${toolBar('analyzer', 'Analizador de audio', 'Tono · BPM · volumen — sin salir del navegador', { id: 'anBack', label: 'Workflow' })}
    <div class="an-wrap">
      <div class="dropzone an-dz" id="anDz">
        <svg fill="none" stroke="currentColor"><use href="#i-upload"/></svg>
        <div>Arrastra una canción (MP3/WAV) o haz clic</div>
        <div class="fname" id="anName"></div>
      </div>
      <input type="file" id="anFile" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.wma,.alac" hidden />
      <div id="anResult"></div>
    </div>`;
  $('anBack').onclick = () => switchView('tools');
  const dz = $('anDz'), fi = $('anFile'), res = $('anResult');
  dz.onclick = () => fi.click();
  fi.onchange = () => { if (fi.files[0]) runAnalysis(fi.files[0]); };
  ['dragover', 'dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'dragover') dz.classList.add('drag'); else dz.classList.remove('drag');
    if (ev === 'drop' && e.dataTransfer.files[0]) runAnalysis(e.dataTransfer.files[0]);
  }));

  async function runAnalysis(file) {
    if (!file.type.startsWith('audio') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) { toast('Selecciona un archivo de audio'); return; }
    $('anName').textContent = file.name;
    res.innerHTML = `<div class="loading" style="padding:34px"><div class="spinner"></div><div style="margin-top:10px;color:var(--ink-soft);font-size:13px">Analizando audio…</div></div>`;
    try {
      const arr = await file.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const buf = await ctx.decodeAudioData(arr);
      const sr = buf.sampleRate, dur = buf.duration;
      const { mono, peakDb, rmsDb, clipPct, crest } = analyzeLevels(buf);
      try { ctx.close(); } catch {}
      // limita el análisis pesado a los primeros 120 s (consistencia + velocidad)
      const slice = mono.length > sr * 120 ? mono.subarray(0, sr * 120) : mono;
      await new Promise(r => setTimeout(r, 20)); // deja pintar el spinner
      const key = detectKey(slice, sr);
      const bpm = detectBPM(slice, sr);
      const note = NOTE_NAMES[key.tonic];
      const modeEs = key.mode === 'major' ? 'mayor' : 'menor';
      const camelot = CAMELOT[`${note} ${key.mode}`] || '—';
      const conf = Math.max(0, Math.min(100, Math.round((key.score + 0.2) / 1.0 * 100)));
      const alt = key.alt, altNote = alt ? NOTE_NAMES[alt.tonic] : '';
      const altLabel = alt ? `${altNote}${alt.mode === 'minor' ? 'm' : ''} (${NOTE_ES[altNote]} ${alt.mode === 'major' ? 'mayor' : 'menor'})` : '';
      const showAlt = alt && key.margin < 0.07;
      const peaks = [];
      const n = 120, block = Math.floor(mono.length / n) || 1;
      for (let i = 0; i < n; i++) { let m = 0; const st = i * block; for (let j = 0; j < block; j += 16) { const v = Math.abs(mono[st + j] || 0); if (v > m) m = v; } peaks.push(m); }
      const wmax = Math.max(...peaks) || 1;
      const bars = peaks.map(p => `<span style="height:${Math.max(3, (p / wmax) * 100)}%"></span>`).join('');
      const clipWarn = clipPct > 0.02;
      const target = -14; // referencia streaming (LUFS aprox.)
      const loudHint = rmsDb < -20 ? 'Suena bajo: sube nivel al masterizar.' : rmsDb > -9 ? 'Muy alto: puede saturar en plataformas.' : 'Buen nivel para streaming.';
      res.innerHTML = `
        <div class="an-hero">
          <div class="an-big">
            <div class="an-big-label">TONO (key)</div>
            <div class="an-big-val">${note}${key.mode === 'minor' ? 'm' : ''}</div>
            <div class="an-big-sub">${NOTE_ES[note]} ${modeEs} · Camelot ${camelot}</div>
          </div>
          <div class="an-big">
            <div class="an-big-label">TEMPO</div>
            <div class="an-big-val">${bpm ?? '—'}<small>BPM</small></div>
            <div class="an-big-sub">${dur ? fmtTime(dur) : ''} de duración</div>
          </div>
        </div>
        <div class="an-player">
          <button class="an-play" id="anPlay" aria-label="Reproducir"><svg fill="none" stroke="#fff"><use href="#i-play"/></svg></button>
          <div class="an-wave">${bars}</div>
        </div>
        <div class="an-key-detail">
          <b>Para el autotune:</b> ajusta a <b>${note} ${modeEs}</b>. Notas de la escala: <span class="an-scale">${scaleNotes(key.tonic, key.mode)}</span>
          <span class="an-conf">fiabilidad del tono ~${conf}%${showAlt ? ` · alternativa probable: <b>${altLabel}</b>` : ''}</span>
        </div>
        <div class="an-stats">
          <div class="an-stat"><div class="an-stat-l">Pico</div><div class="an-stat-v ${peakDb > -0.1 ? 'bad' : ''}">${peakDb.toFixed(1)} dBFS</div></div>
          <div class="an-stat"><div class="an-stat-l">Volumen (RMS)</div><div class="an-stat-v">${rmsDb.toFixed(1)} dBFS</div></div>
          <div class="an-stat"><div class="an-stat-l">Rango dinámico</div><div class="an-stat-v">${crest.toFixed(1)} dB</div></div>
          <div class="an-stat"><div class="an-stat-l">Clipping</div><div class="an-stat-v ${clipWarn ? 'bad' : 'good'}">${clipWarn ? clipPct.toFixed(2) + '%' : 'OK'}</div></div>
        </div>
        <div class="an-note">${clipWarn ? '⚠️ Hay clipping (saturación digital): baja el nivel antes de exportar. ' : ''}${loudHint} <span style="opacity:.6">Referencia de plataformas: ~${target} LUFS.</span></div>
        <div class="an-actions">
          <button class="btn sm primary" id="anUpload"><svg fill="none" stroke="#fff"><use href="#i-upload"/></svg> Subir como beat</button>
          <button class="btn sm" id="anCopy"><svg fill="none" stroke="currentColor"><use href="#i-copy"/></svg> Copiar tono + BPM</button>
          <button class="btn sm ghost" id="anAgain"><svg fill="none" stroke="currentColor"><use href="#i-upload"/></svg> Analizar otra</button>
        </div>`;
      const keyTag = `${note}${key.mode === 'minor' ? 'm' : ''}`;
      const summary = `Tono: ${keyTag} (${NOTE_ES[note]} ${modeEs}) · BPM: ${bpm ?? '—'} · Camelot ${camelot}`;
      // reproductor de previsualización
      const prevUrl = URL.createObjectURL(file);
      const prevAudio = new Audio(prevUrl);
      const playBtn = $('anPlay'), playUse = playBtn.querySelector('use');
      prevAudio.onplay = () => playUse.setAttribute('href', '#i-pause');
      prevAudio.onpause = () => playUse.setAttribute('href', '#i-play');
      prevAudio.onended = () => playUse.setAttribute('href', '#i-play');
      playBtn.onclick = () => { if (prevAudio.paused) { try { audio && audio.pause(); } catch {} prevAudio.play(); } else prevAudio.pause(); };
      const cleanup = () => { try { prevAudio.pause(); URL.revokeObjectURL(prevUrl); } catch {} };
      $('anUpload').onclick = () => { cleanup(); openUploadModal({ isBeat: true, bpm: bpm || '', key: keyTag, title: file.name.replace(/\.[^.]+$/, '') }); };
      $('anCopy').onclick = () => { try { navigator.clipboard.writeText(summary); toast('Copiado ✓ ' + summary); } catch { toast('No se pudo copiar'); } };
      $('anAgain').onclick = () => { cleanup(); fi.value = ''; $('anName').textContent = ''; res.innerHTML = ''; };
    } catch (err) {
      console.error(err);
      res.innerHTML = `<div class="an-note bad">No se pudo analizar el archivo. Prueba con un MP3 o WAV estándar.</div>`;
    }
  }
}

let pkState = null;
let pkAudio = null;

async function pkLoadOrDefault() {
  const uid = state.user.id;
  const { data: saved } = await sb.from('press_kits').select('data,published').eq('user_id', uid).maybeSingle();
  const p = state.profile;
  const theme = (p.theme && typeof p.theme === 'object') ? p.theme : {};
  const profLinks = (Array.isArray(theme.links) ? theme.links : []).map(l => ({ label: l.label || '', url: l.url || '' }));
  const [{ data: tracks }, foll] = await Promise.all([
    sb.from('tracks').select('id,title,cover_url,audio_url,genre,plays').eq('user_id', uid).order('plays', { ascending: false }).limit(30),
    sb.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', uid),
  ]);
  const tr = (tracks || []);
  const allTracks = tr.map(t => ({ id: t.id, title: t.title, cover_url: t.cover_url || '', audio_url: t.audio_url || '' }));
  const totalPlays = tr.reduce((a, t) => a + (t.plays || 0), 0);
  // valores guardados (si los hay)
  if (saved && saved.data && Object.keys(saved.data).length) {
    const d = saved.data;
    d.allTracks = allTracks;                 // refrescar catálogo para el selector
    d.links = profLinks;                     // enlaces siempre desde el perfil
    d.stats = { followers: foll.count || 0, plays: totalPlays, tracks: tr.length };
    if (!Array.isArray(d.external)) d.external = [];
    if (!Array.isArray(d.quotes)) d.quotes = [];
    if (!d.sections) d.sections = { stats: true, bio: true, highlights: true, tracks: true, contact: true, links: true, external: true, quotes: true };
    d.published = !!saved.published;
    return d;
  }
  const genres = [...new Set(tr.map(t => (t.genre || '').trim()).filter(Boolean))].slice(0, 4).join(', ');
  return {
    name: p.display_name || p.username, tagline: theme.tagline || '', location: '', genres,
    bioShort: (p.bio || '').slice(0, 200), bioLong: p.bio || '',
    avatar: p.avatar_url || '', banner: czUrl(theme.banner) || '',
    contactEmail: '', booking: '', management: '',
    highlights: [],
    external: [
      { label: 'Spotify · oyentes mensuales', value: '' },
      { label: 'Instagram · seguidores', value: '' },
      { label: 'Reproducciones totales', value: '' },
    ],
    quotes: [],
    links: profLinks,
    showStats: true, stats: { followers: foll.count || 0, plays: totalPlays, tracks: tr.length },
    tracks: allTracks.slice(0, 4),
    allTracks,
    accent: czColor(theme.accent) || '#3e57fc', template: 'dark',
    sections: { stats: true, bio: true, highlights: true, tracks: true, contact: true, links: true, external: true, quotes: true },
    published: false,
  };
}

async function renderPressKit() {
  setActiveNav('ecosystems');
  const main = $('main');
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = `${toolBar('presskit', 'Press Kit / EPK', 'Tu dossier de artista')}<div class="loading" style="padding:40px"><div class="spinner"></div></div>`;
  pkState = await pkLoadOrDefault();
  const k = pkState;
  const tpls = [['dark', 'Oscuro'], ['light', 'Claro'], ['gradient', 'Degradado']];
  main.innerHTML = `
${toolBar('presskit', 'Press Kit / EPK', 'Edita a la izquierda, mira el resultado a la derecha', { id: 'pkBack', label: 'Workflow' })}
    <div class="pk-builder">
      <div class="pk-form">
        <div class="pk-fsec"><h4>Identidad</h4>
          <label class="pk-l">Nombre artístico</label><input class="pk-in" data-k="name" value="${esc(k.name || '')}" maxlength="60" />
          <label class="pk-l">Eslogan / frase</label><input class="pk-in" data-k="tagline" value="${esc(k.tagline || '')}" maxlength="100" placeholder="Ej: Trap melódico desde Madrid" />
          <div class="pk-row2">
            <div><label class="pk-l">Ubicación</label><input class="pk-in" data-k="location" value="${esc(k.location || '')}" maxlength="60" placeholder="Ciudad, país" /></div>
            <div><label class="pk-l">Géneros</label><input class="pk-in" data-k="genres" value="${esc(k.genres || '')}" maxlength="80" placeholder="Trap, R&B" /></div>
          </div>
        </div>
        <div class="pk-fsec"><h4>Biografía</h4>
          <label class="pk-l">Bio corta (1–2 frases)</label><textarea class="pk-in" data-k="bioShort" maxlength="280" rows="2">${esc(k.bioShort || '')}</textarea>
          <label class="pk-l">Bio larga</label><textarea class="pk-in" data-k="bioLong" maxlength="1500" rows="5">${esc(k.bioLong || '')}</textarea>
        </div>
        <div class="pk-fsec"><h4>Hitos / logros <span class="pk-hint2">una línea por hito</span></h4>
          <textarea class="pk-in" data-k="highlights" rows="4" placeholder="+50.000 reproducciones&#10;Telonero en Sala X&#10;Reseñado por...">${esc((k.highlights || []).join('\n'))}</textarea>
        </div>
        <div class="pk-fsec"><h4>Estadísticas globales <span class="pk-hint2">tu presencia en todas las apps e Internet</span></h4>
          <p class="pk-hint2" style="margin:0 0 8px">Esto es lo principal de tu press kit: tus números reales como artista en cualquier plataforma — Spotify, Instagram, SoundCloud, YouTube, TikTok, oyentes mensuales, totales… Escribe la etiqueta y el valor.</p>
          <div id="pkExtRows" class="pk-ext-rows"></div>
          <button type="button" class="btn sm" id="pkExtAdd">+ Añadir cifra</button>
        </div>
        <div class="pk-fsec"><h4>Prensa / reseñas <span class="pk-hint2">citas de medios o personas</span></h4>
          <p class="pk-hint2" style="margin:0 0 8px">Frases de medios, blogs, salas o profesionales que han hablado de ti.</p>
          <div id="pkQuoteRows" class="pk-q-rows"></div>
          <button type="button" class="btn sm" id="pkQuoteAdd">+ Añadir cita</button>
        </div>
        <div class="pk-fsec"><h4>Pistas destacadas <span class="pk-hint2">elige cuáles mostrar</span></h4>
          <div class="pk-tracks-pick">
            ${(k.allTracks || []).length ? k.allTracks.map(t => `<label class="pk-tk"><input type="checkbox" data-tk="${esc(t.id)}" ${k.tracks.some(x => x.id === t.id) ? 'checked' : ''}/> <span>${esc(t.title)}</span></label>`).join('') : '<p class="pk-hint2">Sube pistas para destacarlas aquí.</p>'}
          </div>
        </div>
        <div class="pk-fsec"><h4>Contacto / booking</h4>
          <label class="pk-l">Email de contacto</label><input class="pk-in" data-k="contactEmail" value="${esc(k.contactEmail || '')}" maxlength="120" placeholder="booking@tucorreo.com" />
          <label class="pk-l">Management / sello</label><input class="pk-in" data-k="management" value="${esc(k.management || '')}" maxlength="120" placeholder="Nombre del management (opcional)" />
          <label class="pk-l">Teléfono / booking</label><input class="pk-in" data-k="booking" value="${esc(k.booking || '')}" maxlength="120" placeholder="Tel. o web de contratación (opcional)" />
        </div>
        <div class="pk-fsec"><h4>Diseño</h4>
          <label class="pk-l">Color de acento</label>
          <div class="pk-color"><input type="color" data-k="accent" value="${czColor(k.accent) || '#3e57fc'}" /><span>${esc(k.accent || '#3e57fc')}</span></div>
          <label class="pk-l">Plantilla</label>
          <div class="pk-tpls">${tpls.map(([v, n]) => `<button type="button" class="pk-tpl ${k.template === v ? 'on' : ''}" data-tpl="${v}">${n}</button>`).join('')}</div>
          <label class="pk-l">Secciones visibles</label>
          <div class="pk-toggles">
            ${[['external', 'Estadísticas globales'], ['stats', 'Cifras en UnderBro'], ['bio', 'Biografía'], ['highlights', 'Hitos'], ['quotes', 'Prensa'], ['tracks', 'Pistas'], ['links', 'Enlaces'], ['contact', 'Contacto']].map(([s, n]) => `<label class="pk-tg"><input type="checkbox" data-sec="${s}" ${k.sections[s] !== false ? 'checked' : ''}/> ${n}</label>`).join('')}
          </div>
        </div>
        <div class="pk-actions">
          <button class="btn primary" id="pkSave"><svg fill="none" stroke="#fff"><use href="#i-globe"/></svg> Guardar y publicar</button>
          <button class="btn" id="pkPdf"><svg fill="none" stroke="currentColor"><use href="#i-download"/></svg> Descargar PDF</button>
        </div>
        <div class="pk-publish">
          <p class="pk-hint2" id="pkPubNote">${pkState.published ? '🌐 Tu press kit está público. Comparte el enlace con salas y sellos.' : 'Pulsa “Guardar y publicar” para obtener una web compartible, o usa “Descargar PDF” sin publicar nada.'}</p>
          <div class="pk-pub-row ${pkState.published ? '' : 'hidden'}" id="pkPubRow">
            <button class="btn sm" id="pkShare"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg> Copiar enlace</button>
            <button class="btn sm" id="pkView"><svg fill="none" stroke="currentColor"><use href="#i-globe"/></svg> Ver público</button>
            <button class="btn sm" id="pkPriv">Hacer privado</button>
          </div>
        </div>
      </div>
      <div class="pk-preview-wrap">
        <div class="pk-preview-label">Vista previa</div>
        <div id="pkPreview" class="pk-preview"></div>
      </div>
    </div>`;

  $('pkBack').onclick = () => switchView('tools');
  // bind inputs de texto
  main.querySelectorAll('.pk-in[data-k]').forEach(inp => inp.addEventListener('input', () => {
    const key = inp.dataset.k;
    if (key === 'highlights') pkState.highlights = inp.value.split('\n').map(s => s.trim()).filter(Boolean);
    else pkState[key] = inp.value;
    if (key === 'accent') { const sp = inp.parentElement.querySelector('span'); if (sp) sp.textContent = inp.value; }
    pkRenderPreview();
  }));
  // pistas
  main.querySelectorAll('input[data-tk]').forEach(cb => cb.onchange = () => {
    const id = cb.dataset.tk; const t = (pkState.allTracks || []).find(x => x.id === id);
    if (cb.checked) { if (t && !pkState.tracks.some(x => x.id === id)) pkState.tracks.push(t); }
    else pkState.tracks = pkState.tracks.filter(x => x.id !== id);
    pkRenderPreview();
  });
  // plantilla
  main.querySelectorAll('.pk-tpl').forEach(b => b.onclick = () => {
    pkState.template = b.dataset.tpl;
    main.querySelectorAll('.pk-tpl').forEach(x => x.classList.toggle('on', x === b));
    pkRenderPreview();
  });
  // secciones
  main.querySelectorAll('input[data-sec]').forEach(cb => cb.onchange = () => {
    pkState.sections[cb.dataset.sec] = cb.checked; pkRenderPreview();
  });
  // cifras externas (Spotify, Instagram, SoundCloud… genérico) con detección de plataforma
  if (!Array.isArray(pkState.external)) pkState.external = [];
  const extBox = $('pkExtRows');
  const extDot = (label) => { const b = pkBrand(label); return `<span class="pk-ext-dot" style="background:${b ? b.color : 'var(--accent)'}" title="${b ? esc(b.name) : 'Otra plataforma'}"></span>`; };
  const renderExtRows = () => {
    extBox.innerHTML = pkState.external.map((row, i) => `
      <div class="pk-ext-row" data-i="${i}">
        <span class="pk-ext-dotwrap" data-i="${i}">${extDot(row.label)}</span>
        <input class="pk-ext-lbl" data-i="${i}" value="${esc(row.label || '')}" maxlength="40" placeholder="Spotify · oyentes mensuales" />
        <input class="pk-ext-val" data-i="${i}" value="${esc(row.value || '')}" maxlength="20" placeholder="1.2M" />
        <button type="button" class="pk-ext-del" data-i="${i}" aria-label="Eliminar">×</button>
      </div>`).join('') || '<p class="pk-hint2">Aún no has añadido cifras.</p>';
    extBox.querySelectorAll('.pk-ext-lbl').forEach(inp => inp.oninput = () => {
      const i = +inp.dataset.i; pkState.external[i].label = inp.value;
      const dw = extBox.querySelector(`.pk-ext-dotwrap[data-i="${i}"]`); if (dw) dw.innerHTML = extDot(inp.value);
      pkRenderPreview();
    });
    extBox.querySelectorAll('.pk-ext-val').forEach(inp => inp.oninput = () => { pkState.external[+inp.dataset.i].value = inp.value; pkRenderPreview(); });
    extBox.querySelectorAll('.pk-ext-del').forEach(b => b.onclick = () => { pkState.external.splice(+b.dataset.i, 1); renderExtRows(); pkRenderPreview(); });
  };
  renderExtRows();
  $('pkExtAdd').onclick = () => { pkState.external.push({ label: '', value: '' }); renderExtRows(); pkRenderPreview(); };
  // prensa / reseñas
  if (!Array.isArray(pkState.quotes)) pkState.quotes = [];
  const qBox = $('pkQuoteRows');
  const renderQRows = () => {
    qBox.innerHTML = pkState.quotes.map((row, i) => `
      <div class="pk-q-row" data-i="${i}">
        <textarea class="pk-q-text" data-i="${i}" rows="2" maxlength="280" placeholder="“Una de las voces más prometedoras del año.”">${esc(row.text || '')}</textarea>
        <div class="pk-q-foot">
          <input class="pk-q-src" data-i="${i}" value="${esc(row.source || '')}" maxlength="80" placeholder="Medio o autor (ej: Rolling Stone)" />
          <button type="button" class="pk-ext-del" data-i="${i}" aria-label="Eliminar">×</button>
        </div>
      </div>`).join('') || '<p class="pk-hint2">Aún no has añadido citas.</p>';
    qBox.querySelectorAll('.pk-q-text').forEach(inp => inp.oninput = () => { pkState.quotes[+inp.dataset.i].text = inp.value; pkRenderPreview(); });
    qBox.querySelectorAll('.pk-q-src').forEach(inp => inp.oninput = () => { pkState.quotes[+inp.dataset.i].source = inp.value; pkRenderPreview(); });
    qBox.querySelectorAll('.pk-ext-del').forEach(b => b.onclick = () => { pkState.quotes.splice(+b.dataset.i, 1); renderQRows(); pkRenderPreview(); });
  };
  renderQRows();
  $('pkQuoteAdd').onclick = () => { pkState.quotes.push({ text: '', source: '' }); renderQRows(); pkRenderPreview(); };
  const pkSyncPub = () => {
    $('pkPubRow').classList.toggle('hidden', !pkState.published);
    $('pkPubNote').innerHTML = pkState.published
      ? '🌐 Tu press kit está público. Comparte el enlace con salas y sellos.'
      : 'Pulsa “Guardar y publicar” para obtener una web compartible, o usa “Descargar PDF” sin publicar nada.';
  };
  $('pkSave').onclick = async () => { pkState.published = true; await pkSave(); pkSyncPub(); };
  $('pkPriv').onclick = async () => { pkState.published = false; await pkSave(true); pkSyncPub(); };
  $('pkShare').onclick = () => { const u = pkPublicUrl(); navigator.clipboard?.writeText(u).then(() => toast('Enlace copiado: ' + u)).catch(() => toast(u)); };
  $('pkView').onclick = () => window.open(pkPublicUrl(), '_blank');
  $('pkPdf').onclick = pkDownloadPdf;
  pkRenderPreview();
  mountBuilderTabs();
}

// Conmutador móvil "Editar / Vista previa" para los builders de herramientas.
// En escritorio no se muestra (se ve form + preview a la vez).
function mountBuilderTabs() {
  const b = document.querySelector('.pk-builder');
  if (!b || b.previousElementSibling?.classList?.contains('pk-tabs')) return;
  const tabs = el(`<div class="pk-tabs">
    <button class="on" data-pt="edit">Editar</button>
    <button data-pt="prev">Vista previa</button>
  </div>`);
  b.parentNode.insertBefore(tabs, b);
  tabs.querySelectorAll('button').forEach(btn => btn.onclick = () => {
    tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
    b.classList.toggle('show-preview', btn.dataset.pt === 'prev');
    try { b.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch {}
  });
}

// imprime/descarga SOLO el press kit (iframe aislado, sin el resto de la app)
function pkDownloadPdf() {
  const cssHref = (document.querySelector('link[rel="stylesheet"]') || {}).href || '/css/styles.css';
  const html = pressKitHTML(pkState);
  const name = (pkState && pkState.name) ? pkState.name : 'press-kit';
  const ifr = document.createElement('iframe');
  ifr.setAttribute('aria-hidden', 'true');
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
  document.body.appendChild(ifr);
  const d = ifr.contentWindow.document;
  d.open();
  d.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>${esc(name)} — Press Kit</title>
    <link rel="stylesheet" href="${esc(cssHref)}">
    <style>
      html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      .pk{max-width:100%;border-radius:0;}
      .pk-tk-play{display:none !important;}
      @page{margin:12mm;}
    </style></head><body>${html}</body></html>`);
  d.close();
  let done = false;
  const go = () => {
    if (done) return; done = true;
    try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (_) {}
    setTimeout(() => ifr.remove(), 1500);
  };
  // espera a que cargue la hoja de estilos enlazada antes de imprimir
  ifr.onload = () => setTimeout(go, 350);
  setTimeout(go, 1200); // respaldo por si onload no dispara (document.write)
  toast('Preparando PDF… elige "Guardar como PDF"');
}

function pkPublicUrl() { return location.origin + '/?kit=' + encodeURIComponent(state.profile.username || ''); }

function pkRenderPreview() {
  const box = $('pkPreview'); if (!box) return;
  box.innerHTML = pressKitHTML(pkState);
  pkWireAudio(box);
}

async function pkSave(fromToggle) {
  const btn = $('pkSave'); btn.disabled = true;
  const pub = !!pkState.published;
  const out = JSON.parse(JSON.stringify(pkState)); delete out.allTracks; // no hace falta persistir el catálogo
  out.updatedAt = new Date().toISOString();
  const { error } = await sb.from('press_kits').upsert({
    user_id: state.user.id, slug: state.profile.username, data: out, published: pub, updated_at: out.updatedAt,
  }, { onConflict: 'user_id' });
  btn.disabled = false;
  if (error) { toast('No se pudo guardar'); return; }
  toast(fromToggle ? 'Ahora es privado · solo tú lo ves'
                   : '🌐 Press kit guardado y publicado');
  if (!fromToggle) { btn.innerHTML = '✓ Publicado'; setTimeout(() => { btn.innerHTML = '<svg fill="none" stroke="#fff"><use href="#i-globe"/></svg> Guardar y publicar'; }, 2200); }
}

/* ---- estadísticas globales: detección de plataforma + utilidades ---- */
const PK_BRANDS = [
  { re: /spotify/i, name: 'Spotify', color: '#1DB954', svg: '<path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.36-.66.48-1.021.24-2.82-1.74-6.36-2.1-10.561-1.14-.418.12-.84-.18-.96-.6-.12-.42.18-.84.6-.96 4.56-1.02 8.52-.6 11.64 1.32.42.18.479.66.302 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14C9.6 9.9 15 10.56 18.72 12.84c.36.18.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.721 1.62.539.3.719 1.02.42 1.56-.299.42-1.02.6-1.559.3z"/>' },
  { re: /instagram|insta\b/i, name: 'Instagram', color: '#E4405F', svg: '<path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.64.07 4.85 0 3.2-.01 3.58-.07 4.85-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07-3.2 0-3.58-.01-4.85-.07-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12c0-3.2.01-3.58.07-4.85.15-3.23 1.66-4.77 4.92-4.92C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12c0 3.26.01 3.67.07 4.95.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24c3.26 0 3.67-.01 4.95-.07 4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95 0-3.26-.01-3.67-.07-4.95-.2-4.35-2.62-6.78-6.98-6.98C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 100 12.32 6.16 6.16 0 000-12.32zM12 16a4 4 0 110-8 4 4 0 010 8zm6.41-11.85a1.44 1.44 0 100 2.88 1.44 1.44 0 000-2.88z"/>' },
  { re: /youtube|yt\b/i, name: 'YouTube', color: '#FF0000', svg: '<path d="M23.5 6.19a3.02 3.02 0 00-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 00.5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 002.12 2.14c1.87.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 002.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z"/>' },
  { re: /tik\s?tok/i, name: 'TikTok', color: '#111', svg: '<path d="M12.53.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>' },
  { re: /x\b|twitter/i, name: 'X', color: '#111', svg: '<path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z"/>' },
  { re: /facebook|fb\b/i, name: 'Facebook', color: '#1877F2', svg: '<path d="M24 12.07C24 5.44 18.63.07 12 .07S0 5.44 0 12.07c0 5.99 4.39 10.95 10.13 11.85v-8.38H7.08v-3.47h3.05V9.43c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87v2.25h3.33l-.53 3.47h-2.8v8.38C19.61 23.02 24 18.06 24 12.07z"/>' },
  { re: /soundcloud|sound\s?cloud/i, name: 'SoundCloud', color: '#FF5500', svg: '<path d="M1.18 11.3c-.07 0-.13.05-.14.13l-.27 2.16.27 2.11c0 .08.07.13.14.13.07 0 .13-.05.14-.13l.31-2.11-.31-2.16c-.01-.08-.07-.13-.14-.13zm1.46-.66c-.08 0-.14.06-.15.15l-.33 2.8.33 2.73c.01.09.07.15.15.15.08 0 .15-.06.15-.15l.37-2.73-.37-2.8c0-.09-.07-.15-.15-.15zm10.7-3.32c-.27 0-.53.05-.77.13-.16-1.86-1.72-3.32-3.62-3.32-.47 0-.92.09-1.32.25-.16.06-.2.12-.2.24v9.5c0 .12.09.22.21.23h5.7c1.14 0 2.06-.92 2.06-2.06 0-1.13-.92-2.05-2.06-2.05zM6.3 7.84c-.09 0-.16.07-.17.17l-.31 4.96.31 2.71c.01.1.08.16.17.16.08 0 .15-.06.16-.16l.36-2.71-.36-4.96c-.01-.1-.08-.17-.16-.17zm-1.48.33c-.08 0-.15.06-.16.16l-.29 4.64.29 2.71c.01.1.08.16.16.16.08 0 .15-.06.16-.16l.33-2.71-.33-4.64c-.01-.1-.08-.16-.16-.16zm-1.47.4c-.08 0-.14.06-.15.15l-.27 4.25.27 2.72c.01.09.07.15.15.15.08 0 .14-.06.15-.15l.31-2.72-.31-4.25c-.01-.09-.07-.15-.15-.15z"/>' },
  { re: /apple\s?music|itunes/i, name: 'Apple Music', color: '#FA243C', svg: '<path d="M23.99 6.12c0-.51-.05-1.03-.15-1.53a4.6 4.6 0 00-.51-1.36 4.3 4.3 0 00-1.9-1.78A5.1 5.1 0 0019.7.97c-.5-.07-1-.1-1.5-.11H5.8c-.5.01-1 .04-1.5.11a5.1 5.1 0 00-1.73.48 4.3 4.3 0 00-1.9 1.78A4.6 4.6 0 00.16 4.6c-.1.5-.15 1.02-.15 1.53L0 6.86v10.27l.01.75c0 .51.05 1.03.15 1.53.1.47.27.93.51 1.36a4.3 4.3 0 001.9 1.78c.54.26 1.13.41 1.73.48.5.07 1 .1 1.5.11h12.4c.5-.01 1-.04 1.5-.11a5.1 5.1 0 001.73-.48 4.3 4.3 0 001.9-1.78c.24-.43.41-.89.51-1.36.1-.5.15-1.02.15-1.53l.01-.75V6.86l-.01-.74zM17.6 9.04v6.36c0 .42-.04.83-.27 1.2-.23.36-.55.6-.94.75-.4.15-.8.2-1.22.13a1.86 1.86 0 01-1.5-1.53c-.13-.74.16-1.5.8-1.92.32-.2.68-.3 1.05-.36l.84-.16c.16-.04.27-.13.3-.3l.01-.1V7.3c0-.06 0-.12-.04-.16-.06-.1-.16-.12-.27-.1l-.2.04-5.7 1.15-.2.05c-.16.05-.24.16-.25.33v8.1c0 .42-.04.83-.27 1.2-.23.36-.55.6-.94.75-.4.15-.8.2-1.22.13a1.86 1.86 0 01-1.5-1.53c-.13-.74.16-1.5.8-1.92.32-.2.68-.3 1.05-.36l.84-.16c.16-.04.27-.13.3-.3V6.5c0-.3.07-.46.5-.55l7.1-1.43c.07-.01.16-.03.24-.03.24 0 .4.16.43.4l.01.15z"/>' },
  { re: /twitch/i, name: 'Twitch', color: '#9146FF', svg: '<path d="M11.57 4.43v4.28h-1.43V4.43h1.43zm3.93 0v4.28h-1.43V4.43h1.43zM4.29 0L.71 3.57v16.86h4.29V24l3.57-3.57h2.86L17.86 14V0H4.29zm12.14 13.29l-2.86 2.85h-2.86l-2.5 2.5v-2.5H4.64V1.43h11.79v11.86z"/>' },
  { re: /deezer/i, name: 'Deezer', color: '#A238FF', svg: '<path d="M18.81 4.16h5.19v3.03h-5.19V4.16zM0 16.84h5.19v3.03H0v-3.03zm6.27 0h5.19v3.03H6.27v-3.03zm6.27 0h5.19v3.03h-5.19v-3.03zm6.27 0H24v3.03h-5.19v-3.03zm0-4.23H24v3.03h-5.19v-3.03zm-6.27 0h5.19v3.03h-5.19v-3.03zm0-4.22h5.19v3.03h-5.19V8.39zm6.27 0H24v3.03h-5.19V8.39z"/>' },
  { re: /tidal/i, name: 'Tidal', color: '#111', svg: '<path d="M12.01 3.99L8.02 7.98 4.03 3.99 0 8.02l4.03 4.03 3.99-3.99 3.99 3.99-3.99 3.99 4.03 4.03 4.03-4.03-3.99-3.99 3.99-3.99-4.1-4.07zm7.96.04l-3.99 3.99 3.99 3.99L24 7.98l-4.03-3.95z"/>' },
  { re: /bandcamp/i, name: 'Bandcamp', color: '#629AA9', svg: '<path d="M0 18.75l7.437-13.5H24l-7.437 13.5z"/>' },
  { re: /threads/i, name: 'Threads', color: '#111', svg: '<path d="M12.19 0h-.38C5.46.04.5 5.05.5 11.99c0 6.96 4.98 11.97 11.32 12.01h.38c3.27-.02 5.79-1.1 7.62-3.19 1.59-1.82 2.41-4.33 2.44-7.46-.03-2.6-.74-4.66-2.1-6.13-1.02-1.1-2.46-1.87-4.18-2.24.08-.96-.06-1.79-.42-2.46C14.99.97 13.69.4 12.19 0zm.78 11.07c.95.06 1.7.34 2.2.83.45.44.68 1.03.68 1.74-.04 1.84-1.46 2.79-3.43 2.79-1.4-.01-2.5-.6-2.96-1.6-.18-.39-.06-.86.27-1.04.34-.18.86-.06 1.04.27.21.45.74.76 1.66.77 1.27 0 1.85-.5 1.86-1.21 0-.31-.12-.55-.32-.74-.27-.26-.74-.43-1.32-.46-.4-.02-.85.01-1.31.09z"/>' },
  { re: /amazon/i, name: 'Amazon Music', color: '#00A8E1', svg: '<path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm0 4.5c2.9 0 5.25 2.35 5.25 5.25v3a5.25 5.25 0 01-10.5 0v-3C6.75 6.85 9.1 4.5 12 4.5zm0 1.5a3.75 3.75 0 00-3.75 3.75v3a3.75 3.75 0 007.5 0v-3A3.75 3.75 0 0012 6zm0 1.5a2.25 2.25 0 012.25 2.25v3a2.25 2.25 0 01-4.5 0v-3A2.25 2.25 0 0112 7.5z"/>' },
  { re: /audiomack/i, name: 'Audiomack', color: '#FFA200', svg: null },
  { re: /beatport/i, name: 'Beatport', color: '#A6CE39', svg: null },
];
function pkBrand(label) { const s = label || ''; for (const b of PK_BRANDS) if (b.re.test(s)) return b; return null; }
function pkMetricIcon(label) {
  const s = (label || '').toLowerCase();
  if (/(seguidor|follower|suscrip|subscrib|fan)/.test(s)) return 'i-people';
  if (/(reproduc|play|stream|oyente|listen|escucha)/.test(s)) return 'i-headphones';
  if (/(visualizac|view|vista)/.test(s)) return 'i-play';
  if (/(like|me gusta|favorit|guardado|save)/.test(s)) return 'i-heart';
  if (/(mensual|monthly)/.test(s)) return 'i-chart';
  return 'i-globe';
}
// parsea "1.2M" / "350k" / "12,5K" / "1 200 000" / "1.200.000" → número
function pkParseNum(v) {
  if (!v) return null;
  let s = String(v).trim().toLowerCase().replace(/\s/g, '');
  const suf = (s.match(/([kmb])\s*$/) || [])[1] || '';
  s = s.replace(/[kmb]\s*$/, '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // el último separador es el decimal; el otro son miles
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // coma sola: miles si forma grupos de 3, si no decimal
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot) {
    // punto solo: miles si forma grupos de 3, si no decimal
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  let n = parseFloat(s); if (isNaN(n)) return null;
  if (suf === 'k') n *= 1e3; else if (suf === 'm') n *= 1e6; else if (suf === 'b') n *= 1e9;
  return n;
}
function pkStatGlyph(label) {
  const b = pkBrand(label);
  if (b && b.svg) return `<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true">${b.svg}</svg>`;
  return `<svg fill="none" stroke="#fff" aria-hidden="true"><use href="#${pkMetricIcon(label)}"/></svg>`;
}
function pkStatColor(label) { const b = pkBrand(label); return b ? b.color : 'var(--pk-accent)'; }

/* ---- render del press kit (preview + público) ---- */
function pressKitHTML(k) {
  if (!k) return '';
  const accent = czColor(k.accent) || '#3e57fc';
  const sec = k.sections || {};
  const banner = czUrl(k.banner);
  const meta = [k.location, k.genres].filter(Boolean).map(esc).join(' · ');
  const initials = (k.name || '?').trim().slice(0, 2).toUpperCase();
  const av = czUrl(k.avatar)
    ? `<div class="pk-av" style="background-image:url('${czUrl(k.avatar)}')"></div>`
    : `<div class="pk-av pk-av-ph">${esc(initials)}</div>`;
  const stats = (sec.stats !== false && k.stats) ? `
    <div class="pk-stats pk-stats-sec">
      <div class="pk-stats-cap">En UnderBro</div>
      <div class="pk-stats-row">
        <div><b>${nfmt(k.stats.followers)}</b><span>seguidores</span></div>
        <div><b>${nfmt(k.stats.plays)}</b><span>reproducciones</span></div>
        <div><b>${nfmt(k.stats.tracks)}</b><span>pistas</span></div>
      </div>
    </div>` : '';
  const extRows = (k.external || []).filter(e => e && (e.value || '').trim());
  // alcance combinado: suma de métricas de audiencia (seguidores / oyentes / fans)
  let combined = 0, combinedCount = 0;
  extRows.forEach(e => {
    if (/(seguidor|follower|fan|suscrip|subscrib|oyente|listener|monthly|mensual)/i.test(e.label || '')) {
      const n = pkParseNum(e.value); if (n) { combined += n; combinedCount++; }
    }
  });
  const reachHero = (combinedCount >= 2) ? `
    <div class="pk-reach"><div class="pk-reach-n">${nfmt(Math.round(combined))}</div><div class="pk-reach-l">audiencia combinada en todas las plataformas</div></div>` : '';
  const external = (sec.external !== false && extRows.length) ? `
    <section class="pk-sec pk-ext-sec"><h3>Presencia global</h3>
      ${reachHero}
      <div class="pk-ext">${extRows.map(e => {
        const lbl = (e.label || '').trim(); const b = pkBrand(lbl);
        return `<div class="pk-ext-card" style="--c:${pkStatColor(lbl)}">
          <span class="pk-ext-ic">${pkStatGlyph(lbl)}</span>
          <b>${esc((e.value || '').trim())}</b>
          <span class="pk-ext-lb">${esc(lbl)}</span>
          ${b ? `<span class="pk-ext-pl">${esc(b.name)}</span>` : ''}
        </div>`;
      }).join('')}</div>
    </section>` : '';
  const bioText = (k.bioLong || k.bioShort || '').trim();
  const bio = (sec.bio !== false && bioText) ? `<section class="pk-sec"><h3>Biografía</h3><p class="pk-bio">${esc(bioText).replace(/\n/g, '<br>')}</p></section>` : '';
  const hl = (sec.highlights !== false && (k.highlights || []).length) ? `<section class="pk-sec"><h3>Hitos</h3><ul class="pk-hl">${k.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul></section>` : '';
  const qRows = (k.quotes || []).filter(q => q && (q.text || '').trim());
  const quotes = (sec.quotes !== false && qRows.length) ? `<section class="pk-sec"><h3>Prensa</h3><div class="pk-quotes">${qRows.map(q => `
      <blockquote class="pk-quote"><p>${esc((q.text || '').trim())}</p>${(q.source || '').trim() ? `<cite>— ${esc((q.source || '').trim())}</cite>` : ''}</blockquote>`).join('')}</div></section>` : '';
  const tracks = (sec.tracks !== false && (k.tracks || []).length) ? `<section class="pk-sec"><h3>Pistas destacadas</h3><div class="pk-tracks">${k.tracks.map(t => `
      <div class="pk-track">
        <div class="pk-tk-cover" style="${czUrl(t.cover_url) ? `background-image:url('${czUrl(t.cover_url)}')` : ''}">${czUrl(t.cover_url) ? '' : '<svg fill="none" stroke="#fff"><use href="#i-music"/></svg>'}</div>
        <div class="pk-tk-title">${esc(t.title || 'Pista')}</div>
        ${czHref(t.audio_url) ? `<button class="pk-tk-play" data-pkplay="${esc(czHref(t.audio_url))}" aria-label="Reproducir"><svg class="ci-play"><use href="#i-play"/></svg><svg class="ci-pause"><use href="#i-pause"/></svg></button>` : ''}
      </div>`).join('')}</div></section>` : '';
  const links = (sec.links !== false && (k.links || []).length) ? `<section class="pk-sec"><h3>Enlaces</h3><div class="pk-links">${k.links.filter(l => l.url).map(l => `<a href="${esc(czHref(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label || hostOf(l.url))}</a>`).join('')}</div></section>` : '';
  const contactBits = [];
  if (k.contactEmail) contactBits.push(`<div><span>Email</span><a href="mailto:${esc(k.contactEmail)}">${esc(k.contactEmail)}</a></div>`);
  if (k.management) contactBits.push(`<div><span>Management</span><b>${esc(k.management)}</b></div>`);
  if (k.booking) contactBits.push(`<div><span>Booking</span><b>${esc(k.booking)}</b></div>`);
  const contact = (sec.contact !== false && contactBits.length) ? `<section class="pk-sec"><h3>Contacto</h3><div class="pk-contact">${contactBits.join('')}</div></section>` : '';
  return `
    <article class="pk tpl-${esc(k.template || 'dark')}" style="--pk-accent:${accent}">
      <header class="pk-hero ${banner ? 'has-banner' : ''}">
        ${banner ? `<div class="pk-banner" style="background-image:url('${banner}')"></div>` : ''}
        <div class="pk-hero-in">
          ${av}
          <div class="pk-id">
            <h1 class="pk-name">${esc(k.name || 'Tu nombre')}</h1>
            ${k.tagline ? `<div class="pk-tag">${esc(k.tagline)}</div>` : ''}
            ${meta ? `<div class="pk-meta">${meta}</div>` : ''}
          </div>
        </div>
      </header>
      <div class="pk-body">
        ${external}${stats}${bio}${hl}${quotes}${tracks}${links}${contact}
      </div>
      <footer class="pk-foot">Press kit creado con <b>UnderBro</b> · underbro.app</footer>
    </article>`;
}

function pkWireAudio(scope) {
  scope.querySelectorAll('[data-pkplay]').forEach(btn => btn.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const url = btn.dataset.pkplay;
    if (pkAudio && pkAudio._btn === btn) { if (pkAudio.paused) pkAudio.play(); else pkAudio.pause(); return; }
    if (pkAudio) { pkAudio.pause(); pkAudio._btn?.classList.remove('playing'); }
    const a = new Audio(url); pkAudio = a; a._btn = btn;
    a.onplay = () => btn.classList.add('playing');
    a.onpause = () => btn.classList.remove('playing');
    a.onended = () => btn.classList.remove('playing');
    a.play().catch(() => toast('No se pudo reproducir'));
  });
}

/* ---- página pública (sin sesión): underbro.app/?kit=usuario ---- */
async function renderPublicPressKit(slug) {
  document.documentElement.classList.add('no-splash');
  const sp = document.getElementById('splash'); if (sp) sp.remove();
  document.getElementById('authScreen')?.classList.add('hidden');
  document.getElementById('app')?.classList.add('hidden');
  let host = document.getElementById('publicKit');
  if (!host) { host = el('<div id="publicKit"></div>'); document.body.appendChild(host); }
  host.innerHTML = `<div class="loading" style="padding:70px"><div class="spinner"></div></div>`;
  let kit = null;
  try {
    const { data } = await sb.from('press_kits').select('data').eq('slug', slug).eq('published', true).maybeSingle();
    kit = data && data.data;
  } catch (_) {}
  if (!kit || !kit.name) {
    host.innerHTML = `<div class="pk-notfound"><h2>Press kit no encontrado</h2><p>El enlace puede ser incorrecto o el artista lo ha despublicado.</p><a class="btn primary" href="/">Ir a UnderBro</a></div>`;
    return;
  }
  document.title = (kit.name || 'Press kit') + ' · UnderBro';
  host.innerHTML = `<div class="pk-public-inner">${pressKitHTML(kit)}<div class="pk-cta"><span>¿Eres artista? Crea el tuyo gratis</span><a class="btn primary" href="/">Crear mi press kit en UnderBro</a></div></div>`;
  pkWireAudio(host);
}

/* =======================================================================
   HERRAMIENTA: SMART LINK (link-in-bio por lanzamiento)
   ======================================================================= */
let smEditId = null, smState = null;
function slugify(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

async function renderSmartLinks() {
  setActiveNav('ecosystems');
  const main = $('main');
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = `
${toolBar('smartlink', 'Smart links', 'Un enlace para tu bio que lleva a todas las plataformas', { id: 'smBack', label: 'Workflow' })}
    <button class="btn primary" id="smNew" style="margin-bottom:14px"><svg fill="none" stroke="#fff"><use href="#i-plus"/></svg> Nuevo smart link</button>
    <div id="smList" class="loading" style="padding:30px"><div class="spinner"></div></div>`;
  $('smBack').onclick = () => switchView('tools');
  $('smNew').onclick = () => { smEditId = null; switchView('smartlink'); };
  const { data } = await sb.from('smart_links').select('id,slug,data,published,created_at').eq('user_id', state.user.id).order('created_at', { ascending: false });
  const list = $('smList'); list.className = '';
  if (!data || !data.length) { list.innerHTML = `<div class="empty"><svg fill="none" style="stroke:#8b5cf6"><use href="#i-share"/></svg><p>Aún no has creado ningún smart link.<br>Pulsa <b>Nuevo smart link</b> para tu próximo lanzamiento.</p></div>`; return; }
  list.innerHTML = '';
  data.forEach(r => {
    const d = r.data || {}; const url = location.origin + '/?l=' + r.slug;
    const row = el(`<div class="sm-row">
      <div class="sm-cover" style="${czUrl(d.cover) ? `background-image:url('${czUrl(d.cover)}')` : ''}">${czUrl(d.cover) ? '' : '<svg fill="none" stroke="#fff"><use href="#i-music"/></svg>'}</div>
      <div class="sm-info"><div class="sm-title">${esc(d.title || 'Sin título')}</div><div class="sm-slug">/?l=${esc(r.slug)} ${r.published ? '' : '· <b>privado</b>'}</div></div>
      <div class="sm-acts">
        <button class="btn sm" data-a="edit">Editar</button>
        <button class="btn sm" data-a="copy" title="Copiar enlace"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg></button>
        <button class="btn sm danger-btn" data-a="del" title="Borrar"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg></button>
      </div></div>`);
    row.querySelector('[data-a="edit"]').onclick = () => { smEditId = r.id; switchView('smartlink'); };
    row.querySelector('[data-a="copy"]').onclick = () => { navigator.clipboard?.writeText(url).then(() => toast('Enlace copiado: ' + url)).catch(() => toast(url)); };
    row.querySelector('[data-a="del"]').onclick = async () => { if (!confirm('¿Borrar este smart link?')) return; await sb.from('smart_links').delete().eq('id', r.id); row.remove(); toast('Smart link borrado'); };
    list.appendChild(row);
  });
}

async function renderSmartLinkBuilder() {
  setActiveNav('ecosystems');
  const main = $('main');
  main.innerHTML = `${toolBar('smartlink', 'Smart link', '')}<div class="loading" style="padding:40px"><div class="spinner"></div></div>`;
  const uid = state.user.id;
  const { data: tracks } = await sb.from('tracks').select('id,title,cover_url,audio_url').eq('user_id', uid).order('created_at', { ascending: false }).limit(30);
  const myTracks = tracks || [];
  let d;
  if (smEditId) { const { data } = await sb.from('smart_links').select('*').eq('id', smEditId).maybeSingle(); d = data ? { ...data.data, _slug: data.slug, _pub: data.published } : null; }
  if (!d) d = { title: '', subtitle: state.profile.display_name || state.profile.username, cover: '', audio: '', links: [], accent: '#3e57fc', template: 'dark', _slug: '', _pub: true };
  smState = d;
  const tpls = [['dark', 'Oscuro'], ['light', 'Claro'], ['gradient', 'Degradado']];
  main.innerHTML = `
${toolBar('smartlink', 'Smart link', 'Edita y publica tu página de lanzamiento', { id: 'slBack', label: 'Mis smart links' })}
    <div class="pk-builder">
      <div class="pk-form">
        <div class="pk-fsec"><h4>Lanzamiento</h4>
          <label class="pk-l">Título</label><input class="pk-in" data-sk="title" value="${esc(d.title || '')}" maxlength="80" placeholder="Nombre del tema o álbum" />
          <label class="pk-l">Subtítulo / artista</label><input class="pk-in" data-sk="subtitle" value="${esc(d.subtitle || '')}" maxlength="80" />
          <label class="pk-l">Portada</label>
          <div class="sm-cover-pick">
            <div class="sm-cover-prev" id="slCoverPrev" style="${czUrl(d.cover) ? `background-image:url('${czUrl(d.cover)}')` : ''}">${czUrl(d.cover) ? '' : '<svg fill="none" stroke="#fff"><use href="#i-image"/></svg>'}</div>
            <div><button class="btn sm" id="slCoverBtn">Subir imagen</button><input type="file" id="slCoverFile" accept="image/*" hidden /><div class="pk-hint2" style="margin-top:6px">o elige una de tus pistas abajo</div></div>
          </div>
          ${myTracks.length ? `<label class="pk-l">Basar en una pista (opcional)</label><div class="sm-track-row">${myTracks.map(t => `<button type="button" class="sm-tk-thumb" data-tk="${esc(t.id)}" title="${esc(t.title)}" style="${czUrl(t.cover_url) ? `background-image:url('${czUrl(t.cover_url)}')` : ''}">${czUrl(t.cover_url) ? '' : esc((t.title || '?').slice(0, 2))}</button>`).join('')}</div>` : ''}
        </div>
        <div class="pk-fsec"><h4>Enlaces a plataformas <button class="btn sm" id="slAddLink" style="float:right">+ Añadir</button></h4>
          <div id="slLinks"></div>
          <div class="pk-hint2">Pega tus URLs de Spotify, YouTube, Apple Music, SoundCloud, Instagram, TikTok… Se detectan solas.</div>
        </div>
        <div class="pk-fsec"><h4>Diseño</h4>
          <label class="pk-l">Color de acento</label>
          <div class="pk-color"><input type="color" data-sk="accent" value="${czColor(d.accent) || '#3e57fc'}" /><span>${esc(d.accent || '#3e57fc')}</span></div>
          <label class="pk-l">Plantilla</label>
          <div class="pk-tpls">${tpls.map(([v, n]) => `<button type="button" class="pk-tpl ${d.template === v ? 'on' : ''}" data-sltpl="${v}">${n}</button>`).join('')}</div>
          <label class="pk-l">Enlace (slug)</label>
          <div class="sm-slug-edit"><span>/?l=</span><input class="pk-in" data-sk="_slug" value="${esc(d._slug || '')}" maxlength="40" placeholder="se genera solo" /></div>
        </div>
        <div class="pk-actions">
          <button class="btn primary" id="slSave"><svg fill="none" stroke="#fff"><use href="#i-globe"/></svg> Guardar y publicar</button>
          <button class="btn" id="slCopy"><svg fill="none" stroke="currentColor"><use href="#i-share"/></svg> Copiar enlace</button>
          <button class="btn" id="slView"><svg fill="none" stroke="currentColor"><use href="#i-globe"/></svg> Ver</button>
        </div>
      </div>
      <div class="pk-preview-wrap"><div class="pk-preview-label">Vista previa</div><div id="slPreview" class="pk-preview"></div></div>
    </div>`;
  $('slBack').onclick = () => switchView('smartlinks');
  main.querySelectorAll('.pk-in[data-sk]').forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.sk; smState[k] = inp.value;
    if (k === 'accent') { const sp = inp.parentElement.querySelector('span'); if (sp) sp.textContent = inp.value; }
    if (k !== '_slug') slRenderPreview();
  }));
  main.querySelectorAll('.pk-tpl[data-sltpl]').forEach(b => b.onclick = () => { smState.template = b.dataset.sltpl; main.querySelectorAll('.pk-tpl[data-sltpl]').forEach(x => x.classList.toggle('on', x === b)); slRenderPreview(); });
  main.querySelectorAll('.sm-tk-thumb').forEach(b => b.onclick = () => {
    const t = myTracks.find(x => x.id === b.dataset.tk); if (!t) return;
    smState.cover = t.cover_url || ''; smState.audio = t.audio_url || '';
    if (!smState.title) { smState.title = t.title; const ti = main.querySelector('[data-sk="title"]'); if (ti) ti.value = t.title; }
    const cp = $('slCoverPrev'); cp.style.backgroundImage = czUrl(t.cover_url) ? `url('${czUrl(t.cover_url)}')` : ''; cp.innerHTML = czUrl(t.cover_url) ? '' : '<svg fill="none" stroke="#fff"><use href="#i-image"/></svg>';
    slRenderPreview();
  });
  $('slCoverBtn').onclick = () => $('slCoverFile').click();
  $('slCoverFile').onchange = async () => {
    const f = $('slCoverFile').files[0]; if (!f) return;
    if (f.size > 6e6) { toast('Máximo 6 MB'); return; }
    $('slCoverBtn').disabled = true; $('slCoverBtn').textContent = 'Subiendo…';
    try {
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${uid}/sl_${Date.now()}.${ext}`;
      const up = await sb.storage.from('covers').upload(path, f, { contentType: f.type || 'image/jpeg' });
      if (up.error) throw up.error;
      smState.cover = sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
      const cp = $('slCoverPrev'); cp.style.backgroundImage = `url('${czUrl(smState.cover)}')`; cp.innerHTML = '';
      slRenderPreview();
    } catch (e) { toast('No se pudo subir la imagen'); }
    $('slCoverBtn').disabled = false; $('slCoverBtn').textContent = 'Subir imagen';
  };
  $('slAddLink').onclick = () => { smState.links.push({ url: '', label: '' }); slRenderLinks(); slRenderPreview(); };
  $('slSave').onclick = slSave;
  $('slCopy').onclick = () => { if (!smState._slug) { toast('Guarda primero para generar el enlace'); return; } const u = location.origin + '/?l=' + smState._slug; navigator.clipboard?.writeText(u).then(() => toast('Enlace copiado: ' + u)).catch(() => toast(u)); };
  $('slView').onclick = () => { if (!smState._slug) { toast('Guarda primero'); return; } window.open(location.origin + '/?l=' + smState._slug, '_blank'); };
  slRenderLinks();
  slRenderPreview();
  mountBuilderTabs();
}
function slRenderLinks() {
  const box = $('slLinks'); if (!box) return;
  box.innerHTML = (smState.links || []).map((l, i) => `
    <div class="sm-link-row">
      <input class="pk-in" data-li="${i}" data-f="url" value="${esc(l.url || '')}" placeholder="https://..." />
      <input class="pk-in sm-link-label" data-li="${i}" data-f="label" value="${esc(l.label || '')}" placeholder="Etiqueta (opcional)" />
      <button class="sm-link-x" data-rm="${i}" title="Quitar">&times;</button>
    </div>`).join('');
  box.querySelectorAll('input[data-li]').forEach(inp => inp.addEventListener('input', () => {
    const i = +inp.dataset.li; smState.links[i][inp.dataset.f] = inp.value; slRenderPreview();
  }));
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { smState.links.splice(+b.dataset.rm, 1); slRenderLinks(); slRenderPreview(); });
}
function slRenderPreview() { const box = $('slPreview'); if (!box) return; box.innerHTML = smartLinkHTML(smState); pkWireAudio(box); }

async function slSave() {
  const btn = $('slSave'); btn.disabled = true;
  if (!smState.title.trim()) { toast('Ponle un título'); btn.disabled = false; return; }
  let slug = slugify(smState._slug) || (slugify(smState.title) + '-' + Math.random().toString(36).slice(2, 6));
  smState._slug = slug;
  const payload = {
    title: smState.title, subtitle: smState.subtitle, cover: smState.cover, audio: smState.audio,
    links: (smState.links || []).filter(l => (l.url || '').trim()), accent: smState.accent, template: smState.template,
  };
  try {
    if (smEditId) {
      const { error } = await sb.from('smart_links').update({ slug, data: payload, published: true, updated_at: new Date().toISOString() }).eq('id', smEditId);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('smart_links').insert({ user_id: state.user.id, slug, data: payload, published: true }).select('id').single();
      if (error) throw error; smEditId = data.id;
    }
    btn.innerHTML = '✓ Publicado'; toast('🌐 Smart link publicado');
    setTimeout(() => { btn.innerHTML = '<svg fill="none" stroke="#fff"><use href="#i-globe"/></svg> Guardar y publicar'; }, 2200);
  } catch (e) {
    toast(/duplicate|unique/i.test(e.message || '') ? 'Ese enlace ya existe, prueba otro slug' : 'No se pudo guardar');
    btn.disabled = false; return;
  }
  btn.disabled = false;
}

function smartLinkHTML(d) {
  if (!d) return '';
  const accent = czColor(d.accent) || '#3e57fc';
  const cover = czUrl(d.cover);
  const links = (d.links || []).filter(l => (l.url || '').trim());
  const btns = links.map(l => {
    const p = (typeof platformOf === 'function') ? platformOf(l.url) : null;
    const label = l.label || (p ? p.name : hostOf(l.url));
    const col = p ? p.color : accent;
    return `<a class="sl-btn" href="${esc(czHref(l.url))}" target="_blank" rel="noopener noreferrer" style="--slc:${col}"><span class="sl-dot"></span><span class="sl-btn-l">${esc(label)}</span><span class="sl-arrow">↗</span></a>`;
  }).join('');
  return `
    <div class="sl tpl-${esc(d.template || 'dark')}" style="--pk-accent:${accent}">
      <div class="sl-cover" style="${cover ? `background-image:url('${cover}')` : ''}">${cover ? '' : '<svg fill="none" stroke="#fff"><use href="#i-music"/></svg>'}</div>
      <div class="sl-head"><div class="sl-title">${esc(d.title || 'Tu lanzamiento')}</div>${d.subtitle ? `<div class="sl-sub">${esc(d.subtitle)}</div>` : ''}</div>
      ${czHref(d.audio) ? `<button class="sl-listen" data-pkplay="${esc(czHref(d.audio))}"><svg class="ci-play"><use href="#i-play"/></svg><svg class="ci-pause"><use href="#i-pause"/></svg> Escuchar adelanto</button>` : ''}
      <div class="sl-btns">${btns || '<div class="pk-hint2" style="text-align:center;padding:10px">Añade enlaces a plataformas</div>'}</div>
      <div class="sl-foot">Smart link · <b>UnderBro</b></div>
    </div>`;
}

async function renderPublicSmartLink(slug) {
  document.documentElement.classList.add('no-splash');
  const sp = document.getElementById('splash'); if (sp) sp.remove();
  document.getElementById('authScreen')?.classList.add('hidden');
  document.getElementById('app')?.classList.add('hidden');
  let host = document.getElementById('publicKit');
  if (!host) { host = el('<div id="publicKit"></div>'); document.body.appendChild(host); }
  host.innerHTML = `<div class="loading" style="padding:70px"><div class="spinner"></div></div>`;
  let d = null;
  try { const { data } = await sb.from('smart_links').select('data').eq('slug', slug).eq('published', true).maybeSingle(); d = data && data.data; } catch (_) {}
  if (!d || !d.title) { host.innerHTML = `<div class="pk-notfound"><h2>Enlace no encontrado</h2><p>El enlace puede ser incorrecto o ya no está disponible.</p><a class="btn primary" href="/">Ir a UnderBro</a></div>`; return; }
  document.title = d.title + ' · UnderBro';
  host.innerHTML = `<div class="sl-public-inner">${smartLinkHTML(d)}<div class="pk-cta"><a class="btn primary" href="/">Crea tu smart link en UnderBro</a></div></div>`;
  pkWireAudio(host);
}

/* =======================================================================
   HERRAMIENTA: SPLIT SHEET (reparto de colaboración → PDF)
   ======================================================================= */
let ssEditId = null, ssState = null;

async function renderSplitSheets() {
  setActiveNav('ecosystems');
  const main = $('main');
  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
  main.innerHTML = `
${toolBar('split', 'Split sheets', 'Reparto de autoría de tus colaboraciones', { id: 'ssBack', label: 'Workflow' })}
    <button class="btn primary" id="ssNew" style="margin-bottom:14px"><svg fill="none" stroke="#fff"><use href="#i-plus"/></svg> Nuevo split sheet</button>
    <div id="ssList" class="loading" style="padding:30px"><div class="spinner"></div></div>`;
  $('ssBack').onclick = () => switchView('tools');
  $('ssNew').onclick = () => { ssEditId = null; switchView('split'); };
  const { data } = await sb.from('split_sheets').select('id,data,updated_at').eq('user_id', state.user.id).order('updated_at', { ascending: false });
  const list = $('ssList'); list.className = '';
  if (!data || !data.length) { list.innerHTML = `<div class="empty"><svg fill="none" style="stroke:#0ea5e9"><use href="#i-files"/></svg><p>Aún no tienes ningún split sheet.<br>Crea uno para tu próxima colaboración.</p></div>`; return; }
  list.innerHTML = '';
  data.forEach(r => {
    const d = r.data || {};
    const row = el(`<div class="sm-row">
      <div class="sm-cover" style="display:grid;place-items:center"><svg fill="none" stroke="#fff" style="width:22px;height:22px"><use href="#i-doc"/></svg></div>
      <div class="sm-info"><div class="sm-title">${esc(d.title || 'Sin título')}</div><div class="sm-slug">${(d.people || []).length} colaborador(es) · ${esc(d.date || '')}</div></div>
      <div class="sm-acts"><button class="btn sm" data-a="edit">Abrir</button><button class="btn sm danger-btn" data-a="del" title="Borrar"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg></button></div></div>`);
    row.querySelector('[data-a="edit"]').onclick = () => { ssEditId = r.id; switchView('split'); };
    row.querySelector('[data-a="del"]').onclick = async () => { if (!confirm('¿Borrar este split sheet?')) return; await sb.from('split_sheets').delete().eq('id', r.id); row.remove(); toast('Borrado'); };
    list.appendChild(row);
  });
}

async function renderSplitBuilder() {
  setActiveNav('ecosystems');
  const main = $('main');
  main.innerHTML = `${toolBar('split', 'Split sheet', '')}<div class="loading" style="padding:40px"><div class="spinner"></div></div>`;
  let d = null;
  if (ssEditId) { const { data } = await sb.from('split_sheets').select('data').eq('id', ssEditId).maybeSingle(); d = data && data.data; }
  if (!d) d = { title: '', date: new Date().toISOString().slice(0, 10), people: [{ name: state.profile.display_name || state.profile.username, role: 'Autor / intérprete', share: 100, contact: '' }], notes: '' };
  ssState = d;
  main.innerHTML = `
${toolBar('split', 'Split sheet', 'Reparto de autoría · exporta a PDF', { id: 'spBack', label: 'Mis split sheets' })}
    <div class="pk-builder">
      <div class="pk-form">
        <div class="pk-fsec"><h4>Obra</h4>
          <div class="pk-row2"><div><label class="pk-l">Título de la canción</label><input class="pk-in" data-ss="title" value="${esc(d.title || '')}" maxlength="120" /></div>
          <div><label class="pk-l">Fecha</label><input class="pk-in" type="date" data-ss="date" value="${esc(d.date || '')}" /></div></div>
        </div>
        <div class="pk-fsec"><h4>Colaboradores <button class="btn sm" id="ssAdd" style="float:right">+ Añadir</button></h4>
          <div id="ssPeople"></div>
          <div class="ss-total" id="ssTotal"></div>
        </div>
        <div class="pk-fsec"><h4>Notas (opcional)</h4>
          <textarea class="pk-in" data-ss="notes" rows="3" placeholder="Acuerdos adicionales, masters, publishing...">${esc(d.notes || '')}</textarea>
        </div>
        <div class="pk-actions">
          <button class="btn primary" id="ssPdf"><svg fill="none" stroke="#fff"><use href="#i-download"/></svg> Descargar PDF</button>
          <button class="btn" id="ssSave"><svg fill="none" stroke="currentColor"><use href="#i-verify"/></svg> Guardar</button>
        </div>
      </div>
      <div class="pk-preview-wrap"><div class="pk-preview-label">Vista previa</div><div id="ssPreview" class="pk-preview"></div></div>
    </div>`;
  $('spBack').onclick = () => switchView('splits');
  main.querySelectorAll('.pk-in[data-ss]').forEach(inp => inp.addEventListener('input', () => { ssState[inp.dataset.ss] = inp.value; ssRenderPreview(); }));
  $('ssAdd').onclick = () => { ssState.people.push({ name: '', role: '', share: 0, contact: '' }); ssRenderPeople(); ssRenderPreview(); };
  $('ssSave').onclick = ssSave;
  $('ssPdf').onclick = () => toolPrintPdf(splitSheetHTML(ssState, true), (ssState.title || 'split-sheet'));
  ssRenderPeople();
  ssRenderPreview();
  mountBuilderTabs();
}
function ssRenderPeople() {
  const box = $('ssPeople'); if (!box) return;
  box.innerHTML = (ssState.people || []).map((p, i) => `
    <div class="ss-person">
      <input class="pk-in" data-pi="${i}" data-f="name" value="${esc(p.name || '')}" placeholder="Nombre legal" />
      <div class="pk-row2">
        <input class="pk-in" data-pi="${i}" data-f="role" value="${esc(p.role || '')}" placeholder="Rol (letra, prod...)" />
        <div class="ss-share"><input class="pk-in" type="number" min="0" max="100" data-pi="${i}" data-f="share" value="${p.share || 0}" /><span>%</span></div>
      </div>
      <input class="pk-in" data-pi="${i}" data-f="contact" value="${esc(p.contact || '')}" placeholder="Email / contacto (opcional)" />
      ${ssState.people.length > 1 ? `<button class="sm-link-x" data-rmp="${i}" title="Quitar">&times;</button>` : ''}
    </div>`).join('');
  box.querySelectorAll('input[data-pi]').forEach(inp => inp.addEventListener('input', () => {
    const i = +inp.dataset.pi, f = inp.dataset.f;
    ssState.people[i][f] = f === 'share' ? (parseFloat(inp.value) || 0) : inp.value;
    ssUpdateTotal(); ssRenderPreview();
  }));
  box.querySelectorAll('[data-rmp]').forEach(b => b.onclick = () => { ssState.people.splice(+b.dataset.rmp, 1); ssRenderPeople(); ssRenderPreview(); });
  ssUpdateTotal();
}
function ssUpdateTotal() {
  const t = (ssState.people || []).reduce((a, p) => a + (parseFloat(p.share) || 0), 0);
  const el2 = $('ssTotal'); if (!el2) return;
  el2.textContent = `Total: ${t}%` + (t === 100 ? ' ✓' : ' (debe sumar 100%)');
  el2.className = 'ss-total ' + (t === 100 ? 'ok' : 'warn');
}
function ssRenderPreview() { const box = $('ssPreview'); if (!box) return; box.innerHTML = splitSheetHTML(ssState); }

async function ssSave() {
  const btn = $('ssSave'); btn.disabled = true;
  const out = JSON.parse(JSON.stringify(ssState)); out.updatedAt = new Date().toISOString();
  try {
    if (ssEditId) { const { error } = await sb.from('split_sheets').update({ data: out, updated_at: out.updatedAt }).eq('id', ssEditId); if (error) throw error; }
    else { const { data, error } = await sb.from('split_sheets').insert({ user_id: state.user.id, data: out }).select('id').single(); if (error) throw error; ssEditId = data.id; }
    btn.innerHTML = '✓ Guardado'; toast('Split sheet guardado');
    setTimeout(() => { btn.innerHTML = '<svg fill="none" stroke="currentColor"><use href="#i-verify"/></svg> Guardar'; }, 2000);
  } catch (e) { toast('No se pudo guardar'); }
  btn.disabled = false;
}

function splitSheetHTML(d, forPdf) {
  if (!d) return '';
  const total = (d.people || []).reduce((a, p) => a + (parseFloat(p.share) || 0), 0);
  const rows = (d.people || []).map(p => `<tr><td>${esc(p.name || '—')}</td><td>${esc(p.role || '')}</td><td class="ss-pct">${(parseFloat(p.share) || 0)}%</td><td>${esc(p.contact || '')}</td></tr>`).join('');
  return `
    <div class="ss-doc ${forPdf ? 'for-pdf' : ''}">
      <div class="ss-doc-head"><h2>Split Sheet</h2><div class="ss-doc-sub">Acuerdo de reparto de autoría</div></div>
      <div class="ss-doc-meta"><div><span>Obra</span><b>${esc(d.title || '—')}</b></div><div><span>Fecha</span><b>${esc(d.date || '—')}</b></div></div>
      <table class="ss-table"><thead><tr><th>Nombre</th><th>Rol</th><th>%</th><th>Contacto</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="ss-pct ${total === 100 ? 'ok' : 'warn'}">${total}%</td><td></td></tr></tfoot></table>
      ${d.notes ? `<div class="ss-notes"><h4>Notas</h4><p>${esc(d.notes).replace(/\n/g, '<br>')}</p></div>` : ''}
      <div class="ss-sign"><h4>Firmas</h4>${(d.people || []).map(p => `<div class="ss-sign-row"><span class="ss-sign-line"></span><span class="ss-sign-name">${esc(p.name || '')}</span></div>`).join('')}</div>
      <div class="ss-doc-foot">Generado con UnderBro · underbro.app</div>
    </div>`;
}

/* genérico: imprime/descarga un HTML aislado como PDF (sin el resto de la app) */
function toolPrintPdf(html, title) {
  const cssHref = (document.querySelector('link[rel="stylesheet"]') || {}).href || '/css/styles.css';
  const ifr = document.createElement('iframe');
  ifr.setAttribute('aria-hidden', 'true');
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
  document.body.appendChild(ifr);
  const dd = ifr.contentWindow.document;
  dd.open();
  dd.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(title || 'documento')}</title>
    <link rel="stylesheet" href="${esc(cssHref)}">
    <style>html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;} .ss-doc,.pk,.sl{max-width:100%;} @page{margin:14mm;}</style>
    </head><body>${html}</body></html>`);
  dd.close();
  let done = false;
  const go = () => { if (done) return; done = true; try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (_) {} setTimeout(() => ifr.remove(), 1500); };
  ifr.onload = () => setTimeout(go, 350);
  setTimeout(go, 1200);
  toast('Preparando PDF… elige "Guardar como PDF"');
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
  attachLongPress(card, () => {
    const sv = state.eventSaves.has(ev.id);
    return { title: ev.title, items: [
      { label: 'Ver detalles', icon: 'calendar', onClick: () => openEvent(ev.id) },
      { label: sv ? 'Quitar de guardados' : 'Guardar', icon: 'bookmark', on: sv, onClick: () => toggleEventSave(ev, card) },
    ] };
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

/* =======================================================================
   PANEL DE ADMIN (estadísticas · usuarios · contenido · difusión)
   ======================================================================= */
async function renderAdmin() {
  if (!state.profile || !state.profile.is_admin) { switchView('feed'); return; }
  setActiveNav('admin');
  const main = $('main');
  main.innerHTML = `
    <div class="main-head"><div><h2>Panel de Admin</h2><div class="sub">Moderación y gestión de UnderBro</div></div></div>
    <div class="admin-grid">
      <div class="admin-card span2"><h3>📊 Estadísticas</h3><div class="adm-kpis" id="admStats"><div class="loading" style="padding:18px"><div class="spinner"></div></div></div></div>
      <div class="admin-card span2"><h3>👤 Gestión de usuarios</h3>
        <div class="adm-search"><input id="admUserQ" type="text" placeholder="Buscar por nombre o @usuario…" /><button class="btn sm primary" id="admUserGo">Buscar</button></div>
        <div id="admUserList" class="adm-list"><div class="sub">Busca un usuario o deja vacío para ver los últimos registrados.</div></div>
      </div>
      <div class="admin-card"><h3>🛡️ Moderar contenido</h3>
        <div class="adm-tabs"><button class="active" data-ct="tracks">Pistas</button><button data-ct="posts">Fotos</button></div>
        <div id="admContent" class="adm-list"><div class="loading" style="padding:18px"><div class="spinner"></div></div></div>
      </div>
      <div class="admin-card"><h3>📣 Difusión a la comunidad</h3>
        <p class="sub" style="margin:0 0 10px">Envía un aviso (push + notificación) a todos los usuarios.</p>
        <input id="admBcTitle" type="text" maxlength="60" placeholder="Título · ej. ¡Nueva función!" />
        <textarea id="admBcBody" maxlength="180" placeholder="Mensaje…" rows="3"></textarea>
        <button class="btn btn-ig" id="admBcSend" style="width:100%;justify-content:center">Enviar a todos</button>
        <div class="sub" id="admBcMsg" style="margin-top:8px"></div>
        <button class="btn" id="admReports" style="width:100%;margin-top:14px"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg> Reportes de la comunidad</button>
      </div>
    </div>`;
  loadAdminStats();
  loadAdminContent('tracks');
  const doSearch = () => adminUserSearch($('admUserQ').value);
  $('admUserGo').onclick = doSearch;
  $('admUserQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  adminUserSearch('');   // últimos registrados
  main.querySelectorAll('.adm-tabs button').forEach((b) => b.onclick = () => {
    main.querySelectorAll('.adm-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    loadAdminContent(b.dataset.ct);
  });
  $('admBcSend').onclick = adminBroadcast;
  $('admReports').onclick = openReportsAdmin;
}
async function loadAdminStats() {
  const box = $('admStats'); if (!box) return;
  const cnt = async (table, filter) => { try { let q = sb.from(table).select('id', { count: 'exact', head: true }); if (filter) q = filter(q); const { count } = await q; return count || 0; } catch (_) { return '—'; } };
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [users, tracks, posts, comments, verified, banned, newUsers, newTracks] = await Promise.all([
    cnt('profiles'), cnt('tracks'), cnt('posts'), cnt('comments'),
    cnt('profiles', (q) => q.eq('verified', true)), cnt('profiles', (q) => q.eq('banned', true)),
    cnt('profiles', (q) => q.gte('created_at', since)), cnt('tracks', (q) => q.gte('created_at', since)),
  ]);
  const kpi = (k, v, hot) => `<div class="adm-kpi${hot ? ' hot' : ''}"><b>${typeof v === 'number' ? nfmt(v) : v}</b><span>${k}</span></div>`;
  box.innerHTML = kpi('Usuarios', users) + kpi('Pistas', tracks) + kpi('Fotos', posts) + kpi('Comentarios', comments)
    + kpi('Verificados', verified) + kpi('Baneados', banned) + kpi('Usuarios · 7d', newUsers, true) + kpi('Pistas · 7d', newTracks, true);
}
async function adminUserSearch(q) {
  const list = $('admUserList'); if (!list) return;
  list.innerHTML = '<div class="loading" style="padding:18px"><div class="spinner"></div></div>';
  const term = sanitizeTerm((q || '').replace('@', ''));
  let query = sb.from('profiles').select('id,username,display_name,avatar_url,verified,banned,is_admin,user_badges(badge)').limit(30);
  query = term ? query.or(`username.ilike.%${term}%,display_name.ilike.%${term}%`) : query.order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) { list.innerHTML = '<div class="sub">Error al buscar usuarios.</div>'; return; }
  if (!data || !data.length) { list.innerHTML = '<div class="sub">Sin resultados.</div>'; return; }
  list.innerHTML = ''; data.forEach((p) => list.appendChild(adminUserRow(p)));
}
function adminUserRow(p) {
  const me = p.id === state.user.id;
  const have = new Set((p.user_badges || []).map((b) => b.badge));
  const tag = `${p.is_admin ? ' <span class="adm-tag mod">ADMIN</span>' : ''}${p.verified ? ' <span class="adm-tag ok">✔</span>' : ''}${p.banned ? ' <span class="adm-tag ban">baneado</span>' : ''}`;
  const badgeBtns = Object.keys(BADGES).map((k) => `<button class="bdgbtn ${have.has(k) ? 'on' : ''}" data-bdg="${k}" title="${esc(BADGES[k].name)}">${BADGES[k].glyph}</button>`).join('');
  const row = el(`<div class="adm-row">
    <span class="adm-av" data-open>${avatarHTML(p)}</span>
    <div class="adm-row-main" data-open><b>${esc(p.display_name || p.username || '—')}${tag}</b><span>@${esc(p.username || '')}</span></div>
    <div class="adm-row-acts">
      <span class="adm-badges">${badgeBtns}</span>
      ${me ? '' : `<button class="btn sm" data-a="dm">Mensaje</button>`}
      <button class="btn sm" data-a="verify">${p.verified ? 'Quitar ✔' : 'Verificar'}</button>
      ${me ? '' : `<button class="btn sm" data-a="ban">${p.banned ? 'Desbanear' : 'Banear'}</button>`}
      ${me ? '' : `<button class="btn sm" data-a="admin">${p.is_admin ? 'Quitar admin' : 'Hacer admin'}</button>`}
      ${me || p.is_admin ? '' : `<button class="btn sm danger" data-a="del">Eliminar</button>`}
    </div>
  </div>`);
  const upd = async (patch) => { const { error } = await sb.from('profiles').update(patch).eq('id', p.id); if (error) { toast('No se pudo: ' + (error.message || '')); return false; } Object.assign(p, patch); return true; };
  row.querySelector('[data-open]').onclick = () => openProfile(p.id);
  const dmB = row.querySelector('[data-a="dm"]'); if (dmB) dmB.onclick = () => openDM(p.id);
  row.querySelector('[data-a="verify"]').onclick = async (e) => { if (await upd({ verified: !p.verified })) { e.target.textContent = p.verified ? 'Quitar ✔' : 'Verificar'; toast(p.verified ? 'Verificado' : 'Verificación quitada'); } };
  const banB = row.querySelector('[data-a="ban"]'); if (banB) banB.onclick = async (e) => { if (await upd({ banned: !p.banned })) { e.target.textContent = p.banned ? 'Desbanear' : 'Banear'; toast(p.banned ? 'Usuario baneado' : 'Usuario desbaneado'); } };
  const admB = row.querySelector('[data-a="admin"]'); if (admB) admB.onclick = async (e) => { if (!confirm(`¿${p.is_admin ? 'QUITAR admin a' : 'HACER admin a'} @${p.username}?`)) return; if (await upd({ is_admin: !p.is_admin })) { e.target.textContent = p.is_admin ? 'Quitar admin' : 'Hacer admin'; toast('Permisos actualizados'); } };
  const delB = row.querySelector('[data-a="del"]'); if (delB) delB.onclick = () => adminDeleteUser(p.id, p.username, () => row.remove());
  row.querySelectorAll('[data-bdg]').forEach((b) => b.onclick = async () => {
    const k = b.dataset.bdg, has = have.has(k);
    if (has) { const { error } = await sb.from('user_badges').delete().eq('user_id', p.id).eq('badge', k); if (error) { toast('No se pudo (¿falta política RLS?)'); return; } have.delete(k); b.classList.remove('on'); toast(`Insignia "${BADGES[k].name}" quitada`); }
    else { const { error } = await sb.from('user_badges').insert({ user_id: p.id, badge: k }); if (error) { toast('No se pudo (¿falta política RLS?)'); return; } have.add(k); b.classList.add('on'); toast(`Insignia "${BADGES[k].name}" otorgada`); }
  });
  return row;
}
async function loadAdminContent(kind) {
  const box = $('admContent'); if (!box) return;
  box.innerHTML = '<div class="loading" style="padding:18px"><div class="spinner"></div></div>';
  try {
    if (kind === 'posts') {
      const { data } = await sb.from('posts').select('id,caption,image_url,created_at,profiles!posts_user_id_fkey(username,display_name)').order('created_at', { ascending: false }).limit(20);
      box.innerHTML = ''; if (!data || !data.length) { box.innerHTML = '<div class="sub">Sin fotos.</div>'; return; }
      data.forEach((p) => {
        const r = el(`<div class="adm-row"><span class="adm-av"><img src="${esc(czUrl(p.image_url))}" alt=""></span><div class="adm-row-main"><b>${esc((p.caption || '(sin texto)').slice(0, 42))}</b><span>${esc(p.profiles?.display_name || p.profiles?.username || '')} · ${timeAgo(p.created_at)}</span></div><div class="adm-row-acts"><button class="btn sm danger" data-del>Borrar</button></div></div>`);
        r.querySelector('[data-del]').onclick = async () => { if (!confirm('¿Borrar esta foto?')) return; const { error } = await sb.from('posts').delete().eq('id', p.id); if (error) { toast('No se pudo'); return; } invalidatePosts(); r.remove(); toast('Foto borrada'); };
        box.appendChild(r);
      });
    } else {
      let hasFeatured = true;
      let res = await sb.from('tracks').select('id,title,featured,created_at,profiles!tracks_user_id_fkey(username,display_name)').order('created_at', { ascending: false }).limit(20);
      if (res.error) { hasFeatured = false; res = await sb.from('tracks').select('id,title,created_at,profiles!tracks_user_id_fkey(username,display_name)').order('created_at', { ascending: false }).limit(20); }
      const data = res.data;
      box.innerHTML = ''; if (!data || !data.length) { box.innerHTML = '<div class="sub">Sin pistas.</div>'; return; }
      data.forEach((t) => {
        const featBtn = hasFeatured ? `<button class="btn sm ${t.featured ? 'primary' : ''}" data-feat>${t.featured ? '★ Quitar' : '☆ Destacar'}</button>` : '';
        const r = el(`<div class="adm-row"><div class="adm-row-main"><b>${t.featured ? '★ ' : ''}${esc(t.title || '—')}</b><span>${esc(t.profiles?.display_name || t.profiles?.username || '')} · ${timeAgo(t.created_at)}</span></div><div class="adm-row-acts">${featBtn}<button class="btn sm danger" data-del>Borrar</button></div></div>`);
        const fb = r.querySelector('[data-feat]'); if (fb) fb.onclick = async () => { const nv = !t.featured; const { error } = await sb.from('tracks').update({ featured: nv }).eq('id', t.id); if (error) { toast('No se pudo (¿falta política/columna?)'); return; } t.featured = nv; fb.textContent = nv ? '★ Quitar' : '☆ Destacar'; fb.classList.toggle('primary', nv); feedCache.delete('trending'); toast(nv ? 'Pista destacada en Trending' : 'Quitada de destacadas'); };
        r.querySelector('[data-del]').onclick = async () => { if (!confirm('¿Borrar esta pista?')) return; const { error } = await sb.from('tracks').delete().eq('id', t.id); if (error) { toast('No se pudo'); return; } r.remove(); toast('Pista borrada'); };
        box.appendChild(r);
      });
    }
  } catch (_) { box.innerHTML = '<div class="sub">Error al cargar el contenido.</div>'; }
}
async function adminBroadcast() {
  const title = $('admBcTitle').value.trim(), body = $('admBcBody').value.trim();
  const msg = $('admBcMsg');
  if (!title && !body) { msg.textContent = 'Escribe un título o un mensaje.'; return; }
  if (!confirm('¿Enviar este aviso a TODA la comunidad?')) return;
  const btn = $('admBcSend'); btn.disabled = true; msg.textContent = 'Enviando…';
  const { error } = await sb.from('broadcasts').insert({ title: title || 'UnderBro', body, sender_id: state.user.id });
  btn.disabled = false;
  if (error) { msg.textContent = 'Falta activar el backend de difusión (tabla broadcasts). Aplica el SQL que te pasé.'; return; }
  $('admBcTitle').value = ''; $('admBcBody').value = ''; msg.textContent = 'Aviso enviado a la comunidad ✅'; toast('Difusión enviada 📣');
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
    <button class="btn primary" id="quickStart" style="display:block;width:100%;max-width:520px;margin-bottom:14px">🚀 Guía rápida · activar todo y tour</button>
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
  $('quickStart').onclick = openSetupWizard;
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
  // difusiones de artistas que sigues
  const { data: anns } = await sb.from('announcements').select('created_at, body, artist_id, profiles!announcements_artist_id_fkey(*)').neq('artist_id', state.user.id).order('created_at',{ascending:false}).limit(20);
  (anns||[]).forEach(a => { if (!isHidden(a.artist_id)) out.push({ ts: a.created_at, type:'announcement', who: a.profiles, text: '📣 ' + (a.body || '') }); });
  if (ids.length) {
    const { data: lk } = await sb.from('likes').select('created_at, track_id, profiles(*)').in('track_id', ids).neq('user_id', state.user.id).order('created_at',{ascending:false}).limit(20);
    (lk||[]).forEach(l => out.push({ ts: l.created_at, type:'like', who: l.profiles, text: `marcó ♥ tu pista "${titleById[l.track_id]||''}"` }));
    const { data: cm } = await sb.from('comments').select('created_at, track_id, body, profiles(*)').in('track_id', ids).neq('user_id', state.user.id).order('created_at',{ascending:false}).limit(20);
    (cm||[]).forEach(c => out.push({ ts: c.created_at, type:'comment', who: c.profiles, text: `comentó en "${titleById[c.track_id]||''}": ${c.body}` }));
    const { data: rp } = await sb.from('reposts').select('created_at, track_id, profiles!reposts_user_id_fkey(*)').in('track_id', ids).neq('user_id', state.user.id).order('created_at',{ascending:false}).limit(20);
    (rp||[]).forEach(r => out.push({ ts: r.created_at, type:'repost', who: r.profiles, text: `🔁 reposteó tu pista "${titleById[r.track_id]||''}"` }));
  }
  // actividad en tus fotos
  try {
    const { data: myPosts } = await sb.from('posts').select('id').eq('user_id', state.user.id);
    const pids = (myPosts||[]).map(p => p.id);
    if (pids.length) {
      const { data: pl } = await sb.from('post_likes').select('created_at, profiles(*)').in('post_id', pids).neq('user_id', state.user.id).order('created_at',{ascending:false}).limit(20);
      (pl||[]).forEach(l => out.push({ ts: l.created_at, type:'like', who: l.profiles, text: 'marcó ♥ tu foto' }));
      const { data: pc } = await sb.from('post_comments').select('created_at, body, profiles!post_comments_user_id_fkey(*)').in('post_id', pids).neq('user_id', state.user.id).order('created_at',{ascending:false}).limit(20);
      (pc||[]).forEach(c => out.push({ ts: c.created_at, type:'comment', who: c.profiles, text: `comentó tu foto: ${c.body}` }));
    }
  } catch (_) {}
  out.sort((a,b) => new Date(b.ts) - new Date(a.ts));
  return out.slice(0, 50);
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
   ONBOARDING — primer arranque de un usuario nuevo
   ======================================================================= */
const ONB_GENRES = ['Trap', 'Reggaetón', 'Drill', 'Hip-Hop', 'R&B', 'Afrobeat', 'Dembow', 'House', 'Techno', 'Pop', 'Lo-Fi', 'Electrónica', 'Rock', 'Punk', 'Experimental'];
async function openOnboarding() {
  if (state.view === 'ecosystems') {/*noop*/}
  const chosen = new Set();
  const m = openModal(`<div class="modal-head"><h3>Bienvenido a UnderBro 🎵</h3></div><div class="modal-body" id="onbBody"></div>`);
  let step = 1, suggested = [];
  const body = m.querySelector('#onbBody');
  const finish = () => { try { localStorage.setItem('ub_onboarded', '1'); } catch (_) {} m.remove(); switchView('feed'); setTimeout(() => { try { openSetupWizard(); } catch (_) {} }, 350); };
  const render = async () => {
    if (step === 1) {
      body.innerHTML = `
        <p style="color:var(--ink-soft);margin-top:0">La red social de la música underground. Dejamos tu cuenta lista en 2 pasos.</p>
        <h4 class="onb-h">¿Qué te gusta escuchar?</h4>
        <div class="onb-chips">${ONB_GENRES.map(g => `<button class="onb-chip" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div>
        <button class="btn primary" id="onbNext" style="width:100%;margin-top:18px">Continuar</button>
        <button class="btn" id="onbSkip" style="width:100%;margin-top:8px">Saltar</button>`;
      body.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { const g = b.dataset.g; if (chosen.has(g)) { chosen.delete(g); b.classList.remove('on'); } else { chosen.add(g); b.classList.add('on'); } });
      body.querySelector('#onbNext').onclick = async () => { try { localStorage.setItem('ub_genres', JSON.stringify([...chosen])); } catch (_) {} step = 2; await render(); };
      body.querySelector('#onbSkip').onclick = finish;
    } else {
      body.innerHTML = `<h4 class="onb-h">Sigue a artistas para llenar tu feed</h4><div id="onbArtists"><div class="loading"><div class="spinner"></div></div></div>
        <button class="btn primary" id="onbDone" style="width:100%;margin-top:16px">Empezar a usar UnderBro</button>`;
      body.querySelector('#onbDone').onclick = finish;
      if (!suggested.length) {
        try {
          const { data } = await sb.from('tracks').select('user_id, profiles!tracks_user_id_fkey(*)').order('plays', { ascending: false }).limit(80);
          const seen = new Set();
          (data || []).forEach(t => { const p = t.profiles; if (p && p.id !== state.user.id && !seen.has(p.id) && !isHidden(p.id)) { seen.add(p.id); suggested.push(p); } });
          suggested = suggested.slice(0, 12);
        } catch (_) {}
      }
      const boxA = body.querySelector('#onbArtists'); boxA.innerHTML = '';
      if (!suggested.length) { boxA.innerHTML = `<div class="eco-hint">Aún no hay artistas que sugerir. ¡Sé de los primeros en subir!</div>`; return; }
      suggested.forEach(p => {
        const f = state.follows.has(p.id);
        const row = el(`<div class="follow-row">${avatarHTML(p)}<div class="fr-info"><div class="fr-name">${esc(p.display_name || p.username)}</div><div class="fr-handle">@${esc(p.username)}</div></div><div class="fr-actions"><button class="btn sm ${f ? '' : 'primary'}" data-f>${f ? 'Siguiendo ✓' : '+ Seguir'}</button></div></div>`);
        row.querySelector('[data-f]').onclick = (e) => { e.stopPropagation(); toggleFollow(p.id, e.currentTarget); };
        boxA.appendChild(row);
      });
    }
  };
  render();
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
      if (isHidden(msg.sender_id)) return; // ignora DMs de usuarios bloqueados
      if (state.hiddenConvos.has(msg.sender_id)) { state.hiddenConvos.delete(msg.sender_id); saveHiddenConvos(); } // un chat oculto reaparece con un mensaje nuevo
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

  // bandeja de grupos en tiempo real (RLS limita a los grupos del usuario)
  sb.channel('group-inbox-' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, async (payload) => {
      const msg = payload.new;
      if (state.groupId === msg.conversation_id) {
        if (!state.dmMsgs.has(msg.id)) dmAppendMessage(msg, { scroll: true });
        if (msg.sender_id !== state.user.id) markGroupRead(msg.conversation_id);
      } else if (msg.sender_id !== state.user.id) {
        toast('💬 Grupo: ' + (msg.body || mediaLabel(msg) || 'Adjunto').slice(0, 38));
        if (state.view === 'messages') renderMessages();
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_messages' }, (payload) => {
      const m = payload.new;
      if (state.groupId === m.conversation_id && state.dmMsgs.has(m.id)) { state.dmMsgs.set(m.id, m); replaceRow(m); }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_messages' }, (payload) => {
      const r = document.querySelector(`.dm-row[data-mid="${payload.old.id}"]`); if (r) r.remove();
    })
    .subscribe();
}

/* =======================================================================
   LLAMADAS 1-a-1 (audio / vídeo) · WebRTC + señalización por Supabase Realtime
   - Cada usuario escucha su canal "ring" calls:<uid> (permanente).
   - Para llamar a X se abre un canal de salida hacia calls:<X> y se envían
     ahí los mensajes de señalización (oferta/respuesta/ICE/colgar).
   ======================================================================= */
const CALL_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  // TURN público de respaldo (relay) para redes móviles / NAT estricto donde STUN no basta.
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
function candType(s) { const m = / typ (\w+)/.exec(s || ''); return m ? m[1] : '?'; }
let callRing = null;        // canal "ring" propio (escucha)
let callAudioCtx = null, callRingTimer = null;

function callSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection); }
function callId() { try { return crypto.randomUUID(); } catch { return 'c' + Date.now() + Math.random().toString(36).slice(2); } }
const callSeenSigs = new Set();  // dedupe broadcast+BD (cada señal llega por dos vías)

function initCalls() {
  if (!callRing) {
    callRing = sb.channel('calls:' + state.user.id, { config: { broadcast: { self: false } } });
    callRing.on('broadcast', { event: 'signal' }, ({ payload }) => onCallSignal(payload)).subscribe();
    // vía de respaldo con entrega garantizada: señales por BD (como los DMs)
    sb.channel('call-signals-' + state.user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `recipient_id=eq.${state.user.id}` },
        (p) => { const row = p.new; if (row && row.payload) onCallSignal(row.payload); })
      .subscribe();
    // ¿se abrió la app desde la notificación de llamada? (Aceptar/Rechazar)
    try {
      const ucall = new URLSearchParams(location.search).get('ucall');
      if (ucall) { setAutoCallAction(ucall); history.replaceState(null, '', location.pathname); }
    } catch (_) {}
    // acciones de la notificación cuando la app ya estaba abierta en segundo plano
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.origin && e.origin !== location.origin) return;   // solo mensajes del propio SW
        if (e.data && e.data.type === 'callAction' && (e.data.action === 'accept' || e.data.action === 'decline')) { setAutoCallAction(e.data.action); applyAutoCallAction(); }
      });
    }
    callSignalCatchUp();
    getCallIceServers();   // pre-carga credenciales TURN: descolgar es instantáneo
    // al volver del segundo plano (móvil), el vídeo puede quedarse pausado: relánzalo
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.call) { playRemoteMedia(); attachCallLocal(); }
    });
  }
  $('dmCallBtn').onclick = () => startCall(false);
  $('dmVideoBtn').onclick = () => startCall(true);
  $('callHangBtn').onclick = callHangupBtn;
  $('callDeclineBtn').onclick = () => declineCall(false);
  $('callAcceptBtn').onclick = acceptCall;
  $('callMuteBtn').onclick = toggleCallMute;
  $('callVideoBtn').onclick = toggleCallCam;
  $('callSpeakerBtn').onclick = toggleCallSpeaker;
  $('callFlipBtn').onclick = switchCallCamera;
  $('callMinBtn').onclick = minimizeCall;
  $('callMini').onclick = expandCall;
}

// al abrir la app: procesa señales recientes pendientes (p. ej. llamada entrante
// que sonó mientras la app estaba cerrada y se abrió desde la notificación push)
async function callSignalCatchUp() {
  try {
    const since = new Date(Date.now() - 45000).toISOString();
    const { data } = await sb.from('call_signals').select('payload')
      .eq('recipient_id', state.user.id).gt('created_at', since).order('created_at');
    (data || []).forEach(r => { try { onCallSignal(r.payload); } catch (_) {} });
    sb.from('call_signals').delete().eq('recipient_id', state.user.id).lt('created_at', since).then(() => {}, () => {});
  } catch (_) {}
}

// envía una señal por las DOS vías: broadcast (instantáneo) y BD (garantizado)
function sendSignal(c, kind, extra = {}) {
  const payload = { kind, call_id: c.id, from: state.user.id, sig: callId(), ...extra };
  try { c.out.send(payload); } catch (_) {}
  sb.from('call_signals')
    .insert({ call_id: c.id, sender_id: state.user.id, recipient_id: c.peer, kind, payload })
    .then(() => {}, (e) => console.error('[call] señal BD', e));
}

// canal de salida hacia el "ring" del peer (con buffer hasta SUBSCRIBED)
function callOutChan(peerId) {
  const ch = sb.channel('calls:' + peerId);
  const queue = []; let ready = false;
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') { ready = true; queue.splice(0).forEach(p => ch.send({ type: 'broadcast', event: 'signal', payload: p })); }
  });
  return {
    send(payload) { if (ready) ch.send({ type: 'broadcast', event: 'signal', payload }); else queue.push(payload); },
    close() { try { sb.removeChannel(ch); } catch (_) {} },
  };
}

async function startCall(video) {
  if (state.groupId || !state.dmPeer) return;
  if (!callSupported()) { toast('Tu navegador no soporta llamadas'); return; }
  if (state.call) { toast('Ya tienes una llamada en curso'); return; }
  const peer = state.dmPeer;
  if (state.blocked.has(peer) || state.hidden.has(peer)) { toast('No puedes llamar a este usuario'); return; }
  let media;
  try { media = await getCallStream(video); }
  catch (err) { handleGumError(err, video); return; }
  const { stream, camOk } = media;
  const ice = await getCallIceServers();
  const id = callId();
  state.call = {
    id, peer, peerProfile: state.dmPeerProfile, video, role: 'caller', status: 'calling',
    out: callOutChan(peer), localStream: stream, remoteStream: null, pc: null, iceServers: ice,
    pendingIce: [], muted: false, camOff: video && !camOk, facing: 'user',
    speaker: true, startedAt: 0, everConnected: false, logId: null, finalized: false, timer: null,
  };
  buildCallPc();
  stream.getTracks().forEach(t => state.call.pc.addTrack(t, stream));
  // sin cámara: aun así negociamos vídeo de entrada para VER al otro
  if (video && !camOk) { try { state.call.pc.addTransceiver('video', { direction: 'recvonly' }); } catch (_) {} toast('Tu cámara no está disponible: envías solo audio'); }
  showCallScreen('outgoing');
  startRingback();
  haptic(20);
  try {
    const offer = await state.call.pc.createOffer();
    await state.call.pc.setLocalDescription(offer);
    console.log('[call] oferta enviada', id);
    sendSignal(state.call, 'offer', { sdp: { type: offer.type, sdp: offer.sdp }, video, ts: Date.now() });
  } catch (e) { console.error('[call] createOffer', e); toast('No se pudo iniciar la llamada'); cleanupCall(); return; }
  createCallLog();           // inserta la fila de llamada → dispara la push al receptor
  state.call.noAnswerTO = setTimeout(() => {
    if (state.call && state.call.id === id && state.call.status === 'calling') { toast('Sin respuesta'); callHangupBtn(); }
  }, 45000);
}

// pide micro (+cámara si video). Si la cámara falla o no existe, degrada a
// solo-audio en vez de tumbar la llamada: camOk indica si hay vídeo local.
async function getCallStream(video) {
  if (!video) return { stream: await navigator.mediaDevices.getUserMedia({ audio: true }), camOk: false };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    return { stream, camOk: true };
  } catch (e) {
    console.warn('[call] cámara no disponible, sigo con audio', e && e.name);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });  // si esto también falla, lanza
    return { stream, camOk: false };
  }
}

// mensajes de error claros al pedir micrófono/cámara
function gumErrorMsg(err, video) {
  const n = err && err.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Permiso denegado. Activa el micrófono' + (video ? ' y la cámara' : '') + ' en los ajustes del navegador.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return video ? 'No se encontró cámara o micrófono' : 'No se encontró micrófono';
  if (n === 'NotReadableError') return 'El micrófono/cámara está siendo usado por otra app';
  return video ? 'No se pudo acceder a la cámara/micrófono' : 'No se pudo acceder al micrófono';
}
// ¿el error de getUserMedia es por permiso bloqueado/denegado?
function isPermDenied(err) { const n = err && err.name; return n === 'NotAllowedError' || n === 'SecurityError'; }
// Maneja el error: si es de permisos, abre la guía con pasos; si no, un aviso.
function handleGumError(err, video) {
  if (isPermDenied(err)) callPermHelp(video);
  else toast(gumErrorMsg(err, video));
}
// Guía visual con los pasos exactos para activar micro/cámara en CADA dispositivo.
// (El navegador no deja cambiar el permiso desde la web; solo podemos explicar cómo.)
function callPermHelp(video) {
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const que = video ? 'el <b>micrófono</b> y la <b>cámara</b>' : 'el <b>micrófono</b>';
  let pasos;
  if (isIOS) {
    pasos = standalone
      ? ['Abre los <b>Ajustes</b> de tu iPhone.', 'Baja hasta encontrar <b>UnderBro</b> en la lista de apps.', `Activa ${que}.`, 'Vuelve a UnderBro e intenta la llamada otra vez.']
      : ['En Safari, toca el icono <b>“aA”</b> a la izquierda de la barra de dirección.', 'Pulsa <b>“Ajustes del sitio web”</b>.', `Pon ${que} en <b>“Permitir”</b>.`, 'Recarga la página.'];
  } else if (isAndroid) {
    pasos = standalone
      ? ['Mantén pulsado el icono de <b>UnderBro</b> en tu pantalla.', 'Toca <b>“Información de la app”</b> (ⓘ).', `Entra en <b>Permisos</b> y activa ${que}.`, 'Vuelve a UnderBro e intenta de nuevo.']
      : ['Toca el <b>candado 🔒</b> a la izquierda de la barra de dirección.', 'Pulsa <b>“Permisos”</b> (o “Configuración del sitio”).', `Activa ${que}.`, 'Recarga la página.'];
  } else {
    pasos = ['Haz clic en el icono de <b>cámara</b> o el <b>candado 🔒</b> a la izquierda de la barra de dirección.', `Selecciona <b>“Permitir”</b> para ${que}.`, 'Recarga la página y vuelve a llamar.'];
  }
  const lista = pasos.map((p, i) => `<li><span class="ph-n">${i + 1}</span><span>${p}</span></li>`).join('');
  const m = openModal(`
    <div class="modal-head"><h3>Activar ${video ? 'micro y cámara' : 'micrófono'}</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <p style="margin:0 0 14px;color:var(--ink-soft);font-size:14px">Para las llamadas, UnderBro necesita permiso para ${que}. Tu dispositivo lo bloqueó; actívalo así:</p>
      <ol class="perm-steps">${lista}</ol>
      <button class="btn primary" id="permRetry" style="width:100%;margin-top:6px">Ya lo activé · reintentar</button>
    </div>`);
  m.querySelector('#permRetry').onclick = async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video }); s.getTracks().forEach(t => t.stop()); m.remove(); toast('¡Permiso concedido! Ya puedes llamar.'); }
    catch (_) { toast('Aún bloqueado. Si acabas de cambiarlo, recarga la página.'); }
  };
}

// Servidores ICE: STUN + TURN de Cloudflare con credenciales temporales.
// Se intentan dos fuentes (RPC de Supabase y función /api/turn de Vercel) y,
// solo si ambas fallan, el TURN público de respaldo. Se cachea ~12h.
let callTurnCache = null;
async function fetchTurnServers() {
  for (let attempt = 0; attempt < 2; attempt++) {
    // 1) RPC en Supabase (si está desplegada)
    try {
      const { data, error } = await sb.rpc('get_turn_credentials');
      const ice = !error && data && data.iceServers;
      if (ice) { console.log('[call] TURN: Cloudflare (RPC)'); return Array.isArray(ice) ? ice : [ice]; }
    } catch (_) {}
    // 2) función serverless en la propia web (con timeout para no colgar)
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch('/api/turn', { method: 'POST', signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) {
        const d = await r.json();
        const ice = d && d.iceServers;
        if (ice) { console.log('[call] TURN: Cloudflare (/api/turn)'); return Array.isArray(ice) ? ice : [ice]; }
      }
    } catch (_) {}
  }
  return null;
}
async function getCallIceServers() {
  const base = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  if (callTurnCache && Date.now() < callTurnCache.exp) return [...base, ...callTurnCache.servers];
  const servers = await fetchTurnServers();
  if (servers) { callTurnCache = { servers, exp: Date.now() + 12 * 3600000 }; return [...base, ...servers]; }
  console.warn('[call] TURN Cloudflare no disponible, uso respaldo público');
  return [...base, ...CALL_ICE_SERVERS.slice(1)];
}

function buildCallPc() {
  const c = state.call;
  const pc = new RTCPeerConnection({ iceServers: c.iceServers || CALL_ICE_SERVERS, iceCandidatePoolSize: 4 });
  c.pc = pc; c.remoteStream = new MediaStream(); c.gotRelay = false; c.gotRemoteCand = false;
  pc.onicecandidate = (e) => {
    if (!e.candidate) { console.log('[call] gathering ICE completo'); return; }
    const cand = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
    const ty = candType(cand.candidate);
    if (ty === 'relay') c.gotRelay = true;
    console.log('[call] candidato local:', ty);
    sendSignal(c, 'ice', { candidate: cand });
  };
  // usar el stream del evento (Safari no renderiza pistas añadidas a un srcObject ya asignado)
  pc.ontrack = (e) => {
    console.log('[call] ontrack', e.track && e.track.kind);
    if (e.streams && e.streams[0]) c.remoteStream = e.streams[0];
    else { try { c.remoteStream.addTrack(e.track); } catch (_) {} }
    // cuando empiezan a llegar frames de verdad (iOS los marca muted al inicio)
    e.track.onunmute = () => { attachCallRemote(); playRemoteMedia(); };
    attachCallRemote();
  };
  // Safari/iOS dispara de forma fiable iceConnectionState; Chrome/FF connectionState.
  const onState = (s) => {
    if (s === 'connected' || s === 'completed') { clearTimeout(c.disconnectTO); onCallConnected(); }
    else if (s === 'disconnected') {
      // transitorio: damos margen antes de intentar recuperar (no cortamos)
      clearTimeout(c.disconnectTO);
      c.disconnectTO = setTimeout(() => {
        const st = pc.iceConnectionState;
        if (state.call === c && st !== 'connected' && st !== 'completed') tryRecoverCall(c);
      }, 6000);
    } else if (s === 'failed') {
      tryRecoverCall(c);   // re-negociar ICE en vez de colgar a la primera
    }
  };
  pc.oniceconnectionstatechange = () => { console.log('[call] iceConnectionState:', pc.iceConnectionState); onState(pc.iceConnectionState); };
  pc.onconnectionstatechange = () => { console.log('[call] connectionState:', pc.connectionState); onState(pc.connectionState); };
}
// recuperación automática: re-negocia la ruta (ICE restart) sin cortar la llamada.
// Solo el que llamó crea la nueva oferta; el receptor pide reinicio al que llamó.
async function tryRecoverCall(c) {
  if (!state.call || state.call !== c || c.ending) return;
  if (c.recovering) return;
  c.recoverN = (c.recoverN || 0) + 1;
  if (c.recoverN > 4) {   // ya hemos intentado bastante
    if (!c.everConnected) callDiagnose(c); else toast('Se perdió la conexión');
    callHangupBtn();
    return;
  }
  console.log('[call] recuperando conexión (intento ' + c.recoverN + ')');
  c.recovering = true;
  setTimeout(() => { if (state.call === c) c.recovering = false; }, 7000);
  if (c.role === 'caller') {
    try {
      const offer = await c.pc.createOffer({ iceRestart: true });
      await c.pc.setLocalDescription(offer);
      sendSignal(c, 'reoffer', { sdp: { type: offer.type, sdp: offer.sdp } });
    } catch (e) { console.error('[call] iceRestart', e); }
  } else {
    sendSignal(c, 'needrestart', {});   // el receptor no puede reiniciar: lo pide
  }
}
// si tras contestar no se conecta en ~25s, abortamos (en vez de cargar para siempre)
function armConnectWatchdog() {
  const c = state.call; if (!c) return;
  clearTimeout(c.connectTO);
  c.connectTO = setTimeout(async () => {
    if (!(state.call && state.call.id === c.id && !state.call.everConnected)) return;
    await callDiagnose(c);
    callHangupBtn();
  }, 40000);
}
// diagnóstico concreto de por qué no conectó (TURN vs intercambio de rutas)
async function callDiagnose(c) {
  if (!c || c.diagnosed) return; c.diagnosed = true;
  let hadRemote = c.gotRemoteCand, pairOk = false;
  try {
    const stats = await c.pc.getStats();
    stats.forEach(r => {
      if (r.type === 'remote-candidate') hadRemote = true;
      if (r.type === 'candidate-pair' && (r.state === 'succeeded' || r.nominated)) pairOk = true;
    });
  } catch (_) {}
  console.warn('[call] DIAGNÓSTICO →', { relayLocal: c.gotRelay, recibioCandidatosRemotos: hadRemote, parejaOk: pairOk });
  let msg;
  if (pairOk) msg = 'Conexión establecida pero sin medios. Reinténtalo.';
  else if (!hadRemote) msg = 'No llegaron las rutas de red del otro usuario (señalización).';
  else if (!c.gotRelay) msg = 'No hay servidor TURN disponible: en esta red la llamada necesita TURN.';
  else msg = 'No se encontró ruta entre los dispositivos. Hace falta un TURN fiable.';
  toast(msg);
}

function onCallConnected() {
  const c = state.call; if (!c || c.everConnected) return;
  c.everConnected = true; c.status = 'connected'; c.startedAt = Date.now();
  console.log('[call] conectada');
  stopRing(); clearTimeout(c.noAnswerTO); clearTimeout(c.connectTO);
  attachCallRemote();
  $('callStatus').textContent = '0:00';
  c.timer = setInterval(() => {
    const cc = state.call; if (!cc || !cc.startedAt) return;
    const txt = fmtDur((Date.now() - cc.startedAt) / 1000);
    $('callStatus').textContent = txt; $('callMiniTime').textContent = txt;
  }, 1000);
  showCallScreen('active'); attachCallLocal();
}

async function onCallSignal(p) {
  if (!p || !p.kind) return;
  // dedupe: cada señal llega por broadcast Y por BD
  if (p.sig) {
    if (callSeenSigs.has(p.sig)) return;
    callSeenSigs.add(p.sig);
    if (callSeenSigs.size > 800) callSeenSigs.clear();
  }
  console.log('[call] señal recibida:', p.kind);
  if (p.kind === 'offer') {
    if (p.ts && Date.now() - p.ts > 40000) return; // oferta caducada (llamada ya terminada)
    if (state.call) {
      if (state.call.id === p.call_id) return; // duplicado de la misma llamada
      // ocupado con otra llamada distinta: rechaza automáticamente
      const tmp = callOutChan(p.from);
      const payload = { kind: 'reject', call_id: p.call_id, from: state.user.id, sig: callId(), reason: 'busy' };
      tmp.send(payload);
      sb.from('call_signals').insert({ call_id: p.call_id, sender_id: state.user.id, recipient_id: p.from, kind: 'reject', payload }).then(() => {}, () => {});
      setTimeout(() => tmp.close(), 1500);
      return;
    }
    if (isHidden(p.from)) return; // bloqueado
    handleIncomingCall(p);
    return;
  }
  const c = state.call;
  if (!c || c.id !== p.call_id) return;
  if (p.kind === 'answer') {
    if (c.role !== 'caller' || c.answered) return; // ignora respuestas duplicadas/cruzadas
    c.answered = true;
    try { await c.pc.setRemoteDescription(p.sdp); flushPendingIce(); } catch (e) { console.error('[call] setRemoteDescription(answer)', e); }
    if (c.status === 'calling' || c.status === 'connecting') { c.status = 'connecting'; $('callStatus').textContent = 'Conectando…'; showCallScreen('active'); armConnectWatchdog(); }
  } else if (p.kind === 'ice') {
    c.gotRemoteCand = true;
    if (c.pc && c.pc.remoteDescription && c.pc.remoteDescription.type) { try { await c.pc.addIceCandidate(p.candidate); } catch (e) { console.error('[call] addIceCandidate', e); } }
    else c.pendingIce.push(p.candidate);
  } else if (p.kind === 'reject') {
    toast(p.reason === 'busy' ? 'Usuario ocupado' : p.reason === 'media' ? 'El otro usuario no pudo activar su micrófono/cámara' : 'Llamada rechazada');
    finalizeCall(p.reason === 'busy' ? 'busy' : (p.reason === 'timeout' ? 'missed' : 'declined'));
    cleanupCall();
  } else if (p.kind === 'reoffer') {
    // ICE restart: el receptor aplica la nueva oferta y responde sin tocar la UI
    if (!c.pc) return;
    try {
      await c.pc.setRemoteDescription(p.sdp); flushPendingIce();
      const ans = await c.pc.createAnswer();
      await c.pc.setLocalDescription(ans);
      sendSignal(c, 'reanswer', { sdp: { type: ans.type, sdp: ans.sdp } });
    } catch (e) { console.error('[call] reoffer', e); }
  } else if (p.kind === 'reanswer') {
    if (!c.pc) return;
    try { await c.pc.setRemoteDescription(p.sdp); flushPendingIce(); } catch (e) { console.error('[call] reanswer', e); }
  } else if (p.kind === 'needrestart') {
    if (c.role === 'caller') tryRecoverCall(c);   // el receptor pidió reinicio
  } else if (p.kind === 'camstate') {
    c.remoteCamOff = !!p.off;          // el otro encendió/apagó su cámara
    attachCallRemote();
  } else if (p.kind === 'cancel') {
    toast('Llamada perdida'); cleanupCall();
  } else if (p.kind === 'hangup') {
    if (c.role === 'caller') finalizeCall(c.everConnected ? 'completed' : 'missed');
    cleanupCall();
  }
}

// acción pendiente pedida desde la notificación (aceptar/rechazar al abrir)
function setAutoCallAction(a) {
  state._autoCallAction = a;
  clearTimeout(state._autoCallTO);
  state._autoCallTO = setTimeout(() => { state._autoCallAction = null; }, 25000);
}
function applyAutoCallAction() {
  const a = state._autoCallAction;
  if (!a) return;
  const c = state.call;
  if (c && c.role === 'callee' && c.status === 'incoming') {
    state._autoCallAction = null; clearTimeout(state._autoCallTO);
    if (a === 'decline') declineCall(false); else acceptCall();
  }
}

async function handleIncomingCall(p) {
  let prof = null; try { ({ data: prof } = await sb.from('profiles').select('*').eq('id', p.from).single()); } catch (_) {}
  state.call = {
    id: p.call_id, peer: p.from, peerProfile: prof, video: !!p.video, role: 'callee', status: 'incoming',
    out: callOutChan(p.from), offer: p.sdp, localStream: null, remoteStream: null, pc: null,
    pendingIce: [], muted: false, camOff: false, facing: 'user', speaker: true,
    startedAt: 0, everConnected: false, logId: null, finalized: false, timer: null,
  };
  showCallScreen('incoming');
  startRingtone();
  haptic(30);
  state.call.incomingTO = setTimeout(() => { if (state.call && state.call.id === p.call_id && state.call.status === 'incoming') declineCall(true); }, 35000);
  applyAutoCallAction();   // si se abrió desde la notificación con Aceptar/Rechazar
}

async function acceptCall() {
  const c = state.call; if (!c || c.role !== 'callee' || c.status !== 'incoming') return;
  clearTimeout(c.incomingTO); stopRing();
  let media;
  try { media = await getCallStream(c.video); }
  catch (err) { console.error('[call] gUM accept', err); handleGumError(err, c.video); declineCall(false, 'media'); return; }
  const stream = media.stream;
  if (c.video && !media.camOk) { c.camOff = true; toast('Tu cámara no está disponible: envías solo audio'); }
  c.iceServers = await getCallIceServers();
  c.localStream = stream; c.status = 'connecting';
  buildCallPc();
  stream.getTracks().forEach(t => c.pc.addTrack(t, stream));
  try {
    await c.pc.setRemoteDescription(c.offer);
    flushPendingIce();
    const answer = await c.pc.createAnswer();
    await c.pc.setLocalDescription(answer);
    console.log('[call] respuesta enviada');
    sendSignal(c, 'answer', { sdp: { type: answer.type, sdp: answer.sdp } });
  } catch (e) { console.error('[call] acceptCall', e); toast('No se pudo conectar la llamada'); callHangupBtn(); return; }
  showCallScreen('active'); $('callStatus').textContent = 'Conectando…'; attachCallLocal(); armConnectWatchdog();
}

function declineCall(isTimeout, reason) {
  const c = state.call; if (!c || c.role !== 'callee') return;
  sendSignal(c, 'reject', { reason: reason || (isTimeout ? 'timeout' : 'declined') });
  cleanupCall();
}

function callHangupBtn() {
  const c = state.call; if (!c) return;
  if (c.role === 'caller') {
    if (c.status === 'calling') { sendSignal(c, 'cancel', {}); finalizeCall('missed'); }
    else { sendSignal(c, 'hangup', {}); finalizeCall(c.everConnected ? 'completed' : 'missed'); }
  } else {
    if (c.status === 'incoming') { declineCall(false); return; }
    sendSignal(c, 'hangup', {});
  }
  cleanupCall();
}

function flushPendingIce() {
  const c = state.call; if (!c || !c.pc) return;
  const list = c.pendingIce.splice(0);
  list.forEach(cand => { try { c.pc.addIceCandidate(cand); } catch (_) {} });
}

// el que llama inserta la fila de la llamada al empezar (dispara la push al receptor)
async function createCallLog() {
  const c = state.call; if (!c || c.role !== 'caller' || c.logId) return;
  const name = JSON.stringify({ video: !!c.video, status: 'ringing', dur: 0 });
  try {
    const { data: sent } = await sb.from('direct_messages')
      .insert({ sender_id: state.user.id, recipient_id: c.peer, body: '', attachment_type: 'call', attachment_name: name })
      .select().single();
    if (sent) {
      c.logId = sent.id;
      if (!state.groupId && state.dmPeer === c.peer) dmAppendMessage(sent, { scroll: true });
    }
  } catch (_) {}
}

// al terminar, actualiza la fila con el estado final y la duración (un solo registro)
async function finalizeCall(status) {
  const c = state.call; if (!c || c.finalized || c.role !== 'caller') return;
  c.finalized = true;
  const dur = c.everConnected && c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
  const name = JSON.stringify({ video: !!c.video, status, dur });
  try {
    if (c.logId) {
      await sb.from('direct_messages').update({ attachment_name: name }).eq('id', c.logId);
      const local = state.dmMsgs.get(c.logId);
      if (local) { local.attachment_name = name; replaceRow(local); }
    } else {
      const { data: sent } = await sb.from('direct_messages')
        .insert({ sender_id: state.user.id, recipient_id: c.peer, body: '', attachment_type: 'call', attachment_name: name })
        .select().single();
      if (sent && !state.groupId && state.dmPeer === c.peer) dmAppendMessage(sent, { scroll: true });
    }
  } catch (_) {}
}

/* ---- UI de la pantalla de llamada ---- */
function showCallScreen(mode) {
  const c = state.call; if (!c) return;
  const cs = $('callScreen');
  cs.classList.add('open'); cs.setAttribute('aria-hidden', 'false');
  cs.classList.toggle('video-call', !!c.video);
  $('callPeerName').textContent = c.peerProfile ? (c.peerProfile.display_name || c.peerProfile.username || 'Usuario') : 'Usuario';
  $('callPoster').innerHTML = avatarHTML(c.peerProfile);
  $('callIncoming').classList.toggle('show', mode === 'incoming');
  $('callControls').classList.toggle('show', mode !== 'incoming');
  $('callVideoBtn').style.display = c.video ? '' : 'none';
  $('callVideoBtn').classList.toggle('off', !!c.camOff);
  $('callVideoBtn').querySelector('use').setAttribute('href', c.camOff ? '#i-video-off' : '#i-video');
  $('callFlipBtn').style.display = (c.video && mode !== 'incoming') ? '' : 'none';
  $('callMinBtn').style.display = mode === 'incoming' ? 'none' : '';
  $('callMiniName').textContent = c.peerProfile ? (c.peerProfile.display_name || c.peerProfile.username || 'Usuario') : 'Usuario';
  if (mode === 'incoming') $('callStatus').textContent = c.video ? 'Videollamada entrante…' : 'Llamada entrante…';
  else if (mode === 'outgoing') $('callStatus').textContent = 'Llamando…';
  attachCallRemote();
  if (mode !== 'incoming') attachCallLocal();   // self-view también mientras suena
}
function attachCallLocal() {
  const c = state.call; if (!c) return; const v = $('callLocalVideo'); const wrap = v.parentElement;
  const show = c.video && !c.camOff && c.localStream && c.localStream.getVideoTracks().length;
  if (show) { v.srcObject = c.localStream; wrap.classList.add('show'); v.play && v.play().catch(() => {}); }
  else { wrap.classList.remove('show'); }
}
function attachCallRemote() {
  const c = state.call; if (!c) return; const v = $('callRemoteVideo');
  if (v.srcObject !== c.remoteStream) v.srcObject = c.remoteStream || null;
  v.muted = false; v.volume = 1;
  playRemoteMedia();
  const hasVideo = !!(c.remoteStream && c.remoteStream.getVideoTracks().length) && !c.remoteCamOff;
  $('callPoster').classList.toggle('show', !hasVideo);
}
// iOS/Safari a veces rechaza el primer play(); reintentamos unas cuantas veces.
function playRemoteMedia(tries = 6) {
  const v = $('callRemoteVideo'); if (!v || !v.srcObject) return;
  const p = v.play && v.play();
  if (p && p.catch) p.catch(() => { if (tries > 0) setTimeout(() => playRemoteMedia(tries - 1), 350); });
}
function hideCallScreen() {
  const cs = $('callScreen'); cs.classList.remove('open', 'video-call', 'minimized'); cs.setAttribute('aria-hidden', 'true');
  $('callIncoming').classList.remove('show'); $('callControls').classList.remove('show');
  $('callMuteBtn').classList.remove('off'); $('callMuteBtn').querySelector('use').setAttribute('href', '#i-mic');
  $('callVideoBtn').classList.remove('off'); $('callVideoBtn').querySelector('use').setAttribute('href', '#i-video');
  $('callSpeakerBtn').classList.remove('off'); $('callSpeakerBtn').querySelector('use').setAttribute('href', '#i-vol');
  $('callPoster').classList.add('show'); $('callLocalVideo').parentElement.classList.remove('show');
}
function toggleCallMute() {
  const c = state.call; if (!c || !c.localStream) return;
  c.muted = !c.muted; c.localStream.getAudioTracks().forEach(t => t.enabled = !c.muted);
  $('callMuteBtn').classList.toggle('off', c.muted);
  $('callMuteBtn').querySelector('use').setAttribute('href', c.muted ? '#i-mic-off' : '#i-mic');
  toast(c.muted ? 'Micrófono silenciado' : 'Micrófono activado');
}
function toggleCallCam() {
  const c = state.call; if (!c || !c.localStream) return;
  const vt = c.localStream.getVideoTracks();
  if (!vt.length) { toast(c.video ? 'No tienes cámara disponible' : 'Llamada solo de voz'); return; }
  c.camOff = !c.camOff; vt.forEach(t => t.enabled = !c.camOff);
  sendSignal(c, 'camstate', { off: c.camOff });   // el otro lado muestra avatar/vídeo
  $('callVideoBtn').classList.toggle('off', c.camOff);
  $('callVideoBtn').querySelector('use').setAttribute('href', c.camOff ? '#i-video-off' : '#i-video');
  attachCallLocal();
}
async function toggleCallSpeaker() {
  const c = state.call; if (!c) return;
  c.speaker = !c.speaker;
  $('callSpeakerBtn').classList.toggle('off', !c.speaker);
  $('callSpeakerBtn').querySelector('use').setAttribute('href', c.speaker ? '#i-vol' : '#i-vol-off');
  const v = $('callRemoteVideo');
  // mejor esfuerzo: enrutar a auricular/altavoz donde el navegador lo permita
  try {
    if (typeof v.setSinkId === 'function' && navigator.mediaDevices?.enumerateDevices) {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const outs = devs.filter(d => d.kind === 'audiooutput');
      const pick = c.speaker
        ? outs.find(d => /speaker|altavoz/i.test(d.label))
        : outs.find(d => /earpiece|receiver|auricular/i.test(d.label));
      if (pick) await v.setSinkId(pick.deviceId);
    }
  } catch (_) {}
  toast(c.speaker ? '🔊 Altavoz' : '🔈 Auricular');
}
async function switchCallCamera() {
  const c = state.call; if (!c || !c.video || !c.localStream) return;
  const next = c.facing === 'environment' ? 'user' : 'environment';
  let ns;
  try { ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next } }, audio: false }); }
  catch (_) { toast('No se pudo cambiar de cámara'); return; }
  const nt = ns.getVideoTracks()[0]; if (!nt) return;
  const sender = c.pc && c.pc.getSenders().find(s => s.track && s.track.kind === 'video');
  if (sender) { try { await sender.replaceTrack(nt); } catch (_) {} }
  const old = c.localStream.getVideoTracks()[0];
  if (old) { c.localStream.removeTrack(old); old.stop(); }
  c.localStream.addTrack(nt);
  c.facing = next; c.camOff = false;
  $('callVideoBtn').classList.remove('off'); $('callVideoBtn').querySelector('use').setAttribute('href', '#i-video');
  attachCallLocal();
}
function minimizeCall() { if (state.call) $('callScreen').classList.add('minimized'); }
function expandCall() { $('callScreen').classList.remove('minimized'); }
function cleanupCall() {
  const c = state.call; if (!c) return; c.ending = true; state.call = null;
  stopRing();
  clearTimeout(c.noAnswerTO); clearTimeout(c.incomingTO); clearTimeout(c.connectTO); clearTimeout(c.disconnectTO); clearInterval(c.timer);
  try { c.localStream && c.localStream.getTracks().forEach(t => t.stop()); } catch (_) {}
  try { c.pc && (c.pc.onicecandidate = c.pc.ontrack = c.pc.onconnectionstatechange = c.pc.oniceconnectionstatechange = null, c.pc.close()); } catch (_) {}
  try { c.out && c.out.close(); } catch (_) {}
  sb.from('call_signals').delete().eq('call_id', c.id).then(() => {}, () => {});  // limpia señales de esta llamada
  $('callRemoteVideo').srcObject = null; $('callLocalVideo').srcObject = null;
  hideCallScreen();
}

/* ---- tonos (WebAudio): ringback de espera + tono de entrante ---- */
let callRingActive = false;
function callTone(freq, dur, vol) {
  try {
    if (!callAudioCtx) callAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (callAudioCtx.state === 'suspended') callAudioCtx.resume().catch(() => {});
    const osc = callAudioCtx.createOscillator(), g = callAudioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.value = 0.0001; osc.connect(g); g.connect(callAudioCtx.destination);
    const t = callAudioCtx.currentTime;
    g.gain.exponentialRampToValueAtTime(vol || 0.13, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch (_) {}
}
// tono de espera (lo oye quien llama): patrón 1,5 s tono / 3 s silencio a 425 Hz
function startRingback() {
  stopRing(); callRingActive = true;
  const loop = () => {
    if (!callRingActive) return;
    callTone(425, 1.4, 0.12);
    callRingTimer = setTimeout(loop, 4400);
  };
  loop();
}
// tono de entrante (lo oye quien recibe): doble timbre + vibración
function startRingtone() {
  stopRing(); callRingActive = true;
  const loop = () => {
    if (!callRingActive) return;
    callTone(480, 0.4, 0.16);
    setTimeout(() => { if (callRingActive) callTone(440, 0.4, 0.16); }, 550);
    try { navigator.vibrate && navigator.vibrate([350, 200, 350]); } catch (_) {}
    callRingTimer = setTimeout(loop, 2600);
  };
  loop();
}
function stopRing() {
  callRingActive = false;
  if (callRingTimer) { clearTimeout(callRingTimer); clearInterval(callRingTimer); callRingTimer = null; }
  try { navigator.vibrate && navigator.vibrate(0); } catch (_) {}
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
  if (m.attachment_type === 'call') { const mt = safeMeta(m); return (mt.video ? '📹 ' : '📞 ') + callStatusLabel(mt.status, mt.dur, m.sender_id === state.user?.id); }
  if (m.attachment_url) return '📎 ' + (m.attachment_name || 'Archivo');
  return '';
}
function callStatusLabel(status, dur, mine) {
  if (status === 'completed') return (mine ? 'Llamada saliente' : 'Llamada entrante') + ' · ' + fmtDur(dur || 0);
  if (status === 'declined') return 'Llamada rechazada';
  if (status === 'busy') return 'Ocupado';
  if (status === 'ringing' || status === 'connected') return mine ? 'Llamada saliente…' : 'Llamada entrante…';
  return mine ? 'Llamada sin respuesta' : 'Llamada perdida';
}
function dmStatusText() {
  const p = state.dmPeerProfile; if (!p) return '';
  const online = state.online.some(u => u.id === p.id);
  return online ? '<span class="dot-online"></span> en línea' : '@' + esc(p.username || '');
}

/* ---- render de burbujas ---- */
function quotedHTML(id) {
  const q = state.dmMsgs.get(id);
  const who = q ? (q.sender_id === state.user.id ? 'Tú' : (state.groupId ? groupSenderName(q.sender_id) : (state.dmPeerProfile?.display_name || state.dmPeerProfile?.username || ''))) : '';
  const snip = q ? (q.deleted ? 'mensaje eliminado' : (q.body || mediaLabel(q))) : 'Mensaje';
  return `<button class="dm-quote" data-jump="${esc(id)}"><span class="dq-who">${esc(who)}</span><span class="dq-snip">${esc((snip || '').slice(0, 90))}</span></button>`;
}
function statusTicks(msg) {
  return msg.read
    ? `<svg class="dm-tick read"><use href="#i-check-double"/></svg>`
    : `<svg class="dm-tick"><use href="#i-check"/></svg>`;
}
function mediaHTML(msg) {
  if (msg.attachment_type === 'call') {
    const mt = safeMeta(msg);
    const missed = ['missed', 'declined', 'busy'].includes(mt.status);
    const label = callStatusLabel(mt.status, mt.dur, msg.sender_id === state.user?.id);
    return `<div class="dm-call ${missed ? 'missed' : ''}"><span class="dm-call-ic"><svg fill="none" stroke="currentColor"><use href="#i-${mt.video ? 'video' : 'phone'}"/></svg></span><span class="dm-call-txt">${esc(label)}</span></div>`;
  }
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
  return `<a class="dm-filechip" href="${esc(czHref(msg.attachment_url))}" target="_blank" rel="noopener"><svg fill="none"><use href="#i-file"/></svg><span class="fn">${esc(msg.attachment_name || 'archivo')}</span></a>`;
}
function groupSenderName(id) { const p = state.groupMembers[id]; return p ? (p.display_name || p.username || 'usuario') : 'usuario'; }
function bubbleHTML(msg) {
  const mine = msg.sender_id === state.user.id;
  const sender = (state.groupId && !mine) ? `<span class="dm-sender">${esc(groupSenderName(msg.sender_id))}</span>` : '';
  if (msg.deleted) {
    return `<div class="dm-bubble ${mine ? 'me' : 'them'} dm-deleted">${sender}<svg class="dm-del-ico"><use href="#i-x"/></svg><i>Se eliminó este mensaje</i><span class="t">${dmTime(msg.created_at)}</span></div>`;
  }
  const quote = msg.reply_to ? quotedHTML(msg.reply_to) : '';
  const media = mediaHTML(msg);
  const isTrack = msg.attachment_type === 'track';
  const cap = (msg.body && !isTrack) ? `<div class="dm-cap">${linkifyMentions(msg.body)}</div>` : '';
  const edited = msg.edited ? `<span class="dm-edited">editado</span>` : '';
  const ticks = (mine && !state.groupId) ? statusTicks(msg) : '';
  const meta = `<span class="t">${edited}${dmTime(msg.created_at)}${ticks}</span>`;
  return `<div class="dm-bubble ${mine ? 'me' : 'them'} ${media ? 'has-media' : ''}">${sender}${quote}${media}${cap}${meta}</div>`;
}
function reactionsInner(messageId) {
  const map = state.dmReacts.get(messageId); if (!map) return '';
  const uid = state.user.id;
  return Object.entries(map).filter(([, s]) => s.size).map(([e, s]) =>
    `<button class="dm-react ${s.has(uid) ? 'mine' : ''}" data-emoji="${esc(e)}">${esc(e)}<span class="rc">${s.size}</span></button>`).join('');
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
  const reactBar = state.groupId ? '' : `<div class="as-reactbar">${DM_QUICK_EMOJI.map(e => `<button class="as-react" data-e="${e}">${e}</button>`).join('')}<button class="as-react more" data-more aria-label="Más emojis"><svg fill="none" stroke="currentColor"><use href="#i-plus"/></svg></button></div>`;
  const items = [`<button class="as-item" data-a="reply"><svg fill="none" stroke="currentColor"><use href="#i-reply"/></svg> Responder</button>`];
  if (msg.body) items.push(`<button class="as-item" data-a="copy"><svg fill="none" stroke="currentColor"><use href="#i-copy"/></svg> Copiar</button>`);
  if (mine && msg.body) items.push(`<button class="as-item" data-a="edit"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg> Editar</button>`);
  if (mine) items.push(`<button class="as-item danger" data-a="del"><svg fill="none" stroke="currentColor"><use href="#i-trash"/></svg> Eliminar para todos</button>`);
  if (!mine && !msg.deleted) items.push(`<button class="as-item danger" data-a="report"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg> Reportar mensaje</button>`);
  const sheet = el(`<div class="modal-backdrop sheet"><div class="action-sheet">${reactBar}${items.join('')}<button class="as-item cancel" data-a="cancel">Cancelar</button></div></div>`);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelectorAll('.as-react[data-e]').forEach(b => b.onclick = () => { close(); toggleReaction(msg.id, b.dataset.e); });
  sheet.querySelector('[data-more]')?.addEventListener('click', () => { close(); openReactPicker(msg); });
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
  const who = msg.sender_id === state.user.id ? 'Tú' : (state.groupId ? groupSenderName(msg.sender_id) : (state.dmPeerProfile?.display_name || state.dmPeerProfile?.username || ''));
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
    const { error } = await sb.from(msg.conversation_id ? 'group_messages' : 'direct_messages').update({ body: nb, edited: true }).eq('id', msg.id);
    if (error) { toast('No se pudo editar'); return; }
    msg.body = nb; msg.edited = true; state.dmMsgs.set(msg.id, msg); replaceRow(msg);
    m.remove(); toast('Mensaje editado');
  };
}
async function softDeleteMessage(msg) {
  if (!confirm('¿Eliminar este mensaje para todos?')) return;
  const { error } = await sb.from(msg.conversation_id ? 'group_messages' : 'direct_messages').update({ deleted: true }).eq('id', msg.id);
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
  // emoji llega por broadcast en tiempo real (no pasa por la BD/RLS): validar
  if (typeof emoji !== 'string' || !emoji || emoji.length > 8 || /[<>&"']/.test(emoji)) return;
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
  const isGroup = !!state.groupId;
  const other = state.dmPeer;
  if (!isGroup) {
    if (!other) return;
    if (state.blocked.has(other)) { toast('Has bloqueado a este usuario. Desbloquéalo para escribirle.'); return; }
    if (state.hidden.has(other)) { toast('No puedes enviar mensajes a este usuario.'); return; }
  }
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
  const baseRow = isGroup
    ? { conversation_id: state.groupId, sender_id: state.user.id, body, attachment_url, attachment_type, attachment_name, reply_to }
    : { sender_id: state.user.id, recipient_id: other, body, attachment_url, attachment_type, attachment_name, reply_to };
  const { data: sent, error } = await sb.from(isGroup ? 'group_messages' : 'direct_messages')
    .insert(baseRow).select().single();
  if (error) { toast('No se pudo enviar'); return; }
  dmAppendMessage(sent, { scroll: true });
}
async function dmSendAudio(blob, secs, peaks) {
  const isGroup = !!state.groupId;
  const other = state.dmPeer;
  if ((!isGroup && !other) || !requireNotBanned()) return;
  try {
    const path = `${state.user.id}/${Date.now()}.webm`;
    const up = await sb.storage.from('chat').upload(path, blob, { contentType: blob.type || 'audio/webm' });
    if (up.error) throw up.error;
    const url = sb.storage.from('chat').getPublicUrl(path).data.publicUrl;
    const reply_to = state.dmReplyTo?.id || null; cancelReply();
    const name = JSON.stringify({ d: secs, w: (peaks && peaks.length) ? peaks : undefined });
    const baseRow = isGroup
      ? { conversation_id: state.groupId, sender_id: state.user.id, body: '', attachment_url: url, attachment_type: 'audio', attachment_name: name, reply_to }
      : { sender_id: state.user.id, recipient_id: other, body: '', attachment_url: url, attachment_type: 'audio', attachment_name: name, reply_to };
    const { data: sent, error } = await sb.from(isGroup ? 'group_messages' : 'direct_messages')
      .insert(baseRow).select().single();
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
  if (state.groupId) { openGroupInfo(state.groupId); return; }
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
  sheet.querySelector('[data-a="block"]').onclick = () => { close(); if (blocked) unblockUser(other); else blockUser(other, peerName, closeDmScreen); };
  sheet.querySelector('[data-a="report"]').onclick = () => { close(); openReportModal('user', other, other, '@' + (state.dmPeerProfile?.username || '')); };
  $('modalRoot').appendChild(sheet);
}

function closeDmScreen() {
  $('dmScreen').classList.remove('open');
  if (state.dmConv) { try { sb.removeChannel(state.dmConv); } catch (_) {} state.dmConv = null; }
  if (dmMediaRec) dmStopRec(false);
  if (dmVoiceEl) { dmVoiceEl.pause(); dmVoiceEl = null; }
  state.dmPeer = null; state.dmPeerProfile = null; state.dmMsgs.clear(); state.dmReacts.clear();
  state.groupId = null; state.groupConv = null; state.groupMembers = {};
  cancelReply(); clearDmPending(); dmCloseSearch(); dmHideEmoji(); dmShowTyping(false);
  if (state.view === 'messages') renderMessages();
}
async function refreshDmBadge() {
  const { count } = await sb.from('direct_messages').select('id', { count: 'exact', head: true })
    .eq('recipient_id', state.user.id).eq('read', false);
  const n = count || 0;
  const badge = $('dmBadge'), side = $('dmCount');
  if (n > 0) { if (badge) { badge.textContent = n; badge.classList.remove('hidden'); } if (side) side.textContent = n; }
  else { if (badge) badge.classList.add('hidden'); if (side) side.textContent = ''; }
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
function isDesktopChat() { return matchMedia('(min-width: 1025px)').matches; }
function openRightPanel() {
  if (isDesktopChat()) { $('app').classList.remove('right-collapsed'); try { localStorage.setItem('ub_right_collapsed', '0'); } catch (_) {} }
  else { const r = rightEl(); if (!r.classList.contains('open')) toggleRight(); }
  setTimeout(scrollChat, 60);
}
function closeRightPanel() {
  if (isDesktopChat()) { $('app').classList.add('right-collapsed'); try { localStorage.setItem('ub_right_collapsed', '1'); } catch (_) {} }
  else { const r = rightEl(); r.classList.remove('open'); $('drawerBackdrop')?.classList.remove('show'); }
}
function openCommunityChat() { openRightPanel(); }
function convoRow(c, p) {
  const last = c.last;
  const mine = last && last.sender_id === state.user.id;
  const online = state.online.some(u => u.id === c.other);
  let snip;
  if (!last) snip = 'Toca para escribir…';
  else if (last.deleted) snip = '🚫 Mensaje eliminado';
  else if (last.attachment_url) {
    if (last.attachment_type === 'track') snip = last.body || '🎵 Pista';
    else { const lbl = last.attachment_type === 'image' ? '📷 Foto' : last.attachment_type === 'video' ? '🎬 Vídeo' : last.attachment_type === 'audio' ? '🎙️ Nota de voz' : '📎 Archivo'; snip = lbl + (last.body ? ' · ' + last.body : ''); }
  } else snip = last.body;
  const row = el(`
    <div class="convo" data-uid="${c.other}">
      ${avatarHTML(p)}
      <div class="c-main">
        <div class="c-top"><span class="c-name">${esc(p.display_name || p.username || 'usuario')}</span><span class="c-when">${last ? timeAgo(last.created_at) : ''}</span></div>
        <div class="c-snippet ${c.unread ? 'unread' : ''}${last ? '' : ' muted'}">${mine ? 'Tú: ' : ''}${esc(snip || '')}</div>
      </div>
      ${c.unread ? '<span class="c-unread"></span>' : (online ? '<span class="conv-dot" title="En línea"></span>' : '')}
    </div>`);
  row.onclick = () => openDM(c.other);
  attachLongPress(row, () => convoMenu(c, p));
  return row;
}
// menú al mantener pulsado una conversación en la lista de chats
function convoMenu(c, p) {
  const other = c.other;
  const name = p.display_name || p.username || 'usuario';
  const blocked = state.blocked.has(other);
  return {
    title: name,
    items: [
      { label: 'Ver perfil', icon: 'people', onClick: () => openProfile(other) },
      c.unread ? { label: 'Marcar como leído', icon: 'check-double', onClick: () => { markDmRead(other); renderMessages(); } } : null,
      { label: 'Eliminar chat', icon: 'trash', danger: true, onClick: () => { state.hiddenConvos.add(other); saveHiddenConvos(); renderMessages(); toast('Chat eliminado de tu lista'); } },
      { label: blocked ? 'Desbloquear' : 'Bloquear', icon: 'x', danger: !blocked, onClick: () => { if (blocked) unblockUser(other, () => renderMessages()); else blockUser(other, name, () => renderMessages()); } },
      { label: 'Reportar usuario', icon: 'bell', danger: true, onClick: () => openReportModal('user', other, other, '@' + (p.username || '')) },
    ],
  };
}
function saveHiddenConvos() { try { localStorage.setItem('ub_hidden_convos', JSON.stringify([...state.hiddenConvos])); } catch (_) {} }
async function renderMessages() {
  setActiveNav('messages');
  $('main').innerHTML = `<div class="main-head"><div><h2>Chats</h2><div class="sub">Tus conversaciones</div></div><div style="display:flex;gap:8px;align-items:center"><button class="btn sm" id="newGroupBtn"><svg fill="none" stroke="currentColor"><use href="#i-people"/></svg> Nuevo grupo</button><div id="pushBtnWrap" class="push-btn-wrap"></div></div></div><div id="convoList" class="loading"><div class="spinner"></div></div>`;
  renderPushButton();
  $('newGroupBtn').onclick = openCreateGroup;
  const { data } = await sb.from('direct_messages').select('*')
    .or(`sender_id.eq.${state.user.id},recipient_id.eq.${state.user.id}`)
    .order('created_at', { ascending: false }).limit(400);
  const convos = new Map();
  (data || []).forEach(mm => {
    const other = mm.sender_id === state.user.id ? mm.recipient_id : mm.sender_id;
    if (isHidden(other)) return; // ocultar conversaciones con usuarios bloqueados
    if (state.hiddenConvos.has(other)) return; // chats eliminados localmente
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

  // Grupos del usuario
  try {
    const { data: memberRows } = await sb.from('conversation_members')
      .select('last_read_at, conversations:conversation_id(*)').eq('user_id', state.user.id);
    const groups = (memberRows || []).filter(r => r.conversations).map(r => ({ ...r.conversations, last_read_at: r.last_read_at }));
    if (groups.length) {
      const gIds = groups.map(g => g.id);
      const { data: gms } = await sb.from('group_messages').select('*').in('conversation_id', gIds)
        .order('created_at', { ascending: false }).limit(300);
      const lastByConv = {}, unreadByConv = {};
      (gms || []).forEach(mm => {
        if (!lastByConv[mm.conversation_id]) lastByConv[mm.conversation_id] = mm;
        const g = groups.find(x => x.id === mm.conversation_id);
        if (g && mm.sender_id !== state.user.id && (!g.last_read_at || new Date(mm.created_at) > new Date(g.last_read_at))) unreadByConv[mm.conversation_id] = (unreadByConv[mm.conversation_id] || 0) + 1;
      });
      groups.sort((a, b) => new Date((lastByConv[b.id]?.created_at) || b.created_at) - new Date((lastByConv[a.id]?.created_at) || a.created_at));
      list.appendChild(el(`<div class="convo-section"><svg style="width:14px;height:14px;vertical-align:-2px" fill="none" stroke="currentColor"><use href="#i-people"/></svg> Grupos (${groups.length})</div>`));
      groups.forEach(g => list.appendChild(groupRow(g, lastByConv[g.id], unreadByConv[g.id] || 0)));
    }
  } catch (err) { console.error('grupos', err); }

  // buscador + lista de TODOS los bros (todos los usuarios de UnderBro)
  list.appendChild(el(`<div class="convo-search"><svg fill="none" stroke="currentColor"><use href="#i-search"/></svg><input type="text" id="broSearch" placeholder="Buscar bros…" autocomplete="off"></div>`));
  const broList = el('<div id="broList"></div>'); list.appendChild(broList);
  const { data: allProfs } = await sb.from('profiles').select('id,username,display_name,avatar_url,verified,is_admin,theme')
    .neq('id', state.user.id).order('display_name', { ascending: true }).limit(600);
  const profsArr = (allProfs || []).filter(p => !state.blocked.has(p.id) && !isHidden(p.id));
  const renderBros = (term) => {
    const q = (term || '').trim().toLowerCase();
    broList.innerHTML = '';
    const onlineIds = new Set(state.online.map(u => u.id));
    let rows = profsArr;
    if (q) rows = rows.filter(p => ((p.display_name || '') + ' ' + (p.username || '')).toLowerCase().includes(q));
    const meta = rows.map(p => ({ p, c: convos.get(p.id) || { other: p.id, last: null, unread: 0 } }));
    const byRecent = (a, b) => (new Date((b.c.last && b.c.last.created_at) || 0) - new Date((a.c.last && a.c.last.created_at) || 0)) || (a.p.display_name || a.p.username || '').localeCompare(b.p.display_name || b.p.username || '');
    const on = meta.filter(x => onlineIds.has(x.p.id)).sort(byRecent);
    const off = meta.filter(x => !onlineIds.has(x.p.id)).sort(byRecent);
    if (!on.length && !off.length) { broList.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-people"/></svg><p>${q ? 'Ningún bro encontrado.' : 'Aún no hay otros usuarios.'}</p></div>`; return; }
    if (on.length) { broList.appendChild(el(`<div class="convo-section"><span class="dot-online"></span> En línea (${on.length})</div>`)); on.forEach(x => broList.appendChild(convoRow(x.c, x.p))); }
    if (off.length) { broList.appendChild(el(`<div class="convo-section">Bros (${off.length})</div>`)); off.forEach(x => broList.appendChild(convoRow(x.c, x.p))); }
  };
  $('broSearch').oninput = (e) => renderBros(e.target.value);
  renderBros('');
}

async function openDM(other) {
  if (!other || other === state.user.id) return;
  if (state.hiddenConvos.has(other)) { state.hiddenConvos.delete(other); saveHiddenConvos(); }
  const { data: prof } = await sb.from('profiles').select('*').eq('id', other).single();
  if (!prof) { toast('Usuario no encontrado'); return; }
  state.dmPeer = other; state.dmPeerProfile = prof;
  cancelReply(); clearDmPending(); dmCloseSearch(); dmHideEmoji();
  const name = prof.display_name || prof.username;
  const online = state.online.some(u => u.id === other);
  $('dmPeerHead').innerHTML = `${avatarHTML(prof)}<div class="dm-peer-meta"><div class="dm-name">${esc(name)}${verifiedBadge(prof)}</div><div class="dm-status" id="dmStatus">${online ? '<span class="dot-online"></span> en línea' : '@' + esc(prof.username)}</div></div>`;
  $('dmPeerHead').onclick = () => { closeDmScreen(); openProfile(other); };
  $('dmInput').placeholder = `Mensaje para ${name}...`;
  $('dmCallBtn').classList.toggle('hidden', !callSupported());
  $('dmVideoBtn').classList.toggle('hidden', !callSupported());
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
   GRUPOS DE CHAT  (reutilizan la pantalla y las burbujas de los DM)
   ======================================================================= */
function groupAvatarHTML(conv) {
  if (conv && conv.avatar_url) return `<div class="avatar group-av"><img src="${esc(czUrl(conv.avatar_url))}" alt="" /></div>`;
  return `<div class="avatar group-av group-av-empty"><svg width="20" height="20" fill="none" stroke="#fff"><use href="#i-people"/></svg></div>`;
}
function markGroupRead(convId) {
  sb.from('conversation_members').update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', convId).eq('user_id', state.user.id).then(() => {}, () => {});
}
function groupRow(conv, last, unread) {
  let snip = 'Grupo creado';
  if (last) {
    if (last.deleted) snip = '🚫 Mensaje eliminado';
    else if (last.attachment_url) snip = mediaLabel(last) || '📎 Adjunto';
    else snip = last.body || '';
  }
  const who = last ? (last.sender_id === state.user.id ? 'Tú: ' : (groupLastSenderPrefix(conv, last))) : '';
  const row = el(`
    <div class="convo">
      ${groupAvatarHTML(conv)}
      <div class="c-main">
        <div class="c-top"><span class="c-name">${esc(conv.name)}</span>${last ? `<span class="c-when">${timeAgo(last.created_at)}</span>` : ''}</div>
        <div class="c-snippet ${unread ? 'unread' : ''}">${who}${esc(snip)}</div>
      </div>
      ${unread ? `<span class="c-unread">${unread}</span>` : ''}
    </div>`);
  row.onclick = () => openGroup(conv);
  return row;
}
function groupLastSenderPrefix() { return ''; }
async function openGroup(conv) {
  if (!conv || !conv.id) return;
  state.dmPeer = null; state.dmPeerProfile = null;
  state.groupId = conv.id; state.groupConv = conv;
  cancelReply(); clearDmPending(); dmCloseSearch(); dmHideEmoji();
  if (state.dmConv) { try { sb.removeChannel(state.dmConv); } catch (_) {} state.dmConv = null; }
  const { data: members } = await sb.from('conversation_members').select('user_id, role, profiles:user_id(*)').eq('conversation_id', conv.id);
  state.groupMembers = {};
  (members || []).forEach(mm => { if (mm.profiles) state.groupMembers[mm.user_id] = { ...mm.profiles, role: mm.role }; });
  const count = (members || []).length;
  $('dmPeerHead').innerHTML = `${groupAvatarHTML(conv)}<div class="dm-peer-meta"><div class="dm-name">${esc(conv.name)}</div><div class="dm-status" id="dmStatus">${count} ${count === 1 ? 'miembro' : 'miembros'}</div></div>`;
  $('dmPeerHead').onclick = () => openGroupInfo(conv.id);
  $('dmCallBtn').classList.add('hidden');
  $('dmVideoBtn').classList.add('hidden');
  $('dmInput').placeholder = 'Mensaje al grupo...';
  $('dmThread').innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  $('dmScreen').classList.add('open');
  hideDrawers();
  const { data } = await sb.from('group_messages').select('*').eq('conversation_id', conv.id).order('created_at', { ascending: true }).limit(400);
  state.dmReacts.clear();
  renderThread(data || []);
  markGroupRead(conv.id);
  setTimeout(() => $('dmInput')?.focus(), 120);
}
// selector de personas con búsqueda y multi-selección (para crear/añadir)
async function pickPeople({ title, confirmLabel, exclude = [], onConfirm }) {
  const m = openModal(`
    <div class="modal-head"><h3>${esc(title)}</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="field" style="margin-bottom:8px"><input type="text" id="ppSearch" placeholder="Buscar persona…" autocomplete="off" /></div>
      <div id="ppList" class="grp-pick-list"><div class="loading" style="padding:20px"><div class="spinner"></div></div></div>
      <button class="btn primary" id="ppGo" style="width:100%;margin-top:10px" disabled>${esc(confirmLabel)}</button>
    </div>`);
  const sel = new Set();
  const exSet = new Set([state.user.id, ...exclude]);
  const { data: people } = await sb.from('profiles').select('id, username, display_name, avatar_url').order('display_name').limit(500);
  const all = (people || []).filter(p => !exSet.has(p.id) && !isHidden(p.id));
  const listBox = m.querySelector('#ppList'), goBtn = m.querySelector('#ppGo');
  const refresh = () => { goBtn.disabled = sel.size === 0; goBtn.textContent = sel.size ? `${confirmLabel} (${sel.size})` : confirmLabel; };
  const render = (q) => {
    const arr = !q ? all : all.filter(p => (p.display_name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q));
    listBox.innerHTML = arr.length ? '' : '<div class="sub" style="font-size:12px;color:var(--ink-soft);padding:14px;text-align:center">Sin resultados.</div>';
    arr.forEach(p => {
      const row = el(`<div class="grp-pick ${sel.has(p.id) ? 'on' : ''}" data-id="${p.id}">${avatarHTML(p)}<div class="gp-main"><div class="gp-name">${esc(p.display_name || p.username)}</div><div class="gp-handle">@${esc(p.username || '')}</div></div><span class="gp-check"><svg fill="none" stroke="currentColor"><use href="#i-check"/></svg></span></div>`);
      row.onclick = () => { if (sel.has(p.id)) sel.delete(p.id); else sel.add(p.id); row.classList.toggle('on', sel.has(p.id)); refresh(); };
      listBox.appendChild(row);
    });
  };
  render('');
  m.querySelector('#ppSearch').oninput = (e) => render(e.target.value.trim().toLowerCase());
  goBtn.onclick = () => { if (!sel.size) return; m.remove(); onConfirm([...sel]); };
}
async function openCreateGroup() {
  if (!requireNotBanned()) return;
  const m = openModal(`
    <div class="modal-head"><h3>Nuevo grupo</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label>Nombre del grupo</label><input type="text" id="grpName" maxlength="60" placeholder="Mi grupo" /></div>
      <div class="field" style="margin-bottom:6px"><label>Miembros</label><input type="text" id="grpSearch" placeholder="Buscar persona…" autocomplete="off" /></div>
      <div id="grpList" class="grp-pick-list"><div class="loading" style="padding:20px"><div class="spinner"></div></div></div>
      <button class="btn primary" id="grpCreate" style="width:100%;margin-top:10px">Crear grupo</button>
      <div class="auth-msg" id="grpMsg"></div>
    </div>`);
  const sel = new Set();
  const { data: people } = await sb.from('profiles').select('id, username, display_name, avatar_url').neq('id', state.user.id).order('display_name').limit(500);
  const all = (people || []).filter(p => !isHidden(p.id));
  const listBox = m.querySelector('#grpList');
  const render = (q) => {
    const arr = !q ? all : all.filter(p => (p.display_name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q));
    listBox.innerHTML = '';
    arr.forEach(p => {
      const row = el(`<div class="grp-pick ${sel.has(p.id) ? 'on' : ''}" data-id="${p.id}">${avatarHTML(p)}<div class="gp-main"><div class="gp-name">${esc(p.display_name || p.username)}</div><div class="gp-handle">@${esc(p.username || '')}</div></div><span class="gp-check"><svg fill="none" stroke="currentColor"><use href="#i-check"/></svg></span></div>`);
      row.onclick = () => { if (sel.has(p.id)) sel.delete(p.id); else sel.add(p.id); row.classList.toggle('on', sel.has(p.id)); };
      listBox.appendChild(row);
    });
  };
  render('');
  m.querySelector('#grpSearch').oninput = (e) => render(e.target.value.trim().toLowerCase());
  m.querySelector('#grpCreate').onclick = async () => {
    const name = m.querySelector('#grpName').value.trim();
    const msg = m.querySelector('#grpMsg'); msg.className = 'auth-msg';
    if (!name) { msg.className = 'auth-msg error'; msg.textContent = 'Ponle un nombre al grupo.'; return; }
    if (!sel.size) { msg.className = 'auth-msg error'; msg.textContent = 'Añade al menos a una persona.'; return; }
    const btn = m.querySelector('#grpCreate'); btn.disabled = true; btn.textContent = 'Creando…';
    try {
      const { data: conv, error } = await sb.from('conversations').insert({ name, created_by: state.user.id }).select().single();
      if (error) throw error;
      const rows = [{ conversation_id: conv.id, user_id: state.user.id, role: 'admin' }, ...[...sel].map(uid => ({ conversation_id: conv.id, user_id: uid, role: 'member' }))];
      const { error: e2 } = await sb.from('conversation_members').insert(rows);
      if (e2) throw e2;
      m.remove();
      openGroup(conv);
    } catch (err) { console.error(err); msg.className = 'auth-msg error'; msg.textContent = 'No se pudo crear el grupo.'; btn.disabled = false; btn.textContent = 'Crear grupo'; }
  };
}
async function openGroupInfo(convId) {
  const conv = state.groupConv; if (!conv) return;
  const { data: members } = await sb.from('conversation_members').select('user_id, role, profiles:user_id(*)').eq('conversation_id', convId);
  const list = members || [];
  const amCreator = conv.created_by === state.user.id;
  const m = openModal(`
    <div class="modal-head"><h3>Grupo</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="grp-info-head">${groupAvatarHTML(conv)}<div class="gih-main"><input type="text" id="giName" value="${esc(conv.name)}" maxlength="60" ${amCreator ? '' : 'disabled'} /><div class="gih-sub">${list.length} ${list.length === 1 ? 'miembro' : 'miembros'}</div></div></div>
      ${amCreator ? `<button class="btn sm" id="giRename" style="margin-bottom:10px">Guardar nombre</button>` : ''}
      <button class="btn sm" id="giAdd" style="margin-bottom:10px"><svg fill="none" stroke="currentColor"><use href="#i-plus"/></svg> Añadir personas</button>
      <div class="grp-members" id="giMembers"></div>
      <button class="btn" id="giLeave" style="width:100%;margin-top:12px;border-color:#e3b7b0;color:#c0533f">Salir del grupo</button>
    </div>`);
  const membersBox = m.querySelector('#giMembers');
  list.forEach(mm => {
    const p = mm.profiles || {};
    const isCreator = conv.created_by === mm.user_id;
    const canKick = amCreator && mm.user_id !== state.user.id;
    const row = el(`<div class="grp-member"><span class="gm-av" data-uid="${mm.user_id}">${avatarHTML(p)}</span><div class="gm-main"><div class="gm-name">${esc(p.display_name || p.username || 'usuario')}${isCreator ? ' <span class="gm-tag">admin</span>' : ''}</div><div class="gm-handle">@${esc(p.username || '')}</div></div>${canKick ? `<button class="gm-kick" data-kick title="Quitar del grupo"><svg fill="none" stroke="currentColor"><use href="#i-x"/></svg></button>` : ''}</div>`);
    row.querySelector('[data-uid]').onclick = () => { m.remove(); closeDmScreen(); openProfile(mm.user_id); };
    const kick = row.querySelector('[data-kick]');
    if (kick) kick.onclick = async () => {
      if (!confirm(`¿Quitar a ${p.display_name || p.username} del grupo?`)) return;
      const { error } = await sb.from('conversation_members').delete().eq('conversation_id', convId).eq('user_id', mm.user_id);
      if (error) { toast('No se pudo quitar'); return; }
      row.remove(); delete state.groupMembers[mm.user_id]; toast('Persona retirada');
    };
    membersBox.appendChild(row);
  });
  const renameBtn = m.querySelector('#giRename');
  if (renameBtn) renameBtn.onclick = async () => {
    const name = m.querySelector('#giName').value.trim(); if (!name) return;
    const { error } = await sb.from('conversations').update({ name }).eq('id', convId);
    if (error) { toast('No se pudo renombrar'); return; }
    conv.name = name; const nm = $('dmPeerHead').querySelector('.dm-name'); if (nm) nm.textContent = name; toast('Grupo renombrado');
  };
  m.querySelector('#giAdd').onclick = () => {
    m.remove();
    pickPeople({ title: 'Añadir personas', confirmLabel: 'Añadir', exclude: Object.keys(state.groupMembers), onConfirm: async (ids) => {
      const rows = ids.map(uid => ({ conversation_id: convId, user_id: uid, role: 'member' }));
      const { error } = await sb.from('conversation_members').insert(rows);
      if (error) { toast('No se pudieron añadir'); return; }
      toast(ids.length === 1 ? 'Persona añadida' : `${ids.length} personas añadidas`);
      openGroup(conv);
    } });
  };
  m.querySelector('#giLeave').onclick = async () => {
    if (!confirm('¿Salir de este grupo?')) return;
    const { error } = await sb.from('conversation_members').delete().eq('conversation_id', convId).eq('user_id', state.user.id);
    if (error) { toast('No se pudo salir'); return; }
    m.remove(); closeDmScreen(); toast('Has salido del grupo');
  };
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
  if (Notification.permission === 'granted') { try { await subscribeAndSave(); } catch (_) {} return; }
  // pedir permiso una sola vez (clave para recibir llamadas/mensajes con la app cerrada)
  if (Notification.permission === 'default' && !localStorage.getItem('ub_push_asked')) {
    localStorage.setItem('ub_push_asked', '1');
    setTimeout(async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') { await subscribeAndSave(); toast('🔔 Avisos activados: recibirás llamadas y mensajes'); }
      } catch (_) {}
      renderPushButton();
    }, 3000);
  }
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
