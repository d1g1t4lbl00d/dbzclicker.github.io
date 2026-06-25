// Alta / onboarding del vendedor en Stripe Connect (Express).
// POST con Authorization: Bearer <supabase access token>.
const { json, stripe, sbAdmin, userFromToken, APP_URL } = require('../_lib/pay');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  const user = await userFromToken(req);
  if (!user) return json(res, 401, { error: 'auth' });
  try {
    const rows = await sbAdmin(`profiles?id=eq.${user.id}&select=id,stripe_account_id`);
    const prof = rows && rows[0];
    let acct = prof && prof.stripe_account_id;
    if (!acct) {
      const a = await stripe('accounts', {
        type: 'express',
        country: 'ES',
        email: user.email || undefined,
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        business_profile: { product_description: 'Venta de musica y servicios en UnderBro', url: APP_URL },
        metadata: { user_id: user.id },
      });
      acct = a.id;
      await sbAdmin(`profiles?id=eq.${user.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { stripe_account_id: acct } });
    }
    const link = await stripe('account_links', {
      account: acct,
      refresh_url: `${APP_URL}/?pay=connect_refresh`,
      return_url: `${APP_URL}/?pay=connect_done`,
      type: 'account_onboarding',
    });
    return json(res, 200, { url: link.url, account: acct });
  } catch (e) {
    return json(res, 500, { error: e.message || 'error' });
  }
};
