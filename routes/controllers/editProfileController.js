const admin = require('firebase-admin');
const db = admin.firestore();


exports.postEditPersonalAndContactInfo = async (req, res) => {
    const { nombre, apellido, email, telefono, direccion } = req.body;
    const asesorUid = req.session.userId;

    if (!asesorUid) {
        return res.status(401).json({ error: 'No autorizado. Por favor, inicia sesión.' });
    }

    if (!nombre || !apellido || !email || !telefono) {
        return res.status(400).json({ error: 'Nombre, apellido, email y teléfono son campos obligatorios.' });//
    }
    
    // Validación básica de email en el backend
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'El formato del correo electrónico no es válido.' });
    }

    try {
        // Obtenemos los datos actuales para ver si el email ha cambiado
        const currentAsesorDoc = await db.collection('asesores').doc(asesorUid).get();
        const currentAsesorData = currentAsesorDoc.data();
        const currentEmail = currentAsesorData.email;

        // Si el email ha cambiado, intentamos actualizarlo en Firebase Authentication
        if (email !== currentEmail) {
            try {
                await admin.auth().updateUser(asesorUid, { email: email });
            } catch (authError) {
                console.error('Error al actualizar email en Auth:', authError);
                let errorMessage = 'Error al actualizar el correo electrónico.';
                if (authError.code === 'auth/email-already-exists') {
                    errorMessage = 'Este correo electrónico ya está en uso por otra cuenta.';
                } else if (authError.code === 'auth/invalid-email') {
                    errorMessage = 'El correo electrónico proporcionado no es válido.';
                } else if (authError.code === 'auth/requires-recent-login') {
                    errorMessage = 'Por favor, inicia sesión nuevamente para actualizar tu correo electrónico.';
                }
                return res.status(400).json({ error: errorMessage });
            }
        }

        // Actualizar datos en Firestore
        const updateData = {
            nombre,
            apellido,
            email, // Siempre actualizar email en Firestore para mantener la coherencia
            telefono,
            // Solo actualiza la dirección si se proporcionó en el formulario
            ...(direccion && { direccion }) 
        };

        await db.collection('asesores').doc(asesorUid).update(updateData);

        // Actualizar displayName en Firebase Authentication
        await admin.auth().updateUser(asesorUid, {
            displayName: `${nombre} ${apellido}`,
        });

        console.log(`Perfil de asesor actualizado (in-place): ${asesorUid}`);

        // Devolvemos los datos actualizados al frontend
        const updatedAsesorDoc = await db.collection('asesores').doc(asesorUid).get();
        const updatedAsesorData = updatedAsesorDoc.data();

        // Convertir Timestamp a ISO string para la respuesta
        if (updatedAsesorData.fechaRegistro && typeof updatedAsesorData.fechaRegistro.toDate === 'function') {
            updatedAsesorData.fechaRegistro = updatedAsesorData.fechaRegistro.toDate().toISOString();
        }

        res.status(200).json({
            message: 'Perfil actualizado con éxito.',
            asesor: updatedAsesorData
        });

    } catch (error) {
        console.error('Error al actualizar información personal y de contacto:', error);
        res.status(500).json({ error: 'Error interno del servidor al actualizar el perfil.' });
    }
};

