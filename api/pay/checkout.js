// Crea una sesión de Stripe Checkout para comprar un producto.
// UnderBro cobra la comisión (application_fee) y transfiere el resto al vendedor.
// POST { product_id }  con Authorization: Bearer <supabase access token>.
const { json, readJson, stripe, sbAdmin, userFromToken, APP_URL, FEE_BPS } = require('../_lib/pay');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  const user = await userFromToken(req);
  if (!user) return json(res, 401, { error: 'auth' });
  const body = await readJson(req);
  const productId = body.product_id;
  if (!productId) return json(res, 400, { error: 'no_product' });
  try {
    const rows = await sbAdmin(`shop_products?id=eq.${encodeURIComponent(productId)}&select=*`);
    const p = rows && rows[0];
    if (!p) return json(res, 404, { error: 'no_product' });
    if (p.is_free) return json(res, 400, { error: 'free' });
    if (!p.pay_inapp || !p.price_cents || p.price_cents < 50) return json(res, 400, { error: 'not_payable' });
    if (p.user_id === user.id) return json(res, 400, { error: 'own_product' });

    const sRows = await sbAdmin(`profiles?id=eq.${p.user_id}&select=stripe_account_id,stripe_ready,username,display_name`);
    const seller = sRows && sRows[0];
    if (!seller || !seller.stripe_account_id || !seller.stripe_ready) return json(res, 400, { error: 'seller_not_ready' });

    const cur = p.currency || 'eur';
    const amount = p.price_cents;                                   // precio del producto (lo recibe el vendedor)
    const fee = Math.max(0, Math.round(amount * FEE_BPS / 10000));  // gastos de gestión (los paga el comprador, los recibe UnderBro)
    const needsShip = !!p.needs_shipping;                 // físico: siempre pedimos dirección
    const shipCents = needsShip ? (p.ship_cents || 0) : null;

    const ord = await sbAdmin('shop_orders', { method: 'POST', body: {
      product_id: p.id, seller_id: p.user_id, buyer_id: user.id, buyer_email: user.email || null,
      title: p.title, type: p.type, amount_cents: amount, fee_cents: fee, ship_cents: shipCents, currency: cur, status: 'pending',
    }});
    const order = Array.isArray(ord) ? ord[0] : ord;

    const sellerName = (seller.display_name || seller.username || 'UnderBro');
    const lineItems = {
      0: { quantity: 1, price_data: { currency: cur, unit_amount: amount,
        product_data: { name: (p.title || 'Producto').slice(0, 120), description: (sellerName + ' · UnderBro').slice(0, 200) } } },
      1: { quantity: 1, price_data: { currency: cur, unit_amount: fee,
        product_data: { name: 'Gastos de gestión' } } },
    };

    const params = {
      mode: 'payment',
      success_url: `${APP_URL}/?pay=ok&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/?pay=cancel`,
      customer_email: user.email || undefined,
      line_items: lineItems,
      payment_intent_data: {
        application_fee_amount: fee,                                // UnderBro se queda exactamente los gastos de gestión
        transfer_data: { destination: seller.stripe_account_id },   // el resto (producto + envío) va al vendedor
        metadata: { order_id: order.id, product_id: p.id, seller_id: p.user_id, buyer_id: user.id },
      },
      metadata: { order_id: order.id, product_id: p.id },
    };
    if (needsShip) {
      params.shipping_address_collection = { allowed_countries: { 0: 'ES', 1: 'PT', 2: 'FR', 3: 'IT', 4: 'DE', 5: 'GB', 6: 'US', 7: 'MX', 8: 'AR' } };
      params.shipping_options = { 0: { shipping_rate_data: {
        type: 'fixed_amount', display_name: 'Envío',
        fixed_amount: { amount: shipCents, currency: cur },
      } } };
    }
    const session = await stripe('checkout/sessions', params);

    await sbAdmin(`shop_orders?id=eq.${order.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { stripe_session_id: session.id } });
    return json(res, 200, { url: session.url });
  } catch (e) {
    return json(res, 500, { error: e.message || 'error' });
  }
};
