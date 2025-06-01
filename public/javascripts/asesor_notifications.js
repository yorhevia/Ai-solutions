// public/javascript/asesor_notifications.js

document.addEventListener('DOMContentLoaded', function() {
    const notificationBell = document.getElementById('notificationBell');
    const notificationCountSpan = document.getElementById('notification-count');
    const notificationDropdown = document.getElementById('notificationDropdown');
    const notificationList = document.getElementById('latest-notifications'); // Este ID es el contenedor de las notificaciones recientes

    // ... (Tu función formatRelativeTime - está bien) ...
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
        
        return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // ... (Tu función markNotificationAsRead - está bien) ...
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
            return data.success; // Devuelve si fue exitoso
        } catch (error) {
            console.error('Error de red al marcar notificación como leída:', error);
            return false;
        }
    }

    // Función para obtener y mostrar las notificaciones
    async function fetchNotifications() {
        if (!notificationCountSpan || !notificationList) {
            console.warn('Elementos de notificación (contador o lista) no encontrados en el DOM. Revisa los IDs.');
            return; // Salir si no se encuentran los elementos
        }

        try {
            const response = await fetch('/api/asesor/notificaciones-resumen');
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Error ${response.status}: ${errorData.message || 'Error desconocido'}`);
            }

            const data = await response.json();

            if (data.success) {
                const count = data.unreadCount;
                const latest = data.latestNotifications;

                notificationCountSpan.textContent = count;
                // Bootstrap oculta el badge si está vacío, o puedes usar display: none/block
                notificationCountSpan.style.display = count > 0 ? 'inline-block' : 'none'; // 'inline-block' es más común para badges

                notificationList.innerHTML = ''; // Limpiar lista existente

                if (latest.length > 0) {
                    latest.forEach(notif => {
                        const listItem = document.createElement('a');
                        listItem.href = notif.link || '/asesor/notificaciones'; 
                        listItem.classList.add('dropdown-item');
                        if (!notif.read) {
                            listItem.classList.add('font-weight-bold');
                        }
                        listItem.dataset.id = notif.id; 

                        let displayMessage = notif.message;
                        if (displayMessage.length > 60) {
                            displayMessage = displayMessage.substring(0, 57) + '...';
                        }
                        
                        const notificationDate = (notif.timestamp && notif.timestamp._seconds !== undefined) 
                            ? formatRelativeTime(new Date(notif.timestamp._seconds * 1000 + (notif.timestamp._nanoseconds || 0) / 1000000)) 
                            : 'Fecha desconocida';

                        listItem.innerHTML = `
                            <span style="font-size:0.9em; color:#666;">${notificationDate}</span><br>
                            ${displayMessage}
                        `;
                        
                        listItem.addEventListener('click', async function(event) {
                            // Solo prevenimos la navegación si la notificación no ha sido leída y queremos marcarla
                            if (!notif.read) {
                                event.preventDefault(); 
                                const marked = await markNotificationAsRead(notif.id);
                                if (marked) {
                                    // Actualizar la UI localmente para que se vea como leída
                                    this.classList.remove('font-weight-bold');
                                    // Y luego, redirigir
                                    window.location.href = this.href;
                                    // También puedes volver a cargar las notificaciones para actualizar el contador
                                    // fetchNotifications(); 
                                } else {
                                    // Si hubo un error al marcar, aún puedes optar por navegar
                                    window.location.href = this.href;
                                }
                            } else {
                                // Si ya está leída, simplemente navega
                                // No se necesita event.preventDefault() aquí
                            }
                            notificationDropdown.classList.remove('show'); // Ocultar el dropdown al hacer clic
                        });

                        notificationList.appendChild(listItem);
                    });
                } else {
                    notificationList.innerHTML = '<span class="dropdown-item text-center text-muted">No hay notificaciones recientes.</span>';
                }
            } else {
                console.error('Error al obtener notificaciones:', data.message);
            }
        } catch (error) {
            console.error('Error de red o API al obtener notificaciones:', error);
            // Mostrar un indicador de error en el contador si hay un problema
            if (notificationCountSpan) {
                notificationCountSpan.textContent = '!'; 
                notificationCountSpan.style.display = 'inline-block';
            }
            if (notificationList) {
                notificationList.innerHTML = '<span class="dropdown-item text-center text-danger">Error al cargar notificaciones.</span>';
            }
        }
    }

    // Validar que los elementos existen antes de añadir listeners
    if (notificationBell && notificationDropdown) {
        // Mostrar/ocultar el dropdown al hacer clic en la campana
        notificationBell.addEventListener('click', function(event) {
            event.preventDefault(); // Previene el comportamiento por defecto del enlace
            event.stopPropagation(); // Evita que el clic se propague al 'window' listener y lo cierre de inmediato

            notificationDropdown.classList.toggle('show');
            if (notificationDropdown.classList.contains('show')) {
                fetchNotifications(); // Cargar notificaciones cuando se abre el dropdown
            }
        });

        // Ocultar el dropdown si se hace clic fuera de él
        window.addEventListener('click', function(event) {
            // Asegúrate de que el clic no fue dentro del dropdown ni en la campana
            if (!notificationDropdown.contains(event.target) && !notificationBell.contains(event.target) && notificationDropdown.classList.contains('show')) {
                notificationDropdown.classList.remove('show');
            }
        });

        // Cargar notificaciones al cargar la página inicialmente
        fetchNotifications();

        // Opcional: Recargar notificaciones periódicamente (ej. cada 5 minutos)
        // setInterval(fetchNotifications, 5 * 60 * 1000); 
    } else {
        console.warn('Elementos de notificación (notificationBell o notificationDropdown) no encontrados en el DOM. Revisa tus IDs HTML.');
    }
});