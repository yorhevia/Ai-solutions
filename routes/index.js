require('dotenv').config();
var express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const cors = require('cors');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');


const { requireAuth, requireAsesor } = require('../config/middleware'); // Importa ambos middlewares
const isAdmin = require('../config/middlewareisadmin'); 

const { admin, db, auth } = require('./firebase');
const clienteController = require('./controllers/clienteController');
const asesorController = require('./controllers/asesorController');
const editProfileController = require('./controllers/editProfileController');

var router = express.Router();

// Obtén el Client ID de Imgur
const imgurClientId = process.env.IMGUR_CLIENT_ID;

// Configuración de Multer para la subida de FOTO DE PERFIL (SOLO IMAGENES PARA IMGUR)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido. Solo se permiten JPG, PNG, GIF.'), false);
        }
    }
});

router.use(cors());


// Función auxiliar para añadir notificación
async function addNotificationToUser(userId, message, link = '#') {
    try {
        const userRef = db.collection('asesores').doc(userId); // Por defecto a asesores, puede ser dinámico
        const notification = {
            id: uuidv4(),
            timestamp: admin.firestore.FieldValue.serverTimestamp(), // Usar serverTimestamp para consistencia
            message: message,
            read: false,
            link: link
        };
        await userRef.update({
            notifications: admin.firestore.FieldValue.arrayUnion(notification)
        });
        console.log(`Notificación añadida a ${userId}: ${message}`);
    } catch (error) {
        console.error('Error al añadir notificación:', error);
    }
}



//Rutas de Acceso y Autenticación Login, Registro, Logout

/// Ruta de bienvenida
router.get('/', (req, res) => {
    return res.render('welcome');
});

// Rutas de Login
router.get('/login', (req, res) => {
    return res.render('ingreso/login', { error: req.flash('error_msg') });
});

router.post('/login', async (req, res) => {
    const { email, contrasena } = req.body;
    if (!email || !contrasena) {
        req.flash('error_msg', 'Por favor, introduce correo electrónico y contraseña.');
        return res.redirect('/login');
    }
    try {
        const apiKey = process.env.FIREBASE_API_KEY;
        if (!apiKey) {
            console.error('ERROR: FIREBASE_API_KEY no está configurado en las variables de entorno.');
            req.flash('error_msg', 'Error de configuración del servidor. Contacta al administrador.');
            return res.status(500).redirect('/login');
        }
        const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
        const response = await fetch(signInUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email,
                password: contrasena,
                returnSecureToken: true
            })
        });
        const firebaseResponse = await response.json();
        if (!response.ok) {
            console.error('Error de autenticación de Firebase (REST API):', firebaseResponse.error);
            let errorMessage = 'Error al iniciar sesión.';
            if (firebaseResponse.error && firebaseResponse.error.message) {
                switch (firebaseResponse.error.message) {
                    case 'EMAIL_NOT_FOUND':
                    case 'INVALID_PASSWORD':
                        errorMessage = 'Correo electrónico o contraseña incorrectos.';
                        break;
                    case 'USER_DISABLED':
                        errorMessage = 'Tu cuenta ha sido deshabilitada.';
                        break;
                    case 'INVALID_EMAIL':
                        errorMessage = 'El formato del correo electrónico no es válido.';
                        break;
                    default:
                        errorMessage = 'Error al iniciar sesión. Por favor, inténtalo de nuevo.';
                }
            }
            req.flash('error_msg', errorMessage);
            return res.redirect('/login');
        }
        const uid = firebaseResponse.localId;
        console.log('Usuario autenticado con éxito en Firebase (REST API). UID:', uid);
        req.session.userId = uid;
        req.userEmail = email; // Mantener esto para isAdmin

        // AÑADIDO: Determinar el tipo de usuario y guardarlo en la sesión
        const clienteDoc = await db.collection('clientes').doc(uid).get();
        const asesorDoc = await db.collection('asesores').doc(uid).get();

        if (clienteDoc.exists) {
            req.session.userType = 'client';
            req.session.userName = clienteDoc.data().nombre || email;
        } else if (asesorDoc.exists) {
            req.session.userType = 'asesor';
            req.session.userName = asesorDoc.data().nombre || email;
        } else {
            req.session.userType = 'unregistered'; // Usuario autenticado pero sin perfil completado
            req.session.userName = email;
        }

        req.flash('success_msg', '¡Has iniciado sesión con éxito!');
        return res.redirect('/dashboard');
    } catch (error) {
        console.error('Error general en la ruta /login:', error);
        req.flash('error_msg', 'Error interno del servidor. Inténtalo más tarde.');
        return res.status(500).redirect('/login');
    }
});

// Rutas de Registro de Cuenta (Firebase Auth)
router.get('/registro', (req, res) => {
    return res.render('ingreso/registro', { error: req.flash('error_msg'), formData: {} });
});

