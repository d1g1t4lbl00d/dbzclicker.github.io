// Devuelve la entrega de un pedido pagado (descarga / código de entrada),
// buscando por el id de sesión de Stripe (largo e imposible de adivinar).
// GET ?sid=cs_xxx
const { json, sbAdmin } = require('../_lib/pay');

module.exports = async (req, res) => {
  const sid = req.query && (req.query.sid || req.query.session_id);
  if (!sid) return json(res, 400, { error: 'no_sid' });
  try {
    const rows = await sbAdmin(`shop_orders?stripe_session_id=eq.${encodeURIComponent(sid)}&select=id,status,title,type,amount_cents,currency,ticket_code,product_id`);
    const o = rows && rows[0];
    if (!o) return json(res, 404, { error: 'no_order' });
    if (o.status !== 'paid') return json(res, 200, { status: o.status });
    const pr = await sbAdmin(`shop_products?id=eq.${o.product_id}&select=file_url,event_date,event_place,title`);
    const p = (pr && pr[0]) || {};
    return json(res, 200, {
      status: 'paid',
      title: o.title || p.title || 'Producto',
      type: o.type,
      amount_cents: o.amount_cents,
      currency: o.currency,
      file_url: p.file_url || null,
      ticket_code: o.ticket_code || null,
      event_date: p.event_date || null,
      event_place: p.event_place || null,
    });
  } catch (e) {
    return json(res, 500, { error: e.message || 'error' });
  }
};
