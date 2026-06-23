// Verificación de Google Search Console (método de archivo HTML).
// Se sirve en la ruta exacta /google08061c74156461e8.html con 200 y sin
// redirección (cleanUrls redirige los .html, lo que puede romper la
// verificación; por eso se sirve por función, vía rewrite en vercel.json).
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send('google-site-verification: google08061c74156461e8.html');
};
