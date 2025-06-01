const { db, auth, admin } = require('../firebase');

// Importa node-fetch para hacer solicitudes HTTP (necesario para la API de Firebase Auth REST y Imgur)
const fetch = require('node-fetch');

// Importa moment para formatear fechas (asegúrate de tenerlo instalado: npm install moment)
const moment = require('moment');

// Importa uuid para generar IDs únicos para las notificaciones
const { v4: uuidv4 } = require('uuid');

// Importa Stripe (aunque no se usa en las funciones presentadas, lo mantengo ya que estaba)
const { default: Stripe } = require('stripe');

// Función auxiliar para añadir notificaciones.
// --- Función auxiliar para añadir notificaciones (ahora exportada) ---
async function addNotificationToUser(userId, message, link = '#') {
    try {
        const asesorRef = db.collection('asesores').doc(userId);
        const notification = {
            id: uuidv4(), // Usar uuid para generar un ID único para la notificación
            timestamp: admin.firestore.FieldValue.serverTimestamp(), // Usa el timestamp del servidor de Firestore
            message: message,
            read: false,
            link: link
        };
        await asesorRef.update({
            notifications: admin.firestore.FieldValue.arrayUnion(notification)
        });
        console.log(`[Notificación] Añadida a ${userId}: ${message}`);
    } catch (error) {
        console.error('[Notificación Error] Error al añadir notificación:', error);
    }
}

// Exporta la función de notificación. Esto te permite usarla desde otros módulos:
exports.addNotificationToUser = addNotificationToUser;

// --- 1. Función para la API del Resumen de Notificaciones (para la campana) ---
exports.getNotificationSummary = async (req, res) => {
    const userId = req.session.userId; // Obtiene el ID del usuario de la sesión

    console.log(`[API] Solicitud de resumen de notificaciones para asesor: ${userId}`);

    try {
        const asesorDoc = await db.collection('asesores').doc(userId).get();
        if (!asesorDoc.exists) {
            console.warn(`[API] Perfil de asesor no encontrado para ID: ${userId}.`);
            // Si el perfil del asesor no existe, devuelve un resumen vacío pero con éxito.
            return res.json({ success: true, unreadCount: 0, latestNotifications: [], message: 'Perfil de asesor no encontrado.' });
        }

        const asesorData = asesorDoc.data();
        const allNotifications = asesorData.notifications || [];

        let unreadCount = 0;
        allNotifications.forEach(notif => {
            if (!notif.read) {
                unreadCount++;
            }
        });

        // Ordena notificaciones de la más nueva a la más antigua
        const sortedNotifications = allNotifications.sort((a, b) => {
            // Maneja objetos Timestamp de Firebase: convierte a milisegundos para una clasificación fiable
            const timeA = (a.timestamp && typeof a.timestamp === 'object' && a.timestamp._seconds !== undefined)
                ? new Date(a.timestamp._seconds * 1000 + (a.timestamp._nanoseconds || 0) / 1000000).getTime()
                : new Date(a.timestamp).getTime(); // Fallback si no es un Timestamp de Firestore
            
            const timeB = (b.timestamp && typeof b.timestamp === 'object' && b.timestamp._seconds !== undefined)
                ? new Date(b.timestamp._seconds * 1000 + (b.timestamp._nanoseconds || 0) / 1000000).getTime()
                : new Date(b.timestamp).getTime(); // Fallback si no es un Timestamp de Firestore
            
            return timeB - timeA; // Orden descendente (más nueva primero)
        });

        // Toma las últimas 5 notificaciones para el resumen en el desplegable
        const latestNotifications = sortedNotifications.slice(0, 5);

        console.log(`[API] Encontradas ${unreadCount} notificaciones no leídas. Enviando ${latestNotifications.length} más recientes.`);
        res.json({
            success: true,
            unreadCount: unreadCount,
            latestNotifications: latestNotifications
        });

    } catch (error) {
        console.error('[API Error] Falló al obtener el resumen de notificaciones del asesor:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener notificaciones.' });
    }
};

// --- 2. Función para la Página Completa de Notificaciones ---
exports.getFullNotificationsPage = async (req, res) => {
    const userId = req.session.userId;
    console.log(`[Página] Cargando página completa de notificaciones para asesor: ${userId}`);
    try {
        const asesorDoc = await db.collection('asesores').doc(userId).get();
        if (!asesorDoc.exists) {
            req.flash('error_msg', 'Perfil de asesor no encontrado.');
            return res.status(404).redirect('/homeasesor');
        }
        const asesorData = asesorDoc.data();
        // Obtiene todas las notificaciones y las ordena de la más nueva a la más antigua.
        // Asegúrate de que las notificaciones tengan un 'timestamp' para ordenar.
        const notifications = (asesorData.notifications || []).sort((a, b) => {
            const timeA = (a.timestamp && typeof a.timestamp === 'object' && a.timestamp._seconds !== undefined) ? new Date(a.timestamp._seconds * 1000 + (a.timestamp._nanoseconds || 0) / 1000000).getTime() : new Date(a.timestamp).getTime();
            const timeB = (b.timestamp && typeof b.timestamp === 'object' && b.timestamp._seconds !== undefined) ? new Date(b.timestamp._seconds * 1000 + (b.timestamp._nanoseconds || 0) / 1000000).getTime() : new Date(b.timestamp).getTime();
            return timeB - timeA; // Más nueva primero para la lista completa
        });

        res.render('asesor/notificaciones', {
            notifications: notifications,
            user: req.user, // Pasa el objeto user para consistencia en el layout
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });
    } catch (error) {
        console.error('[Página Error] Falló al cargar la página de notificaciones del asesor:', error);
        req.flash('error_msg', 'Error al cargar tus notificaciones.');
        res.redirect('/homeasesor');
    }
};

