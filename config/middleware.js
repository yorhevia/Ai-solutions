function requireAuth(req, res, next) {
    console.log('req.session en requireAuth:', req.session);
    if (req.session && req.session.userId) {
        // El usuario tiene una sesión activa, permitir el acceso
        next();
    } else {
        // El usuario no está autenticado, redirigir al login
        res.redirect('/login');
    }
}

module.exports = requireAuth;