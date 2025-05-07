var express = require('express');
var router = express.Router();

router.get('/', (req, res) =>{
  res.render('login')
})

router.get('/registro', (req, res) =>{
  res.render('registro')
})

router.get('/consulta', (req, res) =>{
  res.render('consulta')
})

module.exports = router;
