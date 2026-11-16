const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

// Проверка за задължителни env променливи
if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET is not set in environment variables.');
    process.exit(1);
}

const app = express();
const APP_BASE_PATH = (process.env.APP_BASE_PATH || '').replace(/\/+$/, '');
const withBase = (route) => `${APP_BASE_PATH}${route === '/' ? '' : route}`;

// Middleware
app.use(cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

if (APP_BASE_PATH) {
    app.use(APP_BASE_PATH, express.static(path.join(__dirname, 'public')));
}

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/xbethub';
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => {
    console.log('MongoDB Connected');
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
})
.catch(err => {
    console.error('MongoDB Connection Error:', err);
});

// Routes
app.use(withBase('/api/predictions'), require('./routes/predictions'));
app.use(withBase('/api/auth'), require('./routes/auth'));

const sendPublicFile = (fileName) => (req, res) => {
    res.sendFile(path.join(__dirname, 'public', fileName));
};

// Serve static files
app.get(withBase('/'), sendPublicFile('index.html'));
app.get(withBase('/login'), sendPublicFile('login.html'));
app.get(withBase('/admin'), sendPublicFile('admin.html'));

app.get('/', sendPublicFile('index.html'));
app.get('/login', sendPublicFile('login.html'));
app.get('/admin', sendPublicFile('admin.html'));