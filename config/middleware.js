// middleware/authMiddleware.js
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    // El usuario tiene una sesión activa, permitir el acceso
    next();
  } else {
    // El usuario no está autenticado, redirigir al login
    res.redirect('/login');
  }
}

module.exports = requireAuth;