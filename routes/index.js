require('dotenv').config();
var express = require('express');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const moment = require('moment');
require('moment/locale/es');
// Importa la instancia de la base de datos y la función getDb
const { db, getDb } = require('../config/database');
// Importa middlewares
const { requireAuth, requireAsesor } = require('../config/middleware');
const isAdmin = require('../config/middlewareisadmin');
var router = express.Router();

// --- CONFIGURACIÓN DE MULTER ---
const upload = multer({
    storage: multer.memoryStorage(), 
    limits: {
        fileSize: 5 * 1024 * 1024 // Límite de 5 MB
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido. Solo se permiten JPG, PNG, GIF.'), false);
        }
    }
});

// --- CONFIGURACIÓN DE MULTER PARA CARGA EN MEMORIA ---
const uploadMemory = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // Límite de 5 MB
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido. Solo se permiten JPG, PNG, GIF.'), false);
        }
    }
});
// --- FIN CONFIGURACIÓN DE MULTER ---

// --- LA RUTA PARA SUBIR LA FOTO DE PERFIL ---
// Cambiamos el nombre de la ruta a /upload-profile-photo como tu error anterior
// Y añadimos el middleware `upload.single('profilePhoto')`
router.post('/upload-profile-photo', requireAuth, upload.single('profilePhoto'), async (req, res) => {
    if (req.session.userType !== 'asesor') {
        return res.status(403).json({ success: false, message: 'Acceso denegado.' });
    }

    try {
        const userId = req.session.userId;
        
        // Multer coloca el archivo en `req.file` cuando se usa `memoryStorage`
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No se recibió ninguna imagen. Por favor, selecciona una foto.' });
        }

        // El contenido binario de la imagen está en req.file.buffer
        const fileBuffer = req.file.buffer;
        const mimeType = req.file.mimetype;

        // Convertir el buffer a una cadena Base64 con el prefijo Data URL
        const base64Image = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

        // Usamos tu función existente para actualizar la foto en la base de datos SQLite
        // (Asumiendo que `updateAsesorProfilePhoto` está definida más abajo en este mismo archivo)
        await updateAsesorProfilePhoto(userId, base64Image); 

        res.json({ success: true, message: 'Foto de perfil subida con éxito.', imageUrl: base64Image });

    } catch (error) {
        // Manejo de errores de Multer (ej. tipo de archivo no permitido) o de la DB
        console.error('Error al subir la foto de perfil:', error);
        let errorMessage = 'Error al subir la foto de perfil.';
        if (error instanceof multer.MulterError) {
            errorMessage = error.message; // Mensajes de error de Multer (ej. "File too large")
        } else if (error.message.includes('Tipo de archivo no permitido')) {
             errorMessage = error.message; // Mensaje de tu fileFilter personalizado
        }
        return res.status(500).json({ success: false, message: errorMessage });
    }
});

async function addNotificationToUser(userId, message, link = '#') { 
    try {
        const dbInstance = getDb(); 
        if (!dbInstance) {
            console.error('Error: La instancia de la base de datos no está disponible.');
            return;
        }

        const notificationId = uuidv4(); 
        const createdAt = new Date().toISOString(); 

        await dbInstance.run(
            `INSERT INTO notifications (id, user_id, message, link, is_read, createdAt)
             VALUES (?, ?, ?, ?, ?, ?)`,
    
            [notificationId, userId, message, link, 0, createdAt] 
        );
        console.log(`Notificación añadida a ${userId}: "${message}" a las ${createdAt}`);
    } catch (error) {
        console.error('Error al añadir notificación:', error);
    }
}


// --- Common Database Operations (replace 'models' calls) ---
const findUserByEmail = async (email) => {
    const dbInstance = getDb();
    return await dbInstance.get(`SELECT id, email, password_hash, userType FROM users WHERE email = ?`, [email]);
};

const findUserById = async (userId) => {
    const dbInstance = getDb();
    return await dbInstance.get(`SELECT id, email, userType FROM users WHERE id = ?`, [userId]);
};

const findClientProfile = async (userId) => {
    const dbInstance = getDb();
    return await dbInstance.get(`
        SELECT 
            id, 
            email, 
            nombre, 
            apellido, 
            telefono, 
            direccion, 
            fotoPerfilUrl,
            ingresosMensuales, 
            ahorrosActuales, 
            perfil_riesgo, 
            objetivo_principal, 
            asesorAsignado,
            createdAt AS fechaRegistro, -- ¡IMPORTANTE! Renombra 'createdAt' a 'fechaRegistro'
            updatedAt
        FROM clientes 
        WHERE id = ?
    `, [userId]);
};

const findAsesorProfile = async (userId) => {
    const dbInstance = getDb();
    return await dbInstance.get(`SELECT * FROM asesores WHERE id = ?`, [userId]);
};

const createUser = async (userData) => {
    const dbInstance = getDb();
    const { id, email, password_hash, userType } = userData;
    return await dbInstance.run(
        `INSERT INTO users (id, email, password_hash, userType) VALUES (?, ?, ?, ?)`,
        [id, email, password_hash, userType || 'unregistered'] // Default userType if not provided
    );
};

const createClientProfile = async (profileData) => {
    const dbInstance = getDb();
    // Desestructuramos solo los campos que vamos a insertar explícitamente.
    // 'fechaRegistro' y 'createdAt' NO se desestructuran aquí, ya que createdAt es automático.
    const { user_id, email, nombre, apellido, telefono, direccion, 
            ingresosMensuales, ahorrosActuales, perfil_riesgo, 
            objetivo_principal, asesorAsignado, fotoPerfilUrl } = profileData; 
    
    return await dbInstance.run(
        // QUITADO: 'fechaRegistro' de la lista de columnas a insertar
        `INSERT INTO clientes (id, email, nombre, apellido, telefono, direccion, 
                              ingresosMensuales, ahorrosActuales, perfil_riesgo, 
                              objetivo_principal, asesorAsignado, fotoPerfilUrl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, // Ajustado el número de '?'
        [
            user_id, 
            email, 
            nombre, 
            apellido, 
            telefono || null, 
            direccion || null, 
            ingresosMensuales || 0.0, 
            ahorrosActuales || 0.0, 
            perfil_riesgo || null, 
            objetivo_principal || null, 
            asesorAsignado || null, 
            fotoPerfilUrl || null
            // QUITADO: fechaRegistro || null de los valores
        ]
    );
};


const createAsesorProfile = async (profileData) => {
    const dbInstance = getDb();
    // Asegúrate de que todos los campos pasados coincidan con los de la tabla DDL
    // Quitamos 'direccion' de aquí y añadimos 'profesion' y 'licencia'
    const { 
        user_id, email, nombre, apellido, telefono, 
        profesion, licencia, especialidad, experiencia, bio, // Agregado profesion, licencia, y bio
        kyc_status, kyc_notes, title_status, title_notes, 
        certification_status, certification_notes, fotoPerfilUrl 
    } = profileData;

    return await dbInstance.run(
        `INSERT INTO asesores (
            id, email, nombre, apellido, telefono, 
            profesion, licencia, especialidad, experiencia, bio, 
            kyc_status, kyc_notes, title_status, title_notes, 
            certification_status, certification_notes, fotoPerfilUrl
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, // ¡El número de '?' ahora coincide!
        [
            user_id, 
            email, 
            nombre, 
            apellido, 
            telefono || null, 
            profesion, 
            licencia,  
            especialidad || null, 
            parseInt(experiencia) || 0, // Aseguramos que sea un número
            bio || null, 
            kyc_status || 'no enviado', // Usamos 'no enviado' como DEFAULT
            kyc_notes || null, 
            title_status || 'no enviado', 
            title_notes || null, 
            certification_status || 'no enviado', 
            certification_notes || null, 
            fotoPerfilUrl || null
        ]
    );
};

const updateClientProfile = async (userId, updateData) => {
    const dbInstance = getDb();
    const fields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updateData);
    values.push(userId);
    return await dbInstance.run(`UPDATE clientes SET ${fields} WHERE id = ?`, values);
};

const updateAsesorProfile = async (userId, updateData) => {
    const dbInstance = getDb();
    const fields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updateData);
    values.push(userId);
    return await dbInstance.run(`UPDATE asesores SET ${fields} WHERE id = ?`, values);
};

const updateAsesorProfessionalProfile = async (userId, updateData) => {
    const dbInstance = getDb();
    const fields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updateData);
    values.push(userId);
    const updateQuery = `UPDATE asesores SET ${fields}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`;
    return await dbInstance.run(updateQuery, values);
};

// Las funciones de foto de perfil están usando `fotoPerfilUrl` como TEXT.
// Si `multer.memoryStorage()` retorna un Buffer, necesitas convertirlo a Base64
// para guardarlo en una columna TEXT, o cambiar la columna a BLOB.
// Por ahora, asumimos que `imageData` será una URL o Base64 string.
const updateClientProfilePhoto = async (userId, imageData) => { // Eliminado imageMimeType, no usado
    const dbInstance = getDb();
    return await dbInstance.run(`UPDATE clientes SET fotoPerfilUrl = ? WHERE id = ?`, [imageData, userId]);
};

const updateAsesorProfilePhoto = async (userId, imageData) => { // Eliminado imageMimeType, no usado
    const dbInstance = getDb();
    return await dbInstance.run(`UPDATE asesores SET fotoPerfilUrl = ? WHERE id = ?`, [imageData, userId]);
};

const getClientProfilePhoto = async (userId) => {
    const dbInstance = getDb();
    return await dbInstance.get(`SELECT fotoPerfilUrl AS photo_blob FROM clientes WHERE id = ?`, [userId]);
};

const getAsesorProfilePhoto = async (userId) => {
    const dbInstance = getDb();
    return await dbInstance.get(`SELECT fotoPerfilUrl AS photo_blob FROM asesores WHERE id = ?`, [userId]);
};

const getUnreadNotificationsCount = async (userId) => {
    const dbInstance = getDb();
    const result = await dbInstance.get(`SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0`, [userId]);
    return result ? result.count : 0;
};


const getNotificationsByUserId = async (userId, limit = null) => {
    const dbInstance = getDb();
    let query = `SELECT id, message, link, is_read AS read, createdAt FROM notifications WHERE user_id = ? ORDER BY createdAt DESC`;
    const params = [userId];

    if (limit) {
        query += ` LIMIT ?`;
        params.push(limit);
    }
    
    return await dbInstance.all(query, params);
};


