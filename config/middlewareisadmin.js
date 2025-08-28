

const isAdmin = async (req, res, next) => {
    if (!req.user || !req.user.email) {
        console.warn('Error: req.user o req.user.email no disponible. Asegúrate de que `requireAuth` se haya ejecutado primero.');
        req.flash('error_msg', 'Acceso denegado. No autenticado o información de usuario no disponible.');
        return res.status(403).redirect('/login'); 
    }

    const userEmail = req.user.email;
    
    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : [];

    if (adminEmails.includes(userEmail)) {
        req.user.role = 'admin';
        console.log(`Middleware: Acceso de administrador concedido para: ${userEmail}`);
        next();
    } else {
        console.warn(`Intento de acceso admin no autorizado para el email: ${userEmail}`);
        req.flash('error_msg', 'Acceso denegado. Se requieren permisos de administrador.');
        return res.status(403).redirect('/dashboard');
    }
};

module.exports = isAdmin;