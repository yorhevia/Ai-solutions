// controllers/clienteController.js

const admin = require('firebase-admin');
const db = admin.firestore();
const auth = admin.auth(); // Servicio de autenticación de Firebase Admin
const fetch = require('node-fetch'); // Necesario para subir a Imgur

// --- Función para mostrar el perfil del cliente (GET) ---
exports.mostrarPerfilCliente = async (req, res) => {
    try {
        const clienteUid = req.session.userId; // Asume que el UID del cliente se guarda en la sesión

        if (!clienteUid) {
            req.flash('error_msg', 'No has iniciado sesión o tu sesión ha expirado.');
            return res.redirect('/login'); // Redirige a login si no hay UID en sesión
        }

        const clienteDoc = await db.collection('clientes').doc(clienteUid).get();

        if (!clienteDoc.exists) {
            console.warn(`Perfil de cliente no encontrado en Firestore para UID: ${clienteUid}. Se renderiza un perfil por defecto.`);
            req.flash('error_msg', 'Tu perfil no está completo. Por favor, edita tu información.');
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
                    fotoPerfilUrl: 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=Perfil',
                    asesorAsignado: ''
                },
                success_msg: req.flash('success_msg'), // Pasa mensajes flash
                error_msg: req.flash('error_msg'), // Pasa mensajes flash
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
        res.render('cliente/perfilcliente', {
            cliente: clienteData,
            user: req.user,
            success_msg: req.flash('success_msg'), // Pasa mensajes flash
            error_msg: req.flash('error_msg') // Pasa mensajes flash
        });
    } catch (error) {
        console.error('Error al obtener el perfil del cliente desde Firestore:', error);
        req.flash('error_msg', 'Error al cargar el perfil del cliente.');
        res.status(500).redirect('/homecliente'); // Redirige a una página segura en caso de error
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
            req.flash('error_msg', 'No autenticado para subir la foto.');
            return res.status(401).json({ success: false, message: 'No autenticado para subir la foto.' });
        }

        if (!req.file) {
            req.flash('error_msg', 'No se ha subido ningún archivo.');
            return res.status(400).json({ success: false, message: 'No se ha subido ningún archivo.' });
        }

        const imgurClientId = process.env.IMGUR_CLIENT_ID;
        if (!imgurClientId) {
            console.error('IMGUR_CLIENT_ID no está configurado.');
            req.flash('error_msg', 'Error de configuración del servicio de imágenes.');
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
            req.flash('error_msg', `Error al subir la foto a Imgur: ${imgurResponse.data.error || 'Error desconocido.'}`);
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

        req.flash('success_msg', 'Foto de perfil actualizada con éxito.');
        res.json({ success: true, message: 'Foto de perfil actualizada con éxito.', imageUrl: imageUrl });

    } catch (error) {
        console.error('Error en uploadProfilePhotoCliente:', error);
        req.flash('error_msg', 'Error interno del servidor al subir la foto de perfil.');
        res.status(500).json({ success: false, message: 'Error interno del servidor al subir la foto de perfil.' });
    }
};


