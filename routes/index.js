var express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const requireAuth = require('../config/middleware'); 
const admin = require('./firebase'); 
const clienteController = require('./controllers/clienteController');
const asesorController = require('./controllers/asesorController');
const editProfileController = require('./controllers/editProfileController'); 

const db = admin.firestore(); 
const auth = admin.auth();   

var router = express.Router();

// Obtén el Client ID de Imgur
const imgurClientId = process.env.IMGUR_CLIENT_ID;

// Configuración de Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
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

// --- RUTAS DE UPLOAD DE FOTOS ---
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

        res.json({
            success: true,
            message: 'Foto de perfil subida y actualizada correctamente.',
            imageUrl: imageUrl
        });

    } catch (error) {
        console.error('Error en el endpoint /upload-profile-photo:', error);
        if (error instanceof multer.MulterError) {
            return res.status(400).json({ success: false, message: `Error en la subida: ${error.message}` });
        }
        res.status(500).json({ success: false, message: 'Error interno del servidor al procesar la imagen.' });
    }
});

// --- RUTAS DE PERFIL ---
router.get('/perfilcliente', requireAuth, clienteController.mostrarPerfil);
router.get('/perfilasesor', requireAuth, asesorController.mostrarPerfilAsesor);

// --- RUTAS DE HOME ---
router.get('/homecliente', requireAuth, (req, res) => {
    res.render('cliente/homecliente');
});
router.get('/homeasesor', requireAuth, (req, res) => {
    res.render('asesor/homeasesor');
});

// --- RUTAS DE ACCESO ---
router.get('/', (req, res) => {
  res.render('welcome')
})
router.get('/login', (req, res) => {
    res.render('ingreso/login');
});
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
  if (err) {
  console.error('Error al destruir la sesión:', err);
  return res.status(500).send('Error al cerrar sesión.');
  }
  res.redirect('/login');
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
        return res.redirect('/dashboard');
    } catch (error) {
        console.error('Error general en la ruta /login:', error);
        return res.status(500).render('ingreso/login', { error: 'Error interno del servidor. Inténtalo más tarde.' });
    }
});

router.get('/registro', (req, res) => {
    res.render('ingreso/registro');
});
router.post('/registro', async (req, res) => {
    const { nombre, apellido, email, contrasena, confirmar_contrasena } = req.body;
    const auth = admin.auth();
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
    res.render('ingreso/registrocliente');
});
router.get('/registro-perfil/asesor', requireAuth, (req, res) => {
    res.render('ingreso/registroasesor');
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
            res.redirect('/homecliente');
        } else if (tipo_usuario === 'asesor') {
            await db.collection('asesores').doc(userId).set(datosAGuardar);
            console.log(`Perfil de asesor registrado para el usuario: ${userId}`, datosAGuardar);
            delete req.session.userCreationTime;
            res.redirect('/homeasesor');
        } else {
            console.error('Tipo de usuario no válido:', tipo_usuario);
            res.status(400).send('Tipo de usuario no válido.');
        }
    } catch (error) {
        console.error('Error al registrar el perfil:', error);
        res.status(500).send('Error al registrar el perfil.');
    }
});

// --- RUTA DASHBOARD ---
router.get('/dashboard', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    try {
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
        console.error('Error al verificar el perfil del usuario:', error);
        res.status(500).send('Error al verificar el perfil del usuario.');
    }
});



// --- RUTAS DE CAMBIO DE CONTRASEÑA ---
// GET para mostrar el formulario de cambio de contraseña
router.get('/cambiar-password', requireAuth, asesorController.getChangePasswordPage);

// POST para manejar el cambio de contraseña
router.post('/cambiar-password', requireAuth, asesorController.changePassword);

// --- OTRAS RUTAS ---
router.get('/consulta', (req, res) => {
  res.render('asesor/consulta')
})
router.get('/consultacliente', (req, res) => {
  res.render('cliente/consultacliente')
})
router.get('/formulariocliente', (req, res) => {
  res.render('cliente/formulariocliente')
})
router.post('/perfil/editar-info-personal', requireAuth, editProfileController.postEditPersonalAndContactInfo);


module.exports = router;