// C:\Users\Gustavo\Desktop\AI-Finance-Solutions\config\database.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../database.sqlite');

let db = null; 

let originalDbGet = null;
let originalDbAll = null;
let originalDbRun = null;

db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('DB INIT: Error conectando a la base de datos SQLite:', err.message);
    } else {
        console.log('DB INIT: Conectado a la base de datos SQLite.');

        originalDbGet = sqlite3.Database.prototype.get;
        originalDbAll = sqlite3.Database.prototype.all;
        originalDbRun = sqlite3.Database.prototype.run;

        db.exec(`
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                userType TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS clientes (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                nombre TEXT NOT NULL,
                apellido TEXT NOT NULL,
                telefono TEXT,
                direccion TEXT,
                fotoPerfilUrl TEXT,
                ingresosMensuales REAL DEFAULT 0.0,
                gastosMensuales REAL DEFAULT 0.0,
                ahorrosActuales REAL DEFAULT 0.0,
                objetivosFinancieros TEXT,
                perfil_riesgo TEXT,       
                objetivo_principal TEXT,  
                asesorAsignado TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (asesorAsignado) REFERENCES asesores(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS asesores (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                nombre TEXT NOT NULL,
                apellido TEXT NOT NULL,
                telefono TEXT,
                profesion TEXT NOT NULL,
                licencia TEXT NOT NULL,
                especialidad TEXT,
                experiencia INTEGER,
                bio TEXT,
                fotoPerfilUrl TEXT,

                kyc_status TEXT DEFAULT 'no enviado',
                kyc_notes TEXT, 
                kyc_document_type TEXT, 
                kyc_document_number TEXT, 
                kyc_front_url TEXT, 
                kyc_back_url TEXT, 
                kyc_selfie_url TEXT, 

                title_status TEXT DEFAULT 'no enviado',
                title_notes TEXT, 
                title_document_url TEXT, 

                certification_status TEXT DEFAULT 'no enviado',
                certification_notes TEXT, 
                certification_document_url TEXT, 
                
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, 
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, 

                FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE
            );

            -- ¡ESTA ES LA TABLA QUE FALTABA!
            CREATE TABLE IF NOT EXISTS clientes_asignados (
                asesores_id TEXT NOT NULL,
                clientes_id TEXT NOT NULL,
                PRIMARY KEY (asesores_id, clientes_id),
                FOREIGN KEY (asesores_id) REFERENCES asesores(id) ON DELETE CASCADE,
                FOREIGN KEY (clientes_id) REFERENCES clientes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chat_rooms (
                room_id TEXT PRIMARY KEY,
                client_id TEXT NOT NULL,
                asesor_id TEXT NOT NULL,
                last_message_text TEXT,
                last_message_timestamp DATETIME,
                client_unread_count INTEGER DEFAULT 0,
                asesor_unread_count INTEGER DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES clientes(id) ON DELETE CASCADE,
                FOREIGN KEY (asesor_id) REFERENCES asesores(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                sender_type TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (room_id) REFERENCES chat_rooms(room_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS asesorEventos (
                id TEXT PRIMARY KEY,
                asesorId TEXT NOT NULL, 
                title TEXT NOT NULL,
                start TEXT NOT NULL,
                end TEXT,
                description TEXT,
                allDay INTEGER DEFAULT 0, 
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (asesorId) REFERENCES asesores(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS clienteEventos (
                id TEXT PRIMARY KEY,
                clienteId TEXT NOT NULL, 
                title TEXT NOT NULL,
                start TEXT NOT NULL,
                end TEXT,
                description TEXT,
                allDay INTEGER DEFAULT 0, 
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (clienteId) REFERENCES clientes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                message TEXT NOT NULL,
                link TEXT,
                is_read INTEGER DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS objetivosCliente (
                id TEXT PRIMARY KEY,
                clienteId TEXT NOT NULL,
                nombre TEXT NOT NULL,
                montoObjetivo REAL NOT NULL,
                montoActual REAL DEFAULT 0.0,
                fechaLimite TEXT,
                status TEXT DEFAULT 'pendiente',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (clienteId) REFERENCES clientes(id) ON DELETE CASCADE
            );
        `, (err) => {
            if (err) {
                console.error('DB INIT: Error creando tablas:', err.message);
            } else {
                console.log('DB INIT: Tablas creadas o ya existen.');
            }
        });
    }
});

db.get = (sql, params) => {
    return new Promise((resolve, reject) => {
        originalDbGet.call(db, sql, params, (err, row) => {
            if (err) {
                console.error('DB PROMISIFIED: Error en db.get:', err.message, 'SQL:', sql, 'Params:', params);
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
};

db.all = (sql, params) => {
    return new Promise((resolve, reject) => {
        originalDbAll.call(db, sql, params, (err, rows) => {
            if (err) {
                console.error('DB PROMISIFIED: Error en db.all:', err.message, 'SQL:', sql, 'Params:', params);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

db.run = (sql, params) => {
    return new Promise((resolve, reject) => {
        originalDbRun.call(db, sql, params, function (err) {
            if (err) {
                console.error('DB PROMISIFIED: Error en db.run:', err.message, 'SQL:', sql, 'Params:', params);
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
};

module.exports = {
    db,
    getDb: () => db
};