router.post('/registro', async (req, res) => {
    const { nombre, apellido, email, contrasena, confirmar_contrasena } = req.body;
    if (contrasena !== confirmar_contrasena) {
        req.flash('error_msg', 'Las contraseñas no coinciden.');
        return res.render('ingreso/registro', { error: req.flash('error_msg'), formData: req.body });
    }
    try {
        const userRecord = await auth.createUser({
            email: email,
            password: contrasena,
            displayName: `${nombre} ${apellido}`,
        });
        console.log('Usuario registrado en Firebase Auth:', userRecord.uid);
        req.session.userId = userRecord.uid;
        req.session.userCreationTime = userRecord.metadata.creationTime;
        req.userEmail = email;
        req.session.userName = nombre; // Para el nombre de usuario inicial
        req.session.userType = 'unregistered'; // Tipo de usuario aún no definido por perfil

        req.flash('success_msg', '¡Registro exitoso! Por favor, completa tu perfil.');
        return res.redirect('/dashboard');
    } catch (error) {
        console.error('Error al registrar usuario:', error);
        let errorMessage = 'Error al registrar usuario. Por favor, inténtalo de nuevo.';
        if (error?.errorInfo?.code === 'auth/email-already-exists') {
            errorMessage = 'Este correo electrónico ya está en uso.';
        } else if (error?.errorInfo?.code === 'auth/invalid-email') {
            errorMessage = 'El correo electrónico no es válido.';
        } else if (error?.errorInfo?.code === 'auth/weak-password') {
            errorMessage = 'La contraseña debe tener al menos 6 caracteres.';
        }
        req.flash('error_msg', errorMessage);
        return res.render('ingreso/registro', { error: req.flash('error_msg'), formData: req.body });
    }
});




router.get('/logout', (req, res) => {
    req.flash('success_msg', 'Has cerrado sesión.');

    req.session.destroy((err) => {
        if (err) {
            console.error('Error al destruir la sesión:', err);
     
            req.flash('error_msg', 'Error al cerrar sesión. Intenta de nuevo.');
            return res.status(500).redirect('/login');
        }
        res.redirect('/login');
    });
});



//Rutas de Registro de Perfil Información Adicional

router.get('/registro-perfil/cliente', requireAuth, (req, res) => {
    return res.render('ingreso/registrocliente', { error: req.flash('error_msg') });
});

router.get('/registro-perfil/asesor', requireAuth, (req, res) => {
    return res.render('ingreso/registroasesor', { error: req.flash('error_msg') });
});

router.post('/registro-perfil', requireAuth, async (req, res) => {
    const { tipo_usuario, ...formData } = req.body;
    const userId = req.session.userId;
    const userCreationTime = req.session.userCreationTime;
    if (!userId || !userCreationTime) {
        console.error('ID de usuario o fecha de creación no encontrada en la sesión durante registro-perfil.');
        req.flash('error_msg', 'Sesión inválida o datos de registro incompletos. Por favor, regístrate de nuevo.');
        return res.status(401).redirect('/registro');
    }
    try {
        const datosAGuardar = {
            ...formData,
            fechaRegistro: new Date(userCreationTime)
        };
        if (tipo_usuario === 'cliente') {
            await db.collection('clientes').doc(userId).set(datosAGuardar);
            console.log(`Perfil de cliente registrado para el usuario: ${userId}`, datosAGuardar);
            delete req.session.userCreationTime;
            req.session.userType = 'client'; // Actualizar el tipo de usuario en la sesión
            req.session.userName = formData.nombre; // Actualizar el nombre en la sesión
            req.flash('success_msg', 'Tu perfil de cliente ha sido registrado.');
            return res.redirect('/homecliente');
        } else if (tipo_usuario === 'asesor') {
            // Inicializar las verificaciones para un asesor nuevo
            const asesorDataConVerificaciones = {
                ...datosAGuardar,
                verification: {
                    status: 'No enviado', // Estado inicial de la verificación de identidad (KYC)
                    documentUrl: null,
                    notes: null
                },
                verificacion: { // Estructura para títulos y certificaciones
                    titulo: {
                        estado: 'No enviado',
                        url: null,
                        observaciones: null
                    },
                    certificacion: {
                        estado: 'No enviado',
                        url: null,
                        observaciones: null
                    }
                }
            };
            await db.collection('asesores').doc(userId).set(asesorDataConVerificaciones);
            console.log(`Perfil de asesor registrado para el usuario: ${userId}`, datosAGuardar);
            delete req.session.userCreationTime;
            req.session.userType = 'asesor'; // Actualizar el tipo de usuario en la sesión
            req.session.userName = formData.nombre; // Actualizar el nombre en la sesión
            req.flash('success_msg', 'Tu perfil de asesor ha sido registrado. Espera la verificación.');
            return res.redirect('/homeasesor');
        } else {
            console.error('Tipo de usuario no válido:', tipo_usuario);
            req.flash('error_msg', 'Tipo de usuario no válido.');
            return res.status(400).redirect('/registro');
        }
    } catch (error) {
        console.error('Error al registrar el perfil:', error);
        req.flash('error_msg', 'Error al registrar el perfil.');
        return res.status(500).redirect('/registro');
    }
});


