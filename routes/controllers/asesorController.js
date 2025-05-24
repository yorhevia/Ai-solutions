const admin = require('firebase-admin');
const db = admin.firestore();
const auth = admin.auth();
const fetch = require('node-fetch'); // Asegúrate de tener 'node-fetch' instalado: npm install node-fetch

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
                    email: '',
                    telefono: '',
                    direccion: '',
                    profesion: '',
                    licencia: '',
                    especialidad: '',
                    experiencia: '',
                    descripcion: '',
                    fechaRegistro: null,
                    fotoPerfilUrl: 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=%EF%A3%BF',
                    // Inicializar verification y verificacion para evitar errores en la vista
                    verification: {}, // Para KYC
                    verificacion: {}  // Para Títulos/Credenciales
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

        // Asegurarse de que la propiedad 'verificacion' (para títulos/credenciales) existe
        if (!asesorData.verificacion) {
            asesorData.verificacion = {};
        }

        // Asegurarse de que la propiedad 'verification' (para KYC) existe
        if (!asesorData.verification) {
            asesorData.verification = {};
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
        user: req.user,
        success_msg: req.flash('success_msg'),
        error_msg: req.flash('error_msg'),
        error: req.flash('error')
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
            if (verifyError.error && verifyError.error.message === 'EMAIL_NOT_FOUND') {
                userFacingError = 'El usuario no existe.';
            } else if (verifyError.error && verifyError.error.message === 'INVALID_LOGIN_CREDENTIALS') {
                userFacingError = 'Contraseña o credenciales inválidas.';
            } else if (verifyError.error && verifyError.error.message === 'USER_DISABLED') {
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
                case 'auth/network-request-failed':
                    errorMessage = 'Error de red. Por favor, revisa tu conexión a internet.';
                    break;
                default:
                    errorMessage = `Error de Firebase: ${err.message}`;
            }
        }
        req.flash('error_msg', errorMessage);
        res.redirect('/cambiar-password');
    }
};

// --- Función para renderizar el formulario de verificación de identidad (GET) ---
exports.getVerificationPageAsesor = async (req, res) => {
    try {
        const asesorUid = req.session.userId;
        if (!asesorUid) {
            return res.redirect('/login');
        }

        const asesorDoc = await db.collection('asesores').doc(asesorUid).get();
        if (!asesorDoc.exists) {
            console.warn(`Asesor no encontrado en Firestore para la verificación de identidad: ${asesorUid}`);
            req.flash('error_msg', 'Tu perfil de asesor no se encontró.');
            return res.redirect('/perfilasesor');
        }

        const asesorData = asesorDoc.data();
        // Pasa el objeto completo del asesor para que la vista 'verificar_identidad'
        // pueda acceder tanto a 'asesor.verification' (KYC) como a 'asesor.verificacion' (credenciales).
        res.render('asesor/verificar_identidad', {
            user: req.user,
            verificationStatus: asesorData, // Cambiado para pasar todo 'asesorData'
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            error: req.flash('error')
        });
    } catch (error) {
        console.error('Error al cargar la página de verificación de identidad del asesor:', error);
        req.flash('error_msg', 'Error al cargar la página de verificación.');
        res.redirect('/perfilasesor');
    }
};


