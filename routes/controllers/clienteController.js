const admin = require('firebase-admin');
const db = admin.firestore();

exports.mostrarPerfil = async (req, res) => {
    try {
        // Asumiendo que el UID del cliente de Firebase Auth está disponible en la sesión
        const clienteUid = req.session.userId;

        if (!clienteUid) {
            return res.redirect('/login'); // Redirigir si no hay usuario autenticado
        }

        // Obtener el documento del cliente desde Firestore
        const clienteDoc = await db.collection('clientes').doc(clienteUid).get();

        if (!clienteDoc.exists) {
            return res.status(404).send('Perfil de cliente no encontrado');
        }

        const clienteData = clienteDoc.data();

        // Renderizar la vista 'perfil_cliente' y pasar los datos del cliente
        res.render('cliente/perfilcliente', { cliente: clienteData }); // <--- Ruta corregida

    } catch (error) {
        console.error('Error al obtener el perfil del cliente desde Firestore:', error);
        res.status(500).send('Error al cargar el perfil');
    }
};