// Ruta del Dashboard (redirige según el tipo de usuario)
router.get('/dashboard', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const userEmail = req.userEmail;
    const userType = req.session.userType; // Usar el tipo de usuario de la sesión

    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : [];

    try {
        // Redirección para administradores (basado en email)
        if (adminEmails.includes(userEmail)) {
            return res.redirect('/admin/verificaciones_pendientes');
        }

        // Redirecciones basadas en el tipo de usuario de la sesión
        if (userType === 'client') {
            return res.redirect('/homecliente');
        } else if (userType === 'asesor') {
            return res.redirect('/homeasesor');
        } else if (userType === 'unregistered') {
            // Si el usuario está autenticado pero no tiene perfil completado
            // Comprobar si ya existe un documento para evitar redirigir de nuevo a la selección
            const clienteDoc = await db.collection('clientes').doc(userId).get();
            const asesorDoc = await db.collection('asesores').doc(userId).get();

            if (!clienteDoc.exists && !asesorDoc.exists) {
                return res.render('ingreso/seleccionar_tipo_usuario');
            } else {
                console.warn(`Usuario ${userId} con userType 'unregistered' pero con perfil existente.`);
                if (clienteDoc.exists) { req.session.userType = 'client'; return res.redirect('/homecliente'); }
                if (asesorDoc.exists) { req.session.userType = 'asesor'; return res.redirect('/homeasesor'); }
            }
        } else {
            console.error('Estado de perfil inconsistente para el usuario:', userId);
            req.flash('error_msg', 'Error en el estado del perfil del usuario.');
            return res.status(500).redirect('/login');
        }
    } catch (error) {
        console.error('Error al verificar el perfil del usuario en /dashboard:', error);
        req.flash('error_msg', 'Error al verificar el perfil del usuario.');
        return res.status(500).redirect('/login');
    }
});

// Rutas de notificaciones
router.get('/api/asesor/notificaciones-resumen', requireAuth, requireAsesor, asesorController.getNotificationSummary); // Necesitarías crear esta función en el controlador
router.get('/asesor/notificaciones', requireAuth, requireAsesor, asesorController.getFullNotificationsPage); // Necesitarías crear esta función en el controlador
router.post('/asesor/notificaciones/marcar-leida', requireAuth, requireAsesor, asesorController.markNotificationAsRead); // Necesitarías crear esta función en el controlador


router.get('/homecliente', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }

    const userId = req.session.userId;

    try {
        const clienteDoc = await db.collection('clientes').doc(userId).get();
        let clienteData = {};
        let tieneAsesorAsignado = false;
        let asesorAsignadoData = null; // <-- Nueva variable para los datos del asesor

        if (clienteDoc.exists) {
            clienteData = clienteDoc.data();
            if (clienteData.asesorAsignado && clienteData.asesorAsignado !== '') {
                tieneAsesorAsignado = true;

                // Si tiene asesor, busca los datos del asesor
                const asesorDoc = await db.collection('asesores').doc(clienteData.asesorAsignado).get();
                if (asesorDoc.exists) {
                    asesorAsignadoData = {
                        uid: asesorDoc.id, // Es útil tener el UID en el frontend
                        nombre: asesorDoc.data().nombre || '',
                        apellido: asesorDoc.data().apellido || '',
                        email: asesorDoc.data().email || '',
                        telefono: asesorDoc.data().telefono || '',
                        especialidad: asesorDoc.data().especialidad || 'No especificada',
                        // Agrega otros campos que quieras mostrar en el modal
                    };
                }
            }
        } else {
            req.flash('error_msg', 'Tu perfil de cliente no se encontró. Por favor, completa tu registro.');
            return res.redirect('/login');
        }

        res.render('cliente/homecliente', {
            user: clienteData,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            tieneAsesorAsignado: tieneAsesorAsignado,
            asesorAsignado: asesorAsignadoData // <-- ¡Pasamos los datos del asesor a la vista!
        });

    } catch (error) {
        console.error('Error al cargar homecliente:', error);
        req.flash('error_msg', 'Error al cargar tu página de inicio.');
        res.redirect('/login');
    }
});

