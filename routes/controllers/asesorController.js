// Importa las instancias de Firebase admin SDK
const admin = require('firebase-admin');
const db = admin.firestore();
const auth = admin.auth();

// Importa node-fetch para hacer solicitudes HTTP (necesario para la API de Firebase Auth REST)
const fetch = require('node-fetch');

// Importa moment para formatear fechas (asegúrate de tenerlo instalado: npm install moment)
const moment = require('moment');
const { default: Stripe } = require('stripe');

// Importa uuid para generar IDs únicos para las notificaciones
const { v4: uuidv4 } = require('uuid');

// Función auxiliar para añadir notificaciones.
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
        console.log(`Notificación añadida a ${userId}: ${message}`);
    } catch (error) {
        console.error('Error al añadir notificación:', error);
    }
}


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




// Muestra el perfil del cliente
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

// Editar información personal del cliente
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

// Editar información financiera del cliente
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

// Subir foto de perfil del cliente
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

// Rutas para cambiar contraseña del cliente
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