// --- 3. Función para Marcar Notificación como Leída ---
exports.markNotificationAsRead = async (req, res) => {
    const userId = req.session.userId;
    const { notificationId } = req.body;

    console.log(`[API] Marcando notificación ${notificationId} como leída para asesor: ${userId}`);

    if (!notificationId) {
        return res.status(400).json({ success: false, message: 'ID de notificación no proporcionado.' });
    }

    try {
        const asesorRef = db.collection('asesores').doc(userId);
        const asesorDoc = await asesorRef.get();
        if (!asesorDoc.exists) {
            return res.status(404).json({ success: false, message: 'Asesor no encontrado.' });
        }

        const notifications = asesorDoc.data().notifications || [];
        let notificationFoundAndUpdated = false;
        const updatedNotifications = notifications.map(notif => {
            if (notif.id === notificationId) {
                notificationFoundAndUpdated = true;
                return { ...notif, read: true }; // Marca como leída
            }
            return notif;
        });

        if (!notificationFoundAndUpdated) {
            console.warn(`[API] Notificación ${notificationId} no encontrada para el asesor ${userId}.`);
            return res.status(404).json({ success: false, message: 'Notificación no encontrada o ya marcada como leída.' });
        }

        // Actualiza el documento del asesor en Firestore con el array de notificaciones modificado
        await asesorRef.update({ notifications: updatedNotifications });
        console.log(`[API] Notificación ${notificationId} marcada como leída exitosamente.`);
        res.json({ success: true, message: 'Notificación marcada como leída.' });

    } catch (error) {
        console.error('[API Error] Falló al marcar notificación como leída:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
};




// Muestra el perfil del asesor
exports.mostrarPerfilAsesor = async (req, res) => {
    try {
        const asesorUid = req.session.userId;

        if (!asesorUid) {
            req.flash('error_msg', 'No has iniciado sesión.');
            return res.redirect('/login');
        }

        const asesorDoc = await db.collection('asesores').doc(asesorUid).get();

        if (!asesorDoc.exists) {
            console.warn(`Perfil de asesor no encontrado en Firestore para UID: ${asesorUid}. Se renderiza un perfil por defecto.`);
            req.flash('error_msg', 'Tu perfil no está completo o no se encontró. Por favor, edita tu información.');
            return res.redirect('/');
        }

        const asesorData = asesorDoc.data();

        if (asesorData.fechaRegistro) {
            if (typeof asesorData.fechaRegistro.toDate === 'function') {
                asesorData.fechaRegistro = moment(asesorData.fechaRegistro.toDate()).format('DD/MM/YYYY');
            } else if (asesorData.fechaRegistro instanceof Date) {
                asesorData.fechaRegistro = moment(asesorData.fechaRegistro).format('DD/MM/YYYY');
            } else if (typeof asesorData.fechaRegistro === 'string') {
                try {
                    asesorData.fechaRegistro = moment(asesorData.fechaRegistro).format('DD/MM/YYYY');
                } catch (e) {
                    console.warn('Backend Asesor - fechaRegistro string no es un formato de fecha reconocido.');
                }
            } else {
                asesorData.fechaRegistro = null;
                console.warn('Backend Asesor - Campo fechaRegistro no es Timestamp, Date, ni string. Estableciendo a null.');
            }
        } else {
            asesorData.fechaRegistro = null;
            console.warn('Backend Asesor - Campo fechaRegistro no encontrado para este asesor.');
        }

        asesorData.verification = asesorData.verification || { status: 'no-enviado', photos: {} };
        asesorData.verificacion = asesorData.verificacion || {
            titulo: { estado: 'no-enviado' },
            certificacion: { estado: 'no-enviado' }
        };

        res.render('asesor/perfilasesor', {
            asesor: asesorData,
            user: req.user,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            info_msg: req.flash('info_msg'),
            error: req.flash('error')
        });
    } catch (error) {
        console.error('Error al obtener el perfil del asesor desde Firestore:', error);
        req.flash('error_msg', 'Error al cargar tu perfil.');
        return res.status(500).redirect('/');
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
        req.flash('error', errors);
        return res.redirect('/cambiar-password');
    }

    try {
        const asesorUid = req.session.userId;

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
            const verifyError = await verifyResponse.json();
            console.error('Error al verificar la contraseña actual en Firebase (REST API):', verifyError);
            let userFacingError = 'La contraseña actual es incorrecta.';
            if (verifyError.error && verifyError.error.message) {
                switch (verifyError.error.message) {
                    case 'EMAIL_NOT_FOUND':
                        userFacingError = 'El usuario no existe.';
                        break;
                    case 'INVALID_LOGIN_CREDENTIALS':
                    case 'INVALID_PASSWORD':
                        userFacingError = 'Contraseña actual incorrecta.';
                        break;
                    case 'USER_DISABLED':
                        userFacingError = 'Tu cuenta ha sido deshabilitada.';
                        break;
                    default:
                        userFacingError = 'Error al verificar la contraseña actual. Por favor, inténtalo de nuevo.';
                }
            }
            req.flash('error_msg', userFacingError);
            return res.redirect('/cambiar-password');
        }

        await auth.updateUser(asesorUid, {
            password: newPassword
        });

        req.flash('success_msg', '¡Contraseña actualizada con éxito!');
        return res.redirect('/perfilasesor');
    } catch (err) {
        console.error('Error general en el proceso de cambio de contraseña del asesor:', err);
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
        return res.redirect('/cambiar-password');
    }
};

// --- Función para renderizar el formulario de verificación de identidad (GET) ---
exports.getVerificationPageAsesor = async (req, res) => {
    try {
        const asesorUid = req.session.userId;
        if (!asesorUid) {
            req.flash('error_msg', 'No has iniciado sesión.');
            return res.redirect('/login');
        }

        const asesorDoc = await db.collection('asesores').doc(asesorUid).get();
        if (!asesorDoc.exists) {
            console.warn(`Asesor no encontrado en Firestore para la verificación de identidad: ${asesorUid}.`);
            req.flash('error_msg', 'Tu perfil de asesor no se encontró.');
            return res.redirect('/perfilasesor');
        }

        const asesorData = asesorDoc.data();

        asesorData.verification = asesorData.verification || { status: 'no-enviado', photos: {} };
        asesorData.verificacion = asesorData.verificacion || {
            titulo: { estado: 'no-enviado' },
            certificacion: { estado: 'no-enviado' }
        };

        res.render('asesor/verificar_identidad', {
            user: req.user,
            asesor: asesorData,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            info_msg: req.flash('info_msg'),
            error: req.flash('error')
        });
    } catch (error) {
        console.error('Error al cargar la página de verificación de identidad del asesor:', error);
        req.flash('error_msg', 'Error al cargar la página de verificación. Inténtalo de nuevo.');
        return res.redirect('/perfilasesor');
    }
};

// Función de ayuda para validar formato de URL
const isValidUrl = (url) => {
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
};

// --- Función para manejar el envío de documentos de verificación (POST) ---
exports.postVerifyIdentityAsesor = async (req, res) => {
    console.log('POST /asesor/verificar_identidad received.');
    console.log('Request Body:', req.body);

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
    const asesorUid = req.session.userId;

    if (!asesorUid) {
        req.flash('error_msg', 'Asesor no autenticado. Por favor, inicia sesión.');
        return res.redirect('/login');
    }

    const asesorRef = db.collection('asesores').doc(asesorUid);
    const asesorDoc = await asesorRef.get();
    const currentAsesorData = asesorDoc.data() || {};
    console.log('Current Asesor Data from Firestore (before processing):', currentAsesorData);

    const currentKyc = currentAsesorData.verification || { status: 'no-enviado', photos: {} };
    const currentTitulo = currentAsesorData.verificacion?.titulo || { estado: 'no-enviado' };
    const currentCertificacion = currentAsesorData.verificacion?.certificacion || { estado: 'no-enviado' };

    // --- VALIDACIONES SOLO SI LA SECCIÓN NO ESTÁ YA VERIFICADA ---

    // Validar KYC solo si no está verificado
    if (currentKyc.status !== 'verificado') {
        if (!documentType) {
            errors.push('Por favor, selecciona un tipo de documento.');
        }
        if (!documentNumber) {
            errors.push('Por favor, proporciona el número de documento para KYC.');
        }
        if (!frontPhotoUrl || !isValidUrl(frontPhotoUrl)) {
            errors.push('La URL de la foto frontal del documento de identidad es obligatoria y debe ser una URL válida.');
        }
        if (backPhotoUrl && !isValidUrl(backPhotoUrl)) {
            errors.push('La URL de la foto trasera del documento no es válida. Por favor, revisa el formato.');
        }
        if (!selfiePhotoUrl || !isValidUrl(selfiePhotoUrl)) {
            errors.push('La URL de la selfie con documento es obligatoria y debe ser una URL válida.');
        }
    }

    // Validar Título solo si no está verificado
    if (currentTitulo.estado !== 'verificado') {
        if (!tituloUniversitarioUrl || !isValidUrl(tituloUniversitarioUrl)) {
            errors.push('La URL del título universitario es obligatoria para la verificación de credenciales y debe ser una URL válida.');
        }
    }

    // Validar Certificación solo si no está verificado
    if (currentCertificacion.estado !== 'verificado') {
        if (certificacionProfesionalUrl && !isValidUrl(certificacionProfesionalUrl)) {
            errors.push('La URL de la certificación profesional no es válida. Por favor, revisa el formato.');
        }
    }


    if (errors.length > 0) {
        console.log('Validation Errors:', errors);
        req.flash('error_msg', errors);
        // Recuperar los datos del asesor para volver a renderizar el formulario con los datos actuales y los errores
        let asesorData = currentAsesorData; // Usamos los datos actuales de la BD como base

        // Pre-rellenar los campos del formulario con los valores enviados por el usuario
        // Solo si la sección no está verificada, de lo contrario, se mantiene el valor de la BD
        if (currentKyc.status !== 'verificado') {
            asesorData.verification = asesorData.verification || { status: 'no-enviado', photos: {} };
            asesorData.verification.documentType = documentType;
            asesorData.verification.documentNumber = documentNumber;
            asesorData.verification.photos.front = frontPhotoUrl;
            asesorData.verification.photos.back = backPhotoUrl;
            asesorData.verification.photos.selfie = selfiePhotoUrl;
            asesorData.verification.notes = notes; // Las notas pueden ser siempre editables si así se desea
        } else {
            // Si el KYC está verificado, asegurarnos de que la nota muestre el valor original de la BD
            // pero que si el usuario la modificó en el frontend (por no tener readonly) se muestre la actual.
            // Esto es para la re-renderización del formulario.
            asesorData.verification.notes = notes || asesorData.verification.notes;
        }

        if (currentTitulo.estado !== 'verificado') {
            asesorData.verificacion = asesorData.verificacion || {};
            asesorData.verificacion.titulo = asesorData.verificacion.titulo || {};
            asesorData.verificacion.titulo.urlDocumento = tituloUniversitarioUrl;
        }
        if (currentCertificacion.estado !== 'verificado') {
            asesorData.verificacion = asesorData.verificacion || {};
            asesorData.verificacion.certificacion = asesorData.verificacion.certificacion || {};
            asesorData.verificacion.certificacion.urlDocumento = certificacionProfesionalUrl;
        }


        return res.render('asesor/verificar_identidad', {
            user: req.user,
            asesor: asesorData, // Aseguramos que asesorData tiene los datos correctos para la re-renderización
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            info_msg: req.flash('info_msg'),
            error: req.flash('error')
        });
    }

    try {
        const updateObject = {};
        let notificationSent = false; // Bandera para controlar si ya se envió una notificación

        // Lógica de actualización para KYC
        if (currentKyc.status !== 'verificado') {
            const newKycData = { ...currentKyc }; // Clonar para no modificar directamente el objeto de Firestore

            // Comprobar si hubo cambios relevantes para marcar como pendiente y actualizar
            if (documentType !== (newKycData.documentType || '') ||
                documentNumber !== (newKycData.documentNumber || '') ||
                frontPhotoUrl !== (newKycData.photos?.front || '') ||
                (backPhotoUrl || '') !== (newKycData.photos?.back || '') ||
                selfiePhotoUrl !== (newKycData.photos?.selfie || '') ||
                notes !== (newKycData.notes || '')) { // Comparar con los datos actuales

                newKycData.status = 'pendiente';
                newKycData.documentType = documentType;
                newKycData.documentNumber = documentNumber;
                newKycData.photos = {
                    front: frontPhotoUrl,
                    back: backPhotoUrl || null,
                    selfie: selfiePhotoUrl || null
                };
                newKycData.notes = notes || null;
                newKycData.submittedAt = admin.firestore.FieldValue.serverTimestamp();

                updateObject.verification = newKycData;
                await addNotificationToUser(asesorUid, 'Tu verificación de Identidad (KYC) ha sido enviada para revisión.', '/perfilasesor');
                notificationSent = true;
                console.log('KYC data updated and notification sent.');
            } else {
                console.log('KYC data has no changes to update.');
            }
        } else {
            console.log('KYC already verified. Not updating.');
            // Si está verificado, y la nota se permite editar, solo actualizar la nota si cambió.
            // Esto es un caso especial para la nota que no tiene el 'readonly' condicional del fieldset
            if (notes !== (currentKyc.notes || '')) {
                updateObject['verification.notes'] = notes || null; // Actualizar solo el campo de notas
                console.log('Only notes updated for verified KYC.');
            }
        }

        const updatedCredenciales = currentAsesorData.verificacion || { titulo: { estado: 'no-enviado' }, certificacion: { estado: 'no-enviado' } };
        let credencialesChanged = false;

        // Lógica de actualización para Título
        if (currentTitulo.estado !== 'verificado') {
            if (tituloUniversitarioUrl && tituloUniversitarioUrl !== (currentTitulo.urlDocumento || '')) {
                updatedCredenciales.titulo = {
                    estado: 'pendiente',
                    urlDocumento: tituloUniversitarioUrl,
                    observaciones: null,
                    fechaEnvio: admin.firestore.FieldValue.serverTimestamp()
                };
                credencialesChanged = true;
                console.log('Titulo data updated.');
            } else if (!tituloUniversitarioUrl && currentTitulo.urlDocumento) { // Si se borró la URL y no está verificado
                updatedCredenciales.titulo = { estado: 'no-enviado', urlDocumento: null };
                credencialesChanged = true;
                console.log('Titulo URL cleared. Status set to no-enviado.');
            }
        } else {
            console.log('Titulo already verified. Not updating.');
        }

        // Lógica de actualización para Certificación
        if (currentCertificacion.estado !== 'verificado') {
            if (certificacionProfesionalUrl && certificacionProfesionalUrl !== (currentCertificacion.urlDocumento || '')) {
                updatedCredenciales.certificacion = {
                    estado: 'pendiente',
                    urlDocumento: certificacionProfesionalUrl,
                    observaciones: null,
                    fechaEnvio: admin.firestore.FieldValue.serverTimestamp()
                };
                credencialesChanged = true;
                console.log('Certificacion data updated.');
            } else if (!certificacionProfesionalUrl && currentCertificacion.urlDocumento) { // Si se borró la URL y no está verificado
                updatedCredenciales.certificacion = { estado: 'no-enviado', urlDocumento: null };
                credencialesChanged = true;
                console.log('Certificacion URL cleared. Status set to no-enviado.');
            }
        } else {
            console.log('Certificacion already verified. Not updating.');
        }

        // Solo añadir al updateObject si hubo cambios en credenciales
        if (credencialesChanged) {
            updateObject.verificacion = updatedCredenciales;
            if (!notificationSent) { // Solo enviar notificación si no se envió una por KYC
                await addNotificationToUser(asesorUid, 'Tus credenciales profesionales han sido enviadas para revisión.', '/perfilasesor');
            }
            console.log('Credenciales updated.');
        }


        if (Object.keys(updateObject).length > 0) {
            console.log('Updating Firestore with:', updateObject);
            await asesorRef.update(updateObject);
            req.flash('success_msg', '¡Documentos enviados para verificación con éxito! Tu solicitud será revisada.');
            console.log('Firestore updated successfully. Redirecting to /perfilasesor...');
            return res.redirect('/perfilasesor');
        } else {
            console.log('No hay cambios detectados en la verificación de identidad o credenciales. No se actualizó Firestore. Redirecting to /perfilasesor...');
            req.flash('info_msg', 'No se detectaron cambios en tus documentos. Si ya están verificados, no es necesario re-enviar.');
            return res.redirect('/perfilasesor');
        }

    } catch (err) {
        console.error('Error al procesar la verificación de identidad y credenciales del asesor:', err);
        req.flash('error_msg', `Error al enviar documentos: ${err.message || 'Error desconocido.'}`);
        return res.redirect('/asesor/verificar_identidad');
    }
};

// --- MUESTRA EL PERFIL DEL CLIENTE (MANTIENE LA ORIGINAL DE TU CÓDIGO) ---
// Notar que esta función está en asesorController pero es para 'clientes'.
// Sugiero moverla a clienteController si su propósito es servir al cliente para ver su propio perfil.
// Si es para que un ASESOR vea el perfil de un CLIENTE, entonces se debería llamar
// mostrarPerfilClienteParaAsesor y debería recibir el ID del cliente como parámetro.
exports.mostrarPerfilCliente = async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!userId) {
            req.flash('error_msg', 'No se ha encontrado el ID de usuario en la sesión.');
            return res.redirect('/login');
        }

        const clienteDoc = await db.collection('clientes').doc(userId).get();

        if (!clienteDoc.exists) {
            req.flash('error_msg', 'Perfil de cliente no encontrado.');
            return res.redirect('/dashboard');
        }

        const cliente = clienteDoc.data();
        cliente.fechaRegistro = cliente.fechaRegistro ? moment(cliente.fechaRegistro.toDate()).format('YYYY-MM-DD HH:mm:ss') : null;

        res.render('cliente/perfil_cliente', { cliente: cliente });

    } catch (error) {
        console.error('Error al cargar el perfil del cliente:', error);
        req.flash('error_msg', 'Error al cargar tu perfil.');
        return res.redirect('/homecliente');
    }
};

