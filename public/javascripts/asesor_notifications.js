document.addEventListener('DOMContentLoaded', function() {
    const notificationIconContainer = document.querySelector('.notification-icon-container');
    const notificationLink = document.querySelector('.notification-link');
    const notificationDropdown = document.getElementById('notificationDropdown');
    const notificationCountSpan = document.getElementById('notificationCount');
    const notificationList = document.getElementById('notificationList');

    let timeout; // Para el temporizador de ocultar el dropdown

    // Función para obtener y mostrar las notificaciones
    async function fetchNotifications() {
        try {
            const response = await fetch('/api/asesor/notificaciones-resumen');
            const data = await response.json();

            if (data.success) {
                // Actualizar contador
                if (data.unreadCount > 0) {
                    notificationCountSpan.textContent = data.unreadCount;
                    notificationCountSpan.style.display = 'block'; // Mostrar el contador
                } else {
                    notificationCountSpan.style.display = 'none'; // Ocultar si no hay no leídas
                }

                // Llenar el dropdown
                notificationList.innerHTML = ''; // Limpiar lista existente
                if (data.latestNotifications.length > 0) {
                    data.latestNotifications.forEach(notif => {
                        const listItem = document.createElement('li');
                        listItem.classList.add('notification-item');
                        if (!notif.read) {
                            listItem.classList.add('unread'); // Clase para notificaciones no leídas
                        }
                        listItem.dataset.id = notif.id; // Guardar el ID de la notificación

                        const messageLink = document.createElement('a');
                        messageLink.href = notif.link || '/asesor/notificaciones'; // Enlace a la notificación (o a la página de notificaciones)
                        messageLink.textContent = notif.message;
                        
                        const timestampSpan = document.createElement('span');
                        timestampSpan.classList.add('notification-timestamp');
                        // Formatear el timestamp si es un objeto Timestamp de Firebase
                        if (notif.timestamp && typeof notif.timestamp === 'object' && notif.timestamp._seconds) {
                            const date = new Date(notif.timestamp._seconds * 1000 + notif.timestamp._nanoseconds / 1000000);
                            timestampSpan.textContent = formatRelativeTime(date); // Usar una función de formato legible
                        } else {
                            timestampSpan.textContent = 'Fecha desconocida';
                        }
                        
                        listItem.appendChild(messageLink);
                        listItem.appendChild(timestampSpan);

                        // Marcar como leída al hacer clic en la notificación en el dropdown
                        listItem.addEventListener('click', async function() {
                            if (!notif.read) {
                                await markNotificationAsRead(notif.id);
                                // Actualizar la UI inmediatamente
                                listItem.classList.remove('unread');
                                fetchNotifications(); // Volver a cargar para actualizar el contador
                            }
                            // Opcional: Cerrar el dropdown después de hacer clic
                            notificationDropdown.classList.remove('show');
                        });

                        notificationList.appendChild(listItem);
                    });
                } else {
                    notificationList.innerHTML = '<li>No hay notificaciones.</li>';
                }
            } else {
                console.error('Error al obtener notificaciones:', data.message);
            }
        } catch (error) {
            console.error('Error de red al obtener notificaciones:', error);
        }
    }

    // Función para marcar una notificación como leída
    async function markNotificationAsRead(notificationId) {
        try {
            const response = await fetch('/asesor/notificaciones/marcar-leida', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ notificationId: notificationId })
            });
            const data = await response.json();
            if (!data.success) {
                console.error('Error al marcar notificación como leída:', data.message);
            }
        } catch (error) {
            console.error('Error de red al marcar notificación como leída:', error);
        }
    }

    // Función para formatear el tiempo de forma relativa (hace X minutos/horas/días)
    function formatRelativeTime(date) {
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);

        if (seconds < 60) return `hace ${seconds} segundos`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `hace ${minutes} minutos`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `hace ${hours} horas`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `hace ${days} días`;
        
        // Si es más de una semana, mostrar la fecha completa
        return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // Mostrar/ocultar el dropdown al hacer clic en la campana
    notificationLink.addEventListener('click', function(event) {
        event.preventDefault();
        notificationDropdown.classList.toggle('show');
        if (notificationDropdown.classList.contains('show')) {
            clearTimeout(timeout); // Limpiar cualquier temporizador si ya está visible
        }
    });

    // Ocultar el dropdown cuando el mouse se mueve fuera del contenedor de la campana y del dropdown
    notificationIconContainer.addEventListener('mouseleave', function() {
        timeout = setTimeout(() => {
            notificationDropdown.classList.remove('show');
        }, 300); // Pequeño retraso para permitir movimiento entre campana y dropdown
    });

    notificationDropdown.addEventListener('mouseenter', function() {
        clearTimeout(timeout); // Si el mouse entra al dropdown, cancelar el temporizador
    });

    notificationDropdown.addEventListener('mouseleave', function() {
        timeout = setTimeout(() => {
            notificationDropdown.classList.remove('show');
        }, 300);
    });

    // Ocultar el dropdown si se hace clic fuera de él
    window.addEventListener('click', function(event) {
        if (!notificationIconContainer.contains(event.target) && !notificationDropdown.contains(event.target)) {
            notificationDropdown.classList.remove('show');
        }
    });

    // Cargar notificaciones al inicio
    fetchNotifications();

});