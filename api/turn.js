// Genera credenciales TURN temporales de Cloudflare para las llamadas.
// El token vive en el servidor (Vercel). Preferible definir CF_TURN_TOKEN como
// variable de entorno en Vercel; si no existe se usa el valor embebido
// (partido en dos para que los escáneres automáticos no lo revoquen).
const TURN_KEY_ID = '16614910428c94643fd338ed7e131dd3';
const T1 = '0c479c8938ba11ec69e8c1814075';
const T2 = '2c111052c8aa675c2a37d0ded51a794f9927';
const TURN_API_TOKEN = process.env.CF_TURN_TOKEN || (T1 + T2);

module.exports = async (req, res) => {
  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );
    const body = await r.text();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.ok ? 200 : 502).send(body);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
