// config/middlewareisadmin.js
const isAdmin = async (req, res, next) => {
    if (!req.userEmail) {
        console.warn('Error: userEmail no disponible en req. Es posible que requireAuth no se haya ejecutado o haya fallado.');
        return res.status(403).send('Acceso denegado. No autenticado o email no disponible.');
    }

    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : [];

    if (adminEmails.includes(req.userEmail)) {
        req.userRole = 'admin';
        next();
    } else {
        console.warn(`Intento de acceso admin no autorizado para el email: ${req.userEmail}`);
        return res.status(403).send('Acceso denegado. Permisos de administrador requeridos.');
    }
};

module.exports = isAdmin;