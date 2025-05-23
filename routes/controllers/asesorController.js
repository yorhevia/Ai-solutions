 const admin = require('firebase-admin');
 const db = admin.firestore();

 exports.mostrarPerfilAsesor = async (req, res) => {
  try {
  // 1. Obtener el UID del asesor autenticado desde la sesión
  const asesorUid = req.session.userId;

  // 2. Verificar si el UID existe (asesor autenticado)
  if (!asesorUid) {
  return res.redirect('/login'); // Redirigir si no hay asesor autenticado
  }

  // 3. Consultar Firestore para obtener el documento del asesor usando el UID
  const asesorDoc = await db.collection('asesores').doc(asesorUid).get();

  // 4. Verificar si el documento del asesor existe
  if (!asesorDoc.exists) {
  return res.status(404).send('Perfil de asesor no encontrado');
  }

  // 5. Extraer los datos del documento
  const asesorData = asesorDoc.data();

  // 6. Renderizar la vista 'asesor/perfilasesor' y pasar los datos del asesor
  res.render('asesor/perfilasesor', { asesor: asesorData });

  } catch (error) {
  console.error('Error al obtener el perfil del asesor desde Firestore:', error);
  res.status(500).send('Error al cargar el perfil del asesor');
  }
 };