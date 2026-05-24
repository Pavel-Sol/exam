from flask import Flask, request, jsonify, send_from_directory
import os, re, hashlib
import pymysql
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

DB_CONFIG = {
    "host": "127.0.0.1", "user": "root", "password": "",
    "database": "korochki", "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor
}

RE_LOGIN    = re.compile(r"^[A-Za-z0-9]{6,}$")   # логин: латиница/цифры, от 6
RE_FULLNAME = re.compile(r"^[А-Яа-яЁё\s]+$")
RE_PHONE    = re.compile(r"^8\(\d{3}\)\d{3}-\d{2}-\d{2}$")
RE_EMAIL    = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

def pw(p): return hashlib.sha256(p.encode()).hexdigest()
def db():  return pymysql.connect(**DB_CONFIG)

# ── Страницы ──────────────────────────────────────────────────────────────────
app.add_url_rule("/",                   "pg_idx",    lambda: send_from_directory(FRONTEND_DIR,"login.html"))
app.add_url_rule("/login",              "pg_login",  lambda: send_from_directory(FRONTEND_DIR,"login.html"))
app.add_url_rule("/register",           "pg_reg",    lambda: send_from_directory(FRONTEND_DIR,"register.html"))
app.add_url_rule("/applications",       "pg_apps",   lambda: send_from_directory(FRONTEND_DIR,"applications.html"))
app.add_url_rule("/create_application","pg_create",  lambda: send_from_directory(FRONTEND_DIR,"create_application.html"))
app.add_url_rule("/admin",              "pg_admin",  lambda: send_from_directory(FRONTEND_DIR,"admin.html"))
app.add_url_rule("/styles.css",         "pg_css",    lambda: send_from_directory(FRONTEND_DIR,"styles.css"))
app.add_url_rule("/slider.js",          "pg_sldr",   lambda: send_from_directory(FRONTEND_DIR,"slider.js"))
app.add_url_rule("/assets/<path:fp>",   "pg_assets", lambda fp: send_from_directory(os.path.join(FRONTEND_DIR,"assets"),fp))

# ── API ───────────────────────────────────────────────────────────────────────
@app.post("/api/register")
def register():
    d = request.get_json(silent=True) or {}
    login    = (d.get("login") or "").strip()
    password = d.get("password") or ""
    fname    = (d.get("full_name") or "").strip()
    phone    = (d.get("phone") or "").strip()
    email    = (d.get("email") or "").strip()
    if not all([login, password, fname, phone, email]):
        return jsonify({"error": "Все поля обязательны."}), 400
    if not RE_LOGIN.match(login):
        return jsonify({"error": "Логин: латиница/цифры, от 6 символов."}), 400
    if len(password) < 8:
        return jsonify({"error": "Пароль: не менее 8 символов."}), 400
    if not RE_FULLNAME.match(fname):
        return jsonify({"error": "ФИО: только кириллица и пробелы."}), 400
    if not RE_PHONE.match(phone):
        return jsonify({"error": "Телефон: формат 8(XXX)XXX-XX-XX."}), 400
    if not RE_EMAIL.match(email):
        return jsonify({"error": "Email: неверный формат."}), 400
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE login=%s OR email=%s", (login, email))
                if cur.fetchone():
                    return jsonify({"error": "Логин или email уже заняты."}), 409
                cur.execute("SELECT id FROM roles WHERE name='user'")
                role = cur.fetchone()
                cur.execute(
                    "INSERT INTO users (login,password_hash,full_name,phone,email,role_id)"
                    " VALUES (%s,%s,%s,%s,%s,%s)",
                    (login, pw(password), fname, phone, email, role["id"])
                )
            conn.commit()
        return jsonify({"message": "Пользователь создан."}), 201
    except Exception:
        return jsonify({"error": "Ошибка сервера."}), 500

@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    login_val = (d.get("login") or "").strip()
    password  = d.get("password") or ""
    if not login_val or not password:
        return jsonify({"error": "Введите логин и пароль."}), 400
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT u.id, r.name AS role, u.password_hash"
                    " FROM users u JOIN roles r ON r.id=u.role_id WHERE u.login=%s",
                    (login_val,)
                )
                user = cur.fetchone()
        if not user or user["password_hash"] != pw(password):
            return jsonify({"error": "Неверный логин или пароль."}), 401
        return jsonify({"message": "Вход выполнен.", "user_id": user["id"], "role": user["role"]}), 200
    except Exception:
        return jsonify({"error": "Ошибка сервера."}), 500

