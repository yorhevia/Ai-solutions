require('dotenv').config(); // Carga las variables de entorno desde .env
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

const session = require('express-session');
const flash = require('connect-flash');

router.use(cors());


// --- Configuración e Importación de SQLite ---
const db = require('./config/database'); 
// --- Fin de la Configuración de SQLite ---

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users'); 

var app = express();

// Configuración del motor de vistas
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Sirve archivos estáticos desde la carpeta 'images'
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(logger('dev')); // Muestra logs de desarrollo en la consola
app.use(express.json()); // Permite a la aplicación parsear JSON en el cuerpo de las solicitudes
app.use(express.urlencoded({ extended: false })); // Permite a la aplicación parsear datos de formularios
app.use(cookieParser()); // Habilita el parseo de cookies
app.use(express.static(path.join(__dirname, 'public'))); // Sirve archivos estáticos desde la carpeta 'public'

// Configuración para el proxy, necesario si estás detrás de un proxy/balanceador de carga
app.set('trust proxy', 1);


app.use(session({
    secret: process.env.SESSION_SECRET || '5c43dce9d60c0ed885f5db5d5b6ff7775bb4f20280c1d7f385f13a6c73488066357fb0796046a6be07f2d4d58ddeeda0f797e94586929ca0a101834745fbcdfe', // ¡Usa una variable de entorno para esto en producción!
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // true si estás en producción con HTTPS
        maxAge: 3600000 // 1 hora de duración para la cookie de sesión (en milisegundos)
    }
}));

// --- Añadir el middleware Flash ---
app.use(flash());

// Middleware para pasar mensajes flash y user info a las vistas
app.use((req, res, next) => {
    // Estas variables estarán disponibles en todas tus plantillas EJS
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.info_msg = req.flash('info_msg'); // <--- ¡AÑADIDO ESTO!
    res.locals.userType = req.session.userType || null;
    res.locals.userName = req.session.userName || null;

    // Poblar req.user (para compatibilidad con otros middlewares si es necesario)
    if (req.session.userId) {
        req.user = {
            id: req.session.userId,
            email: req.session.userEmail, // Asegúrate de que userEmail esté en la sesión
            userType: req.session.userType,
            name: req.session.userName
        };
    } else {
        req.user = null;
    }
    next();
});

// --- Rutas de la aplicación ---
app.use('/', indexRouter);
app.use('/users', usersRouter); // Si tienes rutas relacionadas con usuarios separadas

// --- Manejador de errores 404 (página no encontrada) ---
app.use(function(req, res, next) {
    next(createError(404));
});

// --- Manejador de errores general ---
app.use(function(err, req, res, next) {
    // Configura variables locales, solo proporcionando detalles de error en desarrollo
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // Renderiza la página de error con el estado HTTP apropiado
    res.status(err.status || 500);
    res.render('error');
});

module.exports = app;