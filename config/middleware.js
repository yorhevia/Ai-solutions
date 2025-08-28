
const { getDb } = require('./database'); // Importa desde el mismo directorio 'config'

// Middleware para verificar autenticación y obtener datos del usuario de la base de datos SQLite
async function requireAuth(req, res, next) {
    console.log('Middleware: requireAuth - Verificando sesión...');
    console.log('req.session en requireAuth:', req.session);

    if (req.session && req.session.userId) {
        try {
            const db = getDb(); // Usamos la función getDb() para obtener la instancia de la base de datos
            const userRecord = await db.get(`SELECT email, userType FROM users WHERE id = ?`, [req.session.userId]);

            if (userRecord) {
                req.user = {
                    id: req.session.userId,
                    email: userRecord.email,
                    userType: userRecord.userType || req.session.userType
                };
                
                req.session.userType = userRecord.userType || req.session.userType;

                console.log(`Middleware: Usuario autenticado: ${req.user.id}, Email: ${req.user.email}, Tipo: ${req.user.userType}`);
                next();
            } else {
                console.error("Middleware Error: Usuario no encontrado en la base de datos para ID:", req.session.userId);
                req.session.destroy((err) => {
                    if (err) console.error('Error al destruir sesión después de fallo de DB:', err);
                    if (req.flash) req.flash('error_msg', 'Tu sesión ha expirado o es inválida. Por favor, inicia sesión de nuevo.');
                    res.redirect('/login');
                });
            }
        } catch (error) {
            console.error("Middleware Error: Error al obtener usuario de SQLite:", error);
            req.session.destroy((err) => {
                if (err) console.error('Error al destruir sesión después de fallo de DB:', err);
                if (req.flash) req.flash('error_msg', 'Ocurrió un error en la autenticación. Por favor, inicia sesión de nuevo.');
                res.redirect('/login');
            });
        }
    } else {
        console.log('Middleware: No userId en sesión, redirigiendo a login.');
        if (req.flash) req.flash('error_msg', 'Por favor, inicia sesión para acceder a este recurso.');
        res.redirect('/login');
    }
}

const requireAsesor = (req, res, next) => {
    console.log('Middleware: requireAsesor - Verificando tipo de usuario...');
    
    if (req.user && req.user.userType === 'asesor') {
        console.log('Middleware: El usuario es un asesor. Acceso permitido.');
        return next();
    }

    console.log(`Middleware: Acceso denegado para tipo de usuario: ${req.user ? req.user.userType : 'No logueado'}`);
    if (req.flash) req.flash('error_msg', 'Acceso denegado. Esta función es solo para asesores.');
    res.status(403).redirect('/dashboard');
};

module.exports = { requireAuth, requireAsesor };