// Saldo del monedero del vendedor (disponible + en camino) desde Stripe.
// GET con Authorization: Bearer <supabase access token>.
const { json, stripe, sbAdmin, userFromToken } = require('../_lib/pay');

function sumBal(arr) { return (arr || []).reduce((s, b) => s + (b.amount || 0), 0); }

module.exports = async (req, res) => {
  const user = await userFromToken(req);
  if (!user) return json(res, 401, { error: 'auth' });
  try {
    const rows = await sbAdmin(`profiles?id=eq.${user.id}&select=stripe_account_id,stripe_ready`);
    const prof = rows && rows[0];
    if (!prof || !prof.stripe_account_id) return json(res, 200, { connected: false });
    const bal = await stripe('balance', null, 'GET', { account: prof.stripe_account_id });
    const cur = (bal.available && bal.available[0] && bal.available[0].currency) || 'eur';
    return json(res, 200, {
      connected: true,
      ready: !!prof.stripe_ready,
      currency: cur,
      available_cents: sumBal(bal.available),
      pending_cents: sumBal(bal.pending),
    });
  } catch (e) {
    return json(res, 500, { error: e.message || 'error' });
  }
};
