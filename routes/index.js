require('dotenv').config();
var express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const cors = require('cors');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

const requireAuth = require('../config/middleware');
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

// --- Función auxiliar para añadir notificación ---
async function addNotificationToUser(userId, message, link = '#') {
    try {
        const asesorRef = db.collection('asesores').doc(userId);
        const notification = {
            id: uuidv4(),
            timestamp: new Date(), // Fecha actual del servidor de Node.js
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

// --- RUTAS DE UPLOAD DE FOTO DE PERFIL ---
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
                title: `Foto de perfil de asesor ${req.session.userId || 'desconocido'}`,
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

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no autenticado o ID de sesión no disponible.' });
        }

        await db.collection('asesores').doc(userId).update({
            fotoPerfilUrl: imageUrl
        });
        console.log(`URL de foto de perfil actualizada en Firestore para el asesor ${userId}: ${imageUrl}`);

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

// --- RUTAS DE PERFIL ---
router.get('/perfilcliente', requireAuth, clienteController.mostrarPerfilCliente);
router.get('/perfilasesor', requireAuth, asesorController.mostrarPerfilAsesor);

// --- RUTAS DE HOME ---
router.get('/homecliente', requireAuth, (req, res) => {
    return res.render('cliente/homecliente');
});
router.get('/homeasesor', requireAuth, async (req, res) => {
    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : [];
    const userRole = adminEmails.includes(req.userEmail) ? 'admin' : 'asesor';

    return res.render('asesor/homeasesor', { userRole: userRole, currentPage: 'home' });
});

// --- RUTAS DE ACCESO ---
router.get('/', (req, res) => {
    return res.render('welcome');
});
router.get('/login', (req, res) => {
    return res.render('ingreso/login');
});
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error al destruir la sesión:', err);
            return res.status(500).send('Error al cerrar sesión.');
        }
        return res.redirect('/login');
    });
});
router.post('/login', async (req, res) => {
    const { email, contrasena } = req.body;
    if (!email || !contrasena) {
        return res.render('ingreso/login', { error: 'Por favor, introduce correo electrónico y contraseña.' });
    }
    try {
        const apiKey = process.env.FIREBASE_API_KEY;
        if (!apiKey) {
            console.error('ERROR: FIREBASE_API_KEY no está configurado en las variables de entorno.');
            return res.status(500).render('ingreso/login', { error: 'Error de configuración del servidor. Contacta al administrador.' });
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
            return res.render('ingreso/login', { error: errorMessage });
        }
        const idToken = firebaseResponse.idToken;
        const uid = firebaseResponse.localId;
        console.log('Usuario autenticado con éxito en Firebase (REST API). UID:', uid);
        req.session.userId = uid;
        req.userEmail = email; 
        return res.redirect('/dashboard');
    } catch (error) {
        console.error('Error general en la ruta /login:', error);
        return res.status(500).render('ingreso/login', { error: 'Error interno del servidor. Inténtalo más tarde.' });
    }
});

router.get('/registro', (req, res) => {
    return res.render('ingreso/registro');
});
router.post('/registro', async (req, res) => {
    const { nombre, apellido, email, contrasena, confirmar_contrasena } = req.body;
    if (contrasena !== confirmar_contrasena) {
        return res.render('ingreso/registro', { error: 'Las contraseñas no coinciden.', formData: req.body });
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
        return res.redirect('/dashboard');
    } catch (error) {
        console.error('Error al registrar usuario:', error);
        let errorMessage = 'Error al registrar usuario. Por favor, inténtalo de nuevo.';
        if (error?.errorInfo?.code === 'auth/email-already-exists') {
            errorMessage = 'Este correo electrónico ya está en uso.';
        } else if (error?.errorInfo?.code === 'auth/invalid-email') {
            errorMessage = 'El correo electrónico no es válido.';
        } else if (error?.errorInfo?.code === 'auth/invalid-password') {
            errorMessage = 'La contraseña debe tener al menos 6 caracteres.';
        }
        return res.render('ingreso/registro', { error: errorMessage, formData: req.body });
    }
});

