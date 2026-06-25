// Helpers compartidos para la pasarela de pagos (Stripe Connect) — sin dependencias.
// Los archivos/carpetas con prefijo "_" dentro de /api no se exponen como rutas.
const crypto = require('crypto');

const SB_URL = process.env.SUPABASE_URL || 'https://hvpycejcaljgpxwnykuh.supabase.co';
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const APP_URL = process.env.APP_URL || 'https://underbro.app';
const FEE_BPS = parseInt(process.env.PLATFORM_FEE_BPS || '1000', 10); // 1000 = 10%

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readRaw(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = await readRaw(req);
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

// Codifica un objeto anidado a x-www-form-urlencoded con notación de corchetes (formato Stripe)
function encodeForm(obj, prefix, out) {
  out = out || [];
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const v = obj[k];
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encodeForm(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out;
}
async function stripe(path, params, method, opts) {
  if (!STRIPE_SECRET) { const e = new Error('stripe_not_configured'); e.code = 'no_key'; throw e; }
  const headers = {
    Authorization: 'Bearer ' + STRIPE_SECRET,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (opts && opts.account) headers['Stripe-Account'] = opts.account; // actuar en nombre de la cuenta conectada
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: method || 'POST',
    headers,
    body: params ? encodeForm(params).join('&') : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((d.error && d.error.message) || 'stripe_error'); e.stripe = d.error; throw e; }
  return d;
}

// Supabase REST con service role (ignora RLS) — para escrituras de servidor
async function sbAdmin(path, opts) {
  opts = opts || {};
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers: {
      apikey: SB_SERVICE,
      Authorization: 'Bearer ' + SB_SERVICE,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const txt = await r.text();
  let d = null; try { d = txt ? JSON.parse(txt) : null; } catch (_) { d = txt; }
  if (!r.ok) { const e = new Error('sb_error ' + r.status + ': ' + txt); e.status = r.status; throw e; }
  return d;
}

// Verifica un token de acceso de Supabase → devuelve el usuario {id,email} o null
async function userFromToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_SERVICE, Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch (_) { return null; }
}

module.exports = { json, readRaw, readJson, encodeForm, stripe, sbAdmin, userFromToken, crypto, SB_URL, STRIPE_SECRET, APP_URL, FEE_BPS };