router.post('/api/cliente/despedir-asesor', requireAuth, async (req, res) => {
    // Asegúrate de que solo los clientes autenticados puedan usar esto
    if (req.session.userType !== 'client' || !req.session.userId) {
        console.log('Despedir Asesor: Acceso denegado - userType:', req.session.userType, 'userId:', req.session.userId);
        return res.status(403).json({ message: 'Acceso denegado.' });
    }

    const clienteUid = req.session.userId;
    console.log('Despedir Asesor: Intentando desvincular asesor para cliente UID:', clienteUid);

    try {
        if (!db) { // Verificación adicional para 'db'
            console.error('Firestore DB object is not initialized!');
            return res.status(500).json({ message: 'Error interno del servidor: Base de datos no disponible.' });
        }

        await db.collection('clientes').doc(clienteUid).update({
            asesorAsignado: '' 
        });

        console.log('Despedir Asesor: Asesor desvinculado exitosamente para UID:', clienteUid);
        res.status(200).json({ message: 'Has desvinculado a tu asesor exitosamente.' });
    } catch (error) {
        console.error('Error al desvincular asesor del cliente:', error);
        res.status(500).json({ message: 'Error interno del servidor al desvincular al asesor.' });
    }
});



router.get('/homeasesor', requireAuth, async (req, res) => {
    // Verifica si el userType en sesión es 'asesor'.
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : [];
    const userRole = adminEmails.includes(req.userEmail) ? 'admin' : 'asesor'; // Esto asigna 'admin' si el email coincide
    const userId = req.session.userId; // Obtén el ID del usuario de la sesión

    try {
        const userDoc = await db.collection('asesores').doc(userId).get();
        if (!userDoc.exists) {
            req.flash('error_msg', 'Tu perfil de asesor no se encontró. Por favor, completa tu registro.');
            return res.redirect('/login');
        }
        const asesorData = userDoc.data();
        const unreadNotifications = (asesorData.notifications || []).filter(n => !n.read).length;

        res.render('asesor/homeasesor', {
            user: asesorData, // Pasa los datos del asesor
            userRole: userRole, // Pasa el rol (admin/asesor)
            currentPage: 'home',
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            unreadNotifications: unreadNotifications
        });
    } catch (error) {
        console.error('Error al cargar homeasesor:', error);
        req.flash('error_msg', 'Error al cargar tu página de inicio.');
        res.redirect('/login');
    }
});


// Rutas de Perfil
router.get('/perfilcliente', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    clienteController.mostrarPerfilCliente(req, res); // Llama al controlador
});

router.get('/perfilasesor', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    asesorController.mostrarPerfilAsesor(req, res); // Llama al controlador
});

// Rutas de Edición de Perfil
router.post('/perfil/editar-info-personal', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') { // Asumiendo que esta ruta es solo para clientes
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    editProfileController.postEditPersonalAndContactInfo(req, res); // Llama al controlador
});


// Editar información personal del cliente
router.post('/cliente/editar-info-personal', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    clienteController.editarInfoPersonalCliente(req, res);
});

// Editar información financiera del cliente
router.post('/cliente/editar-info-financiera', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    clienteController.editarInfoFinancieraCliente(req, res);
});

// Subir foto de perfil (general, usada por ambos roles)
router.post('/upload-profile-photo', requireAuth, upload.single('profilePhoto'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No se subió ningún archivo.' });
        }

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
            body: JSON.stringify({
                image: imageBase64,
                type: 'base64',
                title: `Foto de perfil de usuario ${req.session.userId || 'desconocido'}`,
                description: `Subida desde AI Finance Solutions el ${new Date().toISOString()}`
            })
        });

        const imgurData = await imgurResponse.json();

        if (!imgurResponse.ok || imgurData.status !== 200 || !imgurData.success) {
            console.error('Error al subir a Imgur:', imgurData);
            const errorMessage = imgurData.data && typeof imgurData.data === 'object' && imgurData.data.error
                                            ? imgurData.data.error
                                            : 'Error desconocido al subir la imagen a Imgur.';
            return res.status(imgurResponse.status || 500).json({
                success: false,
                message: errorMessage
            });
        }

        const imageUrl = imgurData.data.link;
        console.log('Imagen subida a Imgur:', imageUrl);

        const userId = req.session.userId;
        const userType = req.session.userType; // Obtener el tipo de usuario de la sesión

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no autenticado o ID de sesión no disponible.' });
        }

        // Determinar en qué colección guardar la URL de la foto
        let collectionRef;
        if (userType === 'asesor') {
            collectionRef = db.collection('asesores').doc(userId);
        } else if (userType === 'client') { // Esto es para clientes
            collectionRef = db.collection('clientes').doc(userId);
        } else {
            return res.status(400).json({ success: false, message: 'Tipo de usuario no reconocido para la subida de foto.' });
        }

        await collectionRef.update({
            fotoPerfilUrl: imageUrl
        });
        console.log(`URL de foto de perfil actualizada en Firestore para el ${userType} ${userId}: ${imageUrl}`);

        return res.json({
            success: true,
            message: 'Foto de perfil subida y actualizada correctamente.',
            imageUrl: imageUrl
        });

    } catch (error) {
        console.error('Error en el endpoint /upload-profile-photo:', error);
        if (error instanceof multer.MulterError) {
            return res.status(400).json({ success: false, message: `Error en la subida: ${error.message}` });
        }
        return res.status(500).json({ success: false, message: 'Error interno del servidor al procesar la imagen.' });
    }
});


