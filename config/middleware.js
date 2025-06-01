const { auth } = require('../routes/firebase'); // Importa 'auth' del archivo firebase.js

// Middleware para verificar autenticación y obtener datos del usuario de Firebase Auth
function requireAuth(req, res, next) {
    console.log('Middleware: requireAuth - Verificando sesión...');
    console.log('req.session en requireAuth:', req.session);

    if (req.session && req.session.userId) {
        // Si hay un userId en la sesión, intenta obtener el email del usuario de Firebase Auth
        auth.getUser(req.session.userId)
            .then(userRecord => {
                req.userEmail = userRecord.email; 
                // Asegúrate de que req.session.userType se establezca en tu lógica de login
                // Este ejemplo asume que ya lo tienes en la sesión.
                // Si usas Custom Claims de Firebase Auth, lo obtendrías de userRecord.customClaims
                
                console.log(`Middleware: Usuario autenticado: ${req.session.userId}, Email: ${req.userEmail}, Tipo: ${req.session.userType || 'No especificado'}`);
                next(); // Permite el acceso
            })
            .catch(error => {
                console.error("Middleware Error: Error al obtener usuario de Firebase Auth:", error);
                // Si hay un error (ej. usuario no existe en Auth, sesión inválida), destruir sesión y redirigir
                req.session.destroy((err) => {
                    if (err) console.error('Error al destruir sesión después de fallo de Auth:', err);
                    // Usa flash si está configurado en tu app.js
                    if (req.flash) req.flash('error_msg', 'Tu sesión ha expirado o es inválida. Por favor, inicia sesión de nuevo.');
                    res.redirect('/login'); // Redirige a tu página de login
                });
            });
    } else {
        // El usuario no está autenticado, redirigir al login
        console.log('Middleware: No userId en sesión, redirigiendo a login.');
        if (req.flash) req.flash('error_msg', 'Por favor, inicia sesión para acceder a este recurso.');
        res.redirect('/login'); // Redirige a tu página de login
    }
}

// Middleware específico para requerir que el usuario sea un 'asesor'
const requireAsesor = (req, res, next) => {
    console.log('Middleware: requireAsesor - Verificando tipo de usuario...');
    // requireAuth debería ejecutarse antes que este, por lo que req.session.userType debería estar disponible.
    if (req.session && req.session.userType === 'asesor') {
        console.log('Middleware: El usuario es un asesor. Acceso permitido.');
        return next(); // El usuario es un asesor, procede
    }
    console.log(`Middleware: Acceso denegado para tipo de usuario: ${req.session ? req.session.userType : 'No logueado'}`);
    if (req.flash) req.flash('error_msg', 'Acceso denegado. Esta función es solo para asesores.');
    res.status(403).redirect('/dashboard'); // Redirige a un dashboard general o a home si no es asesor
};

module.exports = { requireAuth, requireAsesor };