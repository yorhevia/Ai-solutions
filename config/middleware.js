// Importa Firebase Auth desde tu archivo de configuración de Firebase
const { auth } = require('../routes/firebase'); 

function requireAuth(req, res, next) {
    console.log('req.session en requireAuth:', req.session);

    if (req.session && req.session.userId) {
        // Si hay un userId en la sesión, intenta obtener el email del usuario de Firebase Auth
        auth.getUser(req.session.userId)
            .then(userRecord => {
                req.userEmail = userRecord.email; 
                console.log(`Usuario autenticado: ${req.session.userId}, Email: ${req.userEmail}`);
                next(); // Permite el acceso
            })
            .catch(error => {
                console.error("Error al obtener usuario de Firebase Auth:", error);
                // Si hay un error (ej. usuario no existe en Auth), destruir sesión y redirigir
                req.session.destroy((err) => {
                    if (err) console.error('Error al destruir sesión después de fallo de Auth:', err);
                    res.redirect('/login');
                });
            });
    } else {
        // El usuario no está autenticado, redirigir al login
        console.log('No userId en sesión, redirigiendo a login.');
        res.redirect('/login');
    }
}

module.exports = requireAuth;