// Rutas de cambio de contraseña para Asesor
router.get('/cambiar-password', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    asesorController.getChangePasswordPage(req, res);
});
router.post('/cambiar-password', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para asesores.' });
    }
    asesorController.changePassword(req, res);
});

// Rutas para cambiar contraseña del cliente
router.get('/cliente/cambiar_password', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    clienteController.getChangePasswordPageCliente(req, res);
});
router.post('/cliente/cambiar_password', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    clienteController.changePasswordCliente(req, res);
});


router.get('/consulta', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/consulta');
});

router.get('/consultacliente', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    return res.render('cliente/consultacliente');
});

router.get('/formulariocliente', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    return res.render('cliente/formulariocliente');
});


router.get('/asesor/verificar_identidad', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    asesorController.getVerificationPageAsesor(req, res);
});
router.post('/asesor/verificar_identidad', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para asesores.' });
    }
    asesorController.postVerifyIdentityAsesor(req, res);
});

// Rutas para las herramientas de análisis financiero (solo asesores)
router.get('/herramientas-analisis', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/herramientas_analisis');
});

router.get('/herramientas-analisis/calculadora-presupuesto', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/calculadora_presupuesto');
});

router.get('/herramientas-analisis/analisis-inversiones', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/analisis_inversiones');
});

router.get('/herramientas-analisis/riesgos-mercado', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/riesgos_mercado');
});

router.get('/herramientas-analisis/planificacion-fiscal', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/planificacion_fiscal');
});

router.get('/herramientas-analisis/proyecciones-financieras', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/proyecciones_financieras');
});

router.get('/herramientas-analisis/valoracion-empresas', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/valoracion_empresas');
});

router.get('/clientes-asignados', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    asesorController.mostrarClientesAsignados(req, res);
});

router.get('/clientes/:id_cliente/perfil', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    clienteController.mostrarPerfilClienteAsesor(req, res);
});

router.get('/programar-consulta', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    asesorController.getProgramarConsultaPage(req, res);
});

router.get('/chat-personal', requireAuth, clienteController.mostrarChatPersonalCliente);


router.get('/chat_personal', requireAuth, async (req, res) => {
    // Si el usuario no es ni cliente ni asesor, redirigir
    if (req.session.userType !== 'client' && req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes o asesores.');
        return res.redirect('/dashboard'); // O a otra página adecuada
    }

    const userId = req.session.userId;
    let userName = req.session.userName || req.userEmail;
    let userType = req.session.userType;

    // Aunque ya se intentó en login, asegurar que el nombre y tipo estén actualizados si no lo están
    if (!userName || !userType || userType === 'unregistered') {
        try {
            const clienteDoc = await db.collection('clientes').doc(userId).get();
            const asesorDoc = await db.collection('asesores').doc(userId).get();

            if (clienteDoc.exists) {
                userName = clienteDoc.data().nombre || userName;
                userType = 'client';
                req.session.userName = userName;
                req.session.userType = userType;
            } else if (asesorDoc.exists) {
                userName = asesorDoc.data().nombre || userName;
                userType = 'asesor';
                req.session.userName = userName;
                req.session.userType = userType;
            }
        } catch (error) {
            console.error('Error al obtener el nombre/tipo de usuario para el chat:', error);
            // Continúa con los datos disponibles, pero con un log de error.
        }
    }

    res.render('asesor/chat_personal', { // Asumiendo que chat_personal es una vista genérica de chat
        userId: userId,
        userName: userName,
        userType: userType
    });
});



router.get('/contacto-asesor', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    try {
        const asesoresRef = db.collection('asesores');
        const snapshot = await asesoresRef
            .where('verification.status', '==', 'verificado')
            .where('verificacion.titulo.estado', '==', 'verificado')
            .get();

        const asesoresDisponibles = [];
        snapshot.forEach(doc => {
            const asesor = doc.data();
            asesor._id = doc.id;
            asesoresDisponibles.push(asesor);
        });

        res.render('cliente/asesores-disponibles', {
            asesores: asesoresDisponibles,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });
    } catch (error) {
        console.error('Error al obtener asesores disponibles:', error);
        req.flash('error_msg', 'Error al cargar los asesores disponibles.');
        res.redirect('/homecliente');
    }
});

