var express = require('express');
const requireAuth = require('../config/middleware');
const session = require('express-session');
const admin = require('./firebase'); // Importa la instancia de admin directamente
var router = express.Router();


//OBTENER RUTA PRINCIPAL (LOGIN)
router.get('/', (req, res) =>{
  res.render('ingreso/login')
})


// Ruta POST para el inicio de sesión
router.post('/login', async (req, res) => {
  const { correo, contrasena } = req.body;
  const auth = admin.auth(); // Usa la instancia de admin importada

  try {
    const userCredential = await auth.signInWithEmailAndPassword(correo, contrasena);
    const user = userCredential.user;
    console.log('Usuario autenticado:', user.uid);
    // Establecer la sesión del usuario
    req.session.userId = user.uid;
    return res.redirect('/dashboard');
  } catch (error) {
    return res.render('ingreso/login', { error: 'Error al iniciar sesión' }); // Asegúrate de tener un mensaje de error
  }
});


//OBTENER RUTA REGISTRO
router.get('/registro', (req, res) =>{
  res.render('ingreso/registro')
})

// Ruta POST para el registro
router.post('/registro', async (req, res) => {
  const { nombre, apellido, email, telefono, usuario, contrasena, confirmar_contrasena } = req.body;
  const auth = admin.auth(); 
  const db = admin.firestore(); 

  if (contrasena !== confirmar_contrasena) {
    return res.render('ingreso/registro', { error: 'Las contraseñas no coinciden.' });
  }

  try {
    const userRecord = await auth.createUser({
      email: email,
      password: contrasena,
      displayName: `${nombre} ${apellido}`,
    });
    console.log('Usuario registrado:', userRecord.uid);

    // Opcional: Guardar información adicional del usuario en Firestore
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


module.exports = router;