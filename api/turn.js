// Genera credenciales TURN temporales de Cloudflare para las llamadas.
// Los secretos viven SOLO en variables de entorno de Vercel (no en el repo):
//   - CF_TURN_KEY_ID   → id de la TURN key de Cloudflare
//   - CF_TURN_TOKEN    → API token de esa TURN key
const TURN_KEY_ID = process.env.CF_TURN_KEY_ID;
const TURN_API_TOKEN = process.env.CF_TURN_TOKEN;

module.exports = async (req, res) => {
  if (!TURN_KEY_ID || !TURN_API_TOKEN) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'TURN no configurado: define CF_TURN_KEY_ID y CF_TURN_TOKEN en Vercel.' });
  }
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