// --- EDITAR INFORMACIÓN PERSONAL DEL CLIENTE (MANTIENE LA ORIGINAL DE TU CÓDIGO) ---
// Sugiero moverla a clienteController.
exports.editarInfoPersonalCliente = async (req, res) => {
    const userId = req.session.userId;
    const { nombre, apellido, email, telefono, direccion } = req.body;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
    }

    try {
        const clienteRef = db.collection('clientes').doc(userId);
        await clienteRef.update({
            nombre,
            apellido,
            email,
            telefono: telefono || null,
            direccion: direccion || null
        });
        const updatedClienteDoc = await clienteRef.get();
        return res.json({ success: true, message: 'Información personal actualizada correctamente.', cliente: updatedClienteDoc.data() });
    } catch (error) {
        console.error('Error al actualizar información personal del cliente:', error);
        return res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar la información.' });
    }
};

// --- EDITAR INFORMACIÓN FINANCIERA DEL CLIENTE (MANTIENE LA ORIGINAL DE TU CÓDIGO) ---
// Sugiero moverla a clienteController.
exports.editarInfoFinancieraCliente = async (req, res) => {
    const userId = req.session.userId;
    const { ingresosMensuales, gastosMensuales, ahorrosActuales, objetivosFinancieros } = req.body;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
    }

    try {
        const clienteRef = db.collection('clientes').doc(userId);
        await clienteRef.update({
            ingresosMensuales: parseFloat(ingresosMensuales) || 0,
            gastosMensuales: parseFloat(gastosMensuales) || 0,
            ahorrosActuales: parseFloat(ahorrosActuales) || 0,
            objetivosFinancieros: objetivosFinancieros || ''
        });
        const updatedClienteDoc = await clienteRef.get();
        return res.json({ success: true, message: 'Información financiera actualizada correctamente.', cliente: updatedClienteDoc.data() });
    } catch (error) {
        console.error('Error al actualizar información financiera del cliente:', error);
        return res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar la información financiera.' });
    }
};