const markNotificationAsRead = async (notificationId, userId) => {
    const dbInstance = getDb();
    return await dbInstance.run(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`, [notificationId, userId]);
};

/// Welcome Route
router.get('/', (req, res) => {
    return res.render('welcome');
});

// Login Routes
router.get('/login', (req, res) => {
    return res.render('ingreso/login', { error: req.flash('error_msg') });
});

router.post('/login', async (req, res) => {
    const { email, contrasena } = req.body;
    if (!email || !contrasena) {
        req.flash('error_msg', 'Por favor, introduce correo electrónico y contraseña.');
        return res.redirect('/login');
    }

    try {
        const user = await findUserByEmail(email); // Asume que esto devuelve { id, email, password_hash, userType (de la DB) }

        if (!user) {
            req.flash('error_msg', 'Correo electrónico o contraseña incorrectos.');
            return res.redirect('/login');
        }

        const isMatch = await bcrypt.compare(contrasena, user.password_hash);

        if (!isMatch) {
            req.flash('error_msg', 'Correo electrónico o contraseña incorrectos.');
            return res.redirect('/login');
        }

        // --- Autenticación exitosa, ahora maneja el tipo de usuario ---
        req.session.userId = user.id;
        req.session.userEmail = user.email; // Renombrado de 'email' a 'userEmail' para consistencia
        
        // Determina el tipo de usuario real, priorizando el rol de ADMIN si aplica
        const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : [];
        
        if (adminEmails.includes(user.email)) {
            // Si el email está en la lista de administradores, asigna 'admin' directamente.
            // Esto sobrescribe cualquier 'userType' inicial de la DB (como 'unregistered').
            req.session.userType = 'admin';
            req.session.userName = 'Administrador'; // O el nombre real si lo tienes para admins
        } else if (user.userType === 'unregistered') {
            // Si el usuario no es admin y su tipo es 'unregistered', intenta determinarlo
            const clienteProfile = await findClientProfile(user.id);
            const asesorProfile = await findAsesorProfile(user.id);

            if (clienteProfile) {
                req.session.userType = 'cliente';
                req.session.userName = clienteProfile.nombre || user.email;
            } else if (asesorProfile) {
                req.session.userType = 'asesor';
                req.session.userName = asesorProfile.nombre || user.email;
            } else {
                req.session.userName = user.email; // Todavía perfil no registrado, mantén userType 'unregistered'
                // req.session.userType = 'unregistered'; // Ya lo tienes, no es necesario reasignar
            }
        } else {
            // Si el userType de la DB ya es 'cliente' o 'asesor', usa ese.
            req.session.userType = user.userType; 
            let profileData;
            if (user.userType === 'cliente') {
                profileData = await findClientProfile(user.id);
            } else if (user.userType === 'asesor') {
                profileData = await findAsesorProfile(user.id);
            }
            req.session.userName = profileData ? profileData.nombre : user.email;
        }

        // ¡IMPORTANTE! Guarda la sesión después de modificarla
        await req.session.save();

        req.flash('success_msg', '¡Has iniciado sesión con éxito!');
        
        // Redirige según el tipo de usuario final
        if (req.session.userType === 'admin') {
              res.redirect('/admin/verificaciones_pendientes');
        } else {
            return res.redirect('/dashboard'); // Redirige al dashboard general para asesores/clientes/unregistered
        }

    } catch (error) {
        console.error('Error in /login route:', error);
        req.flash('error_msg', 'Error interno del servidor. Inténtalo más tarde.');
        return res.status(500).redirect('/login');
    } 
});

// Routes for Account Registration
router.get('/registro', (req, res) => {
    return res.render('ingreso/registro', { error: req.flash('error_msg'), formData: {} });
});

router.post('/registro', async (req, res) => {
    const { nombre, apellido, email, contrasena, confirmar_contrasena } = req.body;

    if (contrasena !== confirmar_contrasena) {
        req.flash('error_msg', 'Las contraseñas no coinciden.');
        return res.render('ingreso/registro', { error: req.flash('error_msg'), formData: req.body });
    }

    try {
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            req.flash('error_msg', 'Este correo electrónico ya está en uso.');
            return res.render('ingreso/registro', { error: req.flash('error_msg'), formData: req.body });
        }

        if (contrasena.length < 6) {
            req.flash('error_msg', 'La contraseña debe tener al menos 6 caracteres.');
            return res.render('ingreso/registro', { error: req.flash('error_msg'), formData: req.body });
        }

        const hashedPassword = await bcrypt.hash(contrasena, 10);
        const userId = uuidv4(); // Generate a unique ID for the user

        await createUser({
            id: userId,
            email: email,
            password_hash: hashedPassword,
            userType: 'unregistered' // Initially set as 'unregistered'
        });

        // --- DEBUG DE FECHA AQUÍ ---
        const now = new Date();
        const userCreationTimeUTC = now.toISOString();

        console.log('DEBUG FECHA: Hora local actual (sin formato):', now);
        console.log('DEBUG FECHA: userCreationTime guardado (ISO UTC):', userCreationTimeUTC);
        // --- FIN DEBUG DE FECHA ---

        console.log('User registered in SQLite:', userId);
        req.session.userId = userId;
        req.session.userCreationTime = userCreationTimeUTC; // Usamos la variable ya calculada
        req.session.email = email;
        req.userEmail = email;
        req.session.userName = nombre;
        req.session.userType = 'unregistered';

        await req.session.save();

        req.flash('success_msg', '¡Registro exitoso! Por favor, completa tu perfil.');
        return res.redirect('/dashboard');

    } catch (error) {
        console.error('Error al registrar usuario:', error);
        let errorMessage = 'Error al registrar usuario. Por favor, inténtalo de nuevo.';
        if (error.message.includes('SQLITE_CONSTRAINT_UNIQUE')) {
            errorMessage = 'Este correo electrónico ya está en uso.';
        }
        req.flash('error_msg', errorMessage);
        return res.render('ingreso/registro', { error: req.flash('error_msg'), formData: req.body });
    }
});

router.get('/logout', (req, res) => {
    req.flash('success_msg', 'Has cerrado sesión.');
    req.session.destroy((err) => {
        if (err) {
            console.error('Error al destruir la sesión:', err);
            req.flash('error_msg', 'Error al cerrar sesión. Intenta de nuevo.');
            return res.status(500).redirect('/login');
        }
        res.redirect('/login');
    });
});

// --- Routes for Additional Profile Information Registration ---

router.get('/registro-perfil/cliente', requireAuth, async (req, res) => {
    const dbInstance = getDb();
    const existingClient = await dbInstance.get(`SELECT id FROM clientes WHERE id = ?`, [req.session.userId]);
    if (existingClient) {
        req.flash('error_msg', 'Tu perfil de cliente ya está registrado.');
        return res.redirect('/homecliente');
    }
    return res.render('ingreso/registrocliente', { error: req.flash('error_msg') });
});

router.get('/registro-perfil/asesor', requireAuth, async (req, res) => {
    const dbInstance = getDb();
    const existingAsesor = await dbInstance.get(`SELECT id FROM asesores WHERE id = ?`, [req.session.userId]);
    if (existingAsesor) {
        req.flash('error_msg', 'Tu perfil de asesor ya está registrado.');
        return res.redirect('/homeasesor');
    }
    return res.render('ingreso/registroasesor', { error: req.flash('error_msg') });
});

// --- TU RUTA POST /registro-perfil ---
router.post('/registro-perfil', requireAuth, upload.none(), async (req, res) => {
    // --- DEBUG: Información de la sesión al inicio de la ruta ---
    console.log("DEBUG: Sesión en POST /registro-perfil:", req.session);
    console.log("DEBUG: req.body en POST /registro-perfil:", req.body);
    // Nota: Como estamos usando upload.none(), req.file será undefined.
    // Si más tarde decides añadir la subida de foto aquí, tendrías que cambiar upload.none()
    // por algo como upload.single('campoDeFoto').
    // --- Fin Debug ---

    const { tipo_usuario, ...formData } = req.body;
    const userId = req.session.userId;
    const userEmail = req.session.email;
    const userCreationTime = req.session.userCreationTime;

    if (!userId || !userCreationTime || !userEmail) {
        console.error('Error: ID de usuario, email o fecha de creación no encontrados en la sesión durante el registro de perfil.');
        req.flash('error_msg', 'Sesión inválida o datos de registro incompletos. Por favor, regístrate de nuevo.');
        return res.status(401).redirect('/registro');
    }

    const dbInstance = getDb();

    // La foto de perfil NO se está subiendo en este formulario de registro,
    // así que fotoPerfilUrl será null o se manejará en otro lado.
    const fotoPerfilUrl = null; 

    try {
        if (tipo_usuario === 'cliente') {
            await dbInstance.run(`UPDATE users SET userType = 'cliente' WHERE id = ?`, [userId]);

            // Manejo de 'otro_objetivo' para el campo objetivo_principal
            let objetivoPrincipalParaDB = formData.objetivo_principal;
            if (objetivoPrincipalParaDB === 'otro') { // Coincide con el valor en minúscula del select
                objetivoPrincipalParaDB = formData.otro_objetivo; // Usa el valor del campo "otro"
            }

            // Llamada a createClientProfile con los campos exactamente como los tienes en el formulario
            await createClientProfile({
                user_id: userId,
                email: userEmail,
                nombre: formData.nombre,
                apellido: formData.apellido,
                telefono: formData.telefono || null, // Opcional, guarda null si está vacío
                direccion: formData.direccion || null, // Opcional, guarda null si está vacío
                ingresosMensuales: parseFloat(formData.ingresos) || 0.0, // Mapea 'ingresos' del form a 'ingresosMensuales' de la DB
                ahorrosActuales: parseFloat(formData.ahorros) || 0.0,   // Mapea 'ahorros' del form a 'ahorrosActuales' de la DB
                perfil_riesgo: formData.perfil_riesgo || null, // Opcional, guarda null si está vacío
                objetivo_principal: objetivoPrincipalParaDB || null, // Usa el valor final (o 'otro_objetivo')
                asesorAsignado: null, // Asesor no asignado al registrar el perfil
                fotoPerfilUrl: fotoPerfilUrl // Será null si no se sube en este paso
            });

            console.log(`Perfil de cliente registrado para el usuario: ${userId}`);
            delete req.session.userCreationTime; // Limpia esta variable de sesión una vez que el registro es completo
            req.session.userType = 'cliente';
            req.session.userName = formData.nombre; // Almacena el nombre del usuario en sesión
            await req.session.save(); // Asegúrate de guardar la sesión

            req.flash('success_msg', '¡Tu perfil de cliente ha sido registrado exitosamente!');
            return res.redirect('/homecliente'); // Redirige al home del cliente

        } else if (tipo_usuario === 'asesor') {
            await dbInstance.run(`UPDATE users SET userType = 'asesor' WHERE id = ?`, [userId]);

            // Asumo que tu formulario de registro de asesor tiene estos campos
            // Asegúrate de que los nombres de los campos del formulario de asesor
            // coincidan con los que esperas aquí.
            await createAsesorProfile({
                user_id: userId,
                email: userEmail,
                nombre: formData.nombre,
                apellido: formData.apellido,
                telefono: formData.telefono || null,
                profesion: formData.profesion, 
                licencia: formData.licencia, 
                especialidad: formData.especialidad || null,
                experiencia: parseInt(formData.experiencia) || 0,
                bio: formData.descripcion || null, 
                fotoPerfilUrl: fotoPerfilUrl,
                kyc_status: 'no enviado',
                kyc_notes: null,
                title_status: 'no enviado',
                title_notes: null,
                certification_status: 'no enviado',
                certification_notes: null,
            });

            console.log(`Perfil de asesor registrado para el usuario: ${userId}`);
            delete req.session.userCreationTime;
            req.session.userType = 'asesor';
            req.session.userName = formData.nombre;
            await req.session.save();

            req.flash('success_msg', '¡Tu perfil de asesor ha sido registrado exitosamente! Espera la verificación.');
            return res.redirect('/homeasesor'); // Redirige al home del asesor

        } else {
            console.error('Error: Tipo de usuario no válido:', tipo_usuario);
            req.flash('error_msg', 'Tipo de usuario no válido. Por favor, selecciona "cliente" o "asesor".');
            return res.status(400).redirect('/registro'); // Redirige al formulario de registro general
        }
    } catch (error) {
        console.error('Error al registrar el perfil:', error); 
        // Manejo de errores específicos de base de datos
        if (error.message.includes("SQLITE_CONSTRAINT_UNIQUE")) {
            req.flash('error_msg', 'Ya existe un perfil con este email.');
        } else {
            req.flash('error_msg', `Ocurrió un error al registrar tu perfil. Por favor, inténtalo de nuevo. Detalles: ${error.message}`);
        }
        // Redirige al formulario de registro del tipo de usuario correcto para que pueda corregir
        return res.status(500).redirect(tipo_usuario === 'cliente' ? '/registro-perfil/cliente' : '/registro-perfil/asesor');
    }
});

// Dashboard Route (redirects based on user type)
router.get('/dashboard', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    // CORRECCIÓN: Usar req.session.email en lugar de req.userEmail
    const userEmail = req.session.email;
    const userType = req.session.userType;

    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : [];

    try {
        if (adminEmails.includes(userEmail)) {
            return res.redirect('/admin/verificaciones_pendientes');
        }

        if (userType === 'cliente') {
            return res.redirect('/homecliente');
        } else if (userType === 'asesor') {
            return res.redirect('/homeasesor');
        } else if (userType === 'unregistered') {
            const clienteProfile = await findClientProfile(userId);
            const asesorProfile = await findAsesorProfile(userId);

            if (!clienteProfile && !asesorProfile) {
                return res.render('ingreso/seleccionar_tipo_usuario');
            } else {
                console.warn(`User ${userId} with userType 'unregistered' but with existing profile.`);
                if (clienteProfile) {
                    req.session.userType = 'cliente';
                    await req.session.save(); // Guarda la sesión actualizada
                    return res.redirect('/homecliente');
                }
                if (asesorProfile) {
                    req.session.userType = 'asesor';
                    await req.session.save(); // Guarda la sesión actualizada
                    return res.redirect('/homeasesor');
                }
            }
        } else {
            console.error('Inconsistent profile state for user:', userId);
            req.flash('error_msg', 'Error en el estado del perfil del usuario.');
            return res.status(500).redirect('/login');
        }
    } catch (error) {
        console.error('Error verifying user profile in /dashboard:', error);
        req.flash('error_msg', 'Error al verificar el perfil del usuario.');
        return res.status(500).redirect('/login');
    }
});

// Notification Routes (sin cambios importantes aquí)
router.get('/api/asesor/notificaciones-resumen', requireAuth, requireAsesor, async (req, res) => {
    try {
        const userId = req.session.userId;
        const unreadCount = await getUnreadNotificationsCount(userId);
        const latestNotifications = await getNotificationsByUserId(userId, 5); // Obtener las 5 más recientes
        
        res.json({ 
            success: true, // Añadir 'success: true' para que el frontend lo reconozca
            unreadCount: unreadCount,
            latestNotifications: latestNotifications 
        });
    } catch (error) {
        console.error('Error fetching notification summary:', error);
        res.status(500).json({ success: false, message: 'Error fetching notification summary.' }); // Añadir 'success: false'
    }
});

router.get('/asesor/notificaciones', requireAuth, requireAsesor, async (req, res) => {
    try {
        const userId = req.session.userId;
        const notifications = await getNotificationsByUserId(userId);
        res.render('asesor/notificaciones', { notifications, success_msg: req.flash('success_msg'), error_msg: req.flash('error_msg') });
    } catch (error) {
        console.error('Error fetching full notifications page:', error);
        req.flash('error_msg', 'Error al cargar notificaciones.');
        res.redirect('/homeasesor');
    }
});

router.post('/asesor/notificaciones/marcar-leida', requireAuth, requireAsesor, async (req, res) => {
    try {
        const { notificationId } = req.body;
        const userId = req.session.userId;
        await markNotificationAsRead(notificationId, userId);
        res.json({ success: true, message: 'Notificación marcada como leída.' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ success: false, message: 'Error al marcar notificación como leída.' });
    }
});

router.get('/homecliente', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }

    const userId = req.session.userId;

    try {
        const clienteData = await findClientProfile(userId);
        let tieneAsesorAsignado = false;
        let asesorAsignadoData = null;

        if (clienteData) {
            if (clienteData.asesorAsignado) {
                tieneAsesorAsignado = true;
                const asesorDoc = await findAsesorProfile(clienteData.asesorAsignado);
                if (asesorDoc) {
                    const asesorUser = await findUserById(asesorDoc.id);
                    asesorAsignadoData = {
                        uid: asesorDoc.id,
                        nombre: asesorDoc.nombre || '',
                        apellido: asesorDoc.apellido || '',
                        email: asesorUser?.email || '',
                        telefono: asesorDoc.telefono || '',
                        especialidad: asesorDoc.especialidad || 'No especificada',
                    };
                }
            }
        } else {
            req.flash('error_msg', 'Tu perfil de cliente no se encontró. Por favor, completa tu registro.');
            return res.redirect('/login');
        }

        res.render('cliente/homecliente', {
            user: clienteData,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            tieneAsesorAsignado: tieneAsesorAsignado,
            asesorAsignado: asesorAsignadoData
        });

    } catch (error) {
        console.error('Error al cargar homecliente:', error);
        req.flash('error_msg', 'Error al cargar tu página de inicio.');
        res.redirect('/login');
    }
});

router.post('/api/cliente/despedir-asesor', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente' || !req.session.userId) {
        console.log('Despedir Asesor: Acceso denegado - userType:', req.session.userType, 'userId:', req.session.userId);
        return res.status(403).json({ message: 'Acceso denegado.' });
    }

    const clienteUid = req.session.userId;
    console.log('Despedir Asesor: Intentando desvincular asesor para cliente UID:', clienteUid);

    try {
        await updateClientProfile(clienteUid, { asesorAsignado: null });

        console.log('Despedir Asesor: Asesor desvinculado exitosamente para UID:', clienteUid);
        res.status(200).json({ message: 'Has desvinculado a tu asesor exitosamente.' });
    } catch (error) {
        console.error('Error al desvincular asesor del cliente:', error);
        res.status(500).json({ message: 'Error interno del servidor al desvincular al asesor.' });
    }
});

router.get('/homeasesor', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim()) : [];
    // CORRECCIÓN: Usa req.session.email para el rol de administrador
    const userRole = adminEmails.includes(req.session.email) ? 'admin' : 'asesor';
    const userId = req.session.userId;

    try {
        const asesorData = await findAsesorProfile(userId);
        if (!asesorData) {
            req.flash('error_msg', 'Tu perfil de asesor no se encontró. Por favor, completa tu registro.');
            return res.redirect('/login');
        }
        const unreadNotifications = await getUnreadNotificationsCount(userId);

        res.render('asesor/homeasesor', {
            user: asesorData,
            userRole: userRole,
            currentPage: 'home',
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            unreadNotifications: unreadNotifications
        });
    } catch (error) {
        console.error('Error al cargar homeasesor:', error);
        req.flash('error_msg', 'Error al cargar tu página de inicio.');
        res.redirect('/login');
    }
});



router.get('/perfilcliente', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    try {
        const userId = req.session.userId; // Este es el ID del cliente logueado
        
        // Asumiendo que findClientProfile ya trae todos los datos del cliente necesarios
        const clientProfile = await findClientProfile(userId); 

        // --- CONSOLE.LOGS DE DEBUGGING (mantener para verificar) ---
        console.log('Backend (Debug Cliente): clientProfile obtenido:', clientProfile);
        if (clientProfile) {
            console.log('Backend (Debug Cliente): Valor de clientProfile.fechaRegistro (después de DB):', clientProfile.fechaRegistro);
            console.log('Backend (Debug Cliente): Tipo de clientProfile.fechaRegistro (después de DB):', typeof clientProfile.fechaRegistro);
        }
        // --- FIN CONSOLE.LOGS DE DEBUGGING ---

        if (!clientProfile) {
            req.flash('error_msg', 'Perfil de cliente no encontrado.');
            return res.redirect('/dashboard');
        }

        // --- LÓGICA NUEVA: OBTENER EL ASESOR ASIGNADO ---
        let nombreAsesor = null; // Inicializamos a null por si no hay asesor
        let asesorIdAsignado = null; // Para almacenar el ID del asesor si existe

        // 1. Buscar la asignación en la tabla clientes_asignados
        const assignment = await db.get(
            `SELECT asesores_id FROM clientes_asignados WHERE clientes_id = ?`,
            [userId]
        );

        if (assignment && assignment.asesores_id) {
            asesorIdAsignado = assignment.asesores_id;
            
            // 2. Si hay un asesor asignado, obtener su nombre y apellido de la tabla asesores
            const asesor = await db.get(
                `SELECT nombre, apellido FROM asesores WHERE id = ?`,
                [asesorIdAsignado]
            );

            if (asesor) {
                nombreAsesor = `${asesor.nombre} ${asesor.apellido}`;
                console.log(`Backend (Debug Cliente): Asesor asignado encontrado: ${nombreAsesor}`);
            } else {
                console.warn(`Backend (Debug Cliente): Asesor con ID ${asesorIdAsignado} no encontrado en la tabla 'asesores'.`);
            }
        } else {
            console.log('Backend (Debug Cliente): No hay asesor asignado a este cliente o asignación no encontrada.');
        }
        // --- FIN LÓGICA NUEVA ---


        // Lógica para formatear la fecha con Moment.js (UTC y ajuste de hora local)
        if (clientProfile.fechaRegistro && moment(clientProfile.fechaRegistro).isValid()) {
            // Utilizamos .utc() para asegurarnos de que la fecha se interprete como UTC
            // y luego restamos las 4 horas para ajustarnos a la zona horaria de Venezuela.
            // .locale('es') asegura el formato en español (ej. "junio").
            clientProfile.formattedCreatedAt = moment.utc(clientProfile.fechaRegistro).subtract(4, 'hours').locale('es').format('LL');
        } else {
            clientProfile.formattedCreatedAt = 'Fecha de registro no disponible';
            console.warn('Backend (Debug Cliente): clientProfile.fechaRegistro no es una fecha válida o está ausente después de la recuperación.');
        }

        // --- CONSOLE.LOGS DE DEBUGGING (después del formateo) ---
        console.log('Backend (Debug Cliente): formattedCreatedAt (después del procesamiento):', clientProfile.formattedCreatedAt);
        // --- FIN CONSOLE.LOGS DE DEBUGGING ---

        res.render('cliente/perfilcliente', {
            user: clientProfile,
            nombreAsesor: nombreAsesor, // <-- ¡Aquí pasamos la variable a la plantilla!
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });
    } catch (error) {
        console.error('Error al mostrar perfil de cliente:', error);
        req.flash('error_msg', 'Error al cargar el perfil.');
        res.redirect('/homecliente'); // O la ruta a la que quieras redirigir en caso de error
    }
});

router.get('/perfilasesor', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    try {
        const userId = req.session.userId;
        const asesorProfile = await findAsesorProfile(userId);

        if (!asesorProfile) {
            req.flash('error_msg', 'Perfil de asesor no encontrado.');
            return res.redirect('/dashboard');
        }

   
        if (asesorProfile.createdAt && moment(asesorProfile.createdAt).isValid()) {
      
            asesorProfile.formattedCreatedAt = moment.utc(asesorProfile.createdAt).subtract(4, 'hours').locale('es').format('LL');
        } else {
            asesorProfile.formattedCreatedAt = 'Fecha de registro no disponible';
        }
        // --- FIN DE LA LÍNEA CLAVE ---

        res.render('asesor/perfilasesor', {
            asesor: asesorProfile,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });
    } catch (error) {
        console.error('Error al mostrar perfil de asesor:', error);
        req.flash('error_msg', 'Error al cargar el perfil.');
        res.redirect('/homeasesor');
    }
});

router.post('/perfil/editar-info-personal', requireAuth, async (req, res) => {
    const { userType, userId } = req.session;
    const updateData = req.body;

    try {
        let updatedProfile = null; // Variable para guardar el perfil actualizado

        if (userType === 'cliente') {
            await updateClientProfile(userId, updateData);
            // Después de actualizar, recupera el perfil del cliente
            updatedProfile = await findClientProfile(userId);
        } else if (userType === 'asesor') {
            await updateAsesorProfile(userId, updateData);
            // Después de actualizar, recupera el perfil del asesor
            updatedProfile = await findAsesorProfile(userId);
        } else {
            return res.status(400).json({ success: false, message: 'Tipo de usuario no reconocido.' });
        }

        // Verifica si se pudo recuperar el perfil actualizado
        if (updatedProfile) {
            // Envía los datos del perfil actualizado de vuelta al cliente
            res.json({
                success: true,
                message: 'Información personal actualizada correctamente.',
                asesor: updatedProfile // <--- ¡Esto es lo que faltaba!
                // Si fuera cliente, podrías enviar `client: updatedProfile`
            });
        } else {
            // Esto no debería ocurrir si la actualización fue exitosa, pero es un buen fallback
            res.status(500).json({ success: false, message: 'Información actualizada, pero no se pudo recuperar el perfil.' });
        }

    } catch (error) {
        console.error(`Error al actualizar la información personal para ${userType} ${userId}:`, error);
        // Puedes añadir manejo de errores más específicos aquí, por ejemplo,
        // si el email ya está en uso (UNIQUE constraint failed).
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ success: false, error: 'El email ya está en uso por otra cuenta.' });
        }
        res.status(500).json({ success: false, message: 'Error al actualizar la información personal.' });
    }
});

router.post('/perfil/editar-info-profesional', requireAuth, async (req, res) => {
    const { userType, userId } = req.session;
    const updateData = req.body; // Asumiendo que req.body contiene los campos profesionales

    try {
        let updatedProfile = null;

        // **NOTA IMPORTANTE:**
        // Si tu `updateAsesorProfile` ya es genérica y puede manejar todos los campos del asesor,
        // puedes usarla aquí también. Si tienes una función específica para "profesional", úsala.
        // Asumo que `updateAsesorProfile` es lo suficientemente flexible.

        if (userType === 'cliente') {
            // Un cliente no debería actualizar información profesional de asesor,
            // pero si tienes lógica similar para clientes (ej. otra tabla), la adaptarías aquí.
            // Por ahora, asumimos que esta ruta es solo para asesores.
            return res.status(403).json({ success: false, message: 'Acceso denegado para clientes.' });
        } else if (userType === 'asesor') {
            // Llama a la función de actualización. Aquí podrías usar updateAsesorProfile
            // si es lo suficientemente genérica, o una específica como updateAsesorProfessionalProfile
            await updateAsesorProfessionalProfile(userId, updateData); // Usamos la función adecuada

            // ¡IMPORTANTE! Recupera el perfil COMPLETO y ACTUALIZADO después de la modificación
            updatedProfile = await findAsesorProfile(userId);
        } else {
            return res.status(400).json({ success: false, message: 'Tipo de usuario no reconocido.' });
        }

        // Verifica si el perfil se pudo recuperar exitosamente
        if (updatedProfile) {
            // Envía el objeto asesor actualizado en la respuesta
            res.json({
                success: true,
                message: 'Información profesional actualizada correctamente.',
                asesor: updatedProfile // <--- ¡Asegúrate de enviar esto!
            });
        } else {
            res.status(500).json({ success: false, message: 'Información profesional actualizada, pero no se pudo recuperar el perfil.' });
        }

    } catch (error) {
        console.error(`Error al actualizar la información profesional para el asesor ${userId}:`, error);
        res.status(500).json({ success: false, message: 'Error al actualizar la información profesional.' });
    }
});

// Edit client personal info
router.post('/cliente/editar-info-personal', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') { // Changed 'client' to 'cliente'
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    const userId = req.session.userId;
    const updateData = req.body;
    try {
        await updateClientProfile(userId, updateData); // Use helper
        res.json({ success: true, message: 'Información personal del cliente actualizada correctamente.' });
    } catch (error) {
        console.error('Error al editar información personal del cliente:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar la información personal del cliente.' });
    }
});

// Edit client financial info
router.post('/cliente/editar-info-financiera', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') { // Changed 'client' to 'cliente'
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    const userId = req.session.userId;
    const updateData = req.body; // Assuming req.body contains financial fields

    try {
        await updateClientProfile(userId, updateData); // Use helper
        res.json({ success: true, message: 'Información financiera del cliente actualizada correctamente.' });
    } catch (error) {
        console.error('Error al editar información financiera del cliente:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar la información financiera del cliente.' });
    }
});

// Upload profile photo (general, used by both roles)
router.post('/upload-profile-photo', requireAuth, upload.single('profilePhoto'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No se subió ningún archivo.' });
        }

        const userId = req.session.userId;
        const userType = req.session.userType;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no autenticado o ID de sesión no disponible.' });
        }

        const imageData = req.file.buffer; // The image data as a Buffer
        const imageMimeType = req.file.mimetype; // The MIME type of the image

        let success = false;
        if (userType === 'asesor') {
            success = await updateAsesorProfilePhoto(userId, imageData, imageMimeType); // Use helper
        } else if (userType === 'cliente') { // Changed 'client' to 'cliente'
            success = await updateClientProfilePhoto(userId, imageData, imageMimeType); // Use helper
        } else {
            return res.status(400).json({ success: false, message: 'Tipo de usuario no reconocido para la subida de foto.' });
        }

        if (success) {
            console.log(`Profile photo updated in SQLite for ${userType} ${userId}.`);
            return res.json({
                success: true,
                message: 'Foto de perfil subida y actualizada correctamente.',
            });
        } else {
            return res.status(500).json({ success: false, message: 'Error al guardar la foto de perfil en la base de datos.' });
        }

    } catch (error) {
        console.error('Error in /upload-profile-photo endpoint:', error);
        if (error instanceof multer.MulterError) {
            return res.status(400).json({ success: false, message: `Error en la subida: ${error.message}` });
        }
        return res.status(500).json({ success: false, message: 'Error interno del servidor al procesar la imagen.' });
    }
});

// --- New route to serve profile photos (for display) ---
router.get('/profile-photo/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
      
        let photoData = null;
        let mimeType = null;

        const clientPhoto = await getClientProfilePhoto(userId); // Use helper
        if (clientPhoto && clientPhoto.photo_blob) {
            photoData = clientPhoto.photo_blob;
            mimeType = clientPhoto.photo_mimetype; // Assuming you've added this to your DDL and getClientProfilePhoto
        } else {
            const asesorPhoto = await getAsesorProfilePhoto(userId); // Use helper
            if (asesorPhoto && asesorPhoto.photo_blob) {
                photoData = asesorPhoto.photo_blob;
                mimeType = asesorPhoto.photo_mimetype; // Assuming you've added this to your DDL and getAsesorProfilePhoto
            }
        }

        if (photoData) {
            res.setHeader('Content-Type', mimeType || 'image/jpeg'); // Default to jpeg if no mimetype
            res.send(photoData);
        } else {
            // Serve a default image if no profile photo exists
            const defaultImagePath = path.join(__dirname, '../public/images/default-profile.png');
            res.sendFile(defaultImagePath);
        }
    } catch (error) {
        console.error('Error serving profile photo:', error);
        res.status(500).send('Error al cargar la foto de perfil.');
    }
});







const asesorController = {
     getChangePasswordPage: (req, res) => {
        // Asegúrate de que 'asesor/cambiar_password' sea la ruta correcta a tu archivo .ejs
        // Pasamos los mensajes flash para que la vista los pueda mostrar
        res.render('asesor/cambiar_password', {
            error: req.flash('error'),         // Para un array de errores de validación (ej. newPassword !== confirmNewPassword)
            error_msg: req.flash('error_msg'), // Para mensajes de error generales (ej. contraseña actual incorrecta)
            success_msg: req.flash('success_msg') // Para mensajes de éxito
        });
    },

    // Función para manejar el POST del formulario de cambio de contraseña
    changePassword: async (req, res) => {
        const { userId } = req.session; // Obtiene el ID del usuario actual de la sesión
        // Captura los tres campos del formulario: contraseña actual, nueva y confirmación
        const { currentPassword, newPassword, confirmNewPassword } = req.body;

        let errors = []; // Array para recolectar errores de validación

        // --- 1. Validaciones del lado del servidor ---
        if (!currentPassword || !newPassword || !confirmNewPassword) {
            errors.push('Por favor, completa todos los campos.');
        }
        if (newPassword !== confirmNewPassword) {
            errors.push('La nueva contraseña y la confirmación no coinciden.');
        }
        if (newPassword.length < 6) { // Puedes ajustar la longitud mínima según tus requisitos de seguridad
            errors.push('La nueva contraseña debe tener al menos 6 caracteres.');
        }

        // Si hay errores de validación, flasheamos los mensajes y redirigimos de vuelta al formulario
        if (errors.length > 0) {
            req.flash('error', errors);         // Si `cambiar_password.ejs` espera `error` como un array
            req.flash('error_msg', errors.join(' ')); // Si tu vista solo muestra un string para `error_msg`
            return res.redirect('/cambiar-password'); // Redirige de vuelta al formulario de cambio de contraseña
        }

        const db = getDb(); // Obtiene la instancia de la base de datos

        try {
            // --- 2. Verificar la contraseña actual del usuario ---
            // Recupera el hash de la contraseña almacenado para el usuario en la tabla `users`
            const user = await db.get(`SELECT id, password_hash FROM users WHERE id = ?`, [userId]);

            if (!user) {
                // Si el usuario no se encuentra (lo cual no debería pasar con `requireAuth` pero es buena práctica cubrirlo)
                req.flash('error_msg', 'Usuario no encontrado. Por favor, inicie sesión de nuevo.');
                return res.redirect('/login'); // Redirige al login o a una página de error genérica
            }

            // Compara la contraseña actual ingresada por el usuario con el hash almacenado
            const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
            if (!isMatch) {
                req.flash('error_msg', 'La contraseña actual es incorrecta.');
                return res.redirect('/cambiar-password'); // Redirige de nuevo al formulario con el error
            }

            // --- 3. Hashear y actualizar la nueva contraseña ---
            // Genera un nuevo hash para la nueva contraseña proporcionada por el usuario
            const newPasswordHash = await bcrypt.hash(newPassword, 10); // El costo del salt (10) es un buen valor

            // Actualiza el `password_hash` en la tabla `users` para el `userId`
            await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [newPasswordHash, userId]);

            // --- 4. Redirección en caso de éxito ---
            // Si todo el proceso es exitoso, flasheamos un mensaje de éxito
            req.flash('success_msg', 'Contraseña cambiada exitosamente.');
            // Y luego redirigimos al usuario a la página de su perfil
            return res.redirect('/perfilasesor'); // <--- ¡Esta es la redirección clave al perfil!

        } catch (error) {
            // Manejo de cualquier error inesperado durante el proceso de base de datos o bcrypt
            console.error('Error al cambiar la contraseña del asesor:', error);
            req.flash('error_msg', 'Error interno del servidor al cambiar la contraseña. Por favor, inténtalo de nuevo más tarde.');
            return res.redirect('/cambiar-password'); // En caso de error, vuelve al formulario
        }
    },


        getVerificationPageAsesor: async (req, res) => {
        console.log('CONTROLLER GET_VERIFY: *** INICIO DE FUNCION getVerificationPageAsesor ***'); 
        const db = getDb(); 
        const userId = req.session.userId; 
        console.log('CONTROLLER GET_VERIFY: userId obtenido de sesión para consulta:', userId);

        if (!userId) {
            console.error('CONTROLLER GET_VERIFY: userId no encontrado en la sesión. Esto no debería pasar si requireAuth funciona.');
            req.flash('error_msg', 'ID de usuario no encontrado en la sesión. Por favor, inicia sesión de nuevo.');
            return res.redirect('/login');
        }

        try {
            console.log(`CONTROLLER GET_VERIFY: Ejecutando consulta SELECT completa para asesor con ID: ${userId}`);
            // Consulta la base de datos, incluyendo ahora las columnas `notes`.
            const asesor = await db.get(`
                SELECT 
                    id, 
                    email, 
                    nombre, 
                    apellido, 
                    fotoPerfilUrl,
                    kyc_status, 
                    kyc_notes,                  -- RESTAURADO
                    kyc_document_type, 
                    kyc_document_number,
                    kyc_front_url, 
                    kyc_back_url, 
                    kyc_selfie_url, 
                    title_status, 
                    title_notes,                -- RESTAURADO
                    title_document_url, 
                    certification_status, 
                    certification_notes,        -- RESTAURADO
                    certification_document_url
                FROM asesores 
                WHERE id = ?
            `, [userId]);

            console.log('CONTROLLER GET_VERIFY: Datos crudos del asesor desde DB:', asesor); 

            if (!asesor) {
                console.warn(`CONTROLLER GET_VERIFY: Asesor con ID ${userId} NO encontrado en la base de datos. Redirigiendo a /dashboard.`);
                req.flash('error_msg', 'No se pudo cargar la información del asesor. Intenta iniciar sesión de nuevo.');
                return res.redirect('/dashboard'); 
            }

            console.log('CONTROLLER GET_VERIFY: Asesor encontrado. Mapeando datos para la vista EJS.');
            // Mapeo de datos, incluyendo ahora las propiedades `notes`.
            const asesorParaVista = {
                id: asesor.id,
                email: asesor.email,
                nombre: asesor.nombre,
                apellido: asesor.apellido,
                fotoPerfilUrl: asesor.fotoPerfilUrl,
                
                verification: { 
                    status: asesor.kyc_status,
                    notes: asesor.kyc_notes, // RESTAURADO
                    documentType: asesor.kyc_document_type || '', 
                    documentNumber: asesor.kyc_document_number || '', 
                    photos: {
                        front: asesor.kyc_front_url || '',    
                        back: asesor.kyc_back_url || '',      
                        selfie: asesor.kyc_selfie_url || ''   
                    }
                },
                verificacion: { 
                    titulo: {
                        estado: asesor.title_status,
                        notas: asesor.title_notes, // RESTAURADO
                        urlDocumento: asesor.title_document_url || '' 
                    },
                    certificacion: {
                        estado: asesor.certification_status,
                        notas: asesor.certification_notes, // RESTAURADO
                        urlDocumento: asesor.certification_document_url || '' 
                    }
                }
            };
            
            console.log('CONTROLLER GET_VERIFY: Datos de asesorParaVista listos. Renderizando la página de verificación.');
            res.render('asesor/verificar_identidad', {
                asesor: asesorParaVista, 
                success_msg: req.flash('success_msg'),
                error_msg: req.flash('error_msg'),
                info_msg: req.flash('info_msg'),
                error: req.flash('error') 
            });

        } catch (error) {
            console.error('ERROR CRÍTICO en getVerificationPageAsesor (catch block):', error);
            if (error.message.includes('no such column')) {
                console.error('ERROR CRÍTICO: Posible inconsistencia entre el esquema de la DB y la consulta SQL. Revisa database.js y el SELECT.');
            }
            req.flash('error_msg', 'Error al cargar la información de verificación. Por favor, inténtalo de nuevo. Contacta a soporte si persiste.');
            res.redirect('/dashboard'); 
        }
    },

    // Función para manejar el envío del formulario de verificación de identidad y credenciales
     postVerifyIdentityAsesor: async (req, res) => {
        const db = getDb();
        const { userId } = req.session; // Asegúrate de que userId es el ID del asesor logueado

        // Captura todos los campos del formulario de la vista verificar_identidad.ejs
        const { 
            documentType, documentNumber, frontPhotoUrl, backPhotoUrl, selfiePhotoUrl,
            tituloUniversitarioUrl, certificacionProfesionalUrl, notes // 'notes' es kyc_notes
        } = req.body;

        let errors = [];

        // --- Validaciones del lado del servidor para URLs ---
        // Estas validaciones deben aplicarse a los campos que se están enviando,
        // independientemente de si ya están verificados o no.
        // Si un campo es requerido para la SUBMISIÓN, valida que esté presente.
        if (!documentType || !documentNumber || !frontPhotoUrl || !selfiePhotoUrl || !tituloUniversitarioUrl) {
             // Este mensaje se mostrará si falta cualquier campo obligatorio, incluso si uno de ellos ya estaba verificado pero los otros no.
             // Considera si esta validación debe ser más granular, por ejemplo, solo para los campos NO VERIFICADOS.
             // Para simplificar, la mantendremos así por ahora.
            errors.push('Por favor, completa todos los campos obligatorios para identidad y título universitario.');
        }

        const urlRegex = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
        if (frontPhotoUrl && !urlRegex.test(frontPhotoUrl)) errors.push('La URL de la foto frontal no es válida.');
        if (backPhotoUrl && backPhotoUrl.length > 0 && !urlRegex.test(backPhotoUrl)) errors.push('La URL de la foto trasera no es válida.');
        if (selfiePhotoUrl && !urlRegex.test(selfiePhotoUrl)) errors.push('La URL de la selfie no es válida.');
        if (tituloUniversitarioUrl && !urlRegex.test(tituloUniversitarioUrl)) errors.push('La URL del título universitario no es válida.');
        if (certificacionProfesionalUrl && certificacionProfesionalUrl.length > 0 && !urlRegex.test(certificacionProfesionalUrl)) errors.push('La URL de la certificación profesional no es válida.');


        if (errors.length > 0) {
            req.flash('error_msg', errors.join(' '));
            // Para que los datos pre-llenados sigan apareciendo, podrías recargar el 'asesor' aquí
            // o simplemente redirigir, que ya recarga el estado del asesor en la siguiente request.
            return res.redirect('/asesor/verificar_identidad'); 
        }

        try {
            // 1. Obtener los estados de verificación actuales del asesor desde la base de datos
            const currentAsesor = await db.get(`
                SELECT 
                    kyc_status, kyc_document_type, kyc_document_number, kyc_front_url, kyc_back_url, kyc_selfie_url, kyc_notes,
                    title_status, title_document_url, title_notes,
                    certification_status, certification_document_url, certification_notes
                FROM asesores
                WHERE id = ?
            `, [userId]);

            if (!currentAsesor) {
                req.flash('error_msg', 'Asesor no encontrado.');
                return res.redirect('/asesor/verificar_identidad');
            }

            let updateFields = [];
            let updateParams = [];

            // NOTA: 'kyc_notes' es el único campo de notas que el usuario puede modificar directamente.
            // Siempre lo actualizamos con lo que venga del formulario.
            updateFields.push('kyc_notes = ?');
            updateParams.push(notes || null);
            
            // --- Lógica para Identidad (KYC) ---
            // Solo actualizamos si no está 'verificado'
            if (currentAsesor.kyc_status !== 'verificado') {
                updateFields.push('kyc_status = ?');
                updateParams.push('pendiente'); // Se establece como pendiente al ser reenviado
                updateFields.push('kyc_document_type = ?');
                updateParams.push(documentType || null);
                updateFields.push('kyc_document_number = ?');
                updateParams.push(documentNumber || null);
                updateFields.push('kyc_front_url = ?');
                updateParams.push(frontPhotoUrl || null);
                updateFields.push('kyc_back_url = ?');
                updateParams.push(backPhotoUrl || null);
                updateFields.push('kyc_selfie_url = ?');
                updateParams.push(selfiePhotoUrl || null);
            } else {
                // Si ya está verificado, aseguramos que los campos se mantengan con sus valores originales
                // y no se sobrescriban con los datos potencialmente vacíos o viejos del formulario.
                // Aunque son 'readonly' en el frontend, se siguen enviando.
                // En este caso, no los incluimos en la sentencia UPDATE.
                // No necesitamos hacer nada aquí porque la condición `if (currentAsesor.kyc_status !== 'verificado')`
                // ya previene que se añadan al `updateFields` y `updateParams`.
            }

            // --- Lógica para Título Universitario ---
            // Solo actualizamos si no está 'verificado'
            if (currentAsesor.title_status !== 'verificado') {
                updateFields.push('title_status = ?');
                updateParams.push('pendiente'); // Se establece como pendiente al ser reenviado
                updateFields.push('title_document_url = ?');
                updateParams.push(tituloUniversitarioUrl || null);
            }
            // title_notes no se actualiza desde este formulario de usuario, se mantiene el valor existente en DB.

            // --- Lógica para Certificación Profesional ---
            // Solo actualizamos si no está 'verificado'
            if (currentAsesor.certification_status !== 'verificado') {
                updateFields.push('certification_status = ?');
                updateParams.push('pendiente'); // Se establece como pendiente al ser reenviado
                updateFields.push('certification_document_url = ?');
                updateParams.push(certificacionProfesionalUrl || null);
            }
            // certification_notes no se actualiza desde este formulario de usuario, se mantiene el valor existente en DB.


            // Si no hay campos para actualizar (porque todo está verificado, o solo se enviaron notas sin cambios relevantes)
            // Agregamos `updatedAt` para que siempre haya un cambio de tiempo.
            updateFields.push('updatedAt = CURRENT_TIMESTAMP');
            
            // Si solo se actualizó la nota (kyc_notes) o no hubo cambios significativos en secciones no verificadas
            if (updateFields.length === 0) { // Esto podría ocurrir si solo se envía la nota y todo lo demás está verificado
                req.flash('info_msg', 'No se encontraron cambios pendientes para guardar. Todos los documentos ya están verificados o no se proporcionaron URLs para los documentos pendientes.');
                return res.redirect('/perfilasesor');
            }

            const updateQuery = `
                UPDATE asesores 
                SET ${updateFields.join(', ')}
                WHERE id = ?
            `;
            updateParams.push(userId); // El userId va al final para el WHERE

            await db.run(updateQuery, updateParams);

            req.flash('success_msg', 'Documentos enviados para verificación. Te notificaremos una vez que sean revisados.');
            return res.redirect('/perfilasesor');

        } catch (error) {
            console.error('Error al subir documentos para verificación:', error);
            req.flash('error_msg', 'Error al procesar la solicitud de verificación.');
            res.redirect('/asesor/verificar_identidad');
        }
    },
      mostrarClientesAsignados: async (req, res) => {
        console.log('asesorController.mostrarClientesAsignados: *** INICIO DE FUNCION ***');
        const asesorId = req.session.userId;

        if (!asesorId) {
            console.error('asesorController.mostrarClientesAsignados: userId no encontrado en la sesión. Redirigiendo a login.');
            req.flash('error_msg', 'No se pudo identificar al asesor. Por favor, inicie sesión de nuevo.');
            return res.redirect('/auth/login'); 
        }

        console.log(`asesorController.mostrarClientesAsignados: Asesor ID obtenido: ${asesorId}`);

        try {
        
            const clientes = await db.all(`
                SELECT 
                    id, 
                    nombre, 
                    apellido, 
                    email, 
                    fotoPerfilUrl 
                FROM clientes  -- <--- ¡Tabla 'clientes', no 'clients'!
                WHERE asesorAsignado = ? -- <--- ¡Columna 'asesorAsignado', no JOIN con 'assigned_clients'!
            `, [asesorId]);

            console.log(`asesorController.mostrarClientesAsignados: ${clientes.length} clientes encontrados.`);

            res.render('asesor/clientes_asignados', {
                title: 'Clientes Asignados',
                clientes: clientes, 
                error: req.flash('error'),
                error_msg: req.flash('error_msg'),
                success_msg: req.flash('success_msg'),
                info_msg: req.flash('info_msg')
            });
            console.log('asesorController.mostrarClientesAsignados: Vista clientes_asignados renderizada exitosamente.');

        } catch (error) {
            console.error('ERROR CRÍTICO en asesorController.mostrarClientesAsignados (catch block):', error);
            // Si el error es SQL (ej. tabla no existe, columna no existe), se atrapará aquí.
            req.flash('error_msg', 'Error al cargar los clientes asignados. Por favor, inténtalo de nuevo más tarde.');
            return res.redirect('/dashboard'); 
        }
    },

   mostrarChatGeneralAsesor: async (req, res) => {
        try {
            const asesorId = req.session.userId;
            const asesorName = req.session.userName;
            
            // 1. Obtener los datos 'crudos' de la base de datos
            const clientsRaw = await db.all(`
                SELECT 
                    c.id, 
                    c.nombre, 
                    c.apellido, 
                    c.fotoPerfilUrl,
                    cr.last_message_text,     
                    cr.asesor_unread_count,   
                    cr.last_message_timestamp
                FROM clientes_asignados ca
                JOIN clientes c ON ca.clientes_id = c.id
                LEFT JOIN chat_rooms cr ON (cr.client_id = c.id AND cr.asesor_id = ca.asesores_id)
                WHERE ca.asesores_id = ? 
                ORDER BY cr.last_message_timestamp DESC, c.nombre ASC
            `, [asesorId]);

            // 2. Formatear los clientes para la sidebar y asegurar consistencia de nombres
            const clientesParaSidebarFormatted = clientsRaw.map(client => ({
                id: client.id,
                nombre: client.nombre,
                apellido: client.apellido,
                fotoPerfilUrl: client.fotoPerfilUrl || '/images/default-profile.png',
                lastMessage: client.last_message_text || 'Sin mensajes',   // <--- ALIAS A lastMessage
                unreadCount: client.asesor_unread_count || 0,     // <--- ALIAS A unreadCount
                last_message_timestamp: client.last_message_timestamp // Mantener para ordenamiento si es necesario
            }));

            let initialChatCliente = null;
            let initialChatMessages = [];
            let initialRoomId = null;

            const preselectedClientId = req.query.withClientId;

            if (clientesParaSidebarFormatted && clientesParaSidebarFormatted.length > 0) {
                let clientToDisplay = null;
                if (preselectedClientId) {
                    clientToDisplay = clientesParaSidebarFormatted.find(c => c.id === preselectedClientId);
                }
                if (!clientToDisplay) {
                    clientToDisplay = clientesParaSidebarFormatted[0]; 
                }

                if (clientToDisplay) {
                    initialChatCliente = clientToDisplay; // Este objeto ya tendrá lastMessage y unreadCount
                    initialRoomId = [asesorId, initialChatCliente.id].sort().join('_');

                    await db.run(`
                        INSERT OR IGNORE INTO chat_rooms (room_id, client_id, asesor_id)
                        VALUES (?, ?, ?)
                    `, [initialRoomId, initialChatCliente.id, asesorId]);

                    // Actualiza el contador de no leídos del asesor para este cliente al abrir el chat
                    await db.run('UPDATE chat_rooms SET asesor_unread_count = 0 WHERE room_id = ?', [initialRoomId]);

                    // ALIASING 'sender_id' a 'senderId' y 'sender_type' a 'senderType' (esto ya estaba bien)
                    initialChatMessages = await db.all(
                        'SELECT id, room_id, sender_id AS senderId, sender_type AS senderType, text, timestamp FROM chat_messages WHERE room_id = ? ORDER BY timestamp ASC',
                        [initialRoomId]
                    );
                }
            }
            
            const asesor = await db.get('SELECT id, nombre, apellido, fotoPerfilUrl FROM asesores WHERE id = ?', [asesorId]);

            res.render('asesor/chat_general_asesor', {
                pageTitle: 'Chat General de Asesor',
                asesor: asesor, 
                clientesParaSidebar: clientesParaSidebarFormatted, // <--- Pasar el array formateado
                initialChatCliente: initialChatCliente,
                initialChatMessages: initialChatMessages,
                initialRoomId: initialRoomId, 
                userName: asesorName, 
                messages: req.flash('success_msg'), 
                errors: req.flash('error_msg'),
                info: req.flash('info_msg')
            });
        } catch (error) {
            console.error('Error loading asesor chat general:', error);
            req.flash('error_msg', 'Error al cargar el chat general del asesor.');
            res.redirect('/homeasesor'); 
        }
    },

    getClienteChatMessages: async (req, res) => {
        try {
            const asesorId = req.session.userId;
            const clienteId = req.params.clienteId;
            const roomId = [asesorId, clienteId].sort().join('_');

            const chat = await db.get('SELECT * FROM chat_rooms WHERE room_id = ?', [roomId]);
            if (chat && chat.asesor_unread_count > 0) {
                await db.run('UPDATE chat_rooms SET asesor_unread_count = 0 WHERE room_id = ?', [roomId]);
            }

            // ALIASING 'sender_id' a 'senderId' y 'sender_type' a 'senderType'
            const messages = await db.all('SELECT id, room_id, sender_id AS senderId, sender_type AS senderType, text, timestamp FROM chat_messages WHERE room_id = ? ORDER BY timestamp ASC', [roomId]);
            res.json({ success: true, messages: messages });
        } catch (error) {
            console.error('Error fetching chat messages for asesor:', error);
            res.status(500).json({ success: false, message: 'Error fetching messages.' });
        }
    },

    asesorSendMessage: async (req, res) => {
        try {
            const { clienteId, messageText, timestamp } = req.body;
            const asesorId = req.session.userId; // ID del asesor desde la sesión (autoritativo)
            const asesorName = req.session.userName;
            const finalTimestamp = timestamp || new Date().toISOString(); // Usa el del frontend o genera uno
            const messageId = uuidv4(); // ¡Genera el ID UNA SOLA VEZ aquí!

            const roomId = [asesorId, clienteId].sort().join('_');
            
            await db.run(`
                INSERT OR IGNORE INTO chat_rooms (room_id, client_id, asesor_id)
                VALUES (?, ?, ?)
            `, [roomId, clienteId, asesorId]);

            await db.run(`
                INSERT INTO chat_messages (id, room_id, sender_id, sender_type, text, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [messageId, roomId, asesorId, 'asesor', messageText, finalTimestamp]); // Usa el messageId generado

            await db.run(`
                UPDATE chat_rooms
                SET last_message_text = ?,
                    last_message_timestamp = ?,
                    client_unread_count = client_unread_count + 1
                WHERE room_id = ?
            `, [messageText, finalTimestamp, roomId]);

            // Asumiendo que addNotificationToUser es una función disponible globalmente o importada
            // Si addNotificationToUser no está definida, tendrás que definirla o importarla.
            // Por ejemplo, si es una función auxiliar en otro archivo:
            // const addNotificationToUser = require('./utils/notifications');
            const notificationMessage = `Nuevo mensaje de tu asesor ${asesorName}: "${messageText.substring(0, 50)}..."`;
            await addNotificationToUser(clienteId, notificationMessage, '/chat/personal');

            // Devuelve el mismo ID y la información completa del mensaje al frontend
            res.json({
                success: true,
                message: 'Mensaje enviado.',
                messageId: messageId, // ¡Importante: devuelve el mismo ID!
                senderId: asesorId, // Confirma el senderId
                senderType: 'asesor', // Confirma el senderType
                text: messageText,
                timestamp: finalTimestamp // Confirma el timestamp
            });
        } catch (error) {
            console.error('Error sending message from asesor:', error);
            res.status(500).json({ success: false, message: 'Error sending message.' });
        }
    },

    getClientesChatSidebar: async (req, res) => {
        try {
            const asesorId = req.session.userId;

            const assignedClients = await db.all(`
                SELECT c.id, c.nombre, c.apellido, c.fotoPerfilUrl,
                        cr.last_message_text, cr.asesor_unread_count, cr.last_message_timestamp
                FROM clientes_asignados ca
                JOIN clientes c ON ca.clientes_id = c.id
                LEFT JOIN chat_rooms cr ON (cr.client_id = c.id AND cr.asesor_id = ca.asesores_id)
                WHERE ca.asesores_id = ?
                ORDER BY cr.last_message_timestamp DESC, c.nombre ASC 
            `, [asesorId]);

            let clientesActualizados = [];
            for (const client of assignedClients) {
                clientesActualizados.push({
                    id: client.id,
                    nombre: client.nombre,
                    apellido: client.apellido,
                    fotoPerfilUrl: client.fotoPerfilUrl || '/images/default-profile.png',
                    lastMessage: client.last_message_text || 'No hay mensajes', 
                    unreadCount: client.asesor_unread_count || 0, 
                    lastMessageTimestamp: client.last_message_timestamp 
                });
            }
            res.json({ success: true, clientes: clientesActualizados });

        } catch (error) {
            console.error('Backend: Error al obtener datos de clientes para la sidebar (SQLite):', error);
            res.status(500).json({ success: false, message: 'Error al actualizar clientes de la sidebar.' });
        }
    },

  mostrarCalendarioAsesor: (req, res) => {
        // Simplemente renderiza la vista EJS del calendario.
        // FullCalendar se encarga de llamar a la API para obtener los eventos.
        res.render('asesor/calendario', { title: 'Calendario de Eventos - Asesor' });
    },

    // <<-- FUNCIONES PARA LOS EVENTOS DEL ASESOR (tabla asesorEventos) -->>
    getEventosAsesorAPI: async (req, res) => {
        console.log('asesorController.getEventosAsesorAPI: *** INICIO DE FUNCION ***');
        try {
            const asesorId = req.session.userId; 

            if (!asesorId) {
                console.error('getEventosAsesorAPI: asesorId no encontrado en la sesión.');
                return res.status(401).json({ success: false, message: 'No autorizado. Por favor, inicie sesión.' });
            }

            // Seleccionar también la columna allDay
            const events = await db.all('SELECT id, title, start, end, description, allDay FROM asesorEventos WHERE asesorId = ?', [asesorId]); 
            
            console.log(`getEventosAsesorAPI: ${events.length} eventos encontrados para asesor ${asesorId}.`);
            console.log('Eventos obtenidos:', events);

            res.json(events);
        } catch (error) {
            console.error('ERROR CRÍTICO en asesorController.getEventosAsesorAPI (catch block):', error);
            res.status(500).json({ success: false, message: 'Error al obtener eventos del asesor.' });
        }
    },
    crearEventoAsesorAPI: async (req, res) => {
        console.log('asesorController.crearEventoAsesorAPI: *** INICIO DE FUNCION ***');
        try {
            // Recibir allDay, end y description.
            // FullCalendar envía 'start' directamente.
            const { title, start, end, description, allDay } = req.body; 
            const asesorId = req.session.userId; 

            if (!asesorId) {
                console.error('crearEventoAsesorAPI: asesorId no encontrado en la sesión.');
                return res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
            }

            if (!title) { 
                console.error('crearEventoAsesorAPI: Datos incompletos (title).');
                return res.status(400).json({ success: false, message: 'Datos de evento incompletos: Título del evento es requerido.' });
            }

            // Asigna la fecha actual si 'start' no viene del frontend (ej. al agregar solo por nombre)
            // Mantener la lógica de FullCalendar para `start` y `end` que pueden ser ISO strings completas
            const eventStart = start; 
            const eventEnd = end || start; // Usar 'end' si se proporciona, sino igual a 'start'
            const eventDescription = description || null; // Usar 'description' si se proporciona, sino nulo

            // Usar uuidv4 para generar un ID único, más robusto
            const eventId = `asevt_${uuidv4()}`; 

            // Insertar el evento en la tabla `asesorEventos` con allDay
            await db.run('INSERT INTO asesorEventos (id, asesorId, title, start, end, description, allDay, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [eventId, asesorId, title, eventStart, eventEnd, eventDescription, allDay ? 1 : 0]); 
            
            console.log(`crearEventoAsesorAPI: Evento creado con ID: ${eventId} para asesor ${asesorId}.`);
            res.json({ success: true, id: eventId, message: 'Evento creado exitosamente.' });
        } catch (error) {
            console.error('ERROR CRÍTICO en asesorController.crearEventoAsesorAPI (catch block):', error);
            res.status(500).json({ success: false, message: 'Error al crear evento del asesor.' });
        }
    },
    editarEventoAsesorAPI: async (req, res) => {
        console.log('asesorController.editarEventoAsesorAPI: *** INICIO DE FUNCION ***');
        try {
            const { id } = req.params;
            // Recibir allDay, end y description.
            const { title, start, end, description, allDay } = req.body; 
            const asesorId = req.session.userId; 

            if (!asesorId) {
                console.error('editarEventoAsesorAPI: asesorId no encontrado en la sesión.');
                return res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
            }

            if (!id || !title || !start) {
                console.error('editarEventoAsesorAPI: Datos incompletos (id, title, start).');
                return res.status(400).json({ success: false, message: 'Datos de actualización incompletos.' });
            }

            const eventEnd = end || start; 
            const eventDescription = description || null; 

            // Actualizar el evento en la tabla `asesorEventos` con allDay
            const result = await db.run('UPDATE asesorEventos SET title = ?, start = ?, end = ?, description = ?, allDay = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND asesorId = ?', 
                [title, start, eventEnd, eventDescription, allDay ? 1 : 0, id, asesorId]); 
            
            if (result.changes === 0) {
                console.warn(`editarEventoAsesorAPI: No se actualizó el evento ID ${id} para asesor ${asesorId}. Puede que no exista o no sea del usuario.`);
                return res.status(404).json({ success: false, message: 'Evento no encontrado o no autorizado para actualizar.' });
            }

            console.log(`editarEventoAsesorAPI: Evento ID ${id} actualizado exitosamente para asesor ${asesorId}.`);
            res.json({ success: true, message: 'Evento actualizado.' });
        } catch (error) {
            console.error('ERROR CRÍTICO en asesorController.editarEventoAsesorAPI (catch block):', error);
            res.status(500).json({ success: false, message: 'Error al actualizar evento.' });
        }
    },
    eliminarEventoAsesorAPI: async (req, res) => {
        console.log('asesorController.eliminarEventoAsesorAPI: *** INICIO DE FUNCION ***');
        try {
            const { id } = req.params;
            const asesorId = req.session.userId; 

            if (!asesorId) {
                console.error('eliminarEventoAsesorAPI: asesorId no encontrado en la sesión.');
                return res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
            }

            if (!id) {
                console.error('eliminarEventoAsesorAPI: ID de evento no proporcionado.');
                return res.status(400).json({ success: false, message: 'Datos para eliminar incompletos.' });
            }

            const result = await db.run('DELETE FROM asesorEventos WHERE id = ? AND asesorId = ?', [id, asesorId]); 
            
            if (result.changes === 0) {
                return res.status(404).json({ success: false, message: 'Evento no encontrado o no autorizado para eliminar.' });
            }

            console.log(`eliminarEventoAsesorAPI: Evento ID ${id} eliminado exitosamente para asesor ${asesorId}.`);
            res.json({ success: true, message: 'Evento eliminado.' });
        } catch (error) {
            console.error('ERROR CRÍTICO en asesorController.eliminarEventoAsesorAPI (catch block):', error);
            res.status(500).json({ success: false, message: 'Error al eliminar evento.' });
        }
    },
};

