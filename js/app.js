/* =======================================================================
   UnderBro :: lógica de la aplicación
   ======================================================================= */
(() => {
'use strict';

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
  $('authSubmit').textContent = mode==='register' ? 'Crear cuenta' : 'Entrar';
  $('authPassword').autocomplete = mode==='register' ? 'new-password' : 'current-password';
  $('authMsg').textContent = '';
}
$('tabLogin').onclick = () => setAuthMode('login');
$('tabRegister').onclick = () => setAuthMode('register');

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

$('btnLogout').onclick = async () => {
  await sb.auth.signOut();
  location.reload();
};

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
  await Promise.all([loadLikes(), loadFollows()]);
  bindUI();
  initPlayer();
  initNowPlaying();
  initChat();
  initPresence();
  initDM();
  loadNotifBadge();
  switchView('feed');
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
  $('btnUpload').onclick = openUploadModal;
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
      else if (act === 'people') switchView('people');
      else if (act === 'me') openProfile(state.user.id);
      else if (act === 'upload') openUploadModal();
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
    } else if (view === 'search') {
      tracks = await fetchSearch(state.search); head = { title: `Búsqueda: "${state.search}"`, sub: `${tracks.length} resultado(s)` };
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
  const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)')
    .in('user_id', [...state.follows]).order('created_at', { ascending: false }).limit(50);
  return data || [];
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
async function fetchSearch(term) {
  if (!term) return [];
  const { data } = await sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)')
    .or(`title.ilike.%${term}%,artist.ilike.%${term}%,genre.ilike.%${term}%`)
    .order('plays', { ascending: false }).limit(50);
  return data || [];
}