router.get('/api/asesor/:id', requireAuth, async (req, res) => {
    // Esta ruta puede ser accedida tanto por clientes como por asesores
    // para ver detalles de otros asesores si es necesario.
    try {
        const asesorId = req.params.id;
        const asesorDoc = await db.collection('asesores').doc(asesorId).get();

        if (!asesorDoc.exists) {
            return res.status(404).json({ success: false, message: 'Asesor no encontrado.' });
        }

        const asesorData = asesorDoc.data();
        // Filtrar datos sensibles si es necesario antes de enviar al frontend
        const publicAsesorData = {
            _id: asesorDoc.id,
            nombre: asesorData.nombre,
            apellido: asesorData.apellido,
            email: asesorData.email,
            telefono: asesorData.telefono,
            especialidad: asesorData.especialidad,
            fotoPerfilUrl: asesorData.fotoPerfilUrl,
            descripcion: asesorData.descripcion || 'Asesor financiero experimentado.'
        };

        res.json(publicAsesorData);
    } catch (error) {
        console.error('Error al obtener detalles del asesor:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener detalles del asesor.' });
    }
});


// Ruta para la página de chat personal del cliente
router.get('/chat-personal', requireAuth, clienteController.mostrarChatPersonalCliente);

// API para que el frontend del cliente obtenga los mensajes de su chat con el asesor
router.get('/cliente/api/chat/:asesorId', requireAuth, clienteController.getClienteChatMessages);

// API para que el frontend del cliente envíe mensajes a su asesor
router.post('/cliente/api/send-message', requireAuth,clienteController.clienteSendMessage);

// Ruta para asignar un asesor a un cliente
// Ruta para asignar un asesor a un cliente
router.post('/cliente/asignar-asesor', requireAuth, async (req, res) => {
    // Verificación manual de tipo de usuario
    if (req.session.userType !== 'client') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Debes ser cliente.', redirectTo: '/dashboard' });
    }

    const clienteId = req.session.userId;
    const { asesorId } = req.body;

    if (!asesorId) {
        return res.status(400).json({ success: false, message: 'ID de asesor no proporcionado.' });
    }

    try {
        const clienteRef = db.collection('clientes').doc(clienteId);
        const asesorRef = db.collection('asesores').doc(asesorId);

        const [clienteDoc, asesorDoc] = await Promise.all([
            clienteRef.get(),
            asesorRef.get()
        ]);

        if (!clienteDoc.exists) {
            return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
        }
        if (!asesorDoc.exists) {
            return res.status(404).json({ success: false, message: 'Asesor no encontrado.' });
        }

        const asesorData = asesorDoc.data();
        // Asegurarse de que el asesor esté verificado antes de la asignación
        if (asesorData.verification?.status !== 'verificado' || asesorData.verificacion?.titulo?.estado !== 'verificado') {
            return res.status(400).json({ success: false, message: 'El asesor seleccionado aún no ha sido verificado completamente.' });
        }

        // Asignar el asesor al cliente
        await clienteRef.update({

            asesorAsignado: asesorId // Guarda solo la ID del asesor como una cadena de texto
        
        });

        // Actualizar el documento del asesor para añadir este cliente a su lista de clientes asignados
        await asesorRef.update({
            clientesAsignados: admin.firestore.FieldValue.arrayUnion(clienteId)
        });

        // Añadir notificación al asesor
        const clienteData = clienteDoc.data();
        const notificationMessage = `¡Tienes un nuevo cliente! ${clienteData.nombre} ${clienteData.apellido} te ha seleccionado como su asesor.`;
        // Asegúrate de que addNotificationToUser esté correctamente definida y accesible.
        await addNotificationToUser(asesorId, notificationMessage, `/asesor/clientes/${clienteId}/perfil`);


     
        return res.json({
            success: true,
            message: 'Asesor asignado correctamente. Redirigiendo al chat...',
            redirectTo: '/chat-personal'
        });

    } catch (error) {
        console.error('Error al asignar asesor a cliente:', error);
        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor al asignar el asesor.',
            redirectTo: '/cliente/asesores-disponibles'
        });
    }
});





router.get('/admin/verificaciones_pendientes', requireAuth, isAdmin, async (req, res) => {

    try {
        const asesoresRef = db.collection('asesores');
        const asesoresPendientes = [];

        const snapshot = await asesoresRef.get();

        snapshot.forEach(doc => {
            const asesor = doc.data();
            asesor._id = doc.id;

            const kycPending = asesor.verification && asesor.verification.status === 'pendiente';
            const tituloPending = asesor.verificacion && asesor.verificacion.titulo && asesor.verificacion.titulo.estado === 'pendiente';
            const certificacionPending = asesor.verificacion && asesor.verificacion.certificacion && asesor.verificacion.certificacion.estado === 'pendiente';

            if (kycPending || tituloPending || certificacionPending) {
                asesoresPendientes.push(asesor);
            }
        });

        res.render('admin/verificaciones_pendientes', { asesoresPendientes: asesoresPendientes });
    } catch (error) {
        console.error('Error al cargar verificaciones pendientes (Firestore):', error);
        res.status(500).send('Error interno del servidor al cargar verificaciones.');
    }
});