// --- SUBIR FOTO DE PERFIL DEL CLIENTE (MANTIENE LA ORIGINAL DE TU CÓDIGO) ---
// Sugiero moverla a clienteController.
exports.uploadProfilePhotoCliente = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No se subió ningún archivo.' });
        }

        const imgurClientId = process.env.IMGUR_CLIENT_ID;

        if (!imgurClientId) {
            console.error('ERROR: IMGUR_CLIENT_ID no está configurado en las variables de entorno.');
            return res.status(500).json({ success: false, message: 'Error de configuración del servidor. Contacte al administrador.' });
        }

        const imageBase64 = req.file.buffer.toString('base64');

        const imgurResponse = await fetch('https://api.imgur.com/3/image', {
            method: 'POST',
            headers: {
                'Authorization': `Client-ID ${imgurClientId}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: imageBase64, type: 'base64' })
        });

        const imgurData = await imgurResponse.json();

        if (!imgurResponse.ok || imgurData.status !== 200 || !imgurData.success) {
            console.error('Error al subir a Imgur (cliente):', imgurData);
            return res.status(imgurResponse.status || 500).json({ success: false, message: 'Error al subir la imagen a Imgur.' });
        }

        const imageUrl = imgurData.data.link;
        const userId = req.session.userId;

        await db.collection('clientes').doc(userId).update({
            fotoPerfilUrl: imageUrl
        });

        return res.json({
            success: true,
            message: 'Foto de perfil subida y actualizada correctamente.',
            imageUrl: imageUrl
        });

    } catch (error) {
        console.error('Error en el endpoint /cliente/upload-profile-photo:', error);
        return res.status(500).json({ success: false, message: 'Error interno del servidor al procesar la imagen.' });
    }
};

// --- RUTAS PARA CAMBIAR CONTRASEÑA DEL CLIENTE (MANTIENE LA ORIGINAL DE TU CÓDIGO) ---
// Sugiero moverla a clienteController.
exports.getChangePasswordPageCliente = (req, res) => {
    return res.render('cliente/cambiar_password_cliente', { error: req.flash('error_msg'), success: req.flash('success_msg') });
};

exports.changePasswordCliente = async (req, res) => {
    const { current_password, new_password, confirm_new_password } = req.body;
    const userId = req.session.userId;
    const userEmail = req.userEmail;

    if (!new_password || !confirm_new_password || !current_password) {
        req.flash('error_msg', 'Todos los campos son obligatorios.');
        return res.redirect('/cliente/cambiar_password');
    }
    if (new_password !== confirm_new_password) {
        req.flash('error_msg', 'La nueva contraseña y la confirmación no coinciden.');
        return res.redirect('/cliente/cambiar_password');
    }
    if (new_password.length < 6) {
        req.flash('error_msg', 'La nueva contraseña debe tener al menos 6 caracteres.');
        return res.redirect('/cliente/cambiar_password');
    }

    try {
        const apiKey = process.env.FIREBASE_API_KEY;
        const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
        const reauthResponse = await fetch(signInUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: userEmail,
                password: current_password,
                returnSecureToken: true
            })
        });

        if (!reauthResponse.ok) {
            const reauthError = await reauthResponse.json();
            console.error('Error de re-autenticación (cliente):', reauthError);
            if (reauthError.error && reauthError.error.message === 'INVALID_PASSWORD') {
                req.flash('error_msg', 'La contraseña actual es incorrecta.');
            } else {
                req.flash('error_msg', 'Error al verificar tu contraseña actual. Inténtalo de nuevo.');
            }
            return res.redirect('/cliente/cambiar_password');
        }

        const updatePasswordUrl = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`;
        const updateResponse = await fetch(updatePasswordUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                idToken: (await reauthResponse.json()).idToken,
                password: new_password,
                returnSecureToken: false
            })
        });

        if (!updateResponse.ok) {
            const updateError = await updateResponse.json();
            console.error('Error al actualizar contraseña en Firebase (cliente):', updateError);
            req.flash('error_msg', updateError.error.message || 'Error al actualizar la contraseña. Inténtalo de nuevo.');
            return res.redirect('/cliente/cambiar_password');
        }

        req.flash('success_msg', '¡Contraseña actualizada con éxito!');
        return res.redirect('/cliente/cambiar_password');

    } catch (error) {
        console.error('Error en el proceso de cambio de contraseña del cliente:', error);
        req.flash('error_msg', 'Error interno del servidor al cambiar la contraseña.');
        return res.redirect('/cliente/cambiar_password');
    }
};

