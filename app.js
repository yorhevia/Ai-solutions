require('dotenv').config();
var createError = require('http-errors');
const session = require('express-session');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
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

// Configuración de la sesión
app.use(session({
    // Utiliza la variable de entorno para el secreto
    secret: process.env.SESSION_SECRET, 
    resave: false,
    saveUninitialized: false, 
    cookie: {
        httpOnly: true,
        // Establecer secure: true para producción (HTTPS), false para desarrollo (HTTP)
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 3600000 // 1 hora en milisegundos
    }
}));

// Comprobación de la variable SESSION_SECRET al inicio de la aplicación
if (!process.env.SESSION_SECRET) {
    console.error('Error: SESSION_SECRET no está definida en las variables de entorno. La sesión no funcionará correctamente.');
    process.exit(1); // Sale de la aplicación si falta esta variable crítica
}

app.use('/', indexRouter);
app.use('/users', usersRouter); // Asegúrate de que esta línea es necesaria

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

module.exports = app;