router.post('/admin/verificar-documento', requireAuth, isAdmin, async (req, res) => {
    const { asesorId, type, action } = req.body;

    if (!asesorId || !type || !action) {
        return res.status(400).json({ success: false, message: 'Datos incompletos para la verificación.' });
    }

    try {
        const asesorRef = db.collection('asesores').doc(asesorId);
        const asesorDoc = await asesorRef.get();

        if (!asesorDoc.exists) {
            return res.status(404).json({ success: false, message: 'Asesor no encontrado.' });
        }

        const updateData = {};
        let statusPath;
        let notesPath;
        let notificationMessage = '';
        let notificationLink = '/perfilasesor';

        switch (type) {
            case 'kyc':
                statusPath = 'verification.status';
                notesPath = 'verification.notes';
                notificationMessage = `Tu verificación de **Identificación (KYC)** ha sido **${action === 'verificar' ? 'aprobada' : 'rechazada'}**.`;
                break;
            case 'titulo':
                statusPath = 'verificacion.titulo.estado';
                notesPath = 'verificacion.titulo.observaciones';
                notificationMessage = `Tu **Título Profesional** ha sido **${action === 'verificar' ? 'aprobado' : 'rechazada'}**.`;
                break;
            case 'certificacion':
                statusPath = 'verificacion.certificacion.estado';
                notesPath = 'verificacion.certificacion.observaciones';
                notificationMessage = `Tu **Certificación Profesional** ha sido **${action === 'verificar' ? 'aprobada' : 'rechazada'}**.`;
                break;
            default:
                return res.status(400).json({ success: false, message: 'Tipo de verificación inválido.' });
        }

        if (action === 'verificar') {
            updateData[statusPath] = 'verificado';
            updateData[notesPath] = null;
            notificationMessage += " ¡Felicidades! Ya puedes acceder a todas las funcionalidades.";
        } else if (action === 'rechazar') {
            const predefinedRejectionMessage = `Tu documento fue rechazado. Esto puede deberse a: documento ilegible, información incompleta, documento expirado o no válido, datos no coincidentes, formato incorrecto, o foto no clara. Por favor, revisa tu documento y vuelve a subirlo.`;

            updateData[statusPath] = 'rechazado';
            updateData[notesPath] = predefinedRejectionMessage;
            notificationMessage = `Tu documento fue rechazado. Motivo: ${predefinedRejectionMessage}`;

        } else {
            return res.status(400).json({ success: false, message: 'Acción inválida.' });
        }

        await asesorRef.update(updateData);

        // addNotificationToUser debe ser una función accesible, ya la tienes definida arriba
        await addNotificationToUser(asesorId, notificationMessage, notificationLink);

        res.json({ success: true, message: `Verificación de ${type} actualizada a ${updateData[statusPath]}.` });

    } catch (error) {
        console.error('Error al actualizar la verificación del documento (Firestore):', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al procesar la verificación.' });
    }
});

router.get('/api/cliente/:id', requireAuth, clienteController.getClienteByIdAPI);

// Ruta para la página de notificaciones del asesor
// Requiere autenticación (requireAuth) Y que el usuario autenticado sea un asesor

// Ruta para la página general del chat del asesor (con barra lateral)
router.get('/asesor/chat-general', requireAuth, asesorController.mostrarChatGeneralAsesor);

// API para que el frontend del asesor obtenga los mensajes de un chat específico
router.get('/asesor/api/chat/:clienteId', requireAuth, asesorController.getClienteChatMessages);

// API para que el frontend del asesor envíe mensajes
router.post('/asesor/api/send-message', requireAuth, asesorController.asesorSendMessage);

// NUEVA API: Ruta para que el frontend del asesor actualice la barra lateral (último mensaje y no leídos)
router.get('/asesor/api/clientes-chat-sidebar', requireAuth, async (req, res) => {
    try {
        const asesorUid = req.session.userId;
        const asesorDoc = await db.collection('asesores').doc(asesorUid).get();
        if (!asesorDoc.exists) {
            return res.status(404).json({ success: false, message: 'Asesor no encontrado.' });
        }
        const asesorData = asesorDoc.data();
        const clientesAsignadosIds = asesorData.clientesAsignados || [];

        let clientesActualizados = [];
        for (const clienteId of clientesAsignadosIds) {
            const clienteDoc = await db.collection('clientes').doc(clienteId).get();
            if (clienteDoc.exists) {
                const clienteData = clienteDoc.data();
                const roomId = [asesorUid, clienteId].sort().join('_');
                const chatDoc = await db.collection('chats').doc(`chat_${roomId}`).get(); // Prepend "chat_"

                let lastMessage = '';
                let unreadCount = 0;
                if (chatDoc.exists) {
                    const chatData = chatDoc.data();
                    lastMessage = chatData.lastMessageText || '';
                    unreadCount = chatData.asesorUnreadCount || 0;
                }

                clientesActualizados.push({
                    id: clienteId,
                    nombre: clienteData.nombre,
                    apellido: clienteData.apellido,
                    fotoPerfilUrl: clienteData.fotoPerfilUrl || '/images/default-profile.png',
                    lastMessage: lastMessage,
                    unreadCount: unreadCount
                });
            }
        }
        res.json({ success: true, clientes: clientesActualizados });

    } catch (error) {
        console.error('Error al obtener datos de clientes para la sidebar:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar clientes de la sidebar.' });
    }
});
router.get('/clientes-asignados', requireAuth, asesorController.mostrarClientesAsignados);

