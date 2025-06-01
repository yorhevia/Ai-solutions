require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

const session = require('express-session');
const flash = require('connect-flash');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); 

app.set('trust proxy', 1);

// ** CONFIGURACIÓN DE LA SESIÓN con el STORE POR DEFECTO (memoria) **
app.use(session({
    secret: '5c43dce9d60c0ed885f5db5d5b6ff7775bb4f20280c1d7f385f13a6c73488066357fb0796046a6be07f2d4d58ddeeda0f797e94586929ca0a101834745fbcdfe', // ¡Usa una variable de entorno para esto en producción!
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 3600000 // 1 hora de duración para la cookie de sesión
    }
}));

// ** AÑADIR EL MIDDLEWARE FLASH **
app.use(flash());

// Middleware para pasar mensajes flash y user info a las vistas
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.userType = req.session.userType || null;
    res.locals.userName = req.session.userName || null;

    // Poblar req.user (para compatibilidad con middlewares si es necesario)
    if (req.session.userId) {
        req.user = {
            id: req.session.userId,
            email: req.userEmail,
            userType: req.session.userType,
            name: req.session.userName
        };
    } else {
        req.user = null;
    }
    next();
});

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};
    res.status(err.status || 500);
    res.render('error');
});

module.exports = app;
