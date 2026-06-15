/* UnderBro · Editor premium (solo admin).
   - Controles globales: fondo, colores, tipografía, formas, marca, orden de
     pestañas/menú, biblioteca de imágenes.
   - Visor real (iframe de la app) con inspector: selecciona cualquier elemento,
     arrástralo, edita texto/color/fondo/tamaño/relleno/opacidad, ocúltalo…
   - Deshacer/rehacer, exportar/importar tema. Publica en site_config. */
(() => {
'use strict';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.UNDERBRO_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const BUCKET = 'site-assets';

const NAV = [['feed','Stream'],['feed-trending','Trending'],['radio','Radio'],['beats','Beats'],['events','Eventos'],['posts','Fotos'],['people',"Bro's"],['all','All Tracks'],['favorites','Favorites'],['playlists','Playlists'],['ecosystems','Ecosystems'],['downloads','Downloads'],['messages','Chats'],['notifications','Notifications'],['settings','Settings']];
const TABS = [['following','Following'],['trending','Trending'],['new','New']];
const COLORS = [
  ['accent','Acento','#5f9bff'], ['accent2','Acento 2 (degradado)','#6e2df5'],
  ['ink','Texto principal','#e7ebf3'], ['ink2','Texto secundario','#cdd5e4'], ['inkSoft','Texto tenue','#8a94aa'],
  ['panel','Paneles','#121726'], ['panel2','Paneles secundarios','#1a2033'], ['line','Bordes','#232b40'], ['appbg','Fondo base','#0a0d18'],
];
const SITE_FONTS = { Poppins:'Poppins', Inter:'Inter', Montserrat:'Montserrat', Roboto:'Roboto', Nunito:'Nunito', Lato:'Lato', 'DM Sans':'DM Sans', 'Space Grotesk':'Space Grotesk', Oswald:'Oswald', 'Playfair Display':'Playfair Display' };
const PROPS = [
  { key:'color', label:'Color de texto', type:'color' },
  { key:'background-color', label:'Color de fondo', type:'color' },
  { key:'font-size', label:'Tamaño (px)', type:'num', unit:'px' },
  { key:'font-weight', label:'Grosor', type:'select', opts:['300','400','500','600','700','800','900'] },
  { key:'text-align', label:'Alineación', type:'select', opts:['left','center','right','justify'] },
  { key:'padding', label:'Relleno (px)', type:'num', unit:'px' },
  { key:'margin', label:'Margen (px)', type:'num', unit:'px' },
  { key:'border-radius', label:'Radio (px)', type:'num', unit:'px' },
  { key:'opacity', label:'Opacidad', type:'range', min:0, max:1, step:0.05 },
];

let cfg = defaults();
function defaults() { return { bg:{ mode:'default', dim:0 }, colors:{}, font:{ family:'system' }, radius:null, name:'', tagline:'', logo:'', tabs:{ order:[], hidden:[] }, nav:{ order:[], hidden:[] }, el:{} }; }
function mergeCfg(l) {
  const colors = (l.colors && typeof l.colors === 'object') ? { ...l.colors } : {};
  if (l.accent && !colors.accent) colors.accent = l.accent;
  return {
    bg: Object.assign({ mode:'default', dim:0 }, l.bg || {}),
    colors,
    font: { family: (l.font && l.font.family) || 'system' },
    radius: (l.radius != null) ? +l.radius : null,
    name: l.name || '', tagline: l.tagline || '', logo: l.logo || '',
    tabs: { order:(l.tabs && l.tabs.order) || [], hidden:(l.tabs && l.tabs.hidden) || [] },
    nav: { order:(l.nav && l.nav.order) || [], hidden:(l.nav && l.nav.hidden) || [] },
    el: (l.el && typeof l.el === 'object') ? JSON.parse(JSON.stringify(l.el)) : {},
  };
}
const msg = (t) => { $('msg').textContent = t || ''; };
const libMsg = (t) => { $('libMsg').textContent = t || ''; };
function gate(text, link) { $('gate').innerHTML = `<div><div class="logo" style="font-size:34px;margin-bottom:10px">Under<span class="u">Bro</span></div><p>${text}</p>${link ? '<p><a href="/">Ir a la app</a></p>' : ''}</div>`; }

/* ===== helpers de tema ===== */
function loadFontInto(doc, name) {
  if (!name || name === 'system' || !SITE_FONTS[name]) return null;
  let link = doc.getElementById('site-font-link');
  const href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}:wght@400;500;600;700;800&display=swap`;
  if (!link) { link = doc.createElement('link'); link.id = 'site-font-link'; link.rel = 'stylesheet'; doc.head.appendChild(link); }
  if (link.href !== href) link.href = href;
  return `'${SITE_FONTS[name]}', system-ui, sans-serif`;
}
function bgValue(bg) {
  if (!bg) return '';
  if (bg.mode === 'color' && bg.color) return bg.color;
  if (bg.mode === 'gradient' && bg.c1 && bg.c2) return `linear-gradient(${bg.angle != null ? bg.angle : 135}deg, ${bg.c1}, ${bg.c2})`;
  if (bg.mode === 'image' && bg.image) { const d = Math.max(0, Math.min(85, +bg.dim || 0)) / 100; return `${d ? `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})),` : ''}#0a0d18 url("${String(bg.image).replace(/["\\]/g, '')}") center/cover fixed`; }
  return '';
}
function applyOrderHide(doc, containerSel, itemSel, key, conf) {
  if (!conf) return;
  const cont = doc.querySelector(containerSel); if (!cont) return;
  const items = [...cont.querySelectorAll(itemSel)], by = {};
  items.forEach((el) => { by[el.dataset[key]] = el; el.style.display = ''; });
  (conf.hidden || []).forEach((k) => { if (by[k]) by[k].style.display = 'none'; });
  (conf.order || []).forEach((k) => { const el = by[k]; if (el && el.parentNode) el.parentNode.appendChild(el); });
}
/* aplica TODA la config al documento del iframe (vista real) */
function applyGlobal(doc) {
  const root = doc.documentElement, body = doc.body;
  const set = (k, v) => { if (v) root.style.setProperty(k, v); else root.style.removeProperty(k); };
  const bv = bgValue(cfg.bg);
  body.style.background = bv || '';
  const app = doc.querySelector('.app'); if (app) app.style.background = bv ? 'transparent' : '';
  const c = cfg.colors || {}, acc = c.accent;
  set('--blue', acc); set('--blue-deep', acc); set('--blue-2', acc); set('--accent', acc);
  if (acc) { const g = `linear-gradient(120deg, ${acc} 0%, ${c.accent2 || acc} 100%)`; set('--accent-grad', g); set('--aqua-grad', g); set('--cover-grad', g); }
  else { set('--accent-grad', ''); set('--aqua-grad', ''); set('--cover-grad', ''); }
  set('--ink', c.ink); set('--ink-2', c.ink2); set('--ink-soft', c.inkSoft);
  set('--panel', c.panel); set('--panel-2', c.panel2);
  set('--line', c.line); set('--line-soft', c.line);
  set('--bg', c.appbg); set('--bg-2', c.appbg);
  const fam = loadFontInto(doc, cfg.font.family); set('--font', fam);
  if (cfg.radius != null) { const r = +cfg.radius; set('--r-sm', Math.round(r*0.7)+'px'); set('--r', r+'px'); set('--r-lg', Math.round(r*1.3)+'px'); set('--r-xl', Math.round(r*1.7)+'px'); }
  else { ['--r-sm','--r','--r-lg','--r-xl'].forEach((k) => root.style.removeProperty(k)); }
  doc.querySelectorAll('.logo').forEach((l) => { if (cfg.logo) l.innerHTML = `<img src="${cfg.logo}" alt="" style="height:1.15em;vertical-align:middle">`; else if (cfg.name) l.textContent = cfg.name; });
  applyOrderHide(doc, '#feedTabs', 'button[data-tab]', 'tab', cfg.tabs);
  applyOrderHide(doc, '#sidebar', '.nav-item[data-view]', 'view', cfg.nav);
}
function applyEl(doc) {
  let css = ''; const dyn = [], el = cfg.el || {};
  for (const sel in el) { const o = el[sel]; if (!o) continue; const d = [];
    if (o.hide) d.push('display:none !important');
    if (o.move && (o.move.x || o.move.y)) d.push(`transform:translate(${+o.move.x||0}px,${+o.move.y||0}px) !important`);
    if (o.style) for (const p in o.style) { if (o.style[p] !== '' && o.style[p] != null) d.push(`${p}:${o.style[p]} !important`); }
    if (d.length) css += `${sel}{${d.join(';')}}\n`;
    if (o.text != null || o.img != null) dyn.push([sel, o]);
  }
  let tag = doc.getElementById('ub-el-css'); if (!tag) { tag = doc.createElement('style'); tag.id = 'ub-el-css'; doc.head.appendChild(tag); }
  tag.textContent = css;
  dyn.forEach(([sel, o]) => { try { doc.querySelectorAll(sel).forEach((n) => {
    if (o.text != null && n.textContent !== o.text) n.textContent = o.text;
    if (o.img != null && n.tagName === 'IMG' && n.getAttribute('src') !== o.img) n.setAttribute('src', o.img);
  }); } catch (_) {} });
}
const frameDoc = () => { try { return $('appFrame').contentDocument; } catch (_) { return null; } };
const frameWin = () => { try { return $('appFrame').contentWindow; } catch (_) { return null; } };
function render() { const doc = frameDoc(); if (!doc || !doc.body) return; try { applyGlobal(doc); applyEl(doc); repositionSel(); } catch (_) {} }

/* ===== historial (deshacer / rehacer) ===== */
let history = [], future = [], _snapT = 0, dirty = false;
function setDirty(v) { dirty = v; const b = $('publish'); if (b) b.textContent = v ? 'Publicar cambios •' : 'Publicar cambios'; }
function snap() { setDirty(true); const now = Date.now(); if (now - _snapT < 350 && history.length) { _snapT = now; future = []; updateUndo(); return; } history.push(JSON.stringify(cfg)); if (history.length > 80) history.shift(); future = []; _snapT = now; updateUndo(); }
function updateUndo() { $('tUndo').disabled = !history.length; $('tRedo').disabled = !future.length; $('tUndo').style.opacity = history.length ? 1 : .4; $('tRedo').style.opacity = future.length ? 1 : .4; }
function restoreFrom(stack, other) { if (!stack.length) return; other.push(JSON.stringify(cfg)); cfg = JSON.parse(stack.pop()); hydrateControls(); buildColorList(); buildLists(); render(); if (selector && cfg.el) fillPanel(); updateUndo(); }

/* ===== listas reordenables ===== */
function renderOrderList(containerId, catalog, conf) {
  const keys = catalog.map((c) => c[0]);
  let order = (conf.order && conf.order.length) ? conf.order.filter((k) => keys.includes(k)) : [];
  keys.forEach((k) => { if (!order.includes(k)) order.push(k); });
  conf.order = order;
  const hidden = new Set(conf.hidden || []);
  const labels = Object.fromEntries(catalog);
  const cont = $(containerId); cont.innerHTML = '';
  order.forEach((k, i) => {
    const row = document.createElement('div');
    row.className = 'ord-item' + (hidden.has(k) ? ' hidden-it' : '');
    row.innerHTML = `<button data-up ${i===0?'disabled':''}>↑</button><button data-down ${i===order.length-1?'disabled':''}>↓</button><span class="nm">${labels[k]}</span><label><input type="checkbox" ${hidden.has(k)?'':'checked'}></label>`;
    row.querySelector('[data-up]').onclick = () => { if (i>0) { snap(); [order[i-1],order[i]]=[order[i],order[i-1]]; conf.order=order; renderOrderList(containerId,catalog,conf); render(); } };
    row.querySelector('[data-down]').onclick = () => { if (i<order.length-1) { snap(); [order[i+1],order[i]]=[order[i],order[i+1]]; conf.order=order; renderOrderList(containerId,catalog,conf); render(); } };
    row.querySelector('input').onchange = (e) => { snap(); if (e.target.checked) hidden.delete(k); else hidden.add(k); conf.hidden=[...hidden]; row.classList.toggle('hidden-it', !e.target.checked); render(); };
    cont.appendChild(row);
  });
}
function buildLists() { renderOrderList('tabsList', TABS, cfg.tabs); renderOrderList('navList', NAV, cfg.nav); }
function buildColorList() {
  const cont = $('colorList'); cont.innerHTML = '';
  COLORS.forEach(([key, label, def]) => {
    const on = cfg.colors[key] != null;
    const row = document.createElement('div'); row.className = 'clr-row';
    row.innerHTML = `<input type="checkbox" ${on?'checked':''}><input type="color" value="${cfg.colors[key]||def}" ${on?'':'disabled'}><span class="nm">${label}</span>`;
    const [chk, clr] = row.querySelectorAll('input');
    chk.onchange = () => { snap(); if (chk.checked) { cfg.colors[key]=clr.value; clr.disabled=false; } else { delete cfg.colors[key]; clr.disabled=true; } render(); };
    clr.oninput = () => { if (chk.checked) { cfg.colors[key]=clr.value; render(); } };
    clr.onchange = () => snap();
    cont.appendChild(row);
  });
}

/* ===== imágenes ===== */
async function uploadImage(file, setMsg) {
  if (!file) return null;
  setMsg && setMsg('Subiendo…');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { cacheControl: '31536000', upsert: false });
  if (error) { setMsg && setMsg(/bucket|not found|exist|policy|row-level/i.test(error.message||'') ? 'Falta el bucket site-assets (ejecuta el SQL).' : 'Error: ' + error.message); return null; }
  setMsg && setMsg('Subida ✓');
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
function setBgImage(url) { snap(); cfg.bg.mode='image'; cfg.bg.image=url; document.querySelectorAll('#bgMode button').forEach((x)=>x.classList.toggle('on',x.dataset.m==='image')); showBgPanels(); $('bgImageV').value=url; render(); }
async function loadLibrary() {
  const grid = $('libGrid');
  const { data, error } = await sb.storage.from(BUCKET).list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { grid.innerHTML = `<p class="hint">${/bucket|not found/i.test(error.message||'') ? 'Crea el bucket site-assets (ejecuta el SQL).' : error.message}</p>`; return; }
  const imgs = (data || []).filter((o) => o.name && !o.name.startsWith('.'));
  if (!imgs.length) { grid.innerHTML = '<p class="hint">Aún no has subido imágenes.</p>'; return; }
  grid.innerHTML = '';
  imgs.forEach((o) => {
    const url = sb.storage.from(BUCKET).getPublicUrl(o.name).data.publicUrl;
    const el = document.createElement('div'); el.className = 'lib-it';
    el.innerHTML = `<img src="${url}" loading="lazy"><div class="ov"><button data-a="bg">Fondo</button><button data-a="logo">Logo</button><button data-a="copy">Copiar URL</button><button class="del" data-a="del">Borrar</button></div>`;
    el.querySelector('[data-a="bg"]').onclick = () => { setBgImage(url); libMsg('Fondo aplicado (Publica para guardar).'); };
    el.querySelector('[data-a="logo"]').onclick = () => { snap(); cfg.logo=url; $('logoV').value=url; render(); libMsg('Logo aplicado (Publica para guardar).'); };
    el.querySelector('[data-a="copy"]').onclick = () => { (navigator.clipboard && navigator.clipboard.writeText(url)); libMsg('URL copiada ✓'); };
    el.querySelector('[data-a="del"]').onclick = async () => { if (!confirm('¿Borrar esta imagen del almacenamiento?')) return; await sb.storage.from(BUCKET).remove([o.name]); loadLibrary(); };
    grid.appendChild(el);
  });
}

/* ===== selector de imágenes (picker) ===== */
let pickerResolve = null, imgTarget = 'bg';
function openPicker() { return new Promise((resolve) => { pickerResolve = resolve; $('picker').hidden = false; loadPickGrid(); }); }
function closePicker(v) { $('picker').hidden = true; const r = pickerResolve; pickerResolve = null; if (r) r(v || null); }
async function loadPickGrid() {
  const grid = $('pickGrid'); grid.innerHTML = '<p class="hint">Cargando…</p>';
  const { data, error } = await sb.storage.from(BUCKET).list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { grid.innerHTML = `<p class="hint">${/bucket|not found/i.test(error.message||'') ? 'Crea el bucket site-assets (ejecuta el SQL).' : 'Error al listar.'}</p>`; return; }
  const imgs = (data || []).filter((o) => o.name && !o.name.startsWith('.'));
  if (!imgs.length) { grid.innerHTML = '<p class="hint">Sube una imagen primero (botón de arriba).</p>'; return; }
  grid.innerHTML = '';
  imgs.forEach((o) => {
    const url = sb.storage.from(BUCKET).getPublicUrl(o.name).data.publicUrl;
    const d = document.createElement('div'); d.className = 'lib-it'; d.style.cursor = 'pointer';
    d.innerHTML = `<img src="${url}" loading="lazy">`;
    d.onclick = () => closePicker(url);
    grid.appendChild(d);
  });
}
function setElBg(url) {
  if (!selector) return; snap(); ensureEl();
  const s = cfg.el[selector].style = cfg.el[selector].style || {};
  s['background-image'] = `url("${url}")`;
  if (!s['background-size']) s['background-size'] = 'cover';
  s['background-position'] = 'center'; s['background-repeat'] = 'no-repeat';
  applyEl(frameDoc()); repositionSel(); fillPanel();
}
function setElImg(url) { if (!selector) return; snap(); ensureEl(); cfg.el[selector].img = url; applyEl(frameDoc()); libMsg('Imagen reemplazada (Publica para guardar).'); }

/* ===== controles globales ===== */
function showBgPanels() { $('bgColor').style.display = cfg.bg.mode==='color'?'':'none'; $('bgGrad').style.display = cfg.bg.mode==='gradient'?'':'none'; $('bgImage').style.display = cfg.bg.mode==='image'?'':'none'; }
function hydrateControls() {
  const m = cfg.bg.mode || 'default';
  document.querySelectorAll('#bgMode button').forEach((x) => x.classList.toggle('on', x.dataset.m === m));
  showBgPanels();
  if (cfg.bg.color) $('bgColorV').value = cfg.bg.color;
  if (cfg.bg.c1) $('bgC1').value = cfg.bg.c1;
  if (cfg.bg.c2) $('bgC2').value = cfg.bg.c2;
  if (cfg.bg.angle != null) $('bgAngle').value = cfg.bg.angle;
  if (cfg.bg.image) $('bgImageV').value = cfg.bg.image;
  $('bgDim').value = cfg.bg.dim || 0; $('bgDimL').textContent = (cfg.bg.dim || 0) + '%';
  $('fontV').value = cfg.font.family || 'system';
  const ro = cfg.radius != null;
  $('radiusOn').checked = ro; $('radiusV').disabled = !ro; $('radiusV').value = ro ? cfg.radius : 14; $('radiusL').textContent = (ro ? cfg.radius : 14) + 'px';
  $('nameV').value = cfg.name || ''; $('taglineV').value = cfg.tagline || ''; $('logoV').value = cfg.logo || '';
}
function wire() {
  document.querySelectorAll('#bgMode button').forEach((b) => b.onclick = () => { snap(); document.querySelectorAll('#bgMode button').forEach((x)=>x.classList.toggle('on',x===b)); cfg.bg.mode=b.dataset.m; showBgPanels(); render(); });
  $('bgColorV').oninput = (e) => { cfg.bg.color=e.target.value; render(); }; $('bgColorV').onchange = snap;
  $('bgC1').oninput = (e) => { cfg.bg.c1=e.target.value; render(); }; $('bgC1').onchange = snap;
  $('bgC2').oninput = (e) => { cfg.bg.c2=e.target.value; render(); }; $('bgC2').onchange = snap;
  $('bgAngle').oninput = (e) => { cfg.bg.angle=+e.target.value; render(); }; $('bgAngle').onchange = snap;
  $('bgImageV').oninput = (e) => { snap(); cfg.bg.image=e.target.value.trim(); render(); };
  $('bgDim').oninput = (e) => { cfg.bg.dim=+e.target.value; $('bgDimL').textContent=e.target.value+'%'; render(); }; $('bgDim').onchange = snap;
  $('bgUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], (t)=>{$('bgUpMsg').textContent=t;}); if (u) { setBgImage(u); loadLibrary(); } e.target.value=''; };
  $('fontV').onchange = (e) => { snap(); cfg.font.family=e.target.value; render(); };
  $('radiusOn').onchange = (e) => { snap(); if (e.target.checked) { cfg.radius=+$('radiusV').value; $('radiusV').disabled=false; } else { cfg.radius=null; $('radiusV').disabled=true; } render(); };
  $('radiusV').oninput = (e) => { if ($('radiusOn').checked) { cfg.radius=+e.target.value; $('radiusL').textContent=e.target.value+'px'; render(); } }; $('radiusV').onchange = snap;
  $('nameV').oninput = (e) => { cfg.name=e.target.value; render(); }; $('nameV').onfocus = snap;
  $('taglineV').oninput = (e) => { cfg.tagline=e.target.value; render(); }; $('taglineV').onfocus = snap;
  $('logoV').oninput = (e) => { cfg.logo=e.target.value.trim(); render(); }; $('logoV').onfocus = snap;
  $('logoUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], (t)=>{$('logoUpMsg').textContent=t;}); if (u) { snap(); cfg.logo=u; $('logoV').value=u; render(); loadLibrary(); } e.target.value=''; };
  $('libUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], libMsg); if (u) loadLibrary(); e.target.value=''; };
  $('publish').onclick = publish; $('reset').onclick = resetAll;
  // toolbar visor
  $('tInspect').onclick = toggleInspect;
  $('tUndo').onclick = () => restoreFrom(history, future);
  $('tRedo').onclick = () => restoreFrom(future, history);
  $('tReload').onclick = () => { $('appFrame').src = $('appFrame').src; };
  $('tViewport').onchange = (e) => { $('pvStage').classList.toggle('mobile', e.target.value === 'mobile'); };
  $('tExport').onclick = exportTheme;
  $('tImport').onchange = importTheme;
  // panel propiedades
  buildPropRows();
  $('pClose').onclick = closePanel;
  $('pScope').onchange = (e) => { scopeAll = !!(e.target.checked && genericSel); selector = scopeAll ? genericSel : specificSel; fillPanel(); };
  $('pText').oninput = () => { if (!selector) return; ensureEl(); cfg.el[selector].text = $('pText').value; applyEl(frameDoc()); }; $('pText').onfocus = snap;
  $('pMoveX').oninput = $('pMoveY').oninput = () => { if (!selector) return; ensureEl(); cfg.el[selector].move = { x:+$('pMoveX').value||0, y:+$('pMoveY').value||0 }; applyEl(frameDoc()); repositionSel(); }; $('pMoveX').onfocus = $('pMoveY').onfocus = snap;
  $('pHide').onclick = () => { if (!selector) return; snap(); ensureEl(); cfg.el[selector].hide = !cfg.el[selector].hide; applyEl(frameDoc()); $('pHide').textContent = cfg.el[selector].hide ? 'Mostrar' : 'Ocultar'; };
  $('pResetEl').onclick = () => { if (!selector) return; snap(); delete cfg.el[selector]; applyEl(frameDoc()); fillPanel(); };
  // imágenes por elemento
  $('pBgUp').onclick = () => { imgTarget = 'bg'; $('pImgFile').click(); };
  $('pImgUp').onclick = () => { imgTarget = 'img'; $('pImgFile').click(); };
  $('pBgLib').onclick = async () => { const u = await openPicker(); if (u) setElBg(u); };
  $('pImgLib').onclick = async () => { const u = await openPicker(); if (u) setElImg(u); };
  $('pBgClear').onclick = () => { if (!selector) return; snap(); const s = cfg.el[selector] && cfg.el[selector].style; if (s) { ['background-image','background-size','background-position','background-repeat'].forEach((k) => delete s[k]); } applyEl(frameDoc()); fillPanel(); };
  $('pBgSize').onchange = () => { if (!selector) return; snap(); ensureEl(); const s = cfg.el[selector].style = cfg.el[selector].style || {}; if ($('pBgSize').value) s['background-size'] = $('pBgSize').value; else delete s['background-size']; applyEl(frameDoc()); };
  $('pImgFile').onchange = async (e) => { const u = await uploadImage(e.target.files[0], libMsg); if (u) { (imgTarget === 'img') ? setElImg(u) : setElBg(u); loadLibrary(); } e.target.value = ''; };
  $('pickClose').onclick = () => closePicker(null);
  $('picker').onclick = (e) => { if (e.target === $('picker')) closePicker(null); };
  $('pickUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], libMsg); if (u) { loadLibrary(); closePicker(u); } e.target.value = ''; };
  // teclas: atajos globales + nudge del elemento seleccionado
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { if (typing) return; e.preventDefault(); if (e.shiftKey) restoreFrom(future, history); else restoreFrom(history, future); return; }
    if (mod && (e.key === 'y' || e.key === 'Y')) { if (typing) return; e.preventDefault(); restoreFrom(future, history); return; }
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); publish(); return; }
    if (e.key === 'Escape') { if (!$('picker').hidden) return closePicker(null); if (!$('propPanel').hidden) return closePanel(); if (inspectOn) toggleInspect(); return; }
    if (typing || !selector || !selectedEl) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); snap(); ensureEl(); cfg.el[selector].hide = true; applyEl(frameDoc()); fillPanel(); return; }
    const arrows = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
    if (arrows[e.key]) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; ensureEl(); const m = cfg.el[selector].move || { x:0, y:0 }; cfg.el[selector].move = { x:m.x+arrows[e.key][0]*s, y:m.y+arrows[e.key][1]*s }; applyEl(frameDoc()); repositionSel(); syncMoveInputs(); }
  });
  $('tUndo').title = 'Deshacer (Ctrl/Cmd+Z)'; $('tRedo').title = 'Rehacer (Ctrl/Cmd+Shift+Z)';
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}

