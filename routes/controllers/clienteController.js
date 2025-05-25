const admin = require('firebase-admin');
const db = admin.firestore();
const auth = admin.auth(); // Servicio de autenticación de Firebase Admin
const fetch = require('node-fetch'); // Necesario para subir a Imgur

// --- Función para mostrar el perfil del cliente (GET) ---
exports.mostrarPerfilCliente = async (req, res) => {
    try {
        const clienteUid = req.session.userId; // Asume que el UID del cliente se guarda en la sesión

        if (!clienteUid) {
            return res.redirect('/login'); // Redirige a login si no hay UID en sesión
        }

        const clienteDoc = await db.collection('clientes').doc(clienteUid).get();

        if (!clienteDoc.exists) {
            console.warn(`Perfil de cliente no encontrado en Firestore para UID: ${clienteUid}`);
            return res.status(404).render('cliente/perfilcliente', {
                cliente: {
                    nombre: 'Usuario',
                    apellido: 'Desconocido',
                    email: req.user ? req.user.email : '',
                    telefono: '',
                    direccion: '',
                    perfil_riesgo: 'No definido',
                    objetivo_principal: 'No definido',
                    fechaRegistro: null,
                    fotoPerfilUrl: 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=%EF%A3%BF',
                    asesorAsignado: ''
                },
                error_msg: 'Tu perfil no está completo. Por favor, edita tu información.',
                user: req.user // Pasa req.user para la cabecera
            });
        }

        const clienteData = clienteDoc.data();

        // Manejo de la fecha de registro (Firestore Timestamp a ISO String)
        if (clienteData.fechaRegistro) {
            if (typeof clienteData.fechaRegistro.toDate === 'function') {
                clienteData.fechaRegistro = clienteData.fechaRegistro.toDate().toISOString();
            } else if (!(clienteData.fechaRegistro instanceof Date)) {
                clienteData.fechaRegistro = null; // Si no es Timestamp ni Date, anula
            }
        } else {
            clienteData.fechaRegistro = null;
        }

        // Renderiza la vista del perfil del cliente
        res.render('cliente/perfilcliente', { cliente: clienteData, user: req.user });
    } catch (error) {
        console.error('Error al obtener el perfil del cliente desde Firestore:', error);
        res.status(500).send('Error al cargar el perfil del cliente');
    }
};

// --- Función para editar la información personal del cliente (POST) ---
exports.editarInfoPersonalCliente = async (req, res) => {
    try {
        const clienteUid = req.session.userId;
        const { nombre, apellido, email, telefono, direccion } = req.body;

        if (!clienteUid) {
            return res.status(401).json({ success: false, message: 'No autenticado.' });
        }

        // Validaciones básicas
        if (!nombre || !apellido || !email || !telefono) {
            return res.status(400).json({ success: false, message: 'Nombre, apellido, email y teléfono son obligatorios.' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'El formato del correo electrónico no es válido.' });
        }

        // Opcional: Actualizar el email en Firebase Authentication si ha cambiado
        const currentUser = await auth.getUser(clienteUid);
        if (currentUser.email !== email) {
            try {
                await auth.updateUser(clienteUid, { email: email });
            } catch (authError) {
                console.error("Error al actualizar email en Firebase Auth:", authError);
                if (authError.code === 'auth/email-already-in-use') {
                    return res.status(400).json({ success: false, message: 'El email ya está en uso por otra cuenta.' });
                }
                return res.status(500).json({ success: false, message: 'Error al actualizar el email en Firebase Authentication.' });
            }
        }

        // Actualizar los datos en Firestore
        await db.collection('clientes').doc(clienteUid).update({
            nombre: nombre,
            apellido: apellido,
            email: email,
            telefono: telefono,
            direccion: direccion || null // Si no se proporciona, guarda null
        });

        // Obtener los datos actualizados para devolverlos al frontend
        const updatedClienteDoc = await db.collection('clientes').doc(clienteUid).get();
        const updatedClienteData = updatedClienteDoc.data();

        res.json({ success: true, message: 'Información personal actualizada con éxito.', cliente: updatedClienteData });

    } catch (error) {
        console.error('Error al actualizar la información personal del cliente:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar la información personal.' });
    }
};

