var express = require('express');
const requireAuth = require('../config/middleware'); 
const session = require('express-session'); 
const { admin, db } = require('./firebase');
const clienteController = require('./controllers/clienteController');
const asesorController = require('./controllers/asesorController'); 
const editProfileController = require('./controllers/editProfileController');
const fetch = require('node-fetch'); 
require('dotenv').config(); 


// 2. OBTENER VARIABLES DE ENTORNO Y REALIZAR COMPROBACIONES
const JWT_SECRET = process.env.JWT_SECRET;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

// Comprobaciones de variables críticas
if (!JWT_SECRET) {
    console.error('Error: JWT_SECRET no está definido en las variables de entorno.');
    process.exit(1); // Sale de la aplicación si falta esta variable crítica
}
if (!FIREBASE_API_KEY) {
    console.error('Error: FIREBASE_API_KEY no está definido en las variables de entorno.');
    process.exit(1); // Sale de la aplicación si falta esta variable crítica
}


const auth = admin.auth(); 

var router = express.Router();




// Ruta para mostrar el perfil del cliente
router.get('/perfilcliente', requireAuth, clienteController.mostrarPerfil); 

// Ruta para mostrar el perfil del asesor
router.get('/perfilasesor', requireAuth, asesorController.mostrarPerfilAsesor);

// OBTENER RUTAS PRINCIPALES
router.get('/homecliente', requireAuth, (req, res) => {
    return res.render('cliente/homecliente'); 
});

router.get('/homeasesor', requireAuth, (req, res) => {
    return res.render('asesor/homeasesor'); 
});

//OBTENER RUTA PRINCIPAL (HOME)
router.get('/', (req, res) =>{
    return res.render('welcome'); 
});

//OBTENER RUTA LOGIN
router.get('/login', (req, res) => {
    return res.render('ingreso/login'); 
});

// Ruta para el logout
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error al destruir la sesión:', err);
            return res.status(500).send('Error al cerrar sesión.');
        }
        return res.redirect('/login');
    });
});

// Ruta POST para el inicio de sesión 
router.post('/login', async (req, res) => {
    const { email, contrasena } = req.body;

    if (!email || !contrasena) {
        return res.render('ingreso/login', { error: 'Por favor, introduce correo electrónico y contraseña.' });
    }

    try {
        // Usar FIREBASE_API_KEY (definida arriba globalmente en este archivo)
        if (!FIREBASE_API_KEY) { 
            console.error('ERROR: FIREBASE_API_KEY no está configurado en las variables de entorno.');
            return res.status(500).render('ingreso/login', { error: 'Error de configuración del servidor. Contacta al administrador.' });
        }

        const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

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

        const uid = firebaseResponse.localId;
        console.log('Usuario autenticado con éxito en Firebase (REST API). UID:', uid);
        req.session.userId = uid; 

        return res.redirect('/dashboard');

    } catch (error) {
        console.error('Error general en la ruta /login:', error);
        return res.status(500).render('ingreso/login', { error: 'Error interno del servidor. Inténtalo más tarde.' });
    }
});


// Ruta POST para guardar la información del perfil (del registro inicial)
router.post('/registro-perfil', requireAuth, async (req, res) => {
    const { tipo_usuario, ...formData } = req.body;
    const userId = req.session.userId;
    // Asegurarse de que userCreationTime se haya guardado en la sesión durante el registro inicial si se usa
    const userCreationTime = req.session.userCreationTime; 

    if (!userId) { // Se añadió verificación de userId
        console.error('ID de usuario no encontrado en la sesión durante registro-perfil.');
        return res.status(401).send('Sesión inválida. Por favor, regístrate de nuevo.');
    }

    try {
        const datosAGuardar = {
            ...formData,
            // Si userCreationTime se usó en el registro, inclúyelo aquí
            ...(userCreationTime && { fechaRegistro: new Date(userCreationTime) }) 
        };

        if (tipo_usuario === 'cliente') {
            await db.collection('clientes').doc(userId).set(datosAGuardar); // Usar datosAGuardar
            console.log(`Perfil de cliente registrado para el usuario: ${userId}`, datosAGuardar);
            delete req.session.userCreationTime; // Limpiar después de usar
            return res.redirect('/homecliente');
        } else if (tipo_usuario === 'asesor') {
            await db.collection('asesores').doc(userId).set(datosAGuardar); // Usar datosAGuardar
            console.log(`Perfil de asesor registrado para el usuario: ${userId}`, datosAGuardar);
            delete req.session.userCreationTime; // Limpiar después de usar
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


//OBTENER RUTA REGISTRO
router.get('/registro', (req, res) => {
    return res.render('ingreso/registro'); 
});


// Ruta POST para el registro
router.post('/registro', async (req, res) => {
    const { nombre, apellido, email, contrasena, confirmar_contrasena } = req.body;
    // const auth = admin.auth(); // 'auth' ya está definido globalmente arriba

    if (contrasena !== confirmar_contrasena) {
        return res.render('ingreso/registro', { error: 'Las contraseñas no coinciden.', formData: req.body });
    }

    try {
        const userRecord = await auth.createUser({ // Usar la variable 'auth' definida globalmente
            email: email,
            password: contrasena,
            displayName: `${nombre} ${apellido}`,
        });
        console.log('Usuario registrado:', userRecord.uid);
        
        // Guardar userId y userCreationTime en la sesión para el siguiente paso (registro-perfil)
        req.session.userId = userRecord.uid; 
        req.session.userCreationTime = userRecord.metadata.creationTime; // Guardar timestamp de creación

        // Redirigir a la página para seleccionar tipo de usuario / completar perfil
        return res.redirect('/registro-perfil/seleccionar'); // Una ruta que lleve a 'seleccionar_tipo_usuario'


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


//OBTENER RUTA CONSULTA
router.get('/consulta', (req, res) =>{
    return res.render('asesor/consulta');
});


//OBTENER RUTA CONSULTA CLIENTE
router.get('/consultacliente', (req, res)=> {
    return res.render('cliente/consultacliente');
});

//OBTENER RUTA FORMULARIO CLIENTE
router.get('/formulariocliente', (req, res) =>{
    return res.render('cliente/formulariocliente');
});

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
        return res.status(500).send('Error al verificar el perfil del usuario.');
    }
});

// Rutas para mostrar los formularios de perfil basados en la selección
router.get('/registro-perfil/cliente', requireAuth, (req, res) => {
    return res.render('ingreso/registrocliente'); 
});

router.get('/registro-perfil/asesor', requireAuth, (req, res) => {
    return res.render('ingreso/registroasesor'); 
});

// RUTA PARA LA SELECCIÓN INICIAL DEL TIPO DE USUARIO DESPUÉS DEL REGISTRO
router.get('/registro-perfil/seleccionar', requireAuth, (req, res) => {
    // Asegurarse de que el usuario haya pasado por el registro
    if (!req.session.userId || !req.session.userCreationTime) {
        return res.redirect('/registro'); // Redirigir si no hay datos de registro en la sesión
    }
    return res.render('ingreso/seleccionar_tipo_usuario'); // Renderiza la vista para elegir
});


// Añadir la ruta para editar la información personal y de contacto
router.post('/perfil/editar-info-personal', requireAuth, editProfileController.postEditPersonalAndContactInfo);


module.exports = router;