/* ===== panel de propiedades ===== */
function buildPropRows() {
  const c = $('propStyles'); c.innerHTML = '';
  PROPS.forEach((p) => {
    const row = document.createElement('div'); row.className = 'prop-row';
    let ctrl;
    if (p.type === 'color') ctrl = `<input type="color" id="prop_${p.key}">`;
    else if (p.type === 'num') ctrl = `<input type="number" id="prop_${p.key}">`;
    else if (p.type === 'range') ctrl = `<input type="range" id="prop_${p.key}" min="${p.min}" max="${p.max}" step="${p.step}">`;
    else if (p.type === 'select') ctrl = `<select id="prop_${p.key}"><option value="">—</option>${p.opts.map((o) => `<option value="${o}">${o}</option>`).join('')}</select>`;
    row.innerHTML = `<label>${p.label}</label>${ctrl}<button class="clr" id="clr_${p.key}" title="Quitar">↺</button>`;
    c.appendChild(row);
    const input = row.querySelector(`#prop_${p.key}`);
    const commit = (v) => { if (!selector) return; ensureEl(); cfg.el[selector].style = cfg.el[selector].style || {}; if (v === '' || v == null) delete cfg.el[selector].style[p.key]; else cfg.el[selector].style[p.key] = v + (p.unit || ''); applyEl(frameDoc()); repositionSel(); };
    input.oninput = () => commit(input.value); input.onchange = snap; input.onfocus = snap;
    row.querySelector(`#clr_${p.key}`).onclick = () => { snap(); input.value = p.type === 'color' ? '#000000' : ''; commit(''); };
  });
}
function fillPanel() {
  const o = (cfg.el && cfg.el[selector]) || {}; const st = o.style || {};
  $('pText').value = o.text != null ? o.text : '';
  $('pText').placeholder = selectedEl ? (selectedEl.textContent || '').slice(0, 60) : '(sin cambiar)';
  const cs = selectedEl ? frameWin().getComputedStyle(selectedEl) : null;
  PROPS.forEach((p) => {
    const input = $('prop_' + p.key); if (!input) return;
    let raw = st[p.key];
    if (raw != null) input.value = (p.unit ? parseFloat(raw) : raw);
    else if (cs) {
      if (p.type === 'color') { try { input.value = rgb2hex(cs[p.key === 'background-color' ? 'backgroundColor' : 'color']); } catch (_) {} }
      else if (p.type === 'num') input.value = parseFloat(cs.getPropertyValue(p.key)) || 0;
      else if (p.type === 'range') input.value = parseFloat(cs.opacity) || 1;
      else input.value = '';
    }
  });
  $('pBgSize').value = st['background-size'] || '';
  $('pImgRow').style.display = (selectedEl && selectedEl.tagName === 'IMG') ? '' : 'none';
  const m = o.move || { x:0, y:0 }; $('pMoveX').value = m.x || 0; $('pMoveY').value = m.y || 0;
  $('pHide').textContent = o.hide ? 'Mostrar' : 'Ocultar';
}
function syncMoveInputs() { const m = (cfg.el[selector] && cfg.el[selector].move) || { x:0, y:0 }; $('pMoveX').value = m.x || 0; $('pMoveY').value = m.y || 0; }
function rgb2hex(rgb) {
  const m = (rgb || '').match(/\d+/g); if (!m) return '#000000';
  return '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
}
function ensureEl() { if (!cfg.el) cfg.el = {}; if (!cfg.el[selector]) cfg.el[selector] = {}; }
function closePanel() { $('propPanel').hidden = true; selector = null; selectedEl = null; if (selBox) selBox.style.display = 'none'; }

