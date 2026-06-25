// Estado de cobros del vendedor (¿puede recibir pagos ya?).
// GET con Authorization: Bearer <supabase access token>.
const { json, stripe, sbAdmin, userFromToken } = require('../_lib/pay');

module.exports = async (req, res) => {
  const user = await userFromToken(req);
  if (!user) return json(res, 401, { error: 'auth' });
  try {
    const rows = await sbAdmin(`profiles?id=eq.${user.id}&select=stripe_account_id,stripe_ready`);
    const prof = rows && rows[0];
    if (!prof || !prof.stripe_account_id) return json(res, 200, { connected: false, ready: false });
    const a = await stripe('accounts/' + prof.stripe_account_id, null, 'GET');
    const ready = !!(a.charges_enabled && a.payouts_enabled);
    if (ready !== prof.stripe_ready) {
      await sbAdmin(`profiles?id=eq.${user.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { stripe_ready: ready } });
    }
    return json(res, 200, { connected: true, ready, details_submitted: !!a.details_submitted });
  } catch (e) {
    return json(res, 500, { error: e.message || 'error' });
  }
};