@app.get("/api/applications/my")
def my_apps():
    uid = request.args.get("user_id", "").strip()
    if not uid.isdigit():
        return jsonify({"error": "Требуется user_id."}), 400
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT a.id, a.course_name,
                           DATE_FORMAT(a.start_date,'%%Y-%%m-%%d') AS start_date,
                           pm.name AS payment_method, st.name AS status,
                           DATE_FORMAT(a.created_at,'%%Y-%%m-%%d %%H:%%i') AS created_at
                    FROM applications a
                    JOIN payment_methods pm ON pm.id = a.payment_method_id
                    JOIN application_statuses st ON st.id = a.status_id
                    WHERE a.user_id = %s ORDER BY a.id DESC
                """, (int(uid),))
                return jsonify({"applications": cur.fetchall()}), 200
    except Exception:
        return jsonify({"error": "Ошибка сервера."}), 500

@app.post("/api/applications")
def create_app():
    d       = request.get_json(silent=True) or {}
    uid     = d.get("user_id")
    course  = (d.get("course_name") or "").strip()
    start   = (d.get("start_date") or "").strip()
    pm_name = (d.get("payment_method") or "").strip()
    if not isinstance(uid, int) or uid <= 0:
        return jsonify({"error": "Требуется user_id."}), 400
    if not course:
        return jsonify({"error": "Укажите курс."}), 400
    if not start:
        return jsonify({"error": "Укажите дату."}), 400
    if pm_name not in ("Наличными", "Переводом по номеру телефона"):
        return jsonify({"error": "Выберите способ оплаты."}), 400
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE id=%s", (uid,))
                if not cur.fetchone():
                    return jsonify({"error": "Пользователь не найден."}), 404
                cur.execute("SELECT id FROM payment_methods WHERE name=%s", (pm_name,))
                pm = cur.fetchone()
                cur.execute("SELECT id FROM application_statuses WHERE name='Новая'")
                st = cur.fetchone()
                cur.execute(
                    "INSERT INTO applications (user_id,course_name,start_date,payment_method_id,status_id)"
                    " VALUES (%s,%s,%s,%s,%s)",
                    (uid, course, start, pm["id"], st["id"])
                )
            conn.commit()
        return jsonify({"message": "Заявка создана."}), 201
    except Exception:
        return jsonify({"error": "Ошибка сервера."}), 500

@app.post("/api/reviews")
def add_review():
    d    = request.get_json(silent=True) or {}
    uid  = d.get("user_id")
    text = (d.get("text") or "").strip()
    if not isinstance(uid, int) or uid <= 0:
        return jsonify({"error": "Требуется user_id."}), 400
    if not text:
        return jsonify({"error": "Текст отзыва обязателен."}), 400
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE id=%s", (uid,))
                if not cur.fetchone():
                    return jsonify({"error": "Пользователь не найден."}), 404
                cur.execute("INSERT INTO reviews (user_id,text) VALUES (%s,%s)", (uid, text))
            conn.commit()
        return jsonify({"message": "Отзыв добавлен."}), 201
    except Exception:
        return jsonify({"error": "Ошибка сервера."}), 500

@app.get("/api/admin/applications")
def admin_apps():
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT a.id, u.login AS user_login, a.course_name,
                           DATE_FORMAT(a.start_date,'%%Y-%%m-%%d') AS start_date,
                           pm.name AS payment_method, st.name AS status
                    FROM applications a
                    JOIN users u ON u.id = a.user_id
                    JOIN payment_methods pm ON pm.id = a.payment_method_id
                    JOIN application_statuses st ON st.id = a.status_id
                    ORDER BY a.id DESC
                """)
                return jsonify({"applications": cur.fetchall()}), 200
    except Exception:
        return jsonify({"error": "Ошибка сервера."}), 500

@app.patch("/api/admin/applications/<int:app_id>/status")
def admin_status(app_id):
    d     = request.get_json(silent=True) or {}
    sname = (d.get("status") or "").strip()
    if sname not in {"Новая", "Идёт обучение", "Обучение завершено"}:
        return jsonify({"error": "Недопустимый статус."}), 400
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM application_statuses WHERE name=%s", (sname,))
                st = cur.fetchone()
                if not st:
                    return jsonify({"error": "Статус не найден."}), 500
                cur.execute("UPDATE applications SET status_id=%s WHERE id=%s", (st["id"], app_id))
                if cur.rowcount == 0:
                    return jsonify({"error": "Заявка не найдена."}), 404
            conn.commit()
        return jsonify({"message": "Статус обновлён."}), 200
    except Exception:
        return jsonify({"error": "Ошибка сервера."}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)