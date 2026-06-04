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
  follows: new Set(),  // user_ids que sigo
  downloads: new Set(JSON.parse(localStorage.getItem('ub_downloads') || '[]')),
  view: 'feed',
  tab: 'trending',
  search: '',
  queue: [],           // cola de reproducción (track ids en orden)
  current: null,       // track en reproducción
  presence: null,      // canal de presencia
  online: [],          // usuarios online
};

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
  if (url) return `<div class="avatar ${cls}"><img src="${esc(url)}" alt="" /></div>`;
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
  $('authScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  renderMe();
  await Promise.all([loadLikes(), loadReposts(), loadFollows()]);
  bindUI();
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
  $('meName').innerHTML = esc(state.profile.display_name || state.profile.username) +
    (state.profile.is_admin ? ' <span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c;padding:1px 7px">MOD</span>' : '');
  $('meAvatar').outerHTML = avatarHTML(state.profile).replace('class="avatar ', 'id="meAvatar" class="avatar ');
}

async function loadLikes() {
  const { data } = await sb.from('likes').select('track_id').eq('user_id', state.user.id);
  state.likes = new Set((data||[]).map(r => r.track_id));
}
async function loadReposts() {
  const { data } = await sb.from('reposts').select('track_id').eq('user_id', state.user.id);
  state.reposts = new Set((data||[]).map(r => r.track_id));
}
async function loadFollows() {
  const { data } = await sb.from('follows').select('following_id').eq('follower_id', state.user.id);
  state.follows = new Set((data||[]).map(r => r.following_id));
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
  if (['feed','feed-trending','all','favorites','mytracks','downloads','search'].includes(view)) setActiveNav(view === 'search' ? '' : view);
  else setActiveNav(view);

  if (view === 'settings') return renderSettings();
  if (view === 'notifications') return renderNotifications();
  if (view === 'people') return renderPeople();
  if (view === 'messages') return renderMessages();
  if (view === 'posts') return renderPosts();
  if (view === 'search') return renderSearch();
  if (view === 'playlists') return renderPlaylists();
  if (view === 'radio') return startRadio();

  main.classList.remove('swap'); void main.offsetWidth; main.classList.add('swap');
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
  const ft = collabs.length ? ` ft. ${collabs.map(c => `<a data-collab="${c.id}">${esc(c.display_name || c.username)}</a>`).join(', ')}` : '';
  const mine = t.user_id === state.user.id;
  const cov = t.cover_url ? czUrl(t.cover_url) : '';
  const card = el(`
    <div class="track ${cov ? 'has-bg' : ''}" data-id="${t.id}" ${cov ? `style="background-image:url('${cov}')"` : ''}>
      ${t._repostedBy ? `<div class="repost-badge"><svg fill="none" stroke="currentColor"><use href="#i-repeat"/></svg> Reposteado por <a data-act="repostby">${esc(t._repostedBy)}</a></div>` : ''}
      <div class="t-head">
        <div class="t-titles">
          <div class="t-title">${esc(t.title)}</div>
          <div class="t-artist">por <a data-act="profile">${esc(prof.display_name || prof.username || t.artist || 'anónimo')}</a>${ft}</div>
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
  const bars = peaks.map((h, i) => `<div class="bar" data-i="${i}" style="--h:${h}%;--d:${((i * 37) % 23) * 0.045}s"></div>`).join('');
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
  $('npWave').innerHTML = npPeaks.map(h => `<div class="bar" style="--h:${h}%"></div>`).join('');
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
        ${(mine || state.profile.is_admin) ? `<div class="post-tools">
          ${mine ? `<button class="post-tool" data-act="edit" title="Editar pie de foto"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg></button>` : ''}
          <button class="post-tool danger" data-act="delete" title="Borrar publicación"><svg fill="none" stroke="currentColor"><use href="#i-trash"/></svg></button>
        </div>` : ''}
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
          <div class="cover-prev cz-banner" id="bannerPrev">${t.banner ? `<img src="${esc(t.banner)}" alt="" />` : `<svg width="22" height="22" fill="none" stroke="currentColor"><use href="#i-image"/></svg>`}</div>
          <div class="cover-pick-txt"><b id="bannerName">Subir banner</b><span>Imagen ancha (16:9)</span></div>
        </div>
        <input type="file" id="bannerFile" accept="image/*" hidden />
      </div>
      <div class="field"><label>Color de acento</label><div class="bg-row"><input type="color" id="thAccent" value="${czColor(t.accent) || '#5f7fb8'}"><span class="sub">Tiñe tu nombre, botones y enlaces</span></div></div>
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

  let bannerFile = null, bgFile = null;
  const bannerInput = m.querySelector('#bannerFile'), bgInput = m.querySelector('#bgFile');
  m.querySelector('#bannerPick').onclick = () => bannerInput.click();
  bannerInput.onchange = () => { const f = bannerInput.files[0]; if (!f || !f.type.startsWith('image')) return; bannerFile = f; m.querySelector('#bannerPrev').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" />`; m.querySelector('#bannerName').textContent = f.name; };
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
  main.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { data: prof } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (!prof) { main.innerHTML = '<div class="empty">Perfil no encontrado.</div>'; return; }
  const [{ count: followers }, { count: following }, ownTracks, collabRes] = await Promise.all([
    sb.from('follows').select('follower_id', { count:'exact', head:true }).eq('following_id', userId),
    sb.from('follows').select('following_id', { count:'exact', head:true }).eq('follower_id', userId),
    fetchTracks({ order: 'created_at', userId }),
    sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').contains('collaborators', JSON.stringify([{ id: userId }])).order('created_at', { ascending: false }),
  ]);
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
  const accent = czColor(theme.accent) || '#5f7fb8';
  const banner = czUrl(theme.banner);
  const links = Array.isArray(theme.links) ? theme.links : [];
  const font = (theme.font && FONTS[theme.font]) ? theme.font : '';
  const fontVar = font ? `--pf-font:'${font.replace(/'/g,'')}', sans-serif;` : '';
  const glowCls = theme.glow === 'neon' ? 'glow-neon' : theme.glow === 'soft' ? 'glow-soft' : '';
  const cardsCls = (theme.cards && theme.cards !== 'default' && CARD_STYLES[theme.cards]) ? 'cards-' + theme.cards : '';
  const animCls = (theme.bg && theme.bg.type === 'gradient' && theme.bg.animated) ? 'bg-animated' : '';
  const tagline = (typeof theme.tagline === 'string') ? theme.tagline.slice(0, 140) : '';
  const backTo = ['feed','posts','people','messages','favorites','mytracks','all','downloads','notifications','search'].includes(state.view) ? state.view : 'feed';
  main.innerHTML = `
    <div class="profile-view ${glowCls} ${cardsCls} ${animCls}" style="--accent:${accent};${fontVar}${bgStyle(theme)}">
      <button class="profile-back" id="profileBack"><svg fill="none" stroke="currentColor"><use href="#i-chevron-left"/></svg> Volver</button>
      ${banner ? `<div class="profile-banner" style="background-image:url('${banner}')"></div>` : ''}
      <div class="profile-head ${banner ? 'has-banner' : ''}">
        ${avatarHTML(prof)}
        <div style="flex:1;min-width:0">
          <h2 class="accent-name">${esc(prof.display_name || prof.username)} ${prof.is_admin?'<span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c;vertical-align:middle">MOD</span>':''} ${prof.banned?'<span class="t-genre" style="background:#fae3e0;border-color:#f0c2bc;color:#c0533f;vertical-align:middle">baneado</span>':''}</h2>
          <div style="color:var(--ink-soft)">@${esc(prof.username)}</div>
          ${tagline ? `<div class="profile-tagline">${esc(tagline)}</div>` : ''}
          ${prof.bio ? `<p style="margin-top:6px;max-width:520px">${esc(prof.bio)}</p>` : ''}
          <div class="pstats">
            <span class="pstat" data-pstat="tracks"><b>${myTracks.length}</b> pistas</span>
            <span class="pstat" data-pstat="followers"><b>${followers||0}</b> seguidores</span>
            <span class="pstat" data-pstat="following"><b>${following||0}</b> siguiendo</span>
          </div>
          ${links.length ? `<div class="profile-links">${links.map(l => `<a href="${esc(czHref(l.url))}" target="_blank" rel="noopener noreferrer"><svg fill="none" stroke="currentColor"><use href="#i-globe"/></svg>${esc(l.label || 'enlace')}</a>`).join('')}</div>` : ''}
        </div>
        <div class="pactions">
          ${isMe ? `<button class="btn primary" id="customizeBtn"><svg fill="none" stroke="#fff"><use href="#i-palette"/></svg> Personalizar</button><button class="btn" id="editProfBtn"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg> Editar perfil</button><button class="btn" id="logoutBtn"><svg fill="none" stroke="currentColor"><use href="#i-logout"/></svg> Cerrar sesión</button>`
                  : `<button class="btn ${followsHim?'':'primary'}" id="followBtn">${followsHim?'Siguiendo ✓':'+ Seguir'}</button>`}
          ${!isMe ? `<button class="btn" id="msgBtn"><svg fill="none" stroke="currentColor"><use href="#i-mail"/></svg> Mensaje</button>` : ''}
          ${(!isMe && state.profile.is_admin && !prof.is_admin) ? `<button class="btn" id="banBtn" style="border-color:#e3b7b0;color:#c0533f">${prof.banned?'Desbanear':'Banear usuario'}</button>` : ''}
          ${(!isMe && state.profile.is_admin && !prof.is_admin) ? `<button class="btn danger-btn" id="delUserBtn"><svg fill="none" stroke="#fff"><use href="#i-trash"/></svg> Eliminar usuario</button>` : ''}
        </div>
      </div>
      <div class="profile-tabs" id="profileTabs">
        <button class="active" data-ptab="tracks"><svg fill="none" stroke="currentColor"><use href="#i-music"/></svg> Pistas <span class="ptab-n">${myTracks.length}</span></button>
        <button data-ptab="posts"><svg fill="none" stroke="currentColor"><use href="#i-camera"/></svg> Fotos</button>
        <button data-ptab="feats"><svg fill="none" stroke="currentColor"><use href="#i-people"/></svg> Feats <span class="ptab-n">${featTracks.length}</span></button>
      </div>
      <div id="feedList" class="feed-list"></div>
      <div id="postGrid" class="post-grid hidden"></div>
      <div id="featList" class="feed-list hidden"></div>
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

  // pestañas Pistas / Fotos / Feats
  const tabsEl = $('profileTabs'), gridEl = $('postGrid');
  let postsLoaded = false;
  tabsEl.querySelectorAll('button').forEach(b => b.onclick = () => {
    tabsEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    const tab = b.dataset.ptab;
    list.classList.toggle('hidden', tab !== 'tracks');
    gridEl.classList.toggle('hidden', tab !== 'posts');
    featEl.classList.toggle('hidden', tab !== 'feats');
    if (tab === 'tracks') { state.tracks = myTracks; state.queue = myTracks.map(t => t.id); }
    else if (tab === 'feats') { state.tracks = featTracks; state.queue = featTracks.map(t => t.id); }
    if (tab === 'posts' && !postsLoaded) { postsLoaded = true; loadProfilePosts(userId, gridEl); }
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
  const people = (data||[]).filter(p => p.id !== state.user.id);
  if (!people.length) { list.innerHTML = '<div class="empty"><p>Aún no hay nadie más por aquí.</p></div>'; return; }
  list.innerHTML = '';
  people.forEach(p => {
    const f = state.follows.has(p.id);
    const row = el(`
      <div class="person">
        <div class="person-top">
          ${avatarHTML(p)}
          <div class="person-info">
            <div class="person-name">${esc(p.display_name||p.username)}${p.is_admin?' <span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c">MOD</span>':''}${p.banned?' <span class="t-genre" style="background:#fae3e0;border-color:#f0c2bc;color:#c0533f">baneado</span>':''}</div>
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
  if (pl.cover_url) return `<div class="pl-cover" style="background-image:url('${esc(pl.cover_url)}')"></div>`;
  const covers = (pl.playlist_tracks || []).map(x => x.tracks?.cover_url).filter(Boolean).slice(0, 4);
  if (!covers.length) return `<div class="pl-cover pl-cover-empty"><svg fill="none" stroke="#fff"><use href="#i-list"/></svg></div>`;
  return `<div class="pl-cover pl-cover-grid">${covers.map(c => `<div style="background-image:url('${esc(c)}')"></div>`).join('')}</div>`;
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
      const row = el(`<div class="follow-row"><div class="st-tc-cover" style="${t.cover_url ? `background-image:url('${esc(t.cover_url)}')` : ''}"></div><div class="fr-info"><div class="fr-name">${esc(t.title)}</div><div class="fr-handle">${esc(t.profiles?.display_name || t.profiles?.username || t.artist || '')}</div></div></div>`);
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
    chip.innerHTML = `<div class="st-track-chip"><div class="st-tc-cover" style="${t.cover_url ? `background-image:url('${esc(t.cover_url)}')` : ''}"></div><div class="st-tc-info"><b>${esc(t.title)}</b><span>${esc(t.profiles?.display_name || t.profiles?.username || t.artist || '')}</span></div><button class="st-tc-x" type="button" aria-label="Quitar">&times;</button></div>`;
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
      <div class="field"><label>Notificaciones</label>
        <button class="btn" id="setPushBtn" style="width:100%"><svg fill="none" stroke="currentColor"><use href="#i-bell"/></svg> Activar avisos de chat</button>
        <div class="sub" style="margin-top:6px">Recibe un aviso cuando te escriban, aunque tengas la app cerrada.</div>
      </div>
      <div style="text-align:center;margin-top:16px"><a id="policyLink" style="font-size:12px;color:var(--ink-soft);cursor:pointer">Política de privacidad y cookies</a></div>
      <div style="text-align:center;margin-top:10px;font-size:12px;color:var(--ink-soft)">UnderBro · versión ${APP_VERSION} · <a id="checkUpdate" style="cursor:pointer;text-decoration:underline">Buscar actualizaciones</a></div>
    </div>`;
  $('policyLink').onclick = showPrivacyPolicy;
  const setPushBtn = $('setPushBtn');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { setPushBtn.textContent = '🔔 Avisos activados'; setPushBtn.disabled = true; }
  setPushBtn.onclick = enablePush;
  $('checkUpdate').onclick = async () => { toast('Buscando actualización…'); await checkForUpdate(); setTimeout(() => location.reload(), 700); };
  $('openCustomize').onclick = openProfileCustomizer;
  $('settingsLogout').onclick = logout;
  $('deleteAccount').onclick = deleteAccount;

  const avatarFile = $('avatarFile');
  $('changeAvatar').onclick = () => avatarFile.click();
  let newAvatarFile = null;
  avatarFile.onchange = () => {
    newAvatarFile = avatarFile.files[0];
    if (newAvatarFile) { const url = URL.createObjectURL(newAvatarFile); $('setAvatar').innerHTML = `<div class="avatar" style="width:72px;height:72px"><img src="${url}"/></div>`; }
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
      const { data, error } = await sb.from('profiles').update({ display_name, username, bio, avatar_url }).eq('id', state.user.id).select().single();
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
  const box = $('chatMsgs');
  const canDel = m.user_id === state.user.id || state.profile.is_admin;
  const row = el(`<div class="chat-msg" data-mid="${m.id}"><span class="who" data-uid="${m.user_id}">${esc(m.profiles?.display_name||m.profiles?.username||'anónimo')}</span><span class="when">${timeAgo(m.created_at)}</span>${canDel?`<button class="act sm" data-del-msg style="float:right;padding:0 5px" title="Borrar mensaje">✕</button>`:''}<p>${linkifyMentions(m.body)}</p></div>`);
  const who = row.querySelector('.who');
  who.onclick = () => openProfile(m.user_id);
  who.style.cursor = 'pointer';
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
async function initDM() {
  await refreshDmBadge();
  attachMentionAutocomplete($('dmInput'));
  // controles de la pantalla de chat (persistente)
  $('dmBack').onclick = closeDmScreen;
  $('dmAttach').onclick = () => $('dmFile').click();
  $('dmFile').onchange = () => { if ($('dmFile').files[0]) setDmPending($('dmFile').files[0]); };
  $('dmForm').addEventListener('submit', sendDm);

  sb.channel('dm-inbox-' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${state.user.id}` }, async (payload) => {
      const msg = payload.new;
      if (state.dmPeer === msg.sender_id) {
        dmAppendBubble(msg); markDmRead(msg.sender_id);
      } else {
        refreshDmBadge();
        let p = null; try { ({ data: p } = await sb.from('profiles').select('username,display_name').eq('id', msg.sender_id).single()); } catch {}
        toast('💬 ' + (p?.display_name || p?.username || 'Mensaje') + ': ' + (msg.body || '📎 Adjunto').slice(0, 38));
        if (state.view === 'messages') renderMessages();
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${state.user.id}` }, (payload) => {
      const n = document.querySelector(`.dm-bubble[data-mid="${payload.new.id}"]`);
      if (n) n.replaceWith(makeBubble(payload.new));
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${state.user.id}` }, (payload) => {
      const n = document.querySelector(`.dm-bubble[data-mid="${payload.old.id}"]`);
      if (n) n.remove();
    })
    .subscribe();
}
function bubbleHTML(msg) {
  const mine = msg.sender_id === state.user.id;
  let media = '';
  let isTrack = false;
  if (msg.attachment_url) {
    if (msg.attachment_type === 'image') media = `<img class="dm-img" src="${esc(msg.attachment_url)}" alt="" data-full="${esc(msg.attachment_url)}" />`;
    else if (msg.attachment_type === 'track') {
      isTrack = true;
      let meta = {}; try { meta = JSON.parse(msg.attachment_name || '{}'); } catch (_) {}
      const cover = meta.cover_url
        ? `<div class="dm-track-cover" style="background-image:url('${esc(meta.cover_url)}')"></div>`
        : `<div class="dm-track-cover"><svg fill="none" stroke="#fff"><use href="#i-music"/></svg></div>`;
      media = `<div class="dm-track" data-track-id="${esc(meta.id || '')}">
        ${cover}
        <div class="dm-track-info"><div class="dm-track-title">${esc(meta.title || 'Pista')}</div><div class="dm-track-artist">${esc(meta.artist || '')}</div></div>
        <button class="dm-track-play" data-dmplay aria-label="Reproducir"><svg class="ci-play"><use href="#i-play"/></svg><svg class="ci-pause"><use href="#i-pause"/></svg></button>
      </div>`;
    }
    else media = `<a class="dm-filechip" href="${esc(msg.attachment_url)}" target="_blank" rel="noopener"><svg fill="none"><use href="#i-file"/></svg><span class="fn">${esc(msg.attachment_name || 'archivo')}</span></a>`;
  }
  const cap = (msg.body && !isTrack) ? `<div class="dm-cap">${linkifyMentions(msg.body)}</div>` : '';
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<div class="dm-bubble ${mine ? 'me' : 'them'} ${media ? 'has-media' : ''}">${media}${cap}<span class="t">${time}</span></div>`;
}
function makeBubble(msg) {
  const node = el(bubbleHTML(msg));
  node.dataset.mid = msg.id;
  const img = node.querySelector('.dm-img'); if (img) img.onclick = () => openImageViewer(img.dataset.full);
  const dmPlay = node.querySelector('[data-dmplay]');
  if (dmPlay) dmPlay.onclick = (e) => {
    e.stopPropagation();
    let meta = {}; try { meta = JSON.parse(msg.attachment_name || '{}'); } catch (_) {}
    playSharedTrack(meta, msg.attachment_url);
  };
  if (msg.sender_id === state.user.id) attachSwipe(node, msg);
  return node;
}
// reproduce una pista compartida en el chat (en el reproductor principal)
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
function dmAppendBubble(msg) {
  const thread = $('dmThread');
  const empty = thread.querySelector('.dm-empty'); if (empty) empty.remove();
  thread.appendChild(makeBubble(msg));
  thread.scrollTop = thread.scrollHeight;
}
// Deslizar un mensaje propio (hacia la izquierda) para editar / eliminar
function attachSwipe(node, msg) {
  let startX = 0, startY = 0, dx = 0, dragging = false, swiped = false;
  node.addEventListener('pointerdown', (e) => {
    startX = e.clientX; startY = e.clientY; dragging = true; dx = 0; swiped = false; node.classList.add('swiping');
  });
  node.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const ddx = e.clientX - startX, ddy = e.clientY - startY;
    if (Math.abs(ddy) > Math.abs(ddx)) return; // gesto vertical = scroll
    dx = Math.max(-130, Math.min(0, ddx));
    if (dx < -8) swiped = true;
    node.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false; node.classList.remove('swiping');
    node.style.transform = '';
    if (dx < -55) openMsgActions(msg, node);
    dx = 0;
  };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('pointerleave', end);
  // si hubo deslizamiento, anula el click (no abrir imagen/archivo)
  node.addEventListener('click', (e) => { if (swiped) { e.preventDefault(); e.stopPropagation(); swiped = false; } }, true);
}
function openMsgActions(msg, node) {
  const sheet = el(`<div class="modal-backdrop sheet"><div class="action-sheet">
    <button class="as-item" data-a="edit"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg> Editar mensaje</button>
    <button class="as-item danger" data-a="del"><svg fill="none" stroke="currentColor"><use href="#i-trash"/></svg> Eliminar mensaje</button>
    <button class="as-item cancel" data-a="cancel">Cancelar</button>
  </div></div>`);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelector('[data-a="cancel"]').onclick = close;
  sheet.querySelector('[data-a="edit"]').onclick = () => { close(); editMessage(msg, node); };
  sheet.querySelector('[data-a="del"]').onclick = () => { close(); deleteMessage(msg, node); };
  $('modalRoot').appendChild(sheet);
}
function editMessage(msg, node) {
  const m = openModal(`
    <div class="modal-head"><h3>Editar mensaje</h3><button class="close">&times;</button></div>
    <div class="modal-body">
      <div class="field"><textarea id="edBody" maxlength="1000">${esc(msg.body)}</textarea></div>
      <button class="btn primary" id="edSave">Guardar cambios</button>
    </div>`);
  setTimeout(() => m.querySelector('#edBody')?.focus(), 60);
  m.querySelector('#edSave').onclick = async () => {
    const nb = m.querySelector('#edBody').value.trim();
    if (!nb && !msg.attachment_url) { toast('El mensaje no puede quedar vacío'); return; }
    const { error } = await sb.from('direct_messages').update({ body: nb }).eq('id', msg.id);
    if (error) { toast('No se pudo editar'); return; }
    msg.body = nb;
    node.replaceWith(makeBubble(msg));
    m.remove();
    toast('Mensaje editado');
  };
}
async function deleteMessage(msg, node) {
  if (!confirm('¿Eliminar este mensaje?')) return;
  const { error } = await sb.from('direct_messages').delete().eq('id', msg.id);
  if (error) { toast('No se pudo eliminar'); return; }
  node.remove();
}
function openImageViewer(url) {
  const v = el(`<div class="img-viewer"><img src="${esc(url)}" alt="" /></div>`);
  v.onclick = () => v.remove();
  document.body.appendChild(v);
}
function setDmPending(file) {
  if (file.size > 26214400) { toast('Máximo 25 MB'); $('dmFile').value=''; return; }
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
  const input = $('dmInput');
  const body = input.value.trim();
  const file = state.dmPendingFile;
  if (!body && !file) return;
  input.value = '';
  let attachment_url = null, attachment_type = null, attachment_name = null;
  if (file) {
    const sendBtn = $('dmForm').querySelector('.dm-send'); sendBtn.disabled = true;
    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `${state.user.id}/${Date.now()}.${ext}`;
      const up = await sb.storage.from('chat').upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (up.error) throw up.error;
      attachment_url = sb.storage.from('chat').getPublicUrl(path).data.publicUrl;
      attachment_type = file.type.startsWith('image') ? 'image' : 'file';
      attachment_name = file.name;
    } catch (err) { toast('No se pudo subir el archivo'); sendBtn.disabled = false; return; }
    sendBtn.disabled = false;
    clearDmPending();
  }
  const { data: sent, error } = await sb.from('direct_messages')
    .insert({ sender_id: state.user.id, recipient_id: other, body, attachment_url, attachment_type, attachment_name })
    .select().single();
  if (error) { toast('No se pudo enviar'); return; }
  dmAppendBubble(sent);
}
function closeDmScreen() {
  $('dmScreen').classList.remove('open');
  state.dmPeer = null;
  clearDmPending();
  if (state.view === 'messages') renderMessages();
}
async function refreshDmBadge() {
  const { count } = await sb.from('direct_messages').select('id', { count: 'exact', head: true })
    .eq('recipient_id', state.user.id).eq('read', false);
  const n = count || 0;
  const badge = $('dmBadge'), side = $('dmCount');
  if (n > 0) { badge.textContent = n; badge.classList.remove('hidden'); side.textContent = n; }
  else { badge.classList.add('hidden'); side.textContent = ''; }
}
function markDmRead(other) {
  sb.from('direct_messages').update({ read: true })
    .eq('sender_id', other).eq('recipient_id', state.user.id).eq('read', false)
    .then(() => refreshDmBadge());
}

function openCommunityChat() {
  const r = rightEl();
  if (!r.classList.contains('open')) toggleRight();
}
function convoRow(c, p) {
  const mine = c.last.sender_id === state.user.id;
  const online = state.online.some(u => u.id === c.other);
  let snip = c.last.body;
  if (c.last.attachment_url) {
    if (c.last.attachment_type === 'track') snip = c.last.body || '🎵 Pista';
    else snip = (c.last.attachment_type === 'image' ? '📷 Foto' : '📎 Archivo') + (c.last.body ? ' · ' + c.last.body : '');
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
  const name = prof.display_name || prof.username;
  state.dmPeer = other;
  clearDmPending();
  $('dmPeerHead').innerHTML = `${avatarHTML(prof)}<div><div class="dm-name">${esc(name)}</div><div class="dm-handle">@${esc(prof.username)}</div></div>`;
  $('dmPeerHead').onclick = () => { closeDmScreen(); openProfile(other); };
  $('dmInput').placeholder = `Mensaje para ${name}...`;
  const thread = $('dmThread');
  thread.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  $('dmScreen').classList.add('open');
  hideDrawers();

  const { data } = await sb.from('direct_messages').select('*')
    .or(`and(sender_id.eq.${state.user.id},recipient_id.eq.${other}),and(sender_id.eq.${other},recipient_id.eq.${state.user.id})`)
    .order('created_at', { ascending: true }).limit(300);
  thread.innerHTML = '';
  if (!data || !data.length) thread.innerHTML = `<div class="dm-empty">Aún no hay mensajes.<br>¡Escribe el primero! 👋</div>`;
  else data.forEach(dmAppendBubble);
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
      <p>Los datos se almacenan en <b>Supabase</b> (base de datos y archivos) y la web se sirve desde <b>Vercel</b>, actuando como encargados del tratamiento.</p>
      <h4>Tus derechos</h4>
      <p>Puedes editar tu perfil en cualquier momento y <b>eliminar tu cuenta y todos tus datos y archivos</b> desde <b>Ajustes → Eliminar cuenta</b>. Esa acción es permanente.</p>
      <h4>Contenido y conducta</h4>
      <p>Sube solo contenido sobre el que tengas derechos. El contenido que infrinja derechos o las normas puede ser retirado por moderación.</p>
      <p style="color:var(--ink-soft);font-size:12px;margin-top:14px">Última actualización: ${new Date().toLocaleDateString('es-ES')}.</p>
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
initCookies();
init();
checkForUpdate();
})();
