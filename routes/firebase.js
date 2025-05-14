const admin = require('firebase-admin');
const serviceAccount = require('../config/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // databaseURL: "https://ai-finance-solutions-default-rtdb.googleapis.com"
});

console.log('¡Firebase Admin SDK inicializado y conectado a Firebase!');

module.exports = admin;
