const admin = require('firebase-admin');
const db = admin.firestore();
const auth = admin.auth();

exports.mostrarPerfilAsesor = async (req, res) => {
    try {
        const asesorUid = req.session.userId;

        if (!asesorUid) {
            return res.redirect('/login');
        }

        const asesorDoc = await db.collection('asesores').doc(asesorUid).get();

        if (!asesorDoc.exists) {
            console.warn(`Perfil de asesor no encontrado en Firestore para UID: ${asesorUid}`); 
            return res.status(404).render('asesor/perfilasesor', {
                asesor: {
                    nombre: 'Usuario',
                    apellido: 'Desconocido',
                    email: '', // Considera obtenerlo de Firebase Auth si es necesario
                    telefono: '',
                    direccion: '',
                    profesion: '',
                    licencia: '',
                    especialidad: '',
                    experiencia: '',
                    descripcion: '',
                    fechaRegistro: null,
                    fotoPerfilUrl: 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=%EF%A3%BF'
                },
                error_msg: 'Tu perfil no está completo. Por favor, edita tu información.',
                user: req.user
            });
        }

        const asesorData = asesorDoc.data();

        // Manejo de la fecha de registro para compatibilidad con EJS y Moment.js
        if (asesorData.fechaRegistro) {
            if (typeof asesorData.fechaRegistro.toDate === 'function') {
                const dateObject = asesorData.fechaRegistro.toDate();
                asesorData.fechaRegistro = dateObject.toISOString();
                console.log('Backend Asesor - Fecha convertida de Timestamp a ISO:', asesorData.fechaRegistro);
            } else if (asesorData.fechaRegistro instanceof Date) {
                asesorData.fechaRegistro = asesorData.fechaRegistro.toISOString();
                console.log('Backend Asesor - Fecha ya era Date, convertida a ISO:', asesorData.fechaRegistro);
            } else {
                console.warn('Backend Asesor - fechaRegistro no es Timestamp ni Date:', asesorData.fechaRegistro);
                asesorData.fechaRegistro = null;
            }
        } else {
            asesorData.fechaRegistro = null;
            console.warn('Backend Asesor - Campo fechaRegistro no encontrado para este asesor.');
        }

        res.render('asesor/perfilasesor', { asesor: asesorData, user: req.user });
    } catch (error) {
        console.error('Error al obtener el perfil del asesor desde Firestore:', error);
        res.status(500).send('Error al cargar el perfil del asesor');
    }
};

// --- Función para renderizar el formulario de cambio de contraseña (GET) ---
exports.getChangePasswordPage = (req, res) => {
    res.render('asesor/cambiar_password', {
        user: req.user 
    });
};

// --- Función para manejar la lógica de cambio de contraseña (POST) ---
exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const errors = [];

    // Validaciones de la nueva contraseña en el servidor
    if (!currentPassword || !newPassword || !confirmNewPassword) {
        errors.push('Por favor, rellena todos los campos.');
    }
    if (newPassword !== confirmNewPassword) {
        errors.push('Las nuevas contraseñas no coinciden.');
    }
    if (newPassword.length < 6) {
        errors.push('La nueva contraseña debe tener al menos 6 caracteres.');
    }
    if (newPassword === currentPassword) {
        errors.push('La nueva contraseña no puede ser igual a la actual.');
    }


    if (errors.length > 0) {
        req.flash('error', errors); // Aquí 'error' es un array de strings
        return res.redirect('/cambiar-password');
    }

    try {
        const asesorUid = req.session.userId; // Obtenemos el UID de Firebase Auth desde la sesión

        if (!asesorUid) {
            req.flash('error_msg', 'Usuario no autenticado para cambiar la contraseña.');
            return res.redirect('/login');
        }



        let userRecord;
        try {
            userRecord = await auth.getUser(asesorUid);
        } catch (getUserError) {
            console.error('Error al obtener el usuario de Firebase Auth:', getUserError);
            req.flash('error_msg', 'No se pudo verificar el usuario para cambiar la contraseña.');
            return res.redirect('/cambiar-password');
        }

        const userEmail = userRecord.email;
        const apiKey = process.env.FIREBASE_API_KEY;

        if (!apiKey) {
            console.error('ERROR: FIREBASE_API_KEY no está configurado en las variables de entorno.');
            req.flash('error_msg', 'Error de configuración del servidor. Contacta al administrador.');
            return res.redirect('/cambiar-password');
        }

        // Simular la reautenticación usando la REST API con la contraseña actual
        const verifyPasswordUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
        const verifyResponse = await fetch(verifyPasswordUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: userEmail,
                password: currentPassword,
                returnSecureToken: true
            })
        });

        if (!verifyResponse.ok) {
            // Si la contraseña actual es incorrecta o hay otro problema de autenticación
            const verifyError = await verifyResponse.json();
            console.error('Error al verificar la contraseña actual en Firebase:', verifyError);
            let userFacingError = 'La contraseña actual es incorrecta.';
            if (verifyError.error && verifyError.error.message === 'USER_DISABLED') {
                userFacingError = 'Tu cuenta ha sido deshabilitada.';
            }
            req.flash('error_msg', userFacingError);
            return res.redirect('/cambiar-password');
        }

        // Si la contraseña actual es correcta, procede a actualizar la contraseña
        await auth.updateUser(asesorUid, {
            password: newPassword
        });

        req.flash('success_msg', '¡Contraseña actualizada con éxito!');
        res.redirect('/perfilasesor'); // Redirige al perfil

    } catch (err) {
        console.error('Error al cambiar la contraseña en Firebase Auth:', err);
        let errorMessage = 'Error del servidor al cambiar la contraseña.';

        if (err.code) {
            switch (err.code) {
                case 'auth/invalid-password':
                    errorMessage = 'La nueva contraseña no es válida (debe tener al menos 6 caracteres).';
                    break;
                case 'auth/user-not-found':
                    errorMessage = 'Usuario no encontrado.';
                    break;
                case 'auth/argument-error':
                    errorMessage = 'Error en los datos proporcionados para el usuario.';
                    break;
                default:
                    errorMessage = `Error de Firebase: ${err.message}`;
            }
        }
        req.flash('error_msg', errorMessage);
        res.redirect('/cambiar-password');
    }
};
