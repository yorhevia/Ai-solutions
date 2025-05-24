const admin = require('firebase-admin');
const db = admin.firestore();

exports.mostrarPerfil = async (req, res) => {
    try {
        const clienteUid = req.session.userId;

        if (!clienteUid) {
            return res.redirect('/login');
        }

        const clienteDoc = await db.collection('clientes').doc(clienteUid).get();

        if (!clienteDoc.exists) {
            return res.status(404).send('Perfil de cliente no encontrado');
        }

        const clienteData = clienteDoc.data();

        if (clienteData.fechaRegistro) { // Si el campo fechaRegistro existe
            // Si es un objeto Timestamp de Firestore
            if (typeof clienteData.fechaRegistro.toDate === 'function') {
                const dateObject = clienteData.fechaRegistro.toDate(); // Convertir Timestamp a objeto Date de JS
                clienteData.fechaRegistro = dateObject.toISOString(); // Convertir Date a string ISO
                console.log('Backend Cliente - Fecha convertida de Timestamp a ISO para vista:', clienteData.fechaRegistro);
            } else if (clienteData.fechaRegistro instanceof Date) {
                clienteData.fechaRegistro = clienteData.fechaRegistro.toISOString();
                console.log('Backend Cliente - Fecha ya era Date, convertida a ISO para vista:', clienteData.fechaRegistro);
            } else {
                console.warn('Backend Cliente - fechaRegistro no es Timestamp ni Date:', clienteData.fechaRegistro);
                clienteData.fechaRegistro = null; 
            }
        } else {
            clienteData.fechaRegistro = null; // Asegurarse de que sea nulo si no existe el campo
            console.warn('Backend Cliente - Campo fechaRegistro no encontrado para este cliente.');
        }
        res.render('cliente/perfilcliente', { cliente: clienteData });

    } catch (error) {
        console.error('Error al obtener el perfil del cliente desde Firestore:', error);
        res.status(500).send('Error al cargar el perfil del cliente');
    }
};