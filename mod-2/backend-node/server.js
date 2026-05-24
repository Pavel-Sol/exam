const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const pool = require('./db');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// ---------- HTML страницы (аналог add_url_rule из Flask) ----------
const frontendPath = path.join(__dirname, '..', 'frontend');

app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'login.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(frontendPath, 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(frontendPath, 'register.html'));
});

app.get('/applications', (req, res) => {
    res.sendFile(path.join(frontendPath, 'applications.html'));
});

app.get('/create_application', (req, res) => {
    res.sendFile(path.join(frontendPath, 'create_application.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin.html'));
});

// Статические файлы
app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(frontendPath, 'styles.css'));
});

app.get('/slider.js', (req, res) => {
    res.sendFile(path.join(frontendPath, 'slider.js'));
});

app.get('/slider.css', (req, res) => {
    res.sendFile(path.join(frontendPath, 'slider.css'));
});

app.use('/assets', express.static(path.join(frontendPath, 'assets')));

// ---------- Вспомогательные функции ----------
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// ---------- API (оставляем как было) ----------

// Регистрация
app.post('/api/register', async (req, res) => {
    const { login, password, full_name, phone, email } = req.body;
    
    const loginRegex = /^[A-Za-z0-9]{6,}$/;
    const fullnameRegex = /^[А-Яа-яЁё\s]+$/;
    const phoneRegex = /^8\(\d{3}\)\d{3}-\d{2}-\d{2}$/;
    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    
    if (!login || !password || !full_name || !phone || !email) {
        return res.status(400).json({ error: 'Все поля обязательны.' });
    }
    if (!loginRegex.test(login)) {
        return res.status(400).json({ error: 'Логин: латиница/цифры, от 6 символов.' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Пароль: не менее 8 символов.' });
    }
    if (!fullnameRegex.test(full_name)) {
        return res.status(400).json({ error: 'ФИО: только кириллица и пробелы.' });
    }
    if (!phoneRegex.test(phone)) {
        return res.status(400).json({ error: 'Телефон: формат 8(XXX)XXX-XX-XX.' });
    }
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Email: неверный формат.' });
    }
    
    try {
        const [existing] = await pool.query(
            'SELECT id FROM users WHERE login = ? OR email = ?',
            [login, email]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Логин или email уже заняты.' });
        }
        
        const [roleRows] = await pool.query("SELECT id FROM roles WHERE name = 'user'");
        const roleId = roleRows[0].id;
        
        const hashedPassword = hashPassword(password);
        await pool.query(
            'INSERT INTO users (login, password_hash, full_name, phone, email, role_id) VALUES (?, ?, ?, ?, ?, ?)',
            [login, hashedPassword, full_name, phone, email, roleId]
        );
        
        res.status(201).json({ message: 'Пользователь создан.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера.' });
    }
});

// Авторизация
app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    
    if (!login || !password) {
        return res.status(400).json({ error: 'Введите логин и пароль.' });
    }
    
    try {
        const [rows] = await pool.query(
            `SELECT u.id, r.name AS role, u.password_hash 
             FROM users u 
             JOIN roles r ON r.id = u.role_id 
             WHERE u.login = ?`,
            [login]
        );
        
        const user = rows[0];
        if (!user || user.password_hash !== hashPassword(password)) {
            return res.status(401).json({ error: 'Неверный логин или пароль.' });
        }
        
        res.json({ message: 'Вход выполнен.', user_id: user.id, role: user.role });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера.' });
    }
});

// Получить заявки текущего пользователя
app.get('/api/applications/my', async (req, res) => {
    const userId = req.query.user_id;
    
    if (!userId || isNaN(userId)) {
        return res.status(400).json({ error: 'Требуется user_id.' });
    }
    
    try {
        const [rows] = await pool.query(
            `SELECT a.id, a.course_name,
                    DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
                    pm.name AS payment_method, st.name AS status,
                    DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i') AS created_at
             FROM applications a
             JOIN payment_methods pm ON pm.id = a.payment_method_id
             JOIN application_statuses st ON st.id = a.status_id
             WHERE a.user_id = ?
             ORDER BY a.id DESC`,
            [parseInt(userId)]
        );
        
        res.json({ applications: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера.' });
    }
});

// Создать заявку
app.post('/api/applications', async (req, res) => {
    const { user_id, course_name, start_date, payment_method } = req.body;
    
    if (!user_id || user_id <= 0) {
        return res.status(400).json({ error: 'Требуется user_id.' });
    }
    if (!course_name) {
        return res.status(400).json({ error: 'Укажите курс.' });
    }
    if (!start_date) {
        return res.status(400).json({ error: 'Укажите дату.' });
    }
    if (!['Наличными', 'Переводом по номеру телефона'].includes(payment_method)) {
        return res.status(400).json({ error: 'Выберите способ оплаты.' });
    }
    
    try {
        const [userRows] = await pool.query('SELECT id FROM users WHERE id = ?', [user_id]);
        if (userRows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден.' });
        }
        
        const [pmRows] = await pool.query('SELECT id FROM payment_methods WHERE name = ?', [payment_method]);
        const paymentMethodId = pmRows[0].id;
        
        const [statusRows] = await pool.query("SELECT id FROM application_statuses WHERE name = 'Новая'");
        const statusId = statusRows[0].id;
        
        await pool.query(
            'INSERT INTO applications (user_id, course_name, start_date, payment_method_id, status_id) VALUES (?, ?, ?, ?, ?)',
            [user_id, course_name, start_date, paymentMethodId, statusId]
        );
        
        res.status(201).json({ message: 'Заявка создана.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера.' });
    }
});

// Добавить отзыв
app.post('/api/reviews', async (req, res) => {
    const { user_id, text } = req.body;
    
    if (!user_id || user_id <= 0) {
        return res.status(400).json({ error: 'Требуется user_id.' });
    }
    if (!text) {
        return res.status(400).json({ error: 'Текст отзыва обязателен.' });
    }
    
    try {
        const [userRows] = await pool.query('SELECT id FROM users WHERE id = ?', [user_id]);
        if (userRows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден.' });
        }
        
        await pool.query('INSERT INTO reviews (user_id, text) VALUES (?, ?)', [user_id, text]);
        res.status(201).json({ message: 'Отзыв добавлен.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера.' });
    }
});

// Админ: получить все заявки
app.get('/api/admin/applications', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.id, u.login AS user_login, a.course_name,
                    DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
                    pm.name AS payment_method, st.name AS status
             FROM applications a
             JOIN users u ON u.id = a.user_id
             JOIN payment_methods pm ON pm.id = a.payment_method_id
             JOIN application_statuses st ON st.id = a.status_id
             ORDER BY a.id DESC`
        );
        
        res.json({ applications: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера.' });
    }
});

// Админ: изменить статус заявки
app.patch('/api/admin/applications/:app_id/status', async (req, res) => {
    const appId = parseInt(req.params.app_id);
    const { status } = req.body;
    
    if (!['Новая', 'Идёт обучение', 'Обучение завершено'].includes(status)) {
        return res.status(400).json({ error: 'Недопустимый статус.' });
    }
    
    try {
        const [statusRows] = await pool.query('SELECT id FROM application_statuses WHERE name = ?', [status]);
        const statusId = statusRows[0].id;
        
        const [result] = await pool.query('UPDATE applications SET status_id = ? WHERE id = ?', [statusId, appId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Заявка не найдена.' });
        }
        
        res.json({ message: 'Статус обновлён.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера.' });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://127.0.0.1:${PORT}`);
});