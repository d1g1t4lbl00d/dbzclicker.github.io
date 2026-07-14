// Webhook de Stripe: confirma el pago y entrega el producto (token de descarga / código de entrada).
// Defensa en profundidad: además de verificar la firma (si hay secreto), re-consultamos el
// objeto a Stripe con nuestra clave secreta antes de marcar nada como pagado.
const { sbAdmin, stripe, crypto, readRaw } = require('../_lib/pay');

function verifySig(raw, header, secret) {
  if (!secret || !header) return false;
  const parts = {};
  header.split(',').forEach((kv) => {
    const i = kv.indexOf('=');
    if (i > 0) { const k = kv.slice(0, i), v = kv.slice(i + 1); (parts[k] = parts[k] || []).push(v); }
  });
  const t = parts.t && parts.t[0];
  const v1 = parts.v1 || [];
  if (!t || !v1.length) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + raw, 'utf8').digest('hex');
  return v1.some((s) => { try { return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)); } catch (_) { return false; } });
}

async function fulfill(sessionId) {
  // re-consulta autoritativa a Stripe
  const s = await stripe('checkout/sessions/' + sessionId, null, 'GET').catch(() => null);
  if (!s || s.payment_status !== 'paid') return;
  const orderId = s.metadata && s.metadata.order_id;
  if (!orderId) return;
  const cur = await sbAdmin(`shop_orders?id=eq.${orderId}&select=id,status,file_url,image_url,product_id`).catch(() => null);
  const o = cur && cur[0];
  if (!o || o.status === 'paid') return; // idempotente
  const token = crypto.randomBytes(18).toString('hex');
  const ticket = 'UB-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  // dirección de envío (si el comprador la introdujo) para que el vendedor pueda enviar
  let ship = null;
  const sd = s.shipping_details || (s.collected_information && s.collected_information.shipping_details);
  if (sd && sd.address) {
    const a = sd.address;
    ship = [sd.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.state, a.country]
      .filter(Boolean).join(', ');
  }
  const productId = (s.metadata && s.metadata.product_id) || o.product_id;
  // RED DE SEGURIDAD: garantizamos que el pedido guarde su copia de entrega
  // (archivo + portada) para que el comprador SIEMPRE pueda descargar su producto,
  // aunque el vendedor luego borre o cambie el producto.
  const snap = {};
  if (!o.file_url && productId) {
    const pr = await sbAdmin(`shop_products?id=eq.${productId}&select=file_url,image_url`).catch(() => null);
    if (pr && pr[0]) { snap.file_url = pr[0].file_url || null; snap.image_url = pr[0].image_url || null; }
  }
  if (!o.product_id && productId) snap.product_id = productId;
  await sbAdmin(`shop_orders?id=eq.${orderId}`, { method: 'PATCH', prefer: 'return=minimal', body: Object.assign({
    status: 'paid', paid_at: new Date().toISOString(),
    stripe_payment_intent: s.payment_intent || null,
    download_token: token, ticket_code: ticket, ship_addr: ship,
  }, snap) });
  // descuenta stock solo al confirmarse el pago (no-op si es de unidades ilimitadas)
  if (productId) {
    await sbAdmin('rpc/shop_decrement_stock', { method: 'POST', prefer: 'return=minimal', body: { p_id: productId } }).catch(() => {});
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method'); }
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const raw = await readRaw(req);
  const sig = req.headers['stripe-signature'] || '';
  // Si hay secreto configurado exigimos firma válida; si no, seguimos pero confiamos solo en la re-consulta.
  if (secret && !verifySig(raw, sig, secret)) { res.statusCode = 400; return res.end('bad signature'); }

  let evt; try { evt = JSON.parse(raw); } catch (_) { res.statusCode = 400; return res.end('bad json'); }
  try {
    if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
      const sId = evt.data && evt.data.object && evt.data.object.id;
      if (sId) await fulfill(sId);
    } else if (evt.type === 'account.updated') {
      const a = evt.data.object;
      const ready = !!(a.charges_enabled && a.payouts_enabled);
      const uid = a.metadata && a.metadata.user_id;
      if (uid) await sbAdmin(`profiles?id=eq.${uid}`, { method: 'PATCH', prefer: 'return=minimal', body: { stripe_ready: ready } });
      else if (a.id) await sbAdmin(`profiles?stripe_account_id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { stripe_ready: ready } });
    } else if (evt.type === 'charge.refunded') {
      const pi = evt.data.object && evt.data.object.payment_intent;
      if (pi) {
        const ords = await sbAdmin(`shop_orders?stripe_payment_intent=eq.${pi}&select=id,product_id,status`).catch(() => null);
        const o = ords && ords[0];
        if (o && o.status !== 'refunded') {
          await sbAdmin(`shop_orders?id=eq.${o.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'refunded' } });
          if (o.product_id) await sbAdmin('rpc/shop_increment_stock', { method: 'POST', prefer: 'return=minimal', body: { p_id: o.product_id } }).catch(() => {});
        }
      }
    }
  } catch (_) { /* no reventamos: respondemos 200 para que Stripe no reintente en bucle */ }
  res.statusCode = 200; res.end('ok');
};
