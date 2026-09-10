const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'token não fornecido' });
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuarioId = payload.id;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'token inválido' });
  }
}

module.exports = auth;