function renderFeed(head, tracks, view) {
  const main = $('main');
  main.innerHTML = `<div class="main-head"><div><h2>${esc(head.title)}</h2><div class="sub">${esc(head.sub)}</div></div></div><div id="feedList" class="feed-list"></div>`;
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
  const prof = t.profiles || {};
  const collabs = Array.isArray(t.collaborators) ? t.collaborators : [];
  const ft = collabs.length ? ` ft. ${collabs.map(c => `<a data-collab="${c.id}">${esc(c.display_name || c.username)}</a>`).join(', ')}` : '';
  const mine = t.user_id === state.user.id;
  const card = el(`
    <div class="track" data-id="${t.id}">
      <div class="cover" data-act="play">
        ${t.cover_url ? `<img src="${esc(t.cover_url)}" alt="" />` : `<svg width="34" height="34" fill="none" stroke="#fff" stroke-width="1.6"><use href="#i-music"/></svg>`}
        <div class="play-overlay"><svg><use href="#i-play"/></svg></div>
      </div>
      <div class="body">
        <div class="t-head">
          <div>
            <div class="t-title">${esc(t.title)}</div>
            <div class="t-artist">por <a data-act="profile">${esc(prof.display_name || prof.username || t.artist || 'anónimo')}</a>${ft}</div>
          </div>
          ${t.genre ? `<span class="t-genre">${esc(t.genre)}</span>` : ''}
        </div>
        ${waveHTML(t)}
        <div class="t-foot">
          <span class="time"><svg style="width:12px;height:12px;vertical-align:-1px" fill="none" stroke="currentColor"><use href="#i-headphones"/></svg> ${t.plays||0} · ${fmtTime(t.duration)}</span>
          <button class="act like ${liked?'on':''}" data-act="like"><svg><use href="#i-heart"/></svg><span class="ln">${liked?'Te gusta':'Me gusta'}</span></button>
          <button class="act" data-act="toggleComments"><svg><use href="#i-comment"/></svg><span class="cn">Comentar</span></button>
          <button class="act" data-act="download"><svg><use href="#i-download"/></svg>Descargar</button>
          ${mine ? `<button class="act" data-act="edit"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg>Editar</button>` : ''}
          ${(mine || state.profile.is_admin) ? `<button class="act danger" data-act="delete"><svg fill="none" stroke="currentColor"><use href="#i-trash"/></svg>${mine ? 'Borrar' : 'Borrar (mod)'}</button>` : ''}
        </div>
        <div class="comments hidden" data-comments></div>
      </div>
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
        <div class="collab-add"><input type="text" id="collabInput" placeholder="usuario (sin @)" autocomplete="off" /><button type="button" class="btn sm" id="collabAdd">Añadir</button></div>
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
      const { data, error } = await sb.from('tracks').update({ title, genre: genre || null, cover_url, collaborators: collab.get() })
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

/* ---- LIKES ---- */
async function toggleLike(t, card) {
  const btn = card.querySelector('[data-act="like"]');
  const liked = state.likes.has(t.id);
  if (liked) {
    state.likes.delete(t.id);
    btn.classList.remove('on'); btn.querySelector('.ln').textContent = 'Me gusta';
    await sb.from('likes').delete().eq('track_id', t.id).eq('user_id', state.user.id);
  } else {
    state.likes.add(t.id);
    btn.classList.add('on'); btn.querySelector('.ln').textContent = 'Te gusta';
    await sb.from('likes').insert({ track_id: t.id, user_id: state.user.id });
  }
  updateCounts();
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
        <p>${esc(c.body)}</p>
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
  const form = el(`<form class="comment-form"><input type="text" placeholder="Añade un comentario..." maxlength="400" required /><button class="comment-send" type="submit" aria-label="Enviar"><svg fill="none" stroke="#fff"><use href="#i-send"/></svg></button></form>`);
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
  });
  audio.addEventListener('loadedmetadata', () => { $('pDur').textContent = fmtTime(audio.duration); if (npIsOpen()) $('npDur').textContent = fmtTime(audio.duration); });
  audio.addEventListener('ended', () => step(1));
  audio.addEventListener('play', () => { setPlayIcon(true); showEq(true); markPlayingCard(); setNpPlayIcon(true); });
  audio.addEventListener('pause', () => { setPlayIcon(false); showEq(false); setNpPlayIcon(false); });

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
  document.querySelectorAll('.track.playing').forEach(c => c.classList.remove('playing'));
  const card = document.querySelector(`.track[data-id="${state.current?.id}"]`);
  if (card) card.classList.add('playing');
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

async function playTrack(t) {
  if (state.current?.id === t.id) { togglePlay(); return; }
  state.current = t;
  $('player').classList.remove('hidden');
  $('pTitle').textContent = t.title;
  $('pArtist').textContent = (t.profiles?.display_name || t.profiles?.username || t.artist || '');
  $('pCover').innerHTML = t.cover_url ? `<img src="${esc(t.cover_url)}" alt="" />` : `<svg width="22" height="22" fill="none" stroke="#fff" style="margin:15px"><use href="#i-music"/></svg>`;
  if (npIsOpen()) syncNowPlaying();
  audio.src = t.audio_url;
  try { await audio.play(); } catch {}
  // contar reproducción
  sb.rpc('increment_plays', { track: t.id }).then(() => { t.plays = (t.plays||0)+1; });
  // si no está en la cola actual, crear cola con la vista
  if (!state.queue.includes(t.id)) state.queue = [t.id];
}
function step(dir) {
  if (!state.current) return;
  const idx = state.queue.indexOf(state.current.id);
  const next = state.queue[idx + dir];
  if (next) { const t = state.tracks.find(x => x.id === next); if (t) playTrack(t); }
  else if (dir > 0) { setPlayIcon(false); }
}
function updateCardWave(pct) {
  const card = document.querySelector(`.track[data-id="${state.current?.id}"]`);
  if (!card) return;
  const bars = card.querySelectorAll('.wave .bar');
  const upto = Math.floor(pct * bars.length);
  bars.forEach((b, i) => b.classList.toggle('played', i <= upto));
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
function mountCollab(scope, initial = []) {
  const chips = scope.querySelector('#collabChips');
  const input = scope.querySelector('#collabInput');
  const addBtn = scope.querySelector('#collabAdd');
  let list = (initial || []).slice();
  const render = () => {
    chips.innerHTML = list.map((c, i) => `<span class="chip">@${esc(c.username)}<button type="button" data-i="${i}" aria-label="quitar">&times;</button></span>`).join('');
    chips.querySelectorAll('button[data-i]').forEach(b => b.onclick = () => { list.splice(+b.dataset.i, 1); render(); });
  };
  const add = async () => {
    const u = input.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!u) return;
    if (u === state.profile.username) { toast('Tú ya apareces como autor'); input.value = ''; return; }
    if (list.some(c => c.username === u)) { input.value = ''; return; }
    const { data } = await sb.from('profiles').select('id,username,display_name').eq('username', u).maybeSingle();
    if (!data) { toast('No existe el usuario @' + u); return; }
    list.push({ id: data.id, username: data.username, display_name: data.display_name });
    input.value = ''; render();
  };
  addBtn.onclick = add;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
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
        <div class="collab-add"><input type="text" id="collabInput" placeholder="usuario (sin @)" autocomplete="off" /><button type="button" class="btn sm" id="collabAdd">Añadir</button></div>
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
   PERFIL
   ======================================================================= */
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
    sb.from('tracks').select('*, profiles!tracks_user_id_fkey(*)').contains('collaborators', [{ id: userId }]).order('created_at', { ascending: false }),
  ]);
  // une pistas propias + colaboraciones (sin duplicar)
  const seen = new Set();
  const tracks = [...(ownTracks || []), ...((collabRes && collabRes.data) || [])].filter(t => (seen.has(t.id) ? false : seen.add(t.id)));
  tracks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const isMe = userId === state.user.id;
  const followsHim = state.follows.has(userId);
  main.innerHTML = `
    <div class="profile-head">
      ${avatarHTML(prof)}
      <div>
        <h2>${esc(prof.display_name || prof.username)} ${prof.is_admin?'<span class="t-genre" style="background:#fdeede;border-color:#f3d9b0;color:#b07a2c;vertical-align:middle">MOD</span>':''} ${prof.banned?'<span class="t-genre" style="background:#fae3e0;border-color:#f0c2bc;color:#c0533f;vertical-align:middle">baneado</span>':''}</h2>
        <div style="color:var(--ink-soft)">@${esc(prof.username)}</div>
        ${prof.bio ? `<p style="margin-top:6px;max-width:520px">${esc(prof.bio)}</p>` : ''}
        <div class="pstats">
          <span><b>${tracks.length}</b> pistas</span>
          <span><b>${followers||0}</b> seguidores</span>
          <span><b>${following||0}</b> siguiendo</span>
        </div>
      </div>
      <div class="pactions">
        ${isMe ? `<button class="btn" id="editProfBtn"><svg fill="none" stroke="currentColor"><use href="#i-settings"/></svg> Editar perfil</button>`
                : `<button class="btn ${followsHim?'':'primary'}" id="followBtn">${followsHim?'Siguiendo ✓':'+ Seguir'}</button>`}
        ${!isMe ? `<button class="btn" id="msgBtn"><svg fill="none" stroke="currentColor"><use href="#i-mail"/></svg> Mensaje</button>` : ''}
        ${(!isMe && state.profile.is_admin && !prof.is_admin) ? `<button class="btn" id="banBtn" style="border-color:#e3b7b0;color:#c0533f">${prof.banned?'Desbanear':'Banear usuario'}</button>` : ''}
      </div>
    </div>
    <div class="main-head"><h2>Pistas</h2></div>
    <div id="feedList" class="feed-list"></div>`;

  const list = $('feedList');
  if (!tracks.length) list.innerHTML = `<div class="empty"><svg fill="none"><use href="#i-music"/></svg><p>Sin pistas todavía.</p></div>`;
  else { state.tracks = tracks; state.queue = tracks.map(t=>t.id); tracks.forEach(t => list.appendChild(trackCard(t))); }

  if (isMe) $('editProfBtn').onclick = () => switchView('settings');
  const msgBtn = $('msgBtn');
  if (msgBtn) msgBtn.onclick = () => openDM(userId);
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
  main.innerHTML = `<div class="main-head"><div><h2>People</h2><div class="sub">Descubre a otros creadores</div></div></div><div id="peopleList" class="loading"><div class="spinner"></div></div>`;
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
        </div>
      </div>`);
    const followBtn = row.querySelector('[data-act="follow"]');
    row.querySelector('[data-act="view"]').onclick = () => openProfile(p.id);
    row.querySelector('[data-act="msg"]').onclick = () => openDM(p.id);
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

/* =======================================================================
   SETTINGS
   ======================================================================= */
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
      <button class="btn primary" id="saveProfile">Guardar cambios</button>
      <div class="auth-msg" id="setMsg"></div>
      <hr style="border:none;border-top:1px solid var(--line-soft);margin:20px 0" />
      <div class="field"><label>Nueva contraseña</label><input type="password" id="setPass" placeholder="Mínimo 6 caracteres" autocomplete="new-password" /></div>
      <button class="btn" id="savePass">Cambiar contraseña</button>
      <div class="auth-msg" id="passMsg"></div>
    </div>`;

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
  const row = el(`<div class="chat-msg" data-mid="${m.id}"><span class="who" data-uid="${m.user_id}">${esc(m.profiles?.display_name||m.profiles?.username||'anónimo')}</span><span class="when">${timeAgo(m.created_at)}</span>${canDel?`<button class="act sm" data-del-msg style="float:right;padding:0 5px" title="Borrar mensaje">✕</button>`:''}<p>${esc(m.body)}</p></div>`);
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
  if (msg.attachment_url) {
    if (msg.attachment_type === 'image') media = `<img class="dm-img" src="${esc(msg.attachment_url)}" alt="" data-full="${esc(msg.attachment_url)}" />`;
    else media = `<a class="dm-filechip" href="${esc(msg.attachment_url)}" target="_blank" rel="noopener"><svg fill="none"><use href="#i-file"/></svg><span class="fn">${esc(msg.attachment_name || 'archivo')}</span></a>`;
  }
  const cap = msg.body ? `<div class="dm-cap">${esc(msg.body)}</div>` : '';
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<div class="dm-bubble ${mine ? 'me' : 'them'} ${media ? 'has-media' : ''}">${media}${cap}<span class="t">${time}</span></div>`;
}
function makeBubble(msg) {
  const node = el(bubbleHTML(msg));
  node.dataset.mid = msg.id;
  const img = node.querySelector('.dm-img'); if (img) img.onclick = () => openImageViewer(img.dataset.full);
  if (msg.sender_id === state.user.id) attachSwipe(node, msg);
  return node;
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
  if (c.last.attachment_url) snip = (c.last.attachment_type === 'image' ? '📷 Foto' : '📎 Archivo') + (c.last.body ? ' · ' + c.last.body : '');
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
  $('main').innerHTML = `<div class="main-head"><div><h2>Chats</h2><div class="sub">Tus conversaciones</div></div></div><div id="convoList" class="loading"><div class="spinner"></div></div>`;
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
    list.appendChild(el(`<div class="empty"><svg fill="none"><use href="#i-mail"/></svg><p>Aún no tienes conversaciones privadas.<br>Pulsa <b>Mensaje</b> en alguien de <b>People</b> o en su perfil para empezar.</p></div>`));
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

/* ----------------------------------------------------------------------- */
init();
})();