// -------------------------------------------------------------
// --- NUEVAS FUNCIONES PARA CLIENTE (VISIÓN DE ASESORES) ---
//       Añadidas aquí según tu solicitud.
// -------------------------------------------------------------

exports.mostrarAsesoresDisponibles = async (req, res) => {
    try {
        // Asegúrate de que el usuario sea un cliente autenticado antes de mostrar asesores
        // req.session.userId debe ser el ID del cliente
        if (!req.session.userId) {
            req.flash('error_msg', 'Debes iniciar sesión para ver los asesores disponibles.');
            return res.redirect('/login');
        }

        // Obtener solo asesores que estén verificados y activos desde la colección 'asesores' en Firestore
        // Asume que tienes un campo 'verificado' y 'activo' en tus documentos de asesor
        const asesoresSnapshot = await db.collection('asesores')
                                         .where('verification.status', '==', 'verificado') // Asegura que la verificación KYC está completa
                                         .where('verificacion.titulo.estado', '==', 'verificado') // Asegura que el título está verificado
                                         .where('activo', '==', true)     // Asume un campo 'activo' para asesores que pueden ser asignados
                                         .get();

        const asesoresParaVista = asesoresSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                _id: doc.id, // El ID del documento de Firestore
                nombre: data.nombre,
                apellido: data.apellido,
                especialidad: data.especialidad || 'General', // Campo de especialidad
                descripcion: data.descripcion || 'Asesor financiero experimentado listo para ayudarte a alcanzar tus metas.',
                fotoPerfilUrl: data.fotoPerfilUrl || '/images/default-profile.png' // Usa una imagen por defecto si no tienen una
            };
        });

        res.render('cliente/asesores-disponibles', { // Asegúrate de que esta vista exista en views/cliente/
            asesores: asesoresParaVista,
            user: req.user, // Pasa req.user para la cabecera, etc.
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });
    } catch (error) {
        console.error('Error al obtener asesores disponibles para el cliente desde Firestore (asesorController):', error);
        req.flash('error_msg', 'Hubo un problema al cargar los asesores. Inténtalo de nuevo más tarde.');
        res.redirect('/homecliente'); // O a una página de error adecuada
    }
};