/* ===== inspector del visor ===== */
let inspectOn = false, selectedEl = null, selector = null, specificSel = null, genericSel = null, scopeAll = false, hlBox = null, selBox = null;
function cssPath(el, win) {
  if (!el || el.nodeType !== 1) return '';
  const esc = (win.CSS && win.CSS.escape) ? win.CSS.escape.bind(win.CSS) : ((s) => s);
  if (el.id) return '#' + esc(el.id);
  const parts = []; let node = el;
  while (node && node.nodeType === 1 && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
    if (node.id) { parts.unshift('#' + esc(node.id)); break; }
    let part = node.tagName.toLowerCase();
    const parent = node.parentNode;
    if (parent) { const sibs = [...parent.children].filter((c) => c.tagName === node.tagName); if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`; }
    parts.unshift(part); node = node.parentNode;
  }
  return parts.join('>');
}
// selector "de grupo": clases comunes para afectar a todas las iguales (p. ej. todas las tarjetas)
function genericPath(el, win) {
  const esc = (win.CSS && win.CSS.escape) ? win.CSS.escape.bind(win.CSS) : ((s) => s);
  const cls = ((el.getAttribute && el.getAttribute('class')) || '').trim().split(/\s+/).filter(Boolean);
  if (cls.length) return cls.map((c) => '.' + esc(c)).join('');
  return null;
}
function boxOver(box, el) { if (!box) return; if (!el) { box.style.display = 'none'; return; } const r = el.getBoundingClientRect(); box.style.display = 'block'; box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px'; }
function repositionSel() { if (selBox && selectedEl) boxOver(selBox, selectedEl); }
function toggleInspect() { inspectOn = !inspectOn; $('tInspect').classList.toggle('on', inspectOn); $('pvStage').classList.toggle('inspect', inspectOn); const doc = frameDoc(); if (doc) doc.documentElement.classList.toggle('__ubinspect', inspectOn); if (!inspectOn && hlBox) hlBox.style.display = 'none'; }
function selectEl(el) {
  selectedEl = el;
  specificSel = cssPath(el, frameWin());
  genericSel = genericPath(el, frameWin());
  scopeAll = false; selector = specificSel;
  const sc = $('pScope'); sc.checked = false; sc.disabled = !genericSel;
  $('pScopeSel').textContent = genericSel ? `(${genericSel})` : '(sin clase común)';
  $('pScopeRow').style.opacity = genericSel ? 1 : .5;
  boxOver(selBox, el); if (hlBox) hlBox.style.display = 'none';
  $('propPanel').hidden = false; $('pTag').textContent = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
  buildBread(el); fillPanel();
}
function buildBread(el) {
  const b = $('pBread'); b.innerHTML = ''; const chain = []; let n = el;
  while (n && n.nodeType === 1 && n.tagName !== 'BODY' && chain.length < 6) { chain.unshift(n); n = n.parentNode; }
  chain.forEach((node) => { const cr = document.createElement('span'); cr.className = 'cr' + (node === el ? ' cur' : ''); cr.textContent = node.tagName.toLowerCase(); cr.onclick = () => selectEl(node); b.appendChild(cr); });
}
function onFrameLoad() {
  const doc = frameDoc(), win = frameWin(); if (!doc || !doc.body) return;
  if (!doc.getElementById('ub-inspect-style')) {
    const s = doc.createElement('style'); s.id = 'ub-inspect-style';
    s.textContent = '.__ubov{position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #5f9bff;border-radius:3px}.__ubhl{background:rgba(95,155,255,.14)}.__ubsel{border-color:#ff5db0}html.__ubinspect,html.__ubinspect *{cursor:grab !important}html.__ubinspect *:active{cursor:grabbing !important}';
    doc.head.appendChild(s);
  }
  hlBox = doc.getElementById('__ubhl') || mkBox(doc, '__ubhl');
  selBox = doc.getElementById('__ubsel') || mkBox(doc, '__ubsel');
  selectedEl = null; selector = null; $('propPanel').hidden = true;
  doc.addEventListener('mousemove', onFrameMove, true);
  doc.addEventListener('mousedown', onFrameDown, true);
  doc.addEventListener('click', onFrameClick, true);
  win.addEventListener('scroll', repositionSel, true);
  win.addEventListener('resize', repositionSel, true);
  if (inspectOn) doc.documentElement.classList.add('__ubinspect');
  setTimeout(render, 60); setTimeout(render, 400);
}
function mkBox(doc, cls) { const d = doc.createElement('div'); d.id = cls; d.className = '__ubov ' + cls; d.style.display = 'none'; doc.body.appendChild(d); return d; }
function selectable(t) { return t && t.nodeType === 1 && t !== hlBox && t !== selBox && t.id !== '__ubhl' && t.id !== '__ubsel'; }
function onFrameMove(e) { if (!inspectOn) { if (hlBox) hlBox.style.display = 'none'; return; } if (selectable(e.target)) boxOver(hlBox, e.target); }
function onFrameClick(e) { if (!inspectOn) return; e.preventDefault(); e.stopPropagation(); }
function onFrameDown(e) {
  if (!inspectOn || !selectable(e.target)) return;
  e.preventDefault(); e.stopPropagation();
  const target = e.target, doc = frameDoc();
  const startX = e.clientX, startY = e.clientY; let moved = false, snapped = false;
  const sel = cssPath(target, frameWin());
  const base = (cfg.el[sel] && cfg.el[sel].move) ? { ...cfg.el[sel].move } : { x:0, y:0 };
  function mm(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 3) { moved = true; if (!snapped) { snap(); snapped = true; } if (selectedEl !== target) selectEl(target); }
    if (moved) { selector = sel; ensureEl(); cfg.el[sel].move = { x: Math.round(base.x + dx), y: Math.round(base.y + dy) }; applyEl(doc); boxOver(selBox, target); syncMoveInputs(); }
  }
  function mu() { doc.removeEventListener('mousemove', mm, true); doc.removeEventListener('mouseup', mu, true); if (!moved) selectEl(target); }
  doc.addEventListener('mousemove', mm, true); doc.addEventListener('mouseup', mu, true);
}

/* ===== exportar / importar / publicar ===== */
function trimOrderHide(catalog, conf) {
  const def = catalog.map((c) => c[0]), order = conf.order || [];
  const same = order.length === def.length && order.every((k, i) => k === def[i]);
  const hidden = conf.hidden || [];
  if (same && !hidden.length) return null;
  const out = {}; if (!same) out.order = order; if (hidden.length) out.hidden = hidden; return out;
}
function buildOut() {
  const o = {};
  if (cfg.bg && cfg.bg.mode && cfg.bg.mode !== 'default') { const b = { mode: cfg.bg.mode }; ['color','c1','c2','angle','image','dim'].forEach((k) => { if (cfg.bg[k] != null && cfg.bg[k] !== '') b[k] = cfg.bg[k]; }); o.bg = b; }
  if (Object.keys(cfg.colors).length) o.colors = { ...cfg.colors };
  if (cfg.font.family && cfg.font.family !== 'system') o.font = { family: cfg.font.family };
  if (cfg.radius != null) o.radius = cfg.radius;
  if (cfg.name && cfg.name.trim()) o.name = cfg.name.trim();
  if (cfg.tagline && cfg.tagline.trim()) o.tagline = cfg.tagline.trim();
  if (cfg.logo && cfg.logo.trim()) o.logo = cfg.logo.trim();
  const t = trimOrderHide(TABS, cfg.tabs); if (t) o.tabs = t;
  const n = trimOrderHide(NAV, cfg.nav); if (n) o.nav = n;
  const el = {}; for (const s in (cfg.el || {})) { const v = cfg.el[s]; if (v && (v.text != null || v.img != null || v.hide || (v.move && (v.move.x || v.move.y)) || (v.style && Object.keys(v.style).length))) el[s] = v; }
  if (Object.keys(el).length) o.el = el;
  return o;
}
function exportTheme() {
  const blob = new Blob([JSON.stringify(buildOut(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'underbro-theme.json'; a.click(); URL.revokeObjectURL(a.href);
}
function importTheme(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => { try { snap(); cfg = mergeCfg(JSON.parse(r.result)); hydrateControls(); buildColorList(); buildLists(); render(); msg('Tema importado (revísalo y Publica). ✅'); } catch (_) { msg('Archivo no válido.'); } };
  r.readAsText(file); e.target.value = '';
}
async function publish() {
  $('publish').disabled = true; msg('Publicando…');
  const { error } = await sb.from('site_config').upsert({ id: 1, config: buildOut(), updated_at: new Date().toISOString() });
  $('publish').disabled = false;
  if (error) { msg(/site_config|relation|exist/i.test(error.message||'') ? 'Falta crear la tabla site_config (ejecuta el SQL).' : 'Error: ' + (error.message||'')); return; }
  setDirty(false); msg('¡Publicado! Los usuarios lo verán al recargar. ✅');
}
async function resetAll() {
  if (!confirm('¿Restablecer TODA la apariencia por defecto para todos?')) return;
  snap(); cfg = defaults();
  try { await sb.from('site_config').upsert({ id: 1, config: {}, updated_at: new Date().toISOString() }); } catch (_) {}
  setDirty(false); closePanel(); hydrateControls(); buildColorList(); buildLists(); render(); msg('Restablecido. ✅');
}

/* ===== arranque ===== */
async function boot() {
  let session;
  try { session = (await sb.auth.getSession()).data.session; } catch (_) {}
  if (!session) return gate('Inicia sesión en la app primero (con tu cuenta de administrador).', true);
  const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', session.user.id).maybeSingle();
  if (!prof || !prof.is_admin) return gate('Acceso solo para administradores.', true);
  try { const { data } = await sb.from('site_config').select('config').eq('id', 1).maybeSingle(); if (data && data.config) cfg = mergeCfg(data.config); } catch (_) {}
  $('gate').style.display = 'none'; $('editor').style.display = 'grid';
  hydrateControls(); buildColorList(); buildLists(); wire(); updateUndo(); loadLibrary();
  $('appFrame').addEventListener('load', onFrameLoad);
  if (frameDoc() && frameDoc().readyState === 'complete') onFrameLoad();
}
boot();
})();