// --- Función para renderizar el formulario de cambio de contraseña del cliente (GET) ---
exports.getChangePasswordPageCliente = (req, res) => {
    console.log('--- INICIO: GET /cliente/cambiar_password ---');

    res.render('cliente/cambiar_password', {
        user: req.user,
        success_msg: req.flash('success_msg'), // Pasa mensajes flash
        error_msg: req.flash('error_msg') // Pasa mensajes flash
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
        req.flash('error_msg', errors); // Pasa los errores como mensajes flash
        return res.redirect('/cliente/cambiar_password'); // Redirige de vuelta al formulario del cliente
    }

    try {
        const clienteUid = req.session.userId;

        if (!clienteUid) {
            req.flash('error_msg', 'Usuario no autenticado para cambiar la contraseña.');
            return res.redirect('/login');
        }

        // Nota: La verificación de la `currentPassword` debe hacerse en el cliente
        // usando la API de Firebase Authentication (ej. reauthenticateWithCredential).
        // El Admin SDK no verifica la contraseña actual directamente.
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

// --- NUEVA FUNCIÓN: Mostrar perfil de cliente para el asesor (GET) ---
exports.mostrarPerfilClienteAsesor = async (req, res) => {
    try {
        const idCliente = req.params.id_cliente; // Obtiene el ID del cliente desde los parámetros de la URL

        if (!idCliente) {
            req.flash('error_msg', 'ID de cliente no proporcionado.');
            return res.redirect('/clientes-asignados'); // Redirige a la lista de clientes del asesor
        }

        const clienteDoc = await db.collection('clientes').doc(idCliente).get();

        if (!clienteDoc.exists) {
            console.warn(`Perfil de cliente no encontrado para el asesor para UID: ${idCliente}`);
            req.flash('error_msg', 'El perfil del cliente no fue encontrado.');
            return res.status(404).redirect('/clientes-asignados');
        }

        const clienteData = clienteDoc.data();

        // Manejo de la fecha de registro (Firestore Timestamp a ISO String)
        if (clienteData.fechaRegistro) {
            if (typeof clienteData.fechaRegistro.toDate === 'function') {
                clienteData.fechaRegistro = clienteData.fechaRegistro.toDate().toISOString();
            } else if (!(clienteData.fechaRegistro instanceof Date)) {
                clienteData.fechaRegistro = null;
            }
        } else {
            clienteData.fechaRegistro = null;
        }

        // Renderiza la vista del perfil del cliente (desde la perspectiva del asesor)
        // Asegúrate de tener una vista EJS en views/asesor/perfil_cliente.ejs
        res.render('asesor/perfil_cliente', {
            cliente: clienteData,
            user: req.user, // Pasa la información del usuario autenticado (asesor)
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg')
        });
    } catch (error) {
        console.error('Error al obtener el perfil del cliente para el asesor desde Firestore:', error);
        req.flash('error_msg', 'Error al cargar el perfil del cliente.');
        res.status(500).redirect('/clientes-asignados');
    }
};
exports.mostrarChatPersonalCliente = async (req, res) => {
    try {
        const clienteUid = req.session.userId;
        // --- DEBUG CRÍTICO: Verifica el UID del cliente en sesión ---
        console.log('DEBUG Backend - Cliente autenticado (req.session.userId):', clienteUid); 

        if (!clienteUid) {
            req.flash('error_msg', 'No has iniciado sesión o tu sesión ha expirado.');
            return res.redirect('/login');
        }

        const clienteDoc = await db.collection('clientes').doc(clienteUid).get();
        if (!clienteDoc.exists) {
            console.error('Error: Perfil de cliente no encontrado para UID:', clienteUid);
            req.flash('error_msg', 'Perfil de cliente no encontrado.');
            return res.redirect('/homecliente');
        }
        const clienteData = clienteDoc.data();
        // --- DEBUG CRÍTICO: Verifica el ID del documento del cliente ---
        console.log('DEBUG Backend - ID del documento del cliente (clienteDoc.id):', clienteDoc.id); 

        const asesorAsignadoId = clienteData.asesorAsignado;
        console.log('DEBUG Backend - ID de asesor asignado (desde clienteData.asesorAsignado):', asesorAsignadoId); 

        let asesorData = null;
        let chatMessages = [];
        let roomId = null;

        if (asesorAsignadoId && typeof asesorAsignadoId === 'string' && asesorAsignadoId.trim() !== '') {
            console.log(`DEBUG Backend - Intentando obtener documento de asesor con ID: "${asesorAsignadoId}"`);
            const asesorDoc = await db.collection('asesores').doc(asesorAsignadoId).get();

            if (asesorDoc.exists) {
                console.log(`DEBUG Backend - ¡Éxito! Documento de asesor encontrado con ID: "${asesorDoc.id}"`);
                asesorData = {
                    id: asesorDoc.id,
                    nombre: asesorDoc.data().nombre,
                    apellido: asesorDoc.data().apellido,
                    fotoPerfilUrl: asesorDoc.data().fotoPerfilUrl || '/images/default-profile.png'
                };
                console.log('DEBUG Backend - AsesorData poblada:', asesorData);

                roomId = getChatRoomId(clienteUid, asesorAsignadoId);
                console.log('DEBUG Backend - Calculando Chat Room ID:', roomId);
                const chatDoc = await db.collection('chats').doc(roomId).get();

                if (chatDoc.exists) {
                    console.log('DEBUG Backend - Documento de chat encontrado. Cargando mensajes...');
                    const chatData = chatDoc.data();
                    chatMessages = chatData.messages.map(msg => ({
                        ...msg,
                        // Asegúrate de que timestamp sea siempre un objeto Date para el frontend
                        timestamp: msg.timestamp ? (msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp)) : new Date()
                    }));
                    await db.collection('chats').doc(roomId).update({ clientUnreadCount: 0 });
                    console.log('DEBUG Backend - Mensajes de chat cargados y unreadCount actualizado.');
                } else {
                    console.log('DEBUG Backend - No se encontró documento de chat para esta sala. Chat iniciará vacío.');
                }
            } else {
                console.warn(`Advertencia: Documento de asesor con ID "${asesorAsignadoId}" NO EXISTE en la colección 'asesores'.`);
            }
        } else {
            console.warn(`Advertencia: El cliente ${clienteUid} no tiene un ID de asesor asignado válido o es una cadena vacía/nula.`);
        }

        console.log('DEBUG Backend - Valor final de asesorData antes de renderizar:', asesorData);
        // --- IMPORTANTE: Aseguramos que cliente.id sea el ID del documento de Firestore ---
        res.render('cliente/chat_personal_cliente', {
            cliente: { id: clienteDoc.id, ...clienteData }, // Pasamos el ID del documento explícitamente como cliente.id
            asesorAsignado: asesorData,
            chatMessages: chatMessages,
            user: req.user,
            roomId: roomId,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            info_msg: req.flash('info_msg')
        });

    } catch (error) {
        console.error('Error FATAL al cargar el chat personal del cliente:', error);
        req.flash('error_msg', 'Ocurrió un error al cargar tu chat. Por favor, inténtalo de nuevo.');
        return res.status(500).redirect('/homecliente');
    }
};



// Función auxiliar para obtener una sala de chat de forma consistente (importante que sea la misma que en asesorController)
const getChatRoomId = (uid1, uid2) => {
    const chatMembers = [uid1, uid2].sort();
    return `chat_${chatMembers[0]}_${chatMembers[1]}`;
};

// NUEVO: API para obtener mensajes del chat para el cliente (para peticiones AJAX/fetch)
exports.getClienteChatMessages = async (req, res) => {
    try {
        const clienteUid = req.session.userId;
        const asesorAsignadoId = req.params.asesorId; // El asesor con el que el cliente está chateando

        if (!clienteUid || !asesorAsignadoId) {
            return res.status(400).json({ success: false, message: 'Datos incompletos.' });
        }

        // Opcional: Verificar que este asesor sea el asignado al cliente
        const clienteDoc = await db.collection('clientes').doc(clienteUid).get();
        if (!clienteDoc.exists || clienteDoc.data().asesorAsignado !== asesorAsignadoId) {
             // Esto podría ser un error si el cliente intenta acceder a un chat que no le corresponde
             // o si el asesor asignado no existe o ha cambiado.
             return res.status(403).json({ success: false, message: 'Acceso denegado o asesor no asignado.' });
        }


        const roomId = getChatRoomId(clienteUid, asesorAsignadoId);
        const chatDoc = await db.collection('chats').doc(roomId).get();

        let messages = [];
        if (chatDoc.exists) {
            const chatData = chatDoc.data();
            messages = chatData.messages.map(msg => ({
                ...msg,
                timestamp: msg.timestamp ? (msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp)) : new Date()
            }));

            // Marcar mensajes como leídos para el cliente
            await db.collection('chats').doc(roomId).update({ clientUnreadCount: 0 });
        }

        res.json({ success: true, messages: messages });

    } catch (error) {
        console.error('Error al obtener mensajes del chat del cliente:', error);
        res.status(500).json({ success: false, message: 'Error al obtener mensajes.' });
    }
};

// NUEVO: API para enviar un mensaje desde el cliente (para peticiones AJAX/fetch)
// NUEVO: API para enviar un mensaje desde el cliente (para peticiones AJAX/fetch)
exports.clienteSendMessage = async (req, res) => {
    try {
        const clienteUid = req.session.userId;
        const { asesorId, messageText, timestamp: clientTimestamp } = req.body; // <--- ¡Captura el timestamp enviado desde el cliente!

        if (!clienteUid || !asesorId || !messageText) {
            return res.status(400).json({ success: false, message: 'Datos incompletos para enviar mensaje.' });
        }

        const clienteDoc = await db.collection('clientes').doc(clienteUid).get();
        if (!clienteDoc.exists || clienteDoc.data().asesorAsignado !== asesorId) {
            return res.status(403).json({ success: false, message: 'Acceso denegado o asesor no asignado.' });
        }

        const roomId = getChatRoomId(clienteUid, asesorId);
        const chatRef = db.collection('chats').doc(roomId);
        const chatDoc = await chatRef.get();

        // Usa el timestamp del cliente si está disponible, o el del servidor si no (por seguridad)
        const messageActualTimestamp = clientTimestamp ? new Date(clientTimestamp) : new Date();

        const newMessage = {
            senderId: clienteUid,
            senderType: 'cliente',
            text: messageText,
            timestamp: messageActualTimestamp // Usa el timestamp que realmente quieres guardar
        };

        if (!chatDoc.exists) {
            await chatRef.set({
                clientId: clienteUid,
                asesorId: asesorId,
                messages: [newMessage],
                lastMessageText: messageText,
                lastMessageTimestamp: admin.firestore.Timestamp.fromDate(messageActualTimestamp), // Usa el mismo timestamp del mensaje
                clientUnreadCount: 0,
                asesorUnreadCount: 1
            });
        } else {
            await chatRef.update({
                messages: admin.firestore.FieldValue.arrayUnion(newMessage),
                lastMessageText: messageText,
                lastMessageTimestamp: admin.firestore.Timestamp.fromDate(messageActualTimestamp), // Usa el mismo timestamp del mensaje
                asesorUnreadCount: admin.firestore.FieldValue.increment(1)
            });
        }

        res.json({ success: true, message: 'Mensaje enviado.', sentMessage: newMessage });

    } catch (error) {
        console.error('Error al enviar mensaje del cliente:', error);
        res.status(500).json({ success: false, message: 'Error al enviar mensaje.' });
    }
};