// controllers/clienteController.js (o dondequiera que esté esta función)

exports.asignarAsesorCliente = async (req, res) => {
    try {
        const clienteUid = req.session.userId; // ID del cliente que solicita la asignación
        const { asesorId } = req.body; // ID del asesor a asignar

        if (!clienteUid) {
            return res.status(401).json({
                success: false,
                message: 'No autenticado. Inicia sesión como cliente.',
                redirectTo: '/login'
            });
        }
        if (!asesorId) {
            return res.status(400).json({ success: false, message: 'ID de asesor no proporcionado.' });
        }

        // 1. Verificar si el asesor existe y está verificado/activo en Firestore
        const asesorDoc = await db.collection('asesores').doc(asesorId).get();
        if (!asesorDoc.exists) {
            return res.status(404).json({ success: false, message: 'Asesor no encontrado.' });
        }
        const asesorData = asesorDoc.data();
        // Asegúrate de que el asesor tenga el estado de verificación correcto y esté activo para ser asignado
        if (asesorData.verification?.status !== 'verificado' || asesorData.verificacion?.titulo?.estado !== 'verificado' || !asesorData.activo) {
            return res.status(400).json({ success: false, message: 'Asesor no disponible para asignación en este momento.' });
        }

        // 2. Actualizar el documento del cliente en Firestore para asignarle el asesor
        const clienteRef = db.collection('clientes').doc(clienteUid);
        await clienteRef.update({
            // --- CAMBIO CLAVE AQUÍ ---
            // Guardar directamente el ID del asesor como una cadena de texto
            asesorAsignado: asesorId,
            // --- FIN DEL CAMBIO ---
            fechaAsignacionAsesor: admin.firestore.FieldValue.serverTimestamp() // Opcional: fecha de asignación
        });

        // 3. Actualizar el documento del asesor para añadir este cliente a su lista de clientes asignados
        const asesorRef = db.collection('asesores').doc(asesorId);
        await asesorRef.update({
            clientesAsignados: admin.firestore.FieldValue.arrayUnion(clienteUid) // Añade el UID del cliente al array de clientesAsignados del asesor
        });

        // 4. Añadir notificación al asesor
        // Ojo: Si 'clienteDoc' ya se usó, declara una nueva variable para no reusarla accidentalmente
        const clienteActualizadoDoc = await db.collection('clientes').doc(clienteUid).get(); // Necesitamos los datos del cliente para la notificación
        const clienteActualizadoData = clienteActualizadoDoc.data();
        const notificationMessage = `¡Tienes un nuevo cliente! ${clienteActualizadoData.nombre} ${clienteActualizadoData.apellido} te ha seleccionado como su asesor.`;

        await addNotificationToUser(asesorId, notificationMessage, `/asesor/clientes/${clienteUid}/perfil`);

        // Si todo va bien, enviar la respuesta de éxito con redirectTo
        return res.json({
            success: true,
            message: `¡Has sido asignado a ${asesorData.nombre} ${asesorData.apellido}! Redirigiendo al chat personal...`,
            redirectTo: '/chat-personal' // Redirigir al chat personal después de la asignación
        });

    } catch (error) {
        console.error('Error al asignar asesor al cliente (asignarAsesorCliente):', error);
        return res.status(500).json({
            success: false,
            message: 'Hubo un problema al asignar el asesor. Inténtalo de nuevo.',
            redirectTo: '/cliente/asesores-disponibles' // Redirigir de vuelta a la lista de asesores si hay un error
        });
    }
};