exports.postVerifyIdentityAsesor = async (req, res) => {
    // Ahora esperamos URLs en el req.body, no archivos de Multer
    const { 
        documentType, 
        documentNumber, 
        notes, 
        frontPhotoUrl, 
        backPhotoUrl, 
        selfiePhotoUrl, 
        tituloUniversitarioUrl, 
        certificacionProfesionalUrl 
    } = req.body;

    const errors = [];

    // --- VALIDACIONES DE LAS URLs ---
    // Función de ayuda para validar formato de URL
    const isValidUrl = (url) => {
        try {
            new URL(url);
            return true;
        } catch (e) {
            return false;
        }
    };

    if (!documentType || !documentNumber) {
        errors.push('Por favor, selecciona un tipo de documento y el número de documento.');
    }
    
    // La URL de la foto frontal del documento es obligatoria para KYC
    if (!frontPhotoUrl || !isValidUrl(frontPhotoUrl)) {
        errors.push('La URL de la foto frontal del documento de identidad es obligatoria o no es válida.');
    }
    
    // La URL del título universitario es obligatoria para credenciales
    if (!tituloUniversitarioUrl || !isValidUrl(tituloUniversitarioUrl)) {
        errors.push('La URL del título universitario es obligatoria para la verificación de credenciales o no es válida.');
    }

    // Validar otras URLs si existen
    if (backPhotoUrl && !isValidUrl(backPhotoUrl)) {
        errors.push('La URL de la foto trasera del documento no es válida.');
    }
    if (selfiePhotoUrl && !isValidUrl(selfiePhotoUrl)) {
        errors.push('La URL de la selfie con documento no es válida.');
    }
    if (certificacionProfesionalUrl && !isValidUrl(certificacionProfesionalUrl)) {
        errors.push('La URL de la certificación profesional no es válida.');
    }

    if (errors.length > 0) {
        req.flash('error', errors);
        return res.redirect('/asesor/verificar_identidad');
    }

    try {
        const asesorUid = req.session.userId;
        if (!asesorUid) {
            req.flash('error_msg', 'Asesor no autenticado.');
            return res.redirect('/login');
        }

        // Preparar las URLs para almacenar
        const uploadedPhotoUrls = {};
        if (frontPhotoUrl) uploadedPhotoUrls.front = frontPhotoUrl;
        if (backPhotoUrl) uploadedPhotoUrls.back = backPhotoUrl;
        if (selfiePhotoUrl) uploadedPhotoUrls.selfie = selfiePhotoUrl;
        
        const uploadedCredentialUrls = {};
        if (tituloUniversitarioUrl) uploadedCredentialUrls.titulo = tituloUniversitarioUrl;
        if (certificacionProfesionalUrl) uploadedCredentialUrls.certificacion = certificacionProfesionalUrl;

        // Obtener datos actuales del asesor para no sobrescribir verificaciones si ya existen
        const asesorDoc = await db.collection('asesores').doc(asesorUid).get();
        const currentAsesorData = asesorDoc.data() || {};

        // Combinar datos existentes con los nuevos para 'verification' (KYC)
        const updatedVerification = {
            ...currentAsesorData.verification, // Mantener campos existentes si no se sobrescriben
            status: 'pendiente',
            documentType: documentType,
            documentNumber: documentNumber,
            photos: { ...currentAsesorData.verification?.photos, ...uploadedPhotoUrls }, // Combinar fotos existentes con nuevas
            notes: notes,
            submittedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Combinar datos existentes con los nuevos para 'verificacion' (Credenciales Profesionales)
        const updatedCredenciales = {
            ...currentAsesorData.verificacion, // Mantener campos existentes de verificacion (ej: otros títulos)
        };

        if (uploadedCredentialUrls.titulo) {
            updatedCredenciales.titulo = {
                ...currentAsesorData.verificacion?.titulo, // Mantener datos existentes del título si hay
                estado: 'pendiente',
                urlDocumento: uploadedCredentialUrls.titulo,
                fechaEnvio: admin.firestore.FieldValue.serverTimestamp()
            };
        }
        if (uploadedCredentialUrls.certificacion) {
            updatedCredenciales.certificacion = {
                ...currentAsesorData.verificacion?.certificacion, // Mantener datos existentes de la certificación
                estado: 'pendiente',
                urlDocumento: uploadedCredentialUrls.certificacion,
                fechaEnvio: admin.firestore.FieldValue.serverTimestamp()
            };
        }
        
        // Actualizar el documento del asesor en Firestore con ambos tipos de verificación
        await db.collection('asesores').doc(asesorUid).update({
            verification: updatedVerification, // Información de KYC
            verificacion: updatedCredenciales // Información de Títulos/Certificaciones
        });

        req.flash('success_msg', '¡Documentos enviados para verificación con éxito! Tu solicitud será revisada.');
        res.redirect('/perfilasesor');
    } catch (err) {
        console.error('Error al procesar la verificación de identidad y credenciales del asesor:', err);
        req.flash('error_msg', `Error al enviar documentos: ${err.message || 'Error desconocido.'}`);
        res.redirect('/asesor/verificar_identidad');
    }
};