router.get('/asesor/calendario', requireAuth, asesorController.mostrarCalendario);

router.get('/asesor/api/eventos', requireAuth, asesorController.getEventosAPI); 
router.post('/asesor/api/eventos', requireAuth, asesorController.crearEventoAPI); 
router.put('/asesor/api/eventos/:id', requireAuth, asesorController.editarEventoAPI); 
router.delete('/asesor/api/eventos/:id', requireAuth, asesorController.eliminarEventoAPI); 

router.get('/inversiones', requireAuth, async (req, res) => {
    const news = [
        {
            id: 1,
            title: 'Últimas Novedades en Inteligencia Artificial y su Impacto Financiero',
            // URL de una imagen genérica pero relevante para IA
            imageUrl: '/images/anuncio1.jpg', 
            description: 'Explora cómo los avances en IA están remodelando los mercados financieros y creando nuevas oportunidades de inversión.',
            link: 'https://www.technologyreview.com/topic/ai/'
        },
        {
            id: 2,
            title: 'Guía Completa de Inversiones en Energías Renovables para 2025',
            // URL de una imagen genérica pero relevante para energías renovables
            imageUrl: '/images/anuncio2.jpg', 
            description: 'Descubre los sectores más prometedores dentro de la energía limpia y cómo puedes participar en este crecimiento sostenible.',
            link: 'https://www.bloomberg.com/green'
        },
        {
            id: 3,
            title: 'Emprendimientos Fintech que Están Transformando el Sistema Bancario',
            // URL de una imagen genérica pero relevante para Fintech
            imageUrl: '/images/anuncio3.jpg', 
            description: 'Conoce las startups que están innovando en pagos digitales, préstamos y gestión de patrimonio con soluciones tecnológicas.',
            link: 'https://techcrunch.com/category/fintech/'
        },
        {
            id: 4,
            title: 'Innovación Biotecnológica: Oportunidades de Inversión en Salud y Ciencia',
            // URL de una imagen genérica pero relevante para Biotecnología
            imageUrl: '/images/anuncio4.jpg', 
            description: 'Un vistazo a las empresas de biotecnología que están desarrollando soluciones revolucionarias y captando la atención de inversores.',
            link: 'https://www.fiercebiotech.com/'
        }
    ];
    res.render('cliente/inversiones', { news: news });
});


// --- Ruta para la página del Calendario del Cliente ---
router.get('/cliente/calendario', requireAuth, clienteController.mostrarCalendarioCliente);

// --- Rutas API para los Eventos del Cliente ---
router.get('/cliente/api/eventos', requireAuth, clienteController.getEventosClienteAPI);
router.post('/cliente/api/eventos', requireAuth, clienteController.crearEventoClienteAPI);
router.put('/cliente/api/eventos/:id', requireAuth, clienteController.editarEventoClienteAPI);
router.delete('/cliente/api/eventos/:id', requireAuth, clienteController.eliminarEventoClienteAPI);



router.get('/objetivos-financieros', requireAuth, clienteController.mostrarObjetivosFinancieros);

// Rutas API para la gestión de objetivos financieros
router.get('/cliente/api/objetivos', requireAuth, clienteController.getObjetivosClienteAPI); 
router.get('/cliente/api/objetivos/:id', requireAuth, clienteController.getObjetivoByIdClienteAPI); 
router.post('/cliente/api/objetivos', requireAuth, clienteController.crearObjetivoClienteAPI); 
router.put('/cliente/api/objetivos/:id', requireAuth, clienteController.editarObjetivoClienteAPI); 
router.delete('/cliente/api/objetivos/:id', requireAuth, clienteController.eliminarObjetivoClienteAPI); 


module.exports = router;