// --- RUTAS DE REGISTRO DE PERFIL ---
router.get('/registro-perfil/cliente', requireAuth, (req, res) => {
    return res.render('ingreso/registrocliente');
});
router.get('/registro-perfil/asesor', requireAuth, (req, res) => {
    return res.render('ingreso/registroasesor');
});
router.post('/registro-perfil', requireAuth, async (req, res) => {
    const { tipo_usuario, ...formData } = req.body;
    const userId = req.session.userId;
    const userCreationTime = req.session.userCreationTime;
    if (!userId || !userCreationTime) {
        console.error('ID de usuario o fecha de creación no encontrada en la sesión durante registro-perfil.');
        return res.status(401).send('Sesión inválida o datos de registro incompletos. Por favor, regístrate de nuevo.');
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
            return res.redirect('/homecliente');
        } else if (tipo_usuario === 'asesor') {
            await db.collection('asesores').doc(userId).set(datosAGuardar);
            console.log(`Perfil de asesor registrado para el usuario: ${userId}`, datosAGuardar);
            delete req.session.userCreationTime;
            return res.redirect('/homeasesor');
        } else {
            console.error('Tipo de usuario no válido:', tipo_usuario);
            return res.status(400).send('Tipo de usuario no válido.');
        }
    } catch (error) {
        console.error('Error al registrar el perfil:', error);
        return res.status(500).send('Error al registrar el perfil.');
    }
});

// --- RUTA DASHBOARD ---
router.get('/dashboard', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    const userEmail = req.userEmail; 

    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : [];

    try {
        if (adminEmails.includes(userEmail)) {
            console.log(`Usuario ${userEmail} es administrador. Redirigiendo a /admin/verificaciones_pendientes.`);
            return res.redirect('/admin/verificaciones_pendientes');
        }

        const clienteDoc = await db.collection('clientes').doc(userId).get();
        const asesorDoc = await db.collection('asesores').doc(userId).get();

        if (!clienteDoc.exists && !asesorDoc.exists) {
            return res.render('ingreso/seleccionar_tipo_usuario');
        } else if (clienteDoc.exists) {
            return res.redirect('/homecliente');
        } else if (asesorDoc.exists) {
            return res.redirect('/homeasesor');
        } else {
            console.error('Estado de perfil inconsistente para el usuario:', userId);
            return res.status(500).send('Error en el estado del perfil del usuario.');
        }
    } catch (error) {
        console.error('Error al verificar el perfil del usuario en /dashboard:', error);
        return res.status(500).send('Error al verificar el perfil del usuario.');
    }
});

// --- RUTAS DE CAMBIO DE CONTRASEÑA (Existentes) ---
router.get('/cambiar-password', requireAuth, asesorController.getChangePasswordPage); 
router.post('/cambiar-password', requireAuth, asesorController.changePassword); 

router.get('/consulta', (req, res) => {
    return res.render('asesor/consulta');
});

// --- Rutas de Verificación de Identidad para Asesor (MODIFICADA para URLs) ---
router.get('/asesor/verificar_identidad', requireAuth, asesorController.getVerificationPageAsesor);
router.post('/asesor/verificar_identidad', requireAuth, asesorController.postVerifyIdentityAsesor);

//Rutas de cliente
router.get('/consultacliente', (req, res) => {
    return res.render('cliente/consultacliente');
});
router.get('/formulariocliente', (req, res) => {
    return res.render('cliente/formulariocliente');
});
router.post('/perfil/editar-info-personal', requireAuth, editProfileController.postEditPersonalAndContactInfo);

// Editar información personal del cliente
router.post('/cliente/editar-info-personal', requireAuth, clienteController.editarInfoPersonalCliente);

// Editar información financiera del cliente
router.post('/cliente/editar-info-financiera', requireAuth, clienteController.editarInfoFinancieraCliente);

// Subir foto de perfil del cliente
router.post('/cliente/upload-profile-photo', requireAuth, upload.single('profilePhoto'), clienteController.uploadProfilePhotoCliente);

// Rutas para cambiar contraseña del cliente
router.get('/cliente/cambiar_password', requireAuth, clienteController.getChangePasswordPageCliente);
router.post('/cliente/cambiar_password', requireAuth, clienteController.changePasswordCliente);


// Ruta para mostrar la página de verificaciones pendientes (solo para admin)
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

