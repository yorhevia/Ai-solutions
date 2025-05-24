const admin = require('firebase-admin');
const path = require('path');


let serviceAccount;
let firebaseInitialized = false; // Flag para rastrear si Firebase se inicializó

// 1. Intentar cargar las credenciales desde la variable de entorno
const serviceAccountJsonFromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON; // Usamos el nombre del que te funciona

if (serviceAccountJsonFromEnv) {
    try {
        serviceAccount = JSON.parse(serviceAccountJsonFromEnv);
        console.log('Firebase: Credenciales cargadas desde la variable de entorno.');
    } catch (error) {
        console.error('Firebase Error: No se pudo parsear FIREBASE_SERVICE_ACCOUNT_JSON. Verifique el formato JSON de la variable de entorno.', error);
        // Si hay un error de parseo, no se inicializará y buscará el archivo local.
        serviceAccount = null; 
    }
}

// 2. Si las credenciales no se cargaron de la variable de entorno, intentar cargar el archivo local
if (!serviceAccount) {
    // Ajusta esta ruta si tu serviceAccountKey.json no está en '../config/'
    const localServiceAccountPath = path.resolve(__dirname, '../config/serviceAccountKey.json');
    try {
        // Intenta requerir el archivo local directamente
        serviceAccount = require(localServiceAccountPath);
        console.log(`Firebase: Credenciales cargadas desde el archivo local: ${localServiceAccountPath}`);
    } catch (error) {
        console.error(`Firebase Error: No se encontró o no se pudo cargar el archivo local serviceAccountKey.json desde: ${localServiceAccountPath}`);
        console.error('Si estás en producción, asegúrate de que FIREBASE_SERVICE_ACCOUNT_JSON esté configurada correctamente.');
        console.error('Si estás en desarrollo, verifica que serviceAccountKey.json exista en la ruta correcta.');
      
    }
}

// 3. Inicializar Firebase Admin SDK si se obtuvieron las credenciales
if (serviceAccount) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        const db = admin.firestore(); // Obtener la instancia de Firestore
        console.log('¡Firebase Admin SDK inicializado y conectado a Firebase!');
        firebaseInitialized = true;
        // Exportar tanto admin como db
        module.exports = { admin, db };
    } catch (error) {
        console.error('Firebase Error: No se pudo inicializar Firebase Admin SDK.', error);
        // En caso de un error de inicialización, exportamos un objeto vacío
        module.exports = {};
    }
} else {
    console.warn('Firebase Warn: Firebase Admin SDK no se inicializó porque no se encontraron credenciales válidas.');
    // Si no se encontraron credenciales, exportamos un objeto vacío o null
    module.exports = {}; 
}

