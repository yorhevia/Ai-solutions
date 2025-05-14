var express = require('express');
const requireAuth = require('../config/middleware');
const session = require('express-session');
const admin = require('./firebase');
const db = admin.firestore();
var router = express.Router();


// OBTENER RUTAS PRINCIPALES
router.get('/homecliente', requireAuth, (req, res) => {
    res.render('cliente/homecliente');
});

router.get('/homeasesor', requireAuth, (req, res) => {
    res.render('asesor/homeasesor');
});


//OBTENER RUTA PRINCIPAL (HOME)
router.get('/', (req, res) =>{
  res.render('welcome')
})

//OBTENER RUTA LOGIN
router.get('/login', (req, res) => {
    res.render('ingreso/login'); 
});


// Ruta POST para el inicio de sesión
router.post('/login', async (req, res) => {
    const { email } = req.body;

    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        console.log('Usuario encontrado en Firebase:', userRecord.uid);

        // Si el usuario existe, puedes establecer una sesión en tu backend
        req.session.userId = userRecord.uid;
        return res.redirect('/dashboard');

    } catch (error) {
        console.error('Error al verificar el usuario en Firebase:', error);
        let errorMessage = 'Error al iniciar sesión.';
        if (error.code === 'auth/user-not-found') {
            errorMessage = 'Correo electrónico no encontrado.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'El correo electrónico no es válido.';
        }
        return res.render('ingreso/login', { error: errorMessage });
    }
});


// Ruta POST para guardar la información del perfil
router.post('/registro-perfil', requireAuth, async (req, res) => {
    const { tipo_usuario, ...formData } = req.body;
    const userId = req.session.userId;

    try {
        if (tipo_usuario === 'cliente') {
            await db.collection('clientes').doc(userId).set(formData);
            console.log(`Perfil de cliente registrado para el usuario: ${userId}`, formData);
            res.redirect('/homecliente'); // Redirigir a la página principal del cliente
        } else if (tipo_usuario === 'asesor') {
            await db.collection('asesores').doc(userId).set(formData);
            console.log(`Perfil de asesor registrado para el usuario: ${userId}`, formData);
            res.redirect('/homeasesor'); // Redirigir a la página principal del asesor
        } else {
            console.error('Tipo de usuario no válido:', tipo_usuario);
            res.status(400).send('Tipo de usuario no válido.');
        }
    } catch (error) {
        console.error('Error al registrar el perfil:', error);
        res.status(500).send('Error al registrar el perfil.');
    }
});



//OBTENER RUTA REGISTRO
router.get('/registro', (req, res) => {
    res.render('ingreso/registro');
});


// Ruta POST para el registro
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
        console.log('Usuario registrado:', userRecord.uid);

        // Renderizar la página de registro con un mensaje de éxito y redirigir
        return res.render('ingreso/registro', { success: 'Registro exitoso. Completa tu perfil a continuación...', formData: req.body });

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
  res.render('asesor/consulta')
})


//OBTENER RUTA CONSULTA CLIENTE
router.get('/consultacliente', (req, res)=> {
  res.render('cliente/consultacliente')
})


//OBTENER RUTA PERFIL CLIENTE
router.get('/perfilcliente', (req, res) =>{
  res.render('asesor/perfilcliente')
})


//OBTENER RUTA FORMULARIO CLIENTE
router.get('/formulariocliente', (req, res) =>{
  res.render('cliente/formulariocliente')
})

router.get('/dashboard', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    try {
        const clienteDoc = await db.collection('clientes').doc(userId).get();
        const asesorDoc = await db.collection('asesores').doc(userId).get();

        if (!clienteDoc.exists && !asesorDoc.exists) {
            // Si no existe perfil de cliente ni de asesor, es la primera vez después del registro
            return res.render('ingreso/seleccionar_tipo_usuario'); // Asegúrate de tener esta vista en 'ingreso'
        } else if (clienteDoc.exists) {
            return res.redirect('/homecliente');
        } else if (asesorDoc.exists) {
            return res.redirect('/homeasesor');
        } else {
            // Caso improbable, pero para seguridad
            console.error('Estado de perfil inconsistente para el usuario:', userId);
            return res.status(500).send('Error en el estado del perfil del usuario.');
        }

    } catch (error) {
        console.error('Error al verificar el perfil del usuario:', error);
        res.status(500).send('Error al verificar el perfil del usuario.');
    }
});

// Rutas para mostrar los formularios de perfil basados en la selección
router.get('/registro-perfil/cliente', requireAuth, (req, res) => {
    res.render('ingreso/registrocliente'); // Ajusta la ruta a tu archivo de cliente
});

router.get('/registro-perfil/asesor', requireAuth, (req, res) => {
    res.render('ingreso/registroasesor'); // Ajusta la ruta a tu archivo de asesor
});

// Ruta POST para guardar la información del perfil (sin cambios)
router.post('/registro-perfil', requireAuth, async (req, res) => {
    const { tipo_usuario, ...formData } = req.body;
    const userId = req.session.userId;

    try {
        if (tipo_usuario === 'cliente') {
            await db.collection('clientes').doc(userId).set(formData);
            console.log(`Perfil de cliente registrado para el usuario: ${userId}`, formData);
            res.redirect('/homecliente');
        } else if (tipo_usuario === 'asesor') {
            await db.collection('asesores').doc(userId).set(formData);
            console.log(`Perfil de asesor registrado para el usuario: ${userId}`, formData);
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




module.exports = router;