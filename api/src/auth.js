const jwt = require('jsonwebtoken');
function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({erro:'Autenticação necessária.'});
  try { req.auth = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({erro:'Token inválido ou expirado.'}); }
}
function requireAdmin(req, res, next) {
  if (req.auth?.perfil !== 'admin') return res.status(403).json({erro:'Esta operação exige perfil administrador.'});
  next();
}
module.exports = { requireAuth, requireAdmin };
