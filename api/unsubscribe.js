// Baja de correos (unsubscribe). Enlace: /api/unsubscribe?u=<user_id>&t=<hmac>
// El HMAC lo genera la edge function send-email con el mismo secreto.
const { sbAdmin } = require('./_lib/pay');
const crypto = require('crypto');

const UNSUB_SECRET = 'a7f3c9e21b8d4f60a1c5e8b3d2f70946ubmail';

function page(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;text-align:center;color:#111">
      <div style="font-size:24px;font-weight:800;color:#5f2fd6">Under<span style="color:#27a9ff">Bro</span></div>
      <p style="font-size:16px;margin-top:20px">${body}</p>
      <p><a href="https://underbro.app" style="color:#5f2fd6">Volver a la app</a></p>
    </div>`);
}

module.exports = async (req, res) => {
  const u = req.query && req.query.u;
  const t = req.query && req.query.t;
  if (!u || !t) return page(res, 'Enlace no válido.');
  const expected = crypto.createHmac('sha256', UNSUB_SECRET).update(String(u)).digest('hex');
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(String(t)), Buffer.from(expected)); } catch (_) {}
  if (!ok) return page(res, 'Enlace no válido o caducado.');
  try {
    await sbAdmin(`profiles?id=eq.${encodeURIComponent(u)}`, { method: 'PATCH', prefer: 'return=minimal', body: { email_opt_out: true } });
  } catch (_) { return page(res, 'No se pudo procesar. Inténtalo de nuevo más tarde.'); }
  return page(res, '✅ Te has dado de baja de los correos de UnderBro. No recibirás más avisos por email. (Los correos importantes de tus compras/ventas seguirán llegando).');
};
