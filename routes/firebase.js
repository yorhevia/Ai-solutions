const admin = require('firebase-admin');
const path = require('path');

let serviceAccount;
let firebaseInitialized = false; 

// Variables para exportar, inicializadas a null o undefined
let db = null;
let auth = null; 

// 1. Intentar cargar las credenciales desde la variable de entorno (codificada en Base64)
const serviceAccountBase64FromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

if (serviceAccountBase64FromEnv) {
    let decodedJsonString;
    try {
        decodedJsonString = Buffer.from(serviceAccountBase64FromEnv, 'base64').toString('utf8');
        console.log('Firebase: Variable de entorno decodificada de Base64.');
    } catch (error) {
        console.error('Firebase Error: No se pudo decodificar FIREBASE_SERVICE_ACCOUNT_BASE64 de Base64. Verifique el formato.', error);
        decodedJsonString = null;
    }

    if (decodedJsonString) {
        try {
            serviceAccount = JSON.parse(decodedJsonString);
            console.log('Firebase: Credenciales cargadas desde la variable de entorno (Base64 decodificado).');
        } catch (error) {
            console.error('Firebase Error: No se pudo parsear el JSON decodificado. Verifique el contenido de la variable.', error);
            serviceAccount = null;
        }
    }
}

// 2. Si las credenciales no se cargaron de la variable de entorno, intentar cargar el archivo local
if (!serviceAccount) {
    const localServiceAccountPath = path.resolve(__dirname, '../config/serviceAccountKey.json');
    try {
        serviceAccount = require(localServiceAccountPath);
        console.log(`Firebase: Credenciales cargadas desde el archivo local: ${localServiceAccountPath}`);
    } catch (error) {
        console.error(`Firebase Error: No se encontró o no se pudo cargar el archivo local serviceAccountKey.json desde: ${localServiceAccountPath}`);
        console.error('Si estás en producción, asegúrate de que FIREBASE_SERVICE_ACCOUNT_BASE64 esté configurada correctamente.');
        console.error('Si estás en desarrollo, verifica que serviceAccountKey.json exista en la ruta correcta.');
    }
}

// 3. Inicializar Firebase Admin SDK si se obtuvieron las credenciales
if (serviceAccount) {
    try {
         if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                // databaseURL: "https://ai-finance-solutions-default-rtdb.googleapis.com" // Descomenta si usas Realtime Database
            });
            console.log('¡Firebase Admin SDK inicializado y conectado a Firebase!');
            firebaseInitialized = true; // Actualiza el estado
        }
        
        // Asigna 'db' y 'auth' a las variables globales
        db = admin.firestore();
        auth = admin.auth(); // Obtener la instancia de Auth

    } catch (error) {
        console.error('Firebase Error: No se pudo inicializar Firebase Admin SDK.', error);
    }
} else {
    console.warn('Firebase Warn: Firebase Admin SDK no se inicializó porque no se encontraron credenciales válidas.');
}

module.exports = { admin, db, auth };