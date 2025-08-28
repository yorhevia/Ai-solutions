document.addEventListener('DOMContentLoaded', function() {
    const openMenuButton = document.getElementById('openMenuButton');
    const navbarNav = document.getElementById('navbarNav');
    const notificationBell = document.getElementById('notificationBell');
    const notificationCountSpan = document.getElementById('notification-count');
    const notificationDropdown = document.getElementById('notificationDropdown');
    const notificationList = document.getElementById('latest-notifications');

    // --- Funciones auxiliares para Notificaciones ---

    // Función para formatear el tiempo relativo (ej. "hace 5 minutos")
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

    // Función para marcar una notificación como leída en el backend
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

    // Función para obtener y mostrar las notificaciones en el dropdown de la navbar
    async function fetchNotifications() {
        if (!notificationCountSpan || !notificationList) {
            console.warn('Elementos de notificación (contador o lista) no encontrados en el DOM. Revisa los IDs.');
            return;
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
                // Muestra u oculta el contador si hay notificaciones sin leer
                notificationCountSpan.style.display = count > 0 ? 'inline-block' : 'none';

                // Solo limpiar y rellenar la lista si estamos en la vista de escritorio
                if (window.innerWidth >= 768) {
                    notificationList.innerHTML = ''; // Limpiar lista existente

                    if (latest && latest.length > 0) { // Asegúrate de que 'latest' no es null/undefined
                        latest.forEach(notif => {
                            const listItem = document.createElement('a');
                            listItem.href = notif.link || '/asesor/notificaciones'; 
                            listItem.classList.add('dropdown-item');
                            // Si la notificación no está leída, añade la clase para negrita
                            if (!notif.read) { 
                                listItem.classList.add('font-weight-bold');
                            }
                            listItem.dataset.id = notif.id; 

                            let displayMessage = notif.message;
                            // Trunca el mensaje si es demasiado largo
                            if (displayMessage.length > 60) {
                                displayMessage = displayMessage.substring(0, 57) + '...';
                            }
                            
                            // Convierte el string ISO de `createdAt` a un objeto Date
                            const notificationDate = (notif.createdAt) 
                                ? formatRelativeTime(new Date(notif.createdAt)) 
                                : 'Fecha desconocida';

                            listItem.innerHTML = `
                                <span style="font-size:0.9em; color:#666;">${notificationDate}</span><br>
                                ${displayMessage}
                            `;
                            
                            listItem.addEventListener('click', async function(event) {
                                // Solo previene la navegación si la notificación no ha sido leída
                                if (!notif.read) {
                                    event.preventDefault(); 
                                    const marked = await markNotificationAsRead(notif.id);
                                    if (marked) {
                                        // Actualiza la UI localmente para que se vea como leída
                                        this.classList.remove('font-weight-bold');
                                        // Y luego, redirige
                                        window.location.href = this.href;
                                    } else {
                                        // Si hubo un error al marcar, aún puedes optar por navegar
                                        window.location.href = this.href;
                                    }
                                }
                                // Solo ocultar el dropdown si estamos en desktop
                                if (window.innerWidth >= 768) {
                                    notificationDropdown.classList.remove('show');
                                }
                            });

                            notificationList.appendChild(listItem);
                        });
                    } else {
                        notificationList.innerHTML = '<span class="dropdown-item text-center text-muted">No hay notificaciones recientes.</span>';
                    }
                } // Fin del if para responsive
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
            if (notificationList && window.innerWidth >= 768) { // Solo mostrar este mensaje en desktop
                notificationList.innerHTML = '<span class="dropdown-item text-center text-danger">Error al cargar notificaciones.</span>';
            }
        }
    }

    // Función global para actualizar la campana de notificaciones desde cualquier lugar
    window.updateNotificationBell = fetchNotifications; 

    // --- Lógica del menú de Hamburguesa ---
    if (openMenuButton && navbarNav) {
        openMenuButton.addEventListener('click', function(event) {
            event.stopPropagation(); // Evita que el clic se propague al listener global

            // Cierra el dropdown de notificaciones si está abierto
            if (notificationDropdown.classList.contains('show')) {
                notificationDropdown.classList.remove('show');
            }

            navbarNav.classList.toggle('show');
            const icon = openMenuButton.querySelector('i');
            if (navbarNav.classList.contains('show')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });

        // Detener la propagación de clics dentro del menú para que no se cierre inmediatamente
        navbarNav.addEventListener('click', function(event) {
            event.stopPropagation();
        });
    }

    // --- Lógica del dropdown de Notificaciones ---
    if (notificationBell && notificationDropdown) {
        notificationBell.addEventListener('click', function(event) {
            event.preventDefault(); // Previene el comportamiento por defecto del enlace
            event.stopPropagation(); // Evita que el clic se propague al 'window' listener y lo cierre

            // Cierra el menú principal de hamburguesa si está abierto
            if (navbarNav.classList.contains('show')) {
                navbarNav.classList.remove('show');
                const icon = openMenuButton.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            }

            // Comportamiento condicional: redirigir en móvil, abrir dropdown en escritorio
            if (window.innerWidth < 768) { 
                window.location.href = '/asesor/notificaciones'; // Redirige directamente a la página completa
            } else { 
                notificationDropdown.classList.toggle('show'); // Abre/cierra el dropdown
                if (notificationDropdown.classList.contains('show')) {
                    fetchNotifications(); // Carga las notificaciones cuando se abre (solo en desktop)
                }
            }
        });

        // Detener la propagación de clics dentro del dropdown de notificaciones
        // Esto previene que un clic dentro del dropdown lo cierre (solo en desktop)
        if (window.innerWidth >= 768) { // Solo aplica si es desktop, donde el dropdown se muestra
            notificationDropdown.addEventListener('click', function(event) {
                event.stopPropagation();
            });
        }
    }

    // Cargar el contador de notificaciones al cargar la página inicialmente
    // La lista desplegable solo se cargará cuando se abra el dropdown (en desktop).
    fetchNotifications(); 

    // --- Listener global para cerrar menús al hacer clic fuera ---
    document.addEventListener('click', function(event) {
        // Lógica para cerrar menús solo en escritorio (mayor o igual a 768px)
        if (window.innerWidth >= 768) { 
            const isClickOutsideHamburgerMenu = !openMenuButton.contains(event.target) && !navbarNav.contains(event.target);
            const isClickOutsideNotificationDropdown = !notificationBell.contains(event.target) && !notificationDropdown.contains(event.target);

            // Si el clic fue fuera de ambos, ciérralos
            if (isClickOutsideHamburgerMenu && isClickOutsideNotificationDropdown) {
                if (navbarNav.classList.contains('show')) {
                    navbarNav.classList.remove('show');
                    const icon = openMenuButton.querySelector('i');
                    if (icon) {
                        icon.classList.remove('fa-times');
                        icon.classList.add('fa-bars');
                    }
                }
                if (notificationDropdown.classList.contains('show')) {
                    notificationDropdown.classList.remove('show');
                }
            }
        } else { // En responsive, solo necesitamos cerrar el menú de hamburguesa si está abierto
            const isClickOutsideHamburgerMenu = !openMenuButton.contains(event.target) && !navbarNav.contains(event.target);
            if (isClickOutsideHamburgerMenu && navbarNav.classList.contains('show')) {
                navbarNav.classList.remove('show');
                const icon = openMenuButton.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            }
            // En responsive, el dropdown de notificaciones redirige, no se cierra.
        }
    });

    // Opcional: Recargar notificaciones periódicamente (ej. cada 5 minutos)
    // setInterval(fetchNotifications, 5 * 60 * 1000); 

    // Listener para el redimensionamiento de la ventana (útil si se pasa de móvil a desktop sin recargar)
    window.addEventListener('resize', () => {
        // Al redimensionar, si se está en modo responsive y el menú está abierto, cerrarlo.
        // Y si se vuelve a desktop, asegurar que el dropdown no esté "show" si no debe.
        if (window.innerWidth >= 768) {
            // Asegúrate de que el menú de hamburguesa está cerrado si la pantalla es lo suficientemente grande
            if (navbarNav.classList.contains('show')) {
                navbarNav.classList.remove('show');
                const icon = openMenuButton.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            }
            // Puedes también re-ejecutar fetchNotifications si es necesario para ajustar la visualización
            // fetchNotifications();
        } else { // Si es móvil
            if (notificationDropdown.classList.contains('show')) { // Cierra el dropdown de desktop si se pasa a móvil
                notificationDropdown.classList.remove('show');
            }
        }
    });
});