// Ruta para procesar la aprobación o rechazo de documentos
router.post('/admin/verificar-documento', requireAuth, isAdmin, async (req, res) => {
    // Ya no esperamos selectedReason ni customNotes
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
                notificationMessage = `Tu **Título Profesional** ha sido **${action === 'verificar' ? 'aprobado' : 'rechazado'}**.`;
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
            // Mensaje de rechazo predefinido/genérico
            const predefinedRejectionMessage = `Tu documento fue rechazado. Esto puede deberse a: documento ilegible, información incompleta, documento expirado o no válido, datos no coincidentes, formato incorrecto, o foto no clara. Por favor, revisa tu documento y vuelve a subirlo.`;
            
            updateData[statusPath] = 'rechazado';
            updateData[notesPath] = predefinedRejectionMessage; // Guardar el mensaje genérico
            notificationMessage = `Tu documento fue rechazado. Motivo: ${predefinedRejectionMessage}`; // Usa el mismo mensaje para la notificación

        } else {
            return res.status(400).json({ success: false, message: 'Acción inválida.' });
        }

        await asesorRef.update(updateData);

        await addNotificationToUser(asesorId, notificationMessage, notificationLink);

        res.json({ success: true, message: `Verificación de ${type} actualizada a ${updateData[statusPath]}.` });

    } catch (error) {
        console.error('Error al actualizar la verificación del documento (Firestore):', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al procesar la verificación.' });
    }
});


// Ruta para la página de notificaciones del asesor
router.get('/asesor/notificaciones', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    try {
        const asesorDoc = await db.collection('asesores').doc(userId).get();
        if (!asesorDoc.exists) {
            return res.status(404).send('Perfil de asesor no encontrado.');
        }
        const asesorData = asesorDoc.data();
        const notifications = (asesorData.notifications || []).sort((a, b) => {
            const timeA = (b.timestamp instanceof admin.firestore.Timestamp) ? b.timestamp.toMillis() : new Date(b.timestamp).getTime();
            const timeB = (a.timestamp instanceof admin.firestore.Timestamp) ? a.timestamp.toMillis() : new Date(a.timestamp).getTime();
            return timeA - timeB; 
        });

        res.render('asesor/notificaciones', { notifications: notifications });
    } catch (error) {
        console.error('Error al cargar notificaciones del asesor:', error);
        res.status(500).send('Error interno del servidor al cargar notificaciones.');
    }
});

// Ruta para marcar notificaciones como leídas
router.post('/asesor/notificaciones/marcar-leida', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const { notificationId } = req.body;

    try {
        const asesorRef = db.collection('asesores').doc(userId);
        const asesorDoc = await asesorRef.get();
        if (!asesorDoc.exists) {
            return res.status(404).json({ success: false, message: 'Perfil de asesor no encontrado.' });
        }

        const notifications = asesorDoc.data().notifications || [];
        const updatedNotifications = notifications.map(notif => {
            if (notif.id === notificationId) {
                return { ...notif, read: true };
            }
            return notif;
        });

        await asesorRef.update({ notifications: updatedNotifications });
        res.json({ success: true, message: 'Notificación marcada como leída.' });

    } catch (error) {
        console.error('Error al marcar notificación como leída:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// Ruta API para obtener un resumen de notificaciones para la campana
router.get('/api/asesor/notificaciones-resumen', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    try {
        const asesorDoc = await db.collection('asesores').doc(userId).get();
        if (!asesorDoc.exists) {
            return res.status(404).json({ success: false, message: 'Perfil de asesor no encontrado.' });
        }
        const asesorData = asesorDoc.data();
        const notifications = asesorData.notifications || [];

        const unreadCount = notifications.filter(notif => !notif.read).length;
        const latestNotifications = notifications
                                        .sort((a, b) => {
                                            const timeA = (b.timestamp instanceof admin.firestore.Timestamp) ? b.timestamp.toMillis() : new Date(b.timestamp).getTime();
                                            const timeB = (a.timestamp instanceof admin.firestore.Timestamp) ? a.timestamp.toMillis() : new Date(a.timestamp).getTime();
                                            return timeA - timeB; 
                                        })
                                        .slice(0, 3); 

        res.json({ success: true, unreadCount: unreadCount, latestNotifications: latestNotifications });

    } catch (error) {
        console.error('Error al obtener resumen de notificaciones:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

module.exports = router;