// --- Función para editar la información financiera del cliente (POST) ---
exports.editarInfoFinancieraCliente = async (req, res) => {
    try {
        const clienteUid = req.session.userId;
        let { perfil_riesgo, objetivo_principal, otro_objetivo } = req.body; // <-- Añadir otro_objetivo aquí

        if (!clienteUid) {
            return res.status(401).json({ success: false, message: 'No autenticado.' });
        }

        // Si el objetivo principal seleccionado es "Otro", usa el valor de 'otro_objetivo'
        if (objetivo_principal === 'Otro') {
            objetivo_principal = otro_objetivo;
        }

        // Validaciones básicas
        if (!perfil_riesgo) { 
            return res.status(400).json({ success: false, message: 'El perfil de riesgo es obligatorio.' });
        }
        if (!objetivo_principal || objetivo_principal.trim() === '') { // Validar si el objetivo final está vacío
            return res.status(400).json({ success: false, message: 'El objetivo principal es obligatorio.' });
        }


        // Actualizar los datos en Firestore
        await db.collection('clientes').doc(clienteUid).update({
            perfil_riesgo: perfil_riesgo,
            objetivo_principal: objetivo_principal
        });

        const updatedClienteDoc = await db.collection('clientes').doc(clienteUid).get();
        const updatedClienteData = updatedClienteDoc.data();

        res.json({ success: true, message: 'Información financiera actualizada con éxito.', cliente: updatedClienteData });

    } catch (error) {
        console.error('Error al actualizar la información financiera del cliente:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar la información financiera.' });
    }
};

// --- Función para subir la foto de perfil del cliente (POST) ---
exports.uploadProfilePhotoCliente = async (req, res) => {
    try {
        const clienteUid = req.session.userId;
        if (!clienteUid) {
            return res.status(401).json({ success: false, message: 'No autenticado para subir la foto.' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No se ha subido ningún archivo.' });
        }

        const imgurClientId = process.env.IMGUR_CLIENT_ID;
        if (!imgurClientId) {
            console.error('IMGUR_CLIENT_ID no está configurado.');
            return res.status(500).json({ success: false, message: 'Error de configuración del servicio de imágenes.' });
        }

        const response = await fetch('https://api.imgur.com/3/image', {
            method: 'POST',
            headers: {
                'Authorization': `Client-ID ${imgurClientId}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image: req.file.buffer.toString('base64'),
                type: 'base64'
            })
        });

        const imgurResponse = await response.json();

        if (!imgurResponse.success) {
            console.error('Error al subir a Imgur:', imgurResponse.data.error || 'Error desconocido.');
            return res.status(500).json({ success: false, message: `Error al subir la foto a Imgur: ${imgurResponse.data.error || 'Error desconocido.'}` });
        }

        const imageUrl = imgurResponse.data.link;

        // Actualizar la URL de la foto de perfil en Firestore
        await db.collection('clientes').doc(clienteUid).update({
            fotoPerfilUrl: imageUrl
        });

        // Opcional: Actualizar la foto de perfil en Firebase Authentication
        await auth.updateUser(clienteUid, {
            photoURL: imageUrl
        });

        res.json({ success: true, message: 'Foto de perfil actualizada con éxito.', imageUrl: imageUrl });

    } catch (error) {
        console.error('Error en uploadProfilePhotoCliente:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al subir la foto de perfil.' });
    }
};


// --- Función para renderizar el formulario de cambio de contraseña del cliente (GET) ---
exports.getChangePasswordPageCliente = (req, res) => {
    console.log('--- INICIO: GET /cliente/cambiar_password ---');

    res.render('cliente/cambiar_password', {
        user: req.user 
    });
 
};

// --- Función para manejar la lógica de cambio de contraseña del cliente (POST) ---
exports.changePasswordCliente = async (req, res) => {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const errors = [];


    // Validaciones
    if (!currentPassword || !newPassword || !confirmNewPassword) {
        errors.push('Por favor, rellena todos los campos.');
    }
    if (newPassword !== confirmNewPassword) {
        errors.push('Las nuevas contraseñas no coinciden.');
    }
    if (newPassword.length < 6) {
        errors.push('La nueva contraseña debe tener al menos 6 caracteres.');
    }

    if (errors.length > 0) {
        return res.redirect('/cliente/cambiar_password'); // Redirige de vuelta al formulario del cliente
    }

    try {
        const clienteUid = req.session.userId;

        if (!clienteUid) {
            req.flash('error_msg', 'Usuario no autenticado para cambiar la contraseña.');
            return res.redirect('/login');
        }

        await auth.updateUser(clienteUid, {
            password: newPassword
        });

        req.flash('success_msg', '¡Contraseña actualizada con éxito!');
        res.redirect('/perfilcliente'); // Redirige al perfil del cliente

    } catch (err) {
        console.error('Error al cambiar la contraseña del cliente en Firebase Auth:', err);
        let errorMessage = 'Error del servidor al cambiar la contraseña.';

        if (err.code) {
            switch (err.code) {
                case 'auth/invalid-password':
                    errorMessage = 'La nueva contraseña no es válida (debe tener al menos 6 caracteres).';
                    break;
                case 'auth/user-not-found':
                    errorMessage = 'Usuario no encontrado.';
                    break;
                case 'auth/argument-error':
                    errorMessage = 'Error en los datos proporcionados para el usuario.';
                    break;
                default:
                    errorMessage = `Error de Firebase: ${err.message}`;
            }
        }
        req.flash('error_msg', errorMessage);
        res.redirect('/cliente/cambiar_password');
    }
};