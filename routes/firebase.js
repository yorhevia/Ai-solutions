const admin = require('firebase-admin');

// 1. Obtener la cadena JSON de la variable de entorno
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

// 2. Verificar que la variable de entorno existe
if (!serviceAccountJson) {
    console.error('Error: La variable de entorno FIREBASE_SERVICE_ACCOUNT no está definida.');
    process.exit(1); 
}

let serviceAccount;
try {
    // 3. Parsear la cadena JSON a un objeto JavaScript
    serviceAccount = JSON.parse(serviceAccountJson);
} catch (error) {
    console.error('Error: No se pudo parsear la variable FIREBASE_SERVICE_ACCOUNT como JSON.', error);
    process.exit(1);
}

// 4. Inicializar Firebase Admin SDK con las credenciales
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

console.log('¡Firebase Admin SDK inicializado y conectado a Firebase!');

module.exports = admin;