exports.getAsesorByIdAPI = async (req, res) => {
    try {
        const asesorId = req.params.id; // Obtiene el ID del asesor desde los parámetros de la URL

        const asesorDoc = await db.collection('asesores').doc(asesorId).get();

        if (!asesorDoc.exists) {
            return res.status(404).json({ message: 'Asesor no encontrado.' });
        }

        const asesorData = asesorDoc.data();

        // Devuelve solo los datos públicos o necesarios para el cliente
        // Considera qué campos son realmente necesarios y seguros de exponer públicamente.
        res.json({
            _id: asesorDoc.id, // El ID del documento de Firestore
            nombre: asesorData.nombre,
            apellido: asesorData.apellido,
            email: asesorData.email || 'No proporcionado', // Cuidado con exponer emails públicamente
            telefono: asesorData.telefono || 'No proporcionado', // Cuidado con exponer teléfonos públicamente
            especialidad: asesorData.especialidad || 'General',
            descripcion: asesorData.descripcion || 'Sin descripción disponible.',
            fotoPerfilUrl: asesorData.fotoPerfilUrl || '/images/default-profile.png'
            // No incluir datos sensibles como contraseñas, documentos de verificación, etc.
        });
    } catch (error) {
        console.error('Error al obtener detalles del asesor por ID (API - Firestore - asesorController):', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// Función para formatear timestamps de Firestore a hora legible
const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    // Si es un objeto Timestamp de Firestore, convertir a Date
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
};

// Función para obtener una sala de chat de forma consistente
const getChatRoomId = (uid1, uid2) => {
    const chatMembers = [uid1, uid2].sort();
    return `chat_${chatMembers[0]}_${chatMembers[1]}`;
};



exports.mostrarChatGeneralAsesor = async (req, res) => {
    try {
        const asesorUid = req.session.userId;

        if (!asesorUid) {
            req.flash('error_msg', 'No has iniciado sesión o tu sesión ha expirado.');
            return res.redirect('/login');
        }

        const asesorDoc = await db.collection('asesores').doc(asesorUid).get();
        if (!asesorDoc.exists) {
            req.flash('error_msg', 'Perfil de asesor no encontrado.');
            return res.redirect('/homeasesor');
        }
        const asesorData = asesorDoc.data();

        // Obtener los clientes asignados al asesor
        const clientesAsignadosIds = asesorData.clientesAsignados || []; // Suponiendo que es un array de IDs de clientes

        let clientesParaSidebar = [];
        let clientesDataMap = new Map(); // Para almacenar datos de clientes por ID para fácil acceso

        // Recorrer los clientes asignados para obtener sus datos y el último mensaje/no leídos
        for (const clienteId of clientesAsignadosIds) {
            const clienteDoc = await db.collection('clientes').doc(clienteId).get();
            if (clienteDoc.exists) {
                const clienteData = clienteDoc.data();
                clientesDataMap.set(clienteId, clienteData); // Guarda los datos del cliente

                const roomId = getChatRoomId(asesorUid, clienteId);
                const chatDoc = await db.collection('chats').doc(roomId).get();

                let lastMessage = '';
                let unreadCount = 0;

                if (chatDoc.exists) {
                    const chatData = chatDoc.data();
                    lastMessage = chatData.lastMessageText || '';
                    unreadCount = chatData.asesorUnreadCount || 0; // Mensajes no leídos para el asesor
                }

                clientesParaSidebar.push({
                    id: clienteId,
                    nombre: clienteData.nombre,
                    apellido: clienteData.apellido,
                    fotoPerfilUrl: clienteData.fotoPerfilUrl || '/images/default-profile.png',
                    lastMessage: lastMessage,
                    unreadCount: unreadCount
                });
            }
        }

        // Si hay clientes, selecciona el primero por defecto para cargar su chat
        let initialChatCliente = null;
        let initialChatMessages = [];

        if (clientesParaSidebar.length > 0) {
            const firstClientId = clientesParaSidebar[0].id;
            initialChatCliente = clientesDataMap.get(firstClientId); // Obtén los datos completos del primer cliente

            const roomId = getChatRoomId(asesorUid, firstClientId);
            const chatDoc = await db.collection('chats').doc(roomId).get();

            if (chatDoc.exists) {
                const chatData = chatDoc.data();
                initialChatMessages = chatData.messages.map(msg => ({
                    ...msg,
                    timestamp: msg.timestamp ? msg.timestamp.toDate() : new Date()
                }));
                // Marcar como leídos al cargar el chat inicial
                await db.collection('chats').doc(roomId).update({ asesorUnreadCount: 0 });
            }
        }

        res.render('asesor/chat_general_asesor', {
            // --- ¡AQUÍ ESTÁ LA MODIFICACIÓN CLAVE! ---
            asesor: {
                id: asesorUid, // Aseguramos que 'id' contenga el UID del asesor
                nombre: asesorData.nombre,
                // Puedes añadir otras propiedades de asesorData aquí si las necesitas en el EJS
                // ejemplo: fotoPerfilUrl: asesorData.fotoPerfilUrl
            },
            // ------------------------------------------
            clientesParaSidebar: clientesParaSidebar,
            initialChatCliente: initialChatCliente ? {
                id: initialChatCliente.id,
                nombre: initialChatCliente.nombre,
                apellido: initialChatCliente.apellido,
                fotoPerfilUrl: initialChatCliente.fotoPerfilUrl || '/images/default-profile.png',
            } : null,
            initialChatMessages: initialChatMessages,
            user: req.user, // O req.user.nombre si solo necesitas el nombre para la navbar
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            info_msg: req.flash('info_msg')
        });

    } catch (error) {
        console.error('Error al cargar la página general de chat del asesor:', error);
        req.flash('error_msg', 'Ocurrió un error al cargar el chat. Por favor, inténtalo de nuevo.');
        return res.status(500).redirect('/homeasesor');
    }
};

// NUEVO: API para obtener mensajes de un chat específico (para peticiones AJAX/fetch)
exports.getClienteChatMessages = async (req, res) => {
    try {
        const asesorUid = req.session.userId;
        const clienteId = req.params.clienteId;

        if (!asesorUid || !clienteId) {
            return res.status(400).json({ success: false, message: 'Datos incompletos.' });
        }

        // Opcional: Verificar si el cliente está asignado a este asesor
        // const asesorDoc = await db.collection('asesores').doc(asesorUid).get();
        // if (!asesorDoc.exists || !(asesorDoc.data().clientesAsignados || []).includes(clienteId)) {
        //     return res.status(403).json({ success: false, message: 'Acceso denegado a este chat.' });
        // }

        const roomId = getChatRoomId(asesorUid, clienteId);
        const chatDoc = await db.collection('chats').doc(roomId).get();

        let messages = [];
        if (chatDoc.exists) {
            const chatData = chatDoc.data();
            messages = chatData.messages.map(msg => ({
                ...msg,
                // Si el timestamp es un objeto Timestamp de Firebase, lo convertimos
                timestamp: msg.timestamp ? (msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp)) : new Date()
            }));

            // Marcar mensajes como leídos
            await db.collection('chats').doc(roomId).update({ asesorUnreadCount: 0 });
        }

        res.json({ success: true, messages: messages });

    } catch (error) {
        console.error('Error al obtener mensajes del chat:', error);
        res.status(500).json({ success: false, message: 'Error al obtener mensajes.' });
    }
};

// NUEVO: API para enviar un mensaje desde el asesor (para peticiones AJAX/fetch)
// API para enviar un mensaje desde el asesor (para peticiones AJAX/fetch)
exports.asesorSendMessage = async (req, res) => {
    try {
        const asesorUid = req.session.userId;
        // ¡CAMBIO CLAVE AQUÍ! Ahora también esperamos 'timestamp' del frontend
        const { clienteId, messageText, timestamp } = req.body; 

        if (!asesorUid || !clienteId || !messageText || !timestamp) { // Validar timestamp
            return res.status(400).json({ success: false, message: 'Datos incompletos para enviar mensaje.' });
        }

        const roomId = getChatRoomId(asesorUid, clienteId);
        const chatRef = db.collection('chats').doc(roomId);
        const chatDoc = await chatRef.get();

        // Convertir el timestamp ISO string de vuelta a un objeto Date
        const messageTimestamp = new Date(timestamp); 
        
        let newMessage = {
            senderId: asesorUid,
            senderType: 'asesor',
            text: messageText,
            timestamp: messageTimestamp // ¡Usamos el timestamp del frontend!
        };

        if (!chatDoc.exists) {
            await chatRef.set({
                clientId: clienteId,
                asesorId: asesorUid,
                messages: [newMessage],
                lastMessageText: messageText,
                lastMessageTimestamp: messageTimestamp, // También para el lastMessageTimestamp
                clientUnreadCount: 1,
                asesorUnreadCount: 0
            });
        } else {
            await chatRef.update({
                messages: admin.firestore.FieldValue.arrayUnion(newMessage),
                lastMessageText: messageText,
                lastMessageTimestamp: messageTimestamp, // También para el lastMessageTimestamp
                clientUnreadCount: admin.firestore.FieldValue.increment(1)
            });
        }

        res.json({
            success: true,
            message: 'Mensaje enviado.',
            sentMessage: {
                ...newMessage,
                // Aseguramos que el timestamp se envía como ISO string
                timestamp: newMessage.timestamp.toISOString() 
            }
        });

    } catch (error) {
        console.error('Error al enviar mensaje del asesor:', error);
        res.status(500).json({ success: false, message: 'Error al enviar mensaje.', details: error.message });
    }
};

// Función para mostrar la lista de clientes asignados al asesor
exports.mostrarClientesAsignados = async (req, res) => {
    try {
        const asesorUid = req.session.userId;

        if (!asesorUid) {
            req.flash('error_msg', 'No has iniciado sesión.');
            return res.redirect('/login');
        }

        const asesorDoc = await db.collection('asesores').doc(asesorUid).get();

        if (!asesorDoc.exists) {
            req.flash('error_msg', 'Perfil de asesor no encontrado.');
            return res.redirect('/dashboard');
        }

        const asesorData = asesorDoc.data();
        const clientesAsignadosIds = asesorData.clientesAsignados || [];

        const clientesPromises = clientesAsignadosIds.map(clienteId => {
            return db.collection('clientes').doc(clienteId).get().then(clienteDoc => {
                if (clienteDoc.exists) {
                    const clienteData = clienteDoc.data();
                    return {
                        id: clienteDoc.id,
                        nombre: clienteData.nombre || 'N/A',
                        apellido: clienteData.apellido || 'N/A',
                        fotoPerfilUrl: clienteData.fotoPerfilUrl || '/images/default-profile.png', // ¡AÑADIDO ESTO!
                        email: clienteData.email || 'N/A', // Opcional: si quieres el email en la lista
                        telefono: clienteData.telefono || 'N/A' // Opcional: si quieres el teléfono en la lista
                        // Puedes añadir más campos aquí si los necesitas en el objeto 'cliente'
                        // antes de pasarlo a la vista EJS para la lista.
                    };
                }
                return null;
            });
        });

        const clientes = await Promise.all(clientesPromises);
        const clientesFiltrados = clientes.filter(cliente => cliente !== null); // Filtrar clientes no encontrados

        // console.log('Datos de clientes enviados a la vista:', clientesFiltrados); // Línea para depuración

        res.render('asesor/clientes_asignados', { clientes: clientesFiltrados });
    } catch (error) {
        console.error('Error al cargar la lista de clientes asignados:', error);
        req.flash('error_msg', 'Error al cargar la lista de clientes asignados.');
        return res.redirect('/dashboard');
    }
};

// Ruta para mostrar la vista del calendario
exports.mostrarCalendario = async (req, res) => {
    try {
        if (!req.session.userId) {
            req.flash('error_msg', 'No has iniciado sesión.');
            return res.redirect('/login');
        }
        res.render('asesor/calendario'); // Renderiza la vista del calendario
    } catch (error) {
        console.error('Error al cargar la vista del calendario:', error);
        req.flash('error_msg', 'Error al cargar la vista del calendario.');
        res.redirect('/dashboard'); // O a la página de inicio del asesor
    }
};

// API: Obtener todos los eventos para el asesor logueado
exports.getEventosAPI = async (req, res) => {
    try {
        const asesorId = req.session.userId;
        if (!asesorId) {
            return res.status(401).json({ success: false, message: 'No autenticado.' });
        }

        const eventosSnapshot = await db.collection('eventosCalendario')
                                        .where('asesorId', '==', asesorId)
                                        .get();

        const eventos = [];
        eventosSnapshot.forEach(doc => {
            const data = doc.data();
            eventos.push({
                id: doc.id, // ID del documento para edición/eliminación
                title: data.title,
                start: data.start, // Formato 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:mm:ss'
                end: data.end || data.start // Si no hay end, el evento es de un solo día
            });
        });
        res.json(eventos); // FullCalendar espera un array de objetos de evento
    } catch (error) {
        console.error('Error al obtener eventos del calendario:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
};

// API: Crear un nuevo evento
exports.crearEventoAPI = async (req, res) => {
    try {
        const asesorId = req.session.userId;
        if (!asesorId) {
            return res.status(401).json({ success: false, message: 'No autenticado.' });
        }

        const { title, date } = req.body; // 'date' será la fecha seleccionada del calendario

        if (!title || !date) {
            return res.status(400).json({ success: false, message: 'Título y fecha del evento son requeridos.' });
        }

        const nuevoEvento = {
            asesorId: asesorId,
            title: title,
            start: date, // Guardamos la fecha del evento
            createdAt: new Date()
        };

        const docRef = await db.collection('eventosCalendario').add(nuevoEvento);
        res.status(201).json({ success: true, message: 'Evento creado exitosamente.', eventId: docRef.id });

    } catch (error) {
        console.error('Error al crear evento del calendario:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
};

// API: Editar un evento existente
exports.editarEventoAPI = async (req, res) => {
    try {
        const asesorId = req.session.userId;
        const eventoId = req.params.id; // ID del evento a editar
        const { title, date } = req.body; // Puedes enviar la fecha si también se puede editar

        if (!asesorId) {
            return res.status(401).json({ success: false, message: 'No autenticado.' });
        }
        if (!eventoId || !title || !date) {
            return res.status(400).json({ success: false, message: 'ID, título y fecha del evento son requeridos.' });
        }

        const eventoRef = db.collection('eventosCalendario').doc(eventoId);
        const eventoDoc = await eventoRef.get();

        if (!eventoDoc.exists || eventoDoc.data().asesorId !== asesorId) {
            return res.status(404).json({ success: false, message: 'Evento no encontrado o no autorizado.' });
        }

        await eventoRef.update({
            title: title,
            start: date, // Actualizamos la fecha del evento
            updatedAt: new Date()
        });

        res.json({ success: true, message: 'Evento actualizado exitosamente.' });

    } catch (error) {
        console.error('Error al editar evento del calendario:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
};

// API: Eliminar un evento
exports.eliminarEventoAPI = async (req, res) => {
    try {
        const asesorId = req.session.userId;
        const eventoId = req.params.id; // ID del evento a eliminar

        if (!asesorId) {
            return res.status(401).json({ success: false, message: 'No autenticado.' });
        }
        if (!eventoId) {
            return res.status(400).json({ success: false, message: 'ID del evento es requerido.' });
        }

        const eventoRef = db.collection('eventosCalendario').doc(eventoId);
        const eventoDoc = await eventoRef.get();

        if (!eventoDoc.exists || eventoDoc.data().asesorId !== asesorId) {
            return res.status(404).json({ success: false, message: 'Evento no encontrado o no autorizado.' });
        }

        await eventoRef.delete();
        res.json({ success: true, message: 'Evento eliminado exitosamente.' });

    } catch (error) {
        console.error('Error al eliminar evento del calendario:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
};



