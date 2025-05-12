var express = require('express');
const admin = require('firebase-admin');
const requireAuth = require('../config/middleware');
const session = require('express-session');
const admin = require('./firebase');
var router = express.Router();


//OBTENER RUTA PRINCIPAL (LOGIN)
//OBTENER RUTA PRINCIPAL (LOGIN)


router.get('/', (req, res) =>{
  res.render('ingreso/login')
})


// Ruta POST para el inicio de sesión
// Ruta POST para el inicio de sesión
router.post('/login', async (req, res) => {
  const { correo, contrasena } = req.body;
  const admin = req.app.locals.admin;
  const auth = admin.auth();

  try {
    const userCredential = await auth.signInWithEmailAndPassword(correo, contrasena);
    const user = userCredential.user;
    console.log('Usuario autenticado:', user.uid);
    // Establecer la sesión del usuario
    req.session.userId = user.uid;
    return res.redirect('/dashboard');
  } catch (error) {
    return res.render('login', { error: errorMessage });
  }
});


//OBTENER RUTA REGISTRO
//OBTENER RUTA REGISTRO

router.get('/registro', (req, res) =>{
  res.render('ingreso/registro')
})

// Ruta POST para el registro
// Ruta POST para el registro
router.post('/registro', async (req, res) => {
  const { nombre, apellido, email, telefono, usuario, contrasena, confirmar_contrasena } = req.body;
  const auth = admin.auth();

  if (contrasena !== confirmar_contrasena) {
    return res.render('registro', { error: 'Las contraseñas no coinciden.' });
  }

  try {
    const userRecord = await auth.createUser({
      email: email,
      password: contrasena,
      displayName: `${nombre} ${apellido}`,
    });
    console.log('Usuario registrado:', userRecord.uid);

    // Opcional: Guardar información adicional del usuario en Firestore
    const db = admin.firestore();
    await db.collection('asesores').doc(userRecord.uid).set({
      nombre: nombre,
      apellido: apellido,
      email: email,
      telefono: telefono,
      usuario: usuario,
    });

    return res.redirect('/login'); // Redirige al login después del registro exitoso
  } catch (error) {
    console.error('Error al registrar usuario:', error);
    let errorMessage = 'Error al registrar usuario. Por favor, inténtalo de nuevo.';
    if (error.code === 'auth/email-already-in-use') {
      errorMessage = 'Este correo electrónico ya está en uso.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'El correo electrónico no es válido.';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'La contraseña debe tener al menos 6 caracteres.';
    }
    return res.render('registro', { error: errorMessage, formData: req.body }); // Renderiza el formulario de registro con un mensaje de error y los datos ingresados
  }
});


//OBTENER RUTA CONSULTA
//OBTENER RUTA CONSULTA

router.get('/consulta', (req, res) =>{
  res.render('asesor/consulta')
})


//OBTENER RUTA CONSULTA CLIENTE
//OBTENER RUTA CONSULTA CLIENTE

router.get('/consultacliente', (req, res)=> {
  res.render('cliente/consultacliente')
})


//OBTENER RUTA PERFIL CLIENTE
//OBTENER RUTA PERFIL CLIENTE
router.get('/perfilcliente', (req, res) =>{
  res.render('asesor/perfilcliente')
})


//OBTENER RUTA FORMULARIO CLIENTE
//OBTENER RUTA FORMULARIO CLIENTE

router.get('/formulariocliente', (req, res) =>{
  res.render('cliente/formulariocliente')
})


module.exports = router;
