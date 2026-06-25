// Enrutador único para los endpoints de pago (Stripe Connect).
// Una sola función serverless para no superar el límite de funciones del plan.
// /api/pay/connect · /status · /checkout · /webhook · /order · /balance · /dashboard
const handlers = {
  connect: require('./_connect'),
  status: require('./_status'),
  checkout: require('./_checkout'),
  webhook: require('./_webhook'),
  order: require('./_order'),
  balance: require('./_balance'),
  dashboard: require('./_dashboard'),
};

module.exports = (req, res) => {
  const action = req.query && req.query.action;
  const h = handlers[action];
  if (!h) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'not_found' }));
  }
  return h(req, res);
};