const clienteController = {
     getChangePasswordPageCliente: (req, res) => res.render('cliente/cambiar_password'),
    
    changePasswordCliente: async (req, res) => {
        const dbInstance = getDb(); // Obtener la instancia de la base de datos
        try {
            const { currentPassword, newPassword, confirmNewPassword } = req.body; // Añadir confirmNewPassword
            const userId = req.session.userId; // ID del usuario logueado (cliente)

            if (!userId) {
                req.flash('error_msg', 'No autenticado para cambiar la contraseña.');
                return res.redirect('/login'); 
            }

            // --- Validación de nueva contraseña y confirmación ---
            if (newPassword !== confirmNewPassword) {
                req.flash('error_msg', 'La nueva contraseña y la confirmación no coinciden.');
                return res.redirect('/cliente/cambiar_password'); 
            }

            const user = await dbInstance.get('SELECT password_hash FROM users WHERE id = ?', [userId]);

            if (!user) {
                req.flash('error_msg', 'Usuario no encontrado.');
                return res.redirect('/cliente/cambiar_password'); 
            }

            const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
            if (!isMatch) {
                req.flash('error_msg', 'Contraseña actual incorrecta.');
                return res.redirect('/cliente/cambiar_password'); 
            }

            const newPasswordHash = await bcrypt.hash(newPassword, 10);

            await dbInstance.run('UPDATE users SET password_hash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [newPasswordHash, userId]);

            req.flash('success_msg', 'Contraseña cambiada exitosamente.');
            return res.redirect('/perfilcliente'); 

        } catch (error) {
            console.error('Error cambiando contraseña de cliente:', error);
            req.flash('error_msg', 'Error al cambiar la contraseña. Inténtalo de nuevo más tarde.');
            return res.redirect('/cliente/cambiar_password'); 
        }
    },


    // Función para que el ASESOR vea el perfil de un cliente
    mostrarPerfilClienteAsesor: async (req, res) => {
        console.log('clienteController.mostrarPerfilClienteAsesor: *** INICIO DE FUNCION ***');
        const clienteId = req.params.id_cliente; 

        if (!clienteId) {
            console.error('clienteController.mostrarPerfilClienteAsesor: ID de cliente no proporcionado.');
            req.flash('error_msg', 'ID de cliente no proporcionado.');
            return res.redirect('/asesor/clientes-asignados'); 
        }

        console.log(`clienteController.mostrarPerfilClienteAsesor: Cliente ID obtenido: ${clienteId}`);

        try {
            const cliente = await db.get(`
                SELECT 
                    id, 
                    nombre, 
                    apellido, 
                    email, 
                    telefono, 
                    direccion, 
                    ingresosMensuales,     
                    gastosMensuales,       
                    ahorrosActuales,       
                    objetivosFinancieros,  
                    perfil_riesgo,         
                    objetivo_principal,    
                    createdAt as fechaRegistro, 
                    fotoPerfilUrl 
                FROM clientes              
                WHERE id = ?
            `, [clienteId]);

            if (!cliente) {
                console.warn(`clienteController.mostrarPerfilClienteAsesor: Cliente con ID ${clienteId} NO encontrado en la base de datos.`);
                req.flash('error_msg', 'Cliente no encontrado.');
                return res.redirect('/asesor/clientes-asignados');
            }

            console.log('clienteController.mostrarPerfilClienteAsesor: Cliente encontrado. Renderizando vista de perfil.');
            console.log('Datos del cliente para renderizar (revisar nombres de propiedades):', cliente); 

            res.render('asesor/perfil_cliente', { 
                title: `Perfil de ${cliente.nombre} ${cliente.apellido}`,
                cliente: cliente, 
                error: req.flash('error'),
                error_msg: req.flash('error_msg'),
                success_msg: req.flash('success_msg'),
                info_msg: req.flash('info_msg')
            });
            console.log('clienteController.mostrarPerfilClienteAsesor: Vista perfil_cliente renderizada exitosamente.');

        } catch (error) {
            console.error('ERROR CRÍTICO en clienteController.mostrarPerfilClienteAsesor (catch block):', error);
            req.flash('error_msg', 'Error al cargar el perfil del cliente. Por favor, inténtalo de nuevo más tarde.');
            return res.redirect('/asesor/clientes-asignados');
        }
    },

    // Esta es la función para que el CLIENTE vea su propio perfil
      mostrarPerfilCliente: async (req, res) => {
        console.log('clienteController.mostrarPerfilCliente: *** INICIO DE FUNCION ***');
        const userUid = req.session.userId; 

        if (!userUid) {
            console.error('mostrarPerfilCliente: ID de usuario no encontrado en la sesión. Redirigiendo a login.');
            req.flash('error_msg', 'Tu sesión ha expirado o no has iniciado sesión. Por favor, inicia sesión de nuevo.');
            return res.status(401).redirect('/auth/logincliente'); 
        }

        try {
            const dbInstance = getDb();
            const userData = await dbInstance.get(`
                SELECT 
                    id, 
                    nombre, 
                    apellido, 
                    email, 
                    telefono, 
                    direccion, 
                    ingresosMensuales, 
                    ahorrosActuales, 
                    perfil_riesgo, 
                    objetivo_principal, 
                    fotoPerfilUrl,
                    asesorAsignado, 
                    createdAt as fechaRegistro 
                FROM clientes 
                WHERE id = ?
            `, [userUid]);

            console.log('mostrarPerfilCliente: userData de la DB:', userData);

            if (!userData) {
                console.warn(`mostrarPerfilCliente: Usuario con ID ${userUid} NO encontrado en la base de datos de clientes.`);
                req.flash('error_msg', 'No se encontraron los datos de tu perfil. Por favor, contacta a soporte.');
                return res.redirect('/homecliente'); 
            }
            
            console.log('mostrarPerfilCliente: user.fotoPerfilUrl recuperada:', userData.fotoPerfilUrl ? 'Sí' : 'No');


            let nombreCompletoAsesor = 'No asignado';
            if (userData.asesorAsignado) {
                const asesorData = await dbInstance.get('SELECT nombre, apellido FROM asesores WHERE id = ?', [userData.asesorAsignado]);
                if (asesorData) {
                    nombreCompletoAsesor = `${asesorData.nombre || ''} ${asesorData.apellido || ''}`.trim();
                    if (nombreCompletoAsesor === '') {
                        nombreCompletoAsesor = 'Nombre no disponible';
                    }
                } else {
                    console.warn(`Asesor con ID ${userData.asesorAsignado} no encontrado en la tabla 'asesores'.`);
                }
            }
            
            console.log('mostrarPerfilCliente: Usuario encontrado. Renderizando vista perfilcliente.');
            console.log('mostrarPerfilCliente: Datos finales enviados a EJS (user, nombreAsesor):', userData, nombreCompletoAsesor); 
            res.render('cliente/perfilcliente', {
                title: 'Mi Perfil', 
                user: userData, 
                nombreAsesor: nombreCompletoAsesor, 
                success_msg: req.flash('success_msg'),
                error_msg: req.flash('error_msg'),
                info_msg: req.flash('info_msg') 
            });
        } catch (error) {
            console.error('ERROR CRÍTICO en clienteController.mostrarPerfilCliente (catch block):', error);
            req.flash('error_msg', 'Hubo un error al cargar tu perfil. Por favor, inténtalo de nuevo más tarde.');
            res.status(500).redirect('/homecliente');
        }
    },

     editarInfoPersonalCliente: async (req, res) => {
        const dbInstance = getDb();
        try {
            const clienteUid = req.session.userId;
            const { nombre, apellido, email, telefono, direccion } = req.body;

            if (!clienteUid) {
                return res.status(401).json({ success: false, message: 'No autenticado.' });
            }

            // Validaciones básicas
            if (!nombre || !apellido || !email) { // Teléfono ya no es requerido según tu registro
                return res.status(400).json({ success: false, message: 'Nombre, apellido y email son obligatorios.' });
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ success: false, message: 'El formato del correo electrónico no es válido.' });
            }

            await dbInstance.run(
                `UPDATE clientes SET nombre = ?, apellido = ?, email = ?, telefono = ?, direccion = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
                [nombre, apellido, email, telefono || null, direccion || null, clienteUid]
            );

            // Obtener los datos actualizados para devolverlos al frontend
            const updatedClienteData = await dbInstance.get(
                `SELECT nombre, apellido, email, telefono, direccion FROM clientes WHERE id = ?`,
                [clienteUid]
            );

            res.json({ success: true, message: 'Información personal actualizada con éxito.', user: updatedClienteData });

        } catch (error) {
            console.error('Error al actualizar la información personal del cliente:', error);
            // Manejo de error de email duplicado si la columna email en 'clientes' es UNIQUE
            if (error.message.includes('SQLITE_CONSTRAINT_UNIQUE')) {
                return res.status(400).json({ success: false, message: 'El email ya está en uso por otra cuenta.' });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar la información personal.' });
        }
    },

     editarInfoFinancieraCliente: async (req, res) => {
        const dbInstance = getDb();
        try {
            const clienteUid = req.session.userId;
            let { perfil_riesgo, objetivo_principal, otro_objetivo } = req.body; 

            if (!clienteUid) {
                return res.status(401).json({ success: false, message: 'No autenticado.' });
            }

            // Si el objetivo principal seleccionado es "Otro", usa el valor de 'otro_objetivo'
            if (objetivo_principal === 'Otro') { // Asumo que el frontend envía 'Otro' (capitalizado)
                objetivo_principal = otro_objetivo;
            }

            // Validaciones básicas
            if (!perfil_riesgo) {
                return res.status(400).json({ success: false, message: 'El perfil de riesgo es obligatorio.' });
            }
            if (!objetivo_principal || objetivo_principal.trim() === '') { 
                return res.status(400).json({ success: false, message: 'El objetivo principal es obligatorio.' });
            }

            // Actualizar los datos en SQLite
            await dbInstance.run(
                `UPDATE clientes SET perfil_riesgo = ?, objetivo_principal = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
                [perfil_riesgo, objetivo_principal, clienteUid]
            );

            // Obtener los datos actualizados para devolverlos al frontend
            const updatedClienteData = await dbInstance.get(
                `SELECT perfil_riesgo, objetivo_principal FROM clientes WHERE id = ?`,
                [clienteUid]
            );

            res.json({ success: true, message: 'Información financiera actualizada con éxito.', user: updatedClienteData });

        } catch (error) {
            console.error('Error al actualizar la información financiera del cliente:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar la información financiera.' });
        }
    },

    uploadProfilePhoto: async (req, res) => {
        console.log('clienteController.uploadProfilePhoto: *** INICIO DE FUNCION ***');
        const userUid = req.session.userId;
        const userType = req.session.userType; // Obtener el tipo de usuario de la sesión

        if (!userUid) {
            console.error('uploadProfilePhoto: Usuario no autenticado o ID de sesión no disponible.');
            return res.status(401).json({ success: false, message: 'Usuario no autenticado o ID de sesión no disponible.' });
        }
        if (!req.file) {
            console.warn('uploadProfilePhoto: No se recibió ningún archivo.');
            return res.status(400).json({ success: false, message: 'No se ha subido ningún archivo.' });
        }
        if (!userType || (userType !== 'cliente' && userType !== 'asesor')) {
            console.error('uploadProfilePhoto: Tipo de usuario no reconocido:', userType);
            return res.status(400).json({ success: false, message: 'Tipo de usuario no reconocido para la subida de foto.' });
        }

        const fotoPerfilBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        
        console.log(`uploadProfilePhoto: Archivo recibido para ${userType}. Intentando actualizar la DB...`);

        try {
            const dbInstance = getDb();
            let tableName;

            if (userType === 'cliente') {
                tableName = 'clientes';
            } else if (userType === 'asesor') {
                tableName = 'asesores';
            } else {
                // Esta validación ya se hizo arriba, pero por seguridad
                console.error('uploadProfilePhoto: Tipo de usuario inválido después de validación inicial:', userType);
                return res.status(500).json({ success: false, message: 'Error interno: Tipo de usuario no manejado.' });
            }

            await dbInstance.run(
                `UPDATE ${tableName} SET fotoPerfilUrl = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
                [fotoPerfilBase64, userUid]
            );

            console.log(`uploadProfilePhoto: Foto de perfil actualizada en SQLite para ${userType} ${userUid}.`);
            
            res.status(200).json({ 
                success: true, 
                message: 'Foto de perfil subida con éxito.',
                imageUrl: fotoPerfilBase64 // ¡Importante: Devolver la URL Base64 para que el frontend la use!
            });

        } catch (error) {
            console.error('uploadProfilePhoto: Error al actualizar la foto de perfil en la base de datos:', error);
            if (error.message.includes('file size exceeds limit')) {
                return res.status(413).json({ success: false, message: 'El archivo es demasiado grande. Máximo 5MB.' });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor al subir la foto.' });
        }
    },

    mostrarChatPersonalCliente: async (req, res) => {
        try {
            const clientId = req.session.userId;
            
            // Obtener el objeto completo del cliente logueado para usar en la vista (cliente.id, cliente.nombre)
            const cliente = await db.get('SELECT id, nombre, apellido, fotoPerfilUrl FROM clientes WHERE id = ?', [clientId]);
            if (!cliente) {
                req.flash('error_msg', 'Cliente no encontrado.');
                return res.redirect('/dashboard');
            }

            // Obtener el asesor asignado al cliente
            const clientData = await db.get('SELECT asesorAsignado FROM clientes WHERE id = ?', [clientId]);
            let asesorAsignado = null;
            let chatMessages = []; // Inicializamos como array vacío

            if (clientData && clientData.asesorAsignado) {
                const asesorId = clientData.asesorAsignado;
                asesorAsignado = await db.get('SELECT id, nombre, apellido, fotoPerfilUrl FROM asesores WHERE id = ?', [asesorId]);

                if (!asesorAsignado) {
                    req.flash('error_msg', 'Tu asesor asignado no fue encontrado. Contacta a soporte.');
                    // Continuar, pero sin asesor ni mensajes de chat
                } else {
                    const roomId = [clientId, asesorId].sort().join('_');

                    // Asegúrate de que la sala de chat exista (INSERT OR IGNORE)
                    await db.run(`
                        INSERT OR IGNORE INTO chat_rooms (room_id, client_id, asesor_id)
                        VALUES (?, ?, ?)
                    `, [roomId, clientId, asesorId]);

                    // Reinicia el contador de no leídos del cliente para esta sala
                    await db.run('UPDATE chat_rooms SET client_unread_count = 0 WHERE room_id = ?', [roomId]);

                    // Obtener mensajes de chat, ALIASING 'sender_id' a 'senderId' y 'sender_type' a 'senderType'
                    // Esto es CRUCIAL para que el JavaScript en el EJS pueda acceder a 'message.senderId'
                    chatMessages = await db.all('SELECT id, room_id, sender_id AS senderId, sender_type AS senderType, text, timestamp FROM chat_messages WHERE room_id = ? ORDER BY timestamp ASC', [roomId]);
                }
            } else {
                req.flash('info_msg', 'Aún no tienes un asesor asignado. Puedes seleccionarlo en la sección "Contactar Asesor".');
                // No hay asesor, por lo tanto, chatMessages ya está vacío.
            }

            // Renderizar la vista, pasando todas las variables que tu EJS espera
            // ¡ATENCIÓN: RUTA CORREGIDA AQUÍ!
            res.render('cliente/chat_personal_cliente', {
                user: cliente, // Para el partial de la navbar (user.nombre)
                cliente: cliente, // Para acceder a cliente.id y cliente.nombre en el EJS
                asesorAsignado: asesorAsignado, // El objeto asesor o null
                chatMessages: chatMessages, // Los mensajes del chat
                messages: req.flash('success_msg'), // Para mostrar mensajes flash
                errors: req.flash('error_msg'),
                info: req.flash('info_msg')
            });

        } catch (error) {
            console.error('Error al cargar el chat personal del cliente:', error);
            req.flash('error_msg', 'Error al cargar el chat personal.');
            res.redirect('/dashboard');
        }
    },

    getClienteChatMessages: async (req, res) => {
        try {
            const clientId = req.session.userId;
            const asesorId = req.params.asesorId; // El cliente chatea con SU asesor
            const roomId = [clientId, asesorId].sort().join('_');

            const chat = await db.get('SELECT * FROM chat_rooms WHERE room_id = ?', [roomId]);
            if (chat && chat.client_unread_count > 0) {
                await db.run('UPDATE chat_rooms SET client_unread_count = 0 WHERE room_id = ?', [roomId]);
            }

            // ALIASING 'sender_id' a 'senderId' y 'sender_type' a 'senderType'
            const messages = await db.all('SELECT id, room_id, sender_id AS senderId, sender_type AS senderType, text, timestamp FROM chat_messages WHERE room_id = ? ORDER BY timestamp ASC', [roomId]);
            res.json({ success: true, messages: messages });
        } catch (error) {
            console.error('Error fetching chat messages for client:', error);
            res.status(500).json({ success: false, message: 'Error fetching messages.' });
        }
    },

   clienteSendMessage: async (req, res) => {
    try {
        const { asesorId, messageText, timestamp } = req.body;
        const clientId = req.session.userId;
        const clientName = req.session.userName;
        const roomId = [clientId, asesorId].sort().join('_');
        const messageDbId = uuidv4(); // Genera el UUID aquí UNA VEZ

        await db.run(`
            INSERT OR IGNORE INTO chat_rooms (room_id, client_id, asesor_id)
            VALUES (?, ?, ?)
        `, [roomId, clientId, asesorId]);

        await db.run(`
            INSERT INTO chat_messages (id, room_id, sender_id, sender_type, text, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [messageDbId, roomId, clientId, 'client', messageText, timestamp]); // Usa messageDbId aquí

        await db.run(`
            UPDATE chat_rooms
            SET last_message_text = ?,
                last_message_timestamp = ?,
                asesor_unread_count = asesor_unread_count + 1
            WHERE room_id = ?
        `, [messageText, timestamp, roomId]);

        const notificationMessage = `Nuevo mensaje de ${clientName}: "${messageText.substring(0, 50)}..."`;
        await addNotificationToUser(asesorId, notificationMessage, `/asesor/chat/general?withClientId=${clientId}`);

        // ¡DEVUELVE EL ID DEL MENSAJE AL FRONTEND!
        res.json({ success: true, message: 'Mensaje enviado.', messageId: messageDbId, senderId: clientId, timestamp: timestamp, text: messageText, senderType: 'client' });
    } catch (error) {
        console.error('Error sending message from client:', error);
        res.status(500).json({ success: false, message: 'Error sending message.' });
    }
},


    
       mostrarCalendarioCliente: (req, res) => res.render('cliente/calendario_cliente'),
    
    // <<-- FUNCIONES PARA LOS PROPIOS EVENTOS DEL CLIENTE (nueva tabla clienteEventos) -->>
    getEventosClienteAPI: async (req, res) => {
        try {
            const clienteId = req.session.userId; // El ID del cliente logueado
            // Seleccionamos los eventos de la nueva tabla clienteEventos
            const events = await db.all('SELECT id, title, start, end, description, allDay FROM clienteEventos WHERE clienteId = ?', [clienteId]); 
            res.json(events);
        } catch (error) {
            console.error('Error fetching client events from clienteEventos:', error);
            res.status(500).json({ success: false, message: 'Error al obtener eventos del cliente.' });
        }
    },
    crearEventoClienteAPI: async (req, res) => {
        try {
            const { title, start, end, description, allDay } = req.body; 
            const clienteId = req.session.userId; 
            const eventId = `evt_${uuidv4()}`; 

            // Insertar el evento en la tabla `clienteEventos`
            await db.run('INSERT INTO clienteEventos (id, clienteId, title, start, end, description, allDay, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [eventId, clienteId, title, start, end, description, allDay ? 1 : 0]); 
            
            res.json({ success: true, id: eventId, message: 'Evento creado.' });
        } catch (error) {
            console.error('Error creating client event in clienteEventos:', error);
            res.status(500).json({ success: false, message: 'Error al crear evento del cliente.' });
        }
    },
    editarEventoClienteAPI: async (req, res) => {
        try {
            const { id } = req.params;
            const { title, start, end, description, allDay } = req.body; 
            const clienteId = req.session.userId; 

            // Actualizar el evento en la tabla `clienteEventos`
            await db.run('UPDATE clienteEventos SET title = ?, start = ?, end = ?, description = ?, allDay = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND clienteId = ?', 
                [title, start, end, description, allDay ? 1 : 0, id, clienteId]); 
            
            res.json({ success: true, message: 'Evento actualizado.' });
        } catch (error) {
            console.error('Error editing client event in clienteEventos:', error);
            res.status(500).json({ success: false, message: 'Error al actualizar evento del cliente.' });
        }
    },
    eliminarEventoClienteAPI: async (req, res) => {
        try {
            const { id } = req.params;
            const clienteId = req.session.userId; 

            // Eliminar el evento de la tabla `clienteEventos`
            const result = await db.run('DELETE FROM clienteEventos WHERE id = ? AND clienteId = ?', [id, clienteId]); 
            
            if (result.changes === 0) {
                return res.status(404).json({ success: false, message: 'Evento no encontrado o no autorizado para eliminar.' });
            }

            res.json({ success: true, message: 'Evento eliminado.' });
        } catch (error) {
            console.error('Error deleting client event from clienteEventos:', error);
            res.status(500).json({ success: false, message: 'Error al eliminar evento del cliente.' });
        }
    },

    mostrarObjetivosFinancieros: (req, res) => res.render('cliente/objetivos_financieros'),
    getObjetivosClienteAPI: async (req, res) => {
        try {
            const clientId = req.session.userId;
            // Corregido: Nombres de columnas según tu database.js
            const goals = await db.all('SELECT id, nombre, montoObjetivo, montoActual, fechaLimite, status FROM objetivosCliente WHERE clienteId = ?', [clientId]);
            res.json(goals);
        } catch (error) {
            console.error('Error fetching client goals:', error);
            res.status(500).json({ success: false, message: 'Error al obtener objetivos financieros.' });
        }
    },
    getObjetivoByIdClienteAPI: async (req, res) => {
        try {
            const { id } = req.params;
            const clientId = req.session.userId;
            // Corregido: Nombres de columnas según tu database.js
            const goal = await db.get('SELECT id, nombre, montoObjetivo, montoActual, fechaLimite, status FROM objetivosCliente WHERE id = ? AND clienteId = ?', [id, clientId]);
            if (!goal) {
                return res.status(404).json({ success: false, message: 'Objetivo no encontrado.' });
            }
            res.json(goal);
        } catch (error) {
            console.error('Error fetching client goal by ID:', error);
            res.status(500).json({ success: false, message: 'Error al obtener el objetivo financiero.' });
        }
    },
     crearObjetivoClienteAPI: async (req, res) => {
        const dbInstance = getDb();
        try {
            const clienteId = req.session.userId;
            // Desestructurar los datos del cuerpo de la solicitud
            // Asegúrate de que los nombres coincidan con los que envías desde el frontend
            const { nombre, montoObjetivo, montoActual, fechaLimite, status } = req.body;

            if (!clienteId) {
                return res.status(401).json({ success: false, message: 'No autenticado.' });
            }
            if (!nombre || montoObjetivo === undefined) { // montoObjetivo no puede ser nulo o indefinido
                return res.status(400).json({ success: false, message: 'Nombre y Monto Objetivo son obligatorios.' });
            }

            const objetivoId = uuidv4(); // Generar un ID único para el nuevo objetivo

            // Preparar los valores, asegurando que los opcionales tengan un default si no se envían
            const finalMontoActual = montoActual !== undefined ? parseFloat(montoActual) : 0.0;
            const finalFechaLimite = fechaLimite || null; // Si no se envía, guarda como NULL
            const finalStatus = status || 'pendiente'; // Si no se envía, usa 'pendiente'

            // La consulta INSERT solo incluye las columnas que se van a llenar explícitamente.
            // 'createdAt' y 'updatedAt' se rellenarán automáticamente por la DB si tienen DEFAULT CURRENT_TIMESTAMP.
            await dbInstance.run(
                `INSERT INTO objetivosCliente (id, clienteId, nombre, montoObjetivo, montoActual, fechaLimite, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    objetivoId,
                    clienteId,
                    nombre,
                    parseFloat(montoObjetivo), // Asegura que sea un número REAL
                    finalMontoActual,
                    finalFechaLimite,
                    finalStatus
                ]
            );

            console.log(`Objetivo de cliente creado con ID: ${objetivoId} para cliente: ${clienteId}`);
            res.status(201).json({ success: true, message: 'Objetivo de cliente creado exitosamente.', objetivoId: objetivoId });

        } catch (error) {
            console.error('Error creando objetivo de cliente:', error);
            // Puedes añadir un manejo más específico si hay errores de restricción de DB
            res.status(500).json({ success: false, message: 'Error interno del servidor al crear el objetivo.' });
        }
    },
    editarObjetivoClienteAPI: async (req, res) => {
        try {
            const { id } = req.params;
            // Corregido: Nombres de campos de request.body según tu database.js
            const { nombre, montoObjetivo, montoActual, fechaLimite, status } = req.body;
            const clientId = req.session.userId;
            // Corregido: Nombres de columnas según tu database.js
            await db.run('UPDATE objetivosCliente SET nombre = ?, montoObjetivo = ?, montoActual = ?, fechaLimite = ?, status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND clienteId = ?',
                [nombre, montoObjetivo, montoActual, fechaLimite, status, id, clientId]);
            res.json({ success: true, message: 'Objetivo financiero actualizado.' });
        } catch (error) {
            console.error('Error editing client goal:', error);
            res.status(500).json({ success: false, message: 'Error al actualizar objetivo financiero.' });
        }
    },
    eliminarObjetivoClienteAPI: async (req, res) => {
        try {
            const { id } = req.params;
            const clientId = req.session.userId;
            // Corregido: Nombres de tabla y columna según tu database.js
            const result = await db.run('DELETE FROM objetivosCliente WHERE id = ? AND clienteId = ?', [id, clientId]);

            if (result.changes === 0) {
                return res.status(404).json({ success: false, message: 'Objetivo no encontrado o no autorizado para eliminar.' });
            }
            res.json({ success: true, message: 'Objetivo financiero eliminado.' });
        } catch (error) {
            console.error('Error deleting client goal:', error);
            res.status(500).json({ success: false, message: 'Error al eliminar objetivo financiero.' });
        }
    },
    getClienteByIdAPI: async (req, res) => {
        try {
            const clientId = req.params.id;
            // Corregido: Nombre de tabla según tu database.js
            const client = await db.get('SELECT id, nombre, apellido, email, telefono, fotoPerfilUrl FROM clientes WHERE id = ?', [clientId]);
            if (!client) {
                return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
            }
            res.json(client);
        } catch (error) {
            console.error('Error fetching client by ID:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor al obtener detalles del cliente.' });
        }
    }
};


const chatController = {
    // ... (tus funciones existentes: mostrarChatGeneralAsesor, getClienteChatMessages, asesorSendMessage, getClientesChatSidebar)

    // Nueva función para la API que devuelve los detalles de un cliente
    getClienteDetailsApi: async (req, res) => {
        try {
            const { clientId } = req.params; // El nombre del parámetro en la URL
            const asesorId = req.session.userId; // Para verificar que el asesor tiene acceso

            console.log(`Backend API: Solicitud de detalles para cliente ID: ${clientId} por asesor ID: ${asesorId}`);

            // Opcional pero recomendado: Verificar si el cliente está asignado a este asesor
            // Esto evita que un asesor vea detalles de clientes que no le corresponden.
            const isAssigned = await db.get(
                'SELECT 1 FROM clientes_asignados WHERE clientes_id = ? AND asesores_id = ?',
                [clientId, asesorId]
            );

            if (!isAssigned) {
                console.warn(`Backend API: Acceso denegado a cliente ${clientId} para asesor ${asesorId}. No asignado.`);
                // Si el cliente no está asignado, envía un 403 Forbidden
                return res.status(403).json({ success: false, message: 'Acceso denegado: Cliente no asignado a este asesor.' });
            }

            // Obtener todos los detalles del cliente necesarios para el modal
            // Asegúrate de que estos nombres de columna (id, nombre, apellido, email, telefono, etc.)
            // coincidan con tu esquema de base de datos.
            // 'createdAt' se renombra a 'fechaRegistro' para coincidir con lo que espera el frontend.
            const clientDetails = await db.get(
                `SELECT 
                    id, 
                    nombre, 
                    apellido, 
                    email, 
                    telefono, 
                    direccion, 
                    fotoPerfilUrl,
                    ahorrosActuales, 
                    ingresosMensuales, 
                    objetivo_principal, 
                    perfil_riesgo,
                    createdAt AS fechaRegistro 
                FROM clientes WHERE id = ?`,
                [clientId]
            );

            if (!clientDetails) {
                console.warn(`Backend API: Cliente con ID ${clientId} no encontrado en la base de datos.`);
                // Si el cliente no se encuentra, envía un 404 Not Found
                return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
            }

            console.log(`Backend API: Detalles de cliente ${clientId} obtenidos exitosamente.`);
            // Devuelve un objeto JSON con success y el objeto cliente
            res.json({ success: true, cliente: clientDetails });

        } catch (error) {
            console.error('Backend API: Error CRÍTICO al obtener detalles del cliente:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor al obtener detalles del cliente.' });
        }
    },


};



router.get('/cambiar-password', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    asesorController.getChangePasswordPage(req, res);
});
router.post('/cambiar-password', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para asesores.' });
    }
    asesorController.changePassword(req, res);
});

// --- Rutas de Cambio de Contraseña (Cliente) ---
router.get('/cliente/cambiar_password', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    clienteController.getChangePasswordPageCliente(req, res);
});
router.post('/cliente/cambiar_password', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    clienteController.changePasswordCliente(req, res);
});

// --- Rutas de Perfil y Actualización de Cliente ---
router.get('/cliente/perfil', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    clienteController.mostrarPerfilCliente(req, res);
});
router.post('/cliente/api/actualizar-perfil', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') { 
        console.warn('POST /cliente/api/actualizar-perfil: Acceso denegado. userType no es "cliente". Actual:', req.session.userType);
        return res.status(403).json({ success: false, message: 'Acceso denegado. Esta acción es solo para clientes.' });
    }
    
    console.log('POST /cliente/api/actualizar-perfil: Procesando solicitud para cliente ID:', req.session.userId);


    try {
        await clienteController.editarInfoPersonalCliente(req, res); 
    } catch (error) {
        console.error('Error al llamar a clienteController.editarInfoPersonalCliente:', error);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar el perfil.' });
        }
    }
});


router.post('/cliente/api/actualizar-info-financiera', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        console.warn('POST /cliente/api/actualizar-info-financiera: Acceso denegado. userType no es "cliente". Actual:', req.session.userType);
        return res.status(403).json({ success: false, message: 'Acceso denegado. Esta acción es solo para clientes.' });
    }

    console.log('POST /cliente/api/actualizar-info-financiera: Procesando solicitud para cliente ID:', req.session.userId);

    try {
        await clienteController.editarInfoFinancieraCliente(req, res);
    } catch (error) {
        console.error('Error al llamar a clienteController.editarInfoFinancieraCliente:', error);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar la información financiera.' });
        }
    }
});
// Ruta específica para actualizar foto de perfil
router.post('/cliente/api/upload-profile-photo', 
    requireAuth, // Primero, verifica si el usuario está autenticado
    // Manejo de errores de Multer de forma más específica
    (req, res, next) => {
        upload.single('profilePhoto')(req, res, (err) => {
            if (err instanceof multer.MulterError) {
                // Un error de Multer conocido (ej. FILE_TOO_LARGE)
                console.error('MulterError en /cliente/api/upload-profile-photo:', err.message);
                return res.status(400).json({ success: false, message: `Error de subida: ${err.message}` });
            } else if (err) {
                // Otros errores que puedas haber lanzado desde fileFilter
                console.error('Error de archivo en /cliente/api/upload-profile-photo:', err.message);
                const statusCode = err.statusCode || 500; // Usa el statusCode si lo definiste, sino 500
                return res.status(statusCode).json({ success: false, message: err.message || 'Error desconocido al procesar el archivo.' });
            }
            next(); // Continuar al controlador si no hay errores de Multer
        });
    },
    clienteController.uploadProfilePhoto // Delega toda la lógica al controlador
);


// --- Rutas Generales de Cliente ---
router.get('/consultacliente', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    return res.render('cliente/consultacliente');
});

router.get('/formulariocliente', requireAuth, async (req, res) => {
    if (req.session.userType !== 'client') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    return res.render('cliente/formulariocliente');
});


// --- Rutas de Verificación de Identidad (Asesor Only) ---
router.get('/asesor/verificar_identidad', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    asesorController.getVerificationPageAsesor(req, res);
});
router.post('/asesor/verificar_identidad', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para asesores.' });
    }
    uploadMemory.fields([ // Usar fields para múltiples archivos si KYC tiene varios
        { name: 'documento_frente', maxCount: 1 },
        { name: 'documento_reverso', maxCount: 1 },
        { name: 'selfie', maxCount: 1 }
    ]),
    asesorController.postVerifyIdentityAsesor(req, res);
});


// --- Rutas de Herramientas de Análisis Financiero (Asesor Only) ---
router.get('/herramientas-analisis', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/herramientas_analisis');
});

router.get('/herramientas-analisis/calculadora-presupuesto', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/calculadora_presupuesto');
});

router.get('/herramientas-analisis/analisis-inversiones', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/analisis_inversiones');
});

router.get('/herramientas-analisis/riesgos-mercado', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/riesgos_mercado');
});

router.get('/herramientas-analisis/planificacion-fiscal', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/planificacion_fiscal');
});

router.get('/herramientas-analisis/proyecciones-financieras', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/proyecciones_financieras');
});

router.get('/herramientas-analisis/valoracion-empresas', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    return res.render('asesor/valoracion_empresas');
});


// --- Rutas de Clientes Asignados y Perfil de Cliente (vista por Asesor) ---
router.get('/clientes-asignados', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    asesorController.mostrarClientesAsignados(req, res);
});

router.get('/clientes/:id_cliente/perfil', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    clienteController.mostrarPerfilClienteAsesor(req, res);
});

router.get('/programar-consulta', requireAuth, async (req, res) => {
    if (req.session.userType !== 'asesor') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para asesores.');
        return res.redirect('/dashboard');
    }
    asesorController.getProgramarConsultaPage(req, res);
});



// --- Rutas de Objetivos Financieros (Cliente) ---
router.get('/cliente/objetivos', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    clienteController.mostrarObjetivosFinancieros(req, res);
});
// APIs de Objetivos de Cliente
router.get('/cliente/api/objetivos', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    clienteController.getObjetivosClienteAPI(req, res);
});
router.get('/cliente/api/objetivos/:id', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    clienteController.getObjetivoByIdClienteAPI(req, res);
});
router.post('/cliente/api/objetivos', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    clienteController.crearObjetivoClienteAPI(req, res);
});
router.put('/cliente/api/objetivos/:id', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    clienteController.editarObjetivoClienteAPI(req, res);
});
router.delete('/cliente/api/objetivos/:id', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para clientes.' });
    }
    clienteController.eliminarObjetivoClienteAPI(req, res);
});

// API para obtener un cliente por ID (usada a menudo por asesores para ver detalles)
router.get('/api/clientes/:id', requireAuth, async (req, res) => {
    // Si esta API puede ser accedida por asesores o admin para ver detalles de cualquier cliente
    if (req.session.userType !== 'asesor' && req.session.userType !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo para asesores o administradores.' });
    }
    clienteController.getClienteByIdAPI(req, res);
});


router.get('/contacto-asesor', requireAuth, async (req, res) => {
    if (req.session.userType !== 'cliente') {
        req.flash('error_msg', 'Acceso denegado. Esta página es solo para clientes.');
        return res.redirect('/dashboard');
    }
    try {
        const asesores = await db.all(`
            SELECT id, nombre, apellido, email, telefono, especialidad, experiencia, fotoPerfilUrl, bio AS descripcion
            FROM asesores
            WHERE kyc_status = 'verificado'
              AND title_status = 'verificado'
              AND certification_status = 'verificado'
        `);
        console.log('Asesores disponibles obtenidos:', asesores);

        res.render('cliente/asesores-disponibles', {
            asesores: asesores, 
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });
    } catch (error) {
        console.error('Error al obtener asesores disponibles (SQLite):', error);
        req.flash('error_msg', 'Error al cargar los asesores disponibles. Inténtalo de nuevo más tarde.');
        res.redirect('/homecliente');
    }
});


router.get('/api/asesor', requireAuth, async (req, res) => {
    try {
        const asesores = await db.all(`
            SELECT id, nombre, apellido, email, telefono, especialidad, experiencia, fotoPerfilUrl, bio AS descripcion
            FROM asesores
            WHERE kyc_status = 'verificado'
              AND title_status = 'verificado'
              AND certification_status = 'verificado'
        `);
        res.json({ success: true, asesores: asesores }); // Devuelve la lista de asesores
    } catch (error) {
        console.error('Error al obtener la lista de asesores via API (SQLite):', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener la lista de asesores.' });
    }
});


// Ruta para la API que obtiene los detalles de UN asesor por ID
router.get('/api/asesor/:id', requireAuth, async (req, res) => {
    try {
        const asesorId = req.params.id;
        
        console.log('DEBUG: Solicitando detalles para asesorId:', asesorId);

        const asesorData = await db.get(`
            SELECT id, nombre, apellido, email, telefono, especialidad, experiencia, fotoPerfilUrl, bio AS descripcion
            FROM asesores
            WHERE id = ?
        `, [asesorId]);

        if (!asesorData) {
            console.warn('ADVERTENCIA: Asesor no encontrado para ID:', asesorId);
            return res.status(404).json({ success: false, message: 'Asesor no encontrado.' });
        }

        res.json({ success: true, asesor: asesorData }); 
    } catch (error) {
        console.error('Error al obtener detalles del asesor (SQLite):', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener detalles del asesor.' });
    }
});

// API for client to get chat messages and send messages
router.get('/cliente/api/chat/:asesorId', requireAuth, clienteController.getClienteChatMessages);
router.post('/cliente/api/send-message', requireAuth, clienteController.clienteSendMessage);

// Ruta para asignar un asesor a un cliente
router.post('/cliente/asignar-asesor', requireAuth, async (req, res) => {
    // Middleware de autorización para asegurar que solo los clientes puedan acceder
    if (req.session.userType !== 'cliente') {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Debes ser cliente.', redirectTo: '/dashboard' });
    }

    const clienteId = req.session.userId;
    const { asesorId } = req.body; // El ID del asesor viene del cuerpo de la solicitud

    // DEBUG: Imprime los IDs para verificar
    console.log('DEBUG (Backend - Asignar Asesor): Cliente ID recibido:', clienteId);
    console.log('DEBUG (Backend - Asignar Asesor): Asesor ID recibido del body:', asesorId);

    if (!asesorId) {
        console.error('ERROR (Backend - Asignar Asesor): ID de asesor no proporcionado en el cuerpo de la solicitud.');
        return res.status(400).json({ success: false, message: 'ID de asesor es obligatorio.' });
    }

    try {
        // Verificar si el cliente existe usando la tabla 'clientes'
        // Se agregó 'asesorAsignado' al SELECT para poder verificarlo antes de actualizar.
        const clienteExists = await db.get('SELECT id, nombre, apellido, asesorAsignado FROM clientes WHERE id = ?', [clienteId]);
        if (!clienteExists) {
            console.error('ERROR (Backend - Asignar Asesor): Cliente no encontrado con ID:', clienteId);
            return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
        }
        
        // Verificar si el cliente ya tiene un asesor asignado
        if (clienteExists.asesorAsignado && clienteExists.asesorAsignado !== null) { 
            console.warn('ADVERTENCIA (Backend - Asignar Asesor): Cliente ya tiene un asesor asignado:', clienteExists.asesorAsignado);
            return res.status(400).json({ success: false, message: 'Ya tienes un asesor asignado. No puedes asignar otro.' });
        }


        // Obtener datos del asesor y verificar su estado
        const asesorData = await db.get('SELECT kyc_status, title_status, certification_status, nombre, apellido FROM asesores WHERE id = ?', [asesorId]);
        if (!asesorData) {
            console.error('ERROR (Backend - Asignar Asesor): Asesor no encontrado con ID:', asesorId);
            return res.status(404).json({ success: false, message: 'Asesor no encontrado.' });
        }

        // Verificar que el asesor esté completamente verificado
        if (asesorData.kyc_status !== 'verificado' || asesorData.title_status !== 'verificado' || asesorData.certification_status !== 'verificado') {
            console.error('ERROR (Backend - Asignar Asesor): Asesor no completamente verificado. KYC:', asesorData.kyc_status, 'Título:', asesorData.title_status, 'Certificación:', asesorData.certification_status);
            return res.status(400).json({ success: false, message: 'El asesor seleccionado aún no ha sido verificado completamente.' });
        }

        // Asignar asesor al cliente actualizando la tabla 'clientes'
        await db.run('UPDATE clientes SET asesorAsignado = ? WHERE id = ?', [asesorId, clienteId]);
        console.log(`ÉXITO (Backend - Asignar Asesor): Asesor ${asesorId} asignado a cliente ${clienteId} en tabla clientes.`);

        // Añadir el cliente a la lista de clientes asignados del asesor (usando la tabla de unión)
        // *** ESTA ES LA LÍNEA CRÍTICA CORREGIDA ***
        // *** SE REEMPLAZÓ [NOMBRE_REAL_DE_TU_TABLA_DE_ASIGNACIONES] por 'clientes_asignados' ***
        await db.run('INSERT OR IGNORE INTO clientes_asignados (asesores_id, clientes_id) VALUES (?, ?)', [asesorId, clienteId]);
        console.log(`ÉXITO (Backend - Asignar Asesor): Cliente ${clienteId} añadido a la lista de asignados del asesor ${asesorId}.`);


        // Añadir notificación al asesor (asumiendo que addNotificationToUser ya está importada y funciona)
        const notificationMessage = `¡Tienes un nuevo cliente! ${clienteExists.nombre || 'Un cliente nuevo'} te ha seleccionado como su asesor.`;
        await addNotificationToUser(asesorId, notificationMessage, `/asesor/chat/general?withClientId=${clienteId}`);
        console.log(`DEBUG (Backend - Asignar Asesor): Notificación enviada al asesor ${asesorId}.`);

        // Éxito: Enviar respuesta y redirigir
        req.flash('success_msg', `Has asignado a ${asesorData.nombre} ${asesorData.apellido} como tu asesor.`);
        return res.json({
            success: true,
            message: 'Asesor asignado correctamente. Redirigiendo al chat...',
            redirectTo: '/chat/personal' 
        });

    } catch (error) {
        console.error('ERROR CRÍTICO (Backend - Asignar Asesor):', error);
        req.flash('error_msg', 'Error interno del servidor al asignar el asesor. Por favor, inténtalo de nuevo.');
        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor al asignar el asesor.',
            redirectTo: '/cliente/asesores-disponibles' 
        });
    }
});

// --- Admin Verification Routes ---



router.get('/admin/verificaciones_pendientes', isAdmin, async (req, res) => {
    const db = getDb();

    try {
        const pendingVerifications = await db.all(`
            SELECT id, nombre, apellido, email,
                   kyc_status, kyc_notes,
                   kyc_front_url, kyc_back_url, kyc_selfie_url,  -- Asegúrate de que estas columnas existan en tu DB
                   title_status, title_notes,
                   title_document_url,  -- Asegúrate de que esta columna exista en tu DB
                   certification_status, certification_notes,
                   certification_document_url -- Asegúrate de que esta columna exista en tu DB
            FROM asesores
            WHERE kyc_status = 'pendiente'
               OR title_status = 'pendiente'
               OR certification_status = 'pendiente'
        `);

        res.render('admin/verificaciones_pendientes', {
            asesoresPendientes: pendingVerifications,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });

    } catch (error) {
        console.error('Error al cargar verificaciones pendientes (SQLite):', error);
        req.flash('error_msg', 'Error al cargar las verificaciones pendientes.');
        res.redirect('/admin/verificaciones_pendientes');
    }
});

router.post('/admin/verificar-documento', requireAuth, isAdmin, async (req, res) => {
    const { asesorId, type, action } = req.body;

    if (!asesorId || !type || !action) {
        return res.status(400).json({ success: false, message: 'Datos incompletos para la verificación.' });
    }

    try {
        let updateColumn = '';
        let notesColumn = '';
        let notificationMessage = '';
        let notificationLink = '/perfilasesor';

        switch (type) {
            case 'kyc':
                updateColumn = 'kyc_status';
                notesColumn = 'kyc_notes';
                notificationMessage = `Tu verificación de **Identificación (KYC)** ha sido **${action === 'verificar' ? 'aprobada' : 'rechazada'}**.`;
                break;
            case 'titulo':
                updateColumn = 'title_status';
                notesColumn = 'title_notes';
                notificationMessage = `Tu **Título Profesional** ha sido **${action === 'verificar' ? 'aprobado' : 'rechazada'}**.`;
                break;
            case 'certificacion':
                updateColumn = 'certification_status';
                notesColumn = 'certification_notes';
                notificationMessage = `Tu **Certificación Profesional** ha sido **${action === 'verificar' ? 'aprobada' : 'rechazada'}**.`;
                break;
            default:
                return res.status(400).json({ success: false, message: 'Tipo de verificación inválido.' });
        }

        let statusValue = '';
        let notesValue = null;
        if (action === 'verificar') {
            statusValue = 'verificado';
            notificationMessage += " ¡Felicidades! Ya puedes acceder a todas las funcionalidades.";
        } else if (action === 'rechazar') {
            statusValue = 'rechazado';
            const predefinedRejectionMessage = `Tu documento fue rechazado. Esto puede deberse a: documento ilegible, información incompleta, documento expirado o no válido, datos no coincidentes, formato incorrecto, o foto no clara. Por favor, revisa tu documento y vuelve a subirlo.`;
            notesValue = predefinedRejectionMessage;
            notificationMessage = `Tu documento fue rechazado. Motivo: ${predefinedRejectionMessage}`;
        } else {
            return res.status(400).json({ success: false, message: 'Acción inválida.' });
        }

        // *** ¡LA ÚNICA CORRECCIÓN! Cambiamos 'advisors' por 'asesores' ***
        await db.run(`UPDATE asesores SET ${updateColumn} = ?, ${notesColumn} = ? WHERE id = ?`, [statusValue, notesValue, asesorId]);

        await addNotificationToUser(asesorId, notificationMessage, notificationLink);

        res.json({ success: true, message: `Verificación de ${type} actualizada a ${statusValue}.` });

    } catch (error) {
        console.error('Error al actualizar la verificación del documento (SQLite):', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al procesar la verificación.' });
    }
});





// --- Rutas de Vista de Chat ---

// Ruta para que el cliente vea su chat personal con su asesor asignado
router.get('/chat/personal', requireAuth, clienteController.mostrarChatPersonalCliente);

// Ruta para que el asesor vea su chat general (lista de clientes y chat con uno)
// Puede incluir un `withClientId` para preseleccionar un chat
router.get('/asesor/chat/general', requireAuth, asesorController.mostrarChatGeneralAsesor);


// --- APIs de Chat para Clientes ---
// API para que el cliente obtenga los mensajes de su chat con un asesor específico
router.get('/cliente/api/chat/messages/:asesorId', requireAuth, clienteController.getClienteChatMessages);
// API para que el cliente envíe un mensaje a su asesor
router.post('/cliente/api/chat/send', requireAuth, clienteController.clienteSendMessage);


// --- APIs de Chat para Asesores ---
// API para que el asesor obtenga los mensajes de un chat con un cliente específico
router.get('/asesor/api/chat/messages/:clienteId', requireAuth, asesorController.getClienteChatMessages);
// API para que el asesor envíe un mensaje a un cliente
router.post('/asesor/api/chat/send', requireAuth, asesorController.asesorSendMessage);

// API para la sidebar del chat del asesor (lista de clientes con últimos mensajes/no leídos)
router.get('/asesor/api/clientes-chat-sidebar', requireAuth, asesorController.getClientesChatSidebar);





// --- Advisor Calendar Routes ---
router.get('/asesor/calendario', requireAuth, asesorController.mostrarCalendarioAsesor);
router.get('/asesor/api/eventos', requireAuth, asesorController.getEventosAsesorAPI);
router.post('/asesor/api/eventos', requireAuth, asesorController.crearEventoAsesorAPI);
router.put('/asesor/api/eventos/:id', requireAuth, asesorController.editarEventoAsesorAPI);
router.delete('/asesor/api/eventos/:id', requireAuth, asesorController.eliminarEventoAsesorAPI);

// --- Investments Page ---
router.get('/inversiones', requireAuth, async (req, res) => {
    const news = [
        {
            id: 1,
            title: 'Últimas Novedades en Inteligencia Artificial y su Impacto Financiero',
            imageUrl: '/images/anuncio1.jpg',
            description: 'Explora cómo los avances en IA están remodelando los mercados financieros y creando nuevas oportunidades de inversión.',
            link: 'https://www.technologyreview.com/topic/ai/'
        },
        {
            id: 2,
            title: 'Guía Completa de Inversiones en Energías Renovables para 2025',
            imageUrl: '/images/anuncio2.jpg',
            description: 'Descubre los sectores más prometedores dentro de la energía limpia y cómo puedes participar en este crecimiento sostenible.',
            link: 'https://www.bloomberg.com/green'
        },
        {
            id: 3,
            title: 'Emprendimientos Fintech que Están Transformando el Sistema Bancario',
            imageUrl: '/images/anuncio3.jpg',
            description: 'Conoce las startups que están innovando en pagos digitales, préstamos y gestión de patrimonio con soluciones tecnológicas.',
            link: 'https://techcrunch.com/category/fintech/'
        },
        {
            id: 4,
            title: 'Innovación Biotecnológica: Oportunidades de Inversión en Salud y Ciencia',
            imageUrl: '/images/anuncio4.jpg',
            description: 'Un vistazo a las empresas de biotecnología que están desarrollando soluciones revolucionarias y captando la atención de inversores.',
            link: 'https://www.fiercebiotech.com/'
        }
    ];
    res.render('cliente/inversiones', { news: news });
});

// --- Client Calendar Routes ---
// --- RUTAS DEL CALENDARIO DEL CLIENTE (NUEVAS) ---
router.get('/cliente/calendario', requireAuth, clienteController.mostrarCalendarioCliente);

// Rutas de la API para el calendario del cliente (acceden a eventos de su asesor)
router.get('/cliente/api/eventos', requireAuth, clienteController.getEventosClienteAPI); 
router.post('/cliente/api/eventos', requireAuth, clienteController.crearEventoClienteAPI); 
router.put('/cliente/api/eventos/:id', requireAuth, clienteController.editarEventoClienteAPI); 
router.delete('/cliente/api/eventos/:id', requireAuth, clienteController.eliminarEventoClienteAPI); 

// --- Client Financial Goals Routes ---
router.get('/objetivos-financieros', requireAuth, clienteController.mostrarObjetivosFinancieros);
router.get('/cliente/api/objetivos', requireAuth, clienteController.getObjetivosClienteAPI);
router.get('/cliente/api/objetivos/:id', requireAuth, clienteController.getObjetivoByIdClienteAPI);
router.post('/cliente/api/objetivos', requireAuth, clienteController.crearObjetivoClienteAPI);
router.put('/cliente/api/objetivos/:id', requireAuth, clienteController.editarObjetivoClienteAPI);
router.delete('/cliente/api/objetivos/:id', requireAuth, clienteController.eliminarObjetivoClienteAPI);


router.get('/api/cliente/:clientId', chatController.getClienteDetailsApi);

// --- Privacy Policy Route ---
router.get('/politica-privacidad', (req, res) => {
    res.render('politica_privacidad', {
        title: 'Política de Privacidad',
        error_msg: req.flash('error_msg'),
        success_msg: req.flash('success_msg'),
        info_msg: req.flash('info_msg')
    });
});

module.exports = router;