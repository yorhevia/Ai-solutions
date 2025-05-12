var express = require('express');
var router = express.Router();


//OBTENER RUTA PRINCIPAL (LOGIN)
//OBTENER RUTA PRINCIPAL (LOGIN)


router.get('/', (req, res) =>{
  res.render('ingreso/login')
})


//OBTENER RUTA REGISTRO
//OBTENER RUTA REGISTRO

router.get('/registro', (req, res) =>{
  res.render('ingreso/registro')
})


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
