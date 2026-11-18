const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const mariadb = require("mariadb");
const path = require("path");
require("dotenv").config();

const server = express();
const appPath = path.join(__dirname, "public");

server.use(express.urlencoded({ extended: true }));
server.use(express.json());
server.use(session({
    secret: process.env.secret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, maxAge: 86400000 }
}));

const conn = mariadb.createPool({
    host: process.env.host,
    user: process.env.user,
    password: process.env.password,
    database: process.env.database,
    connectionLimit: 5
});

function checkAuth(req, res, next) {
    if (req.session.user) return next();
    return res.redirect("/auth.html");
}

function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString("hex");
        crypto.scrypt(password, salt, 64, (error, key) => {
            if (error) return reject(error);
            resolve(`${salt}:${key.toString("hex")}`);
        });
    });
}

function verifyPassword(password, storedHash) {
    return new Promise((resolve, reject) => {
        const [salt, savedHex] = String(storedHash).split(":");
        if (!salt || !savedHex) return resolve(false);

        crypto.scrypt(password, salt, 64, (error, key) => {
            if (error) return reject(error);
            const savedKey = Buffer.from(savedHex, "hex");
            resolve(savedKey.length === key.length && crypto.timingSafeEqual(savedKey, key));
        });
    });
}

function saveSession(req, res, user, status = 200, message = "Вход выполнен") {
    req.session.user = { id: user.id, email: user.email };
    req.session.save((error) => {
        if (error) {
            console.error("Ошибка сохранения сессии:", error);
            return res.status(500).json({ error: "Не удалось сохранить сессию" });
        }
        return res.status(status).json({ message, redirect: "/site.html" });
    });
}

server.use(express.static(appPath));

server.get("/", (req, res) => {
    if (req.session.user) return res.redirect("/site.html");
    return res.sendFile(path.join(appPath, "auth.html"));
});

server.get("/site.html", checkAuth, (req, res) => {
    res.sendFile(path.join(appPath, "site.html"));
});

server.post("/reg", async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) return res.status(400).json({ error: "Введите email и пароль" });
    if (password.length < 6) return res.status(400).json({ error: "Пароль должен содержать минимум 6 символов" });

    try {
        const users = await conn.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
        if (users.length > 0) return res.status(409).json({ error: "Пользователь уже существует" });

        const passwordHash = await hashPassword(password);
        const result = await conn.query(
            "INSERT INTO users (email, passwordHash) VALUES (?, ?)",
            [email, passwordHash]
        );

        return saveSession(
            req,
            res,
            { id: Number(result.insertId), email },
            201,
            "Регистрация выполнена"
        );
    } catch (error) {
        console.error("Ошибка регистрации:", error);
        return res.status(500).json({ error: "Ошибка сервера" });
    }
});

server.post("/auth", async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) return res.status(400).json({ error: "Введите email и пароль" });

    try {
        const users = await conn.query(
            "SELECT id, email, passwordHash FROM users WHERE email = ? LIMIT 1",
            [email]
        );
        if (users.length === 0) return res.status(401).json({ error: "Неверный email или пароль" });

        const user = users[0];
        if (!await verifyPassword(password, user.passwordHash)) {
            return res.status(401).json({ error: "Неверный email или пароль" });
        }

        return saveSession(req, res, user);
    } catch (error) {
        console.error("Ошибка авторизации:", error);
        return res.status(500).json({ error: "Ошибка сервера" });
    }
});

server.post("/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) return res.status(500).json({ error: "Не удалось завершить сессию" });
        res.clearCookie("connect.sid");
        return res.json({ redirect: "/auth.html" });
    });
});

const port = process.env.port || 3001;
server.listen(port, () => console.log(`Сервер работает на порту ${port}`));
