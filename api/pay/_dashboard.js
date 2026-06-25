// Enlace de un solo uso al panel Express de Stripe del vendedor
// (ver saldo, gestionar cuenta bancaria y retirar/ver pagos).
// POST con Authorization: Bearer <supabase access token>.
const { json, stripe, sbAdmin, userFromToken } = require('../_lib/pay');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  const user = await userFromToken(req);
  if (!user) return json(res, 401, { error: 'auth' });
  try {
    const rows = await sbAdmin(`profiles?id=eq.${user.id}&select=stripe_account_id`);
    const prof = rows && rows[0];
    if (!prof || !prof.stripe_account_id) return json(res, 400, { error: 'not_connected' });
    const link = await stripe('accounts/' + prof.stripe_account_id + '/login_links', {});
    return json(res, 200, { url: link.url });
  } catch (e) {
    return json(res, 500, { error: e.message || 'error' });
  }
};
