// Minimal handler: no Express, no node_modules required at cold start.
// If this works, the crash is in Express/deps or path. If this crashes, the issue is Vercel/root/config.
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).end(JSON.stringify({
    status: 'OK',
    message: 'Backend is live',
    backend: 'Vercel Serverless',
    path: req.url,
    timestamp: new Date().toISOString(),
  }));
};
