const bcrypt = require("bcrypt");
const express = require("express");
const mariadb = require("mariadb");
const path = require("path");
const fsSync = require("fs");
const crypto = require("crypto");
require("dotenv").config();

const server = express();
const appPath = path.join(__dirname, "public");
// Vercel allows writing only to /tmp. Locally keep the existing uploads folder.
const uploadPath = process.env.VERCEL ? "/tmp/uploads" : path.join(__dirname, "uploads");
fsSync.mkdirSync(uploadPath, { recursive: true });

server.set("trust proxy", 1);

server.use(express.urlencoded({ extended: true }));
server.use(express.json());
const sessionSecret = process.env.SESSION_SECRET || process.env.secret || "development-secret";
const sessionCookieName = "practice_session";

function encodeSession(sessionData) {
    const payload = Buffer.from(JSON.stringify(sessionData)).toString("base64url");
    const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
}

function decodeSession(value) {
    if (!value) return null;
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return null;

    const expectedSignature = crypto.createHmac("sha256", sessionSecret)
        .update(payload)
        .digest("base64url");
    const provided = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        return null;
    }

    try {
        return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch (error) {
        return null;
    }
}

function parseCookies(header = "") {
    return header.split(";").reduce((cookies, part) => {
        const separator = part.indexOf("=");
        if (separator === -1) return cookies;
        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        cookies[key] = decodeURIComponent(value);
        return cookies;
    }, {});
}

function setSessionCookie(res, sessionData) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
        "Set-Cookie",
        `${sessionCookieName}=${encodeURIComponent(encodeSession(sessionData))}; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax${secure}`
    );
}

server.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionData = decodeSession(cookies[sessionCookieName]) || {};

    req.session = sessionData;
    req.session.save = (callback) => {
        delete req.session.save;
        delete req.session.destroy;
        setSessionCookie(res, req.session);
        if (callback) callback(null);
    };
    req.session.destroy = (callback) => {
        res.setHeader("Set-Cookie", `${sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
        req.session = {};
        if (callback) callback(null);
    };
    next();
});
const multer = require('multer');
const Client = require('ssh2-sftp-client');
const fs = require('fs/promises');

const databasePool = mariadb.createPool({
    // Use DB_* variables on Vercel. The lowercase names remain supported locally.
    host: process.env.DB_HOST || process.env.host,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || process.env.user,
    password: process.env.DB_PASSWORD || process.env.password,
    database: process.env.DB_NAME || process.env.database,
    ssl: process.env.DB_SSL === "true"
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" }
        : false,
    connectionLimit: 5
});
const conn = databasePool;

async function checkAuth(req, res, next) {
    if (!req.session.user) {
        if (req.path.startsWith("/api/")) {
            return res.status(401).json({ error: "Требуется авторизация" });
        }
        return res.redirect("/auth.html");
    }

    try {
        const users = await conn.query(
            "SELECT id, email, isBlocked FROM users WHERE id = ? LIMIT 1",
            [req.session.user.id]
        );
        if (users.length === 0 || users[0].isBlocked) {
            req.session.destroy();
            if (req.path.startsWith("/api/")) {
                return res.status(403).json({ error: "Пользователь заблокирован" });
            }
            return res.redirect("/auth.html");
        }
        req.session.user = { id: users[0].id, email: users[0].email };
        return next();
    } catch (error) {
        console.error("Ошибка проверки пользователя:", error);
        return res.status(500).json({ error: "Не удалось проверить пользователя" });
    }
}

function checkAdmin(req, res, next) {
    return checkAuth(req, res, () => {
        if (req.session.user.email === "admin") return next();
        if (req.path.startsWith("/api/")) {
            return res.status(403).json({ error: "Доступ разрешён только администратору" });
        }
        return res.redirect("/site.html");
    });
}

async function hashPassword(password) {
    return bcrypt.hash(password, 12);
}

async function verifyPassword(password, storedHash) {
    if (!String(storedHash).startsWith("$2")) return false;
    return bcrypt.compare(password, storedHash);
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
server.get("/api/videos", checkAuth, async (req, res) => {
    try {
        const videos = await conn.query(
            "SELECT id, title, description, videoUrl FROM videos ORDER BY id DESC"
        );
        return res.json(videos);
    } catch (error) {
        console.error("Ошибка загрузки видео:", error);
        return res.status(500).json({ error: "Не удалось загрузить видео" });
    }
});

server.get("/api/videos/:id", checkAuth, async (req, res) => {
    const videoId = Number(req.params.id);
    if (!Number.isInteger(videoId)) {
        return res.status(400).json({ error: "Некорректный идентификатор видео" });
    }

    try {
        const videos = await conn.query(
            `SELECT id, title, description, videoUrl,
                    EXISTS(
                        SELECT 1 FROM favorites
                        WHERE favorites.videoId = videos.id AND favorites.userId = ?
                    ) AS isFavorite
             FROM videos WHERE id = ? LIMIT 1`,
            [req.session.user.id, videoId]
        );
        if (videos.length === 0) return res.status(404).json({ error: "Видео не найдено" });
        return res.json(videos[0]);
    } catch (error) {
        console.error("Ошибка загрузки видео:", error);
        return res.status(500).json({ error: "Не удалось загрузить видео" });
    }
});
server.get("/api/admin/users", checkAdmin, async (req, res) => {
    try {
        const users = await conn.query(
            "SELECT id, email, isBlocked FROM users ORDER BY id DESC"
        );
        return res.json(users);
    } catch (error) {
        console.error("Ошибка загрузки пользователей:", error);
        return res.status(500).json({ error: "Не удалось загрузить пользователей" });
    }
});

server.patch("/api/admin/users/:id/block", checkAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    const blocked = req.body.blocked;

    if (!Number.isInteger(userId) || ![true, false].includes(blocked)) {
        return res.status(400).json({ error: "Некорректные данные блокировки" });
    }

    try {
        const users = await conn.query(
            "SELECT id, email FROM users WHERE id = ? LIMIT 1",
            [userId]
        );
        if (users.length === 0) return res.status(404).json({ error: "Пользователь не найден" });
        if (users[0].email === "admin") {
            return res.status(400).json({ error: "Нельзя заблокировать администратора" });
        }

        await conn.query("UPDATE users SET isBlocked = ? WHERE id = ?", [blocked ? 1 : 0, userId]);
        return res.json({
            message: blocked ? "Пользователь заблокирован" : "Пользователь разблокирован",
            isBlocked: blocked
        });
    } catch (error) {
        console.error("Ошибка изменения блокировки пользователя:", error);
        return res.status(500).json({ error: "Не удалось изменить блокировку пользователя" });
    }
});
server.get("/api/favorites", checkAuth, async (req, res) => {
    try {
        const videos = await conn.query(
            `SELECT videos.id, videos.title, videos.description, videos.videoUrl
             FROM favorites
             JOIN videos ON videos.id = favorites.videoId
             WHERE favorites.userId = ?
             ORDER BY favorites.createdAt DESC`,
            [req.session.user.id]
        );
        return res.json(videos);
    } catch (error) {
        console.error("Ошибка загрузки понравившихся видео:", error);
        return res.status(500).json({ error: "Не удалось загрузить понравившиеся видео" });
    }
});

server.post("/api/videos/:id/favorite", checkAuth, async (req, res) => {
    const videoId = Number(req.params.id);
    if (!Number.isInteger(videoId)) {
        return res.status(400).json({ error: "Некорректный идентификатор видео" });
    }

    try {
        const videos = await conn.query("SELECT id FROM videos WHERE id = ? LIMIT 1", [videoId]);
        if (videos.length === 0) return res.status(404).json({ error: "Видео не найдено" });

        const favorites = await conn.query(
            "SELECT id FROM favorites WHERE userId = ? AND videoId = ? LIMIT 1",
            [req.session.user.id, videoId]
        );

        if (favorites.length > 0) {
            await conn.query("DELETE FROM favorites WHERE userId = ? AND videoId = ?", [
                req.session.user.id,
                videoId
            ]);
            return res.json({ isFavorite: false });
        }

        await conn.query("INSERT INTO favorites (userId, videoId) VALUES (?, ?)", [
            req.session.user.id,
            videoId
        ]);
        return res.json({ isFavorite: true });
    } catch (error) {
        console.error("Ошибка изменения лайка:", error);
        return res.status(500).json({ error: "Не удалось изменить лайк" });
    }
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
            "SELECT id, email, passwordHash, isBlocked FROM users WHERE email = ? LIMIT 1",
            [email]
        );
        if (users.length === 0) return res.status(401).json({ error: "Неверный email или пароль" });

        const user = users[0];
        if (user.isBlocked) {
            return res.status(403).json({ error: "Ваш аккаунт заблокирован" });
        }
        if (!await verifyPassword(password, user.passwordHash)) {
            return res.status(401).json({ error: "Неверный email или пароль" });
        }
        if (user.email == "admin")
        {
            req.session.user = {
                id: user.id,
                email: user.email
            };
            return req.session.save((error) => {
                if (error) return res.status(500).json({ error: "Не удалось сохранить сессию" });
                return res.json({ redirect: "/site.html" });
            });
        }

        return saveSession(req, res, user);
    } catch (error) {
        console.error("Ошибка авторизации:", error);
        return res.status(500).json({ error: "Ошибка сервера" });
    }
});
server.get("/api/session", checkAuth, (req, res) => {
    return res.json({
        email: req.session.user.email,
        isAdmin: req.session.user.email === "admin"
    });
});

server.get("/admin", checkAdmin, (req, res) => {
    return res.sendFile(path.join(appPath, "admin.html"));
});

server.get("/api/admin/videos", checkAdmin, async (req, res) => {
    try {
        const videos = await conn.query(
            "SELECT id, title, description, videoUrl FROM videos ORDER BY id DESC"
        );
        return res.json(videos);
    } catch (error) {
        console.error("Ошибка загрузки видео для админки:", error);
        return res.status(500).json({ error: "Не удалось загрузить видео" });
    }
});

server.put("/api/admin/videos/:id", checkAdmin, async (req, res) => {
    const videoId = Number(req.params.id);
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();

    if (!Number.isInteger(videoId)) {
        return res.status(400).json({ error: "Некорректный идентификатор видео" });
    }
    if (!title || !description) {
        return res.status(400).json({ error: "Название и описание не должны быть пустыми" });
    }

    try {
        const result = await conn.query(
            "UPDATE videos SET title = ?, description = ? WHERE id = ?",
            [title, description, videoId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: "Видео не найдено" });
        return res.json({ message: "Видео изменено" });
    } catch (error) {
        console.error("Ошибка редактирования видео:", error);
        return res.status(500).json({ error: "Не удалось изменить видео" });
    }
});

server.delete("/api/admin/videos/:id", checkAdmin, async (req, res) => {
    const videoId = Number(req.params.id);
    if (!Number.isInteger(videoId)) {
        return res.status(400).json({ error: "Некорректный идентификатор видео" });
    }

    try {
        const videos = await conn.query(
            "SELECT videoUrl FROM videos WHERE id = ? LIMIT 1",
            [videoId]
        );
        if (videos.length === 0) return res.status(404).json({ error: "Видео не найдено" });

        const remoteFile = `/var/www/videos/${path.basename(String(videos[0].videoUrl || ""))}`;
        const sftp = new Client();
        try {
            await sftp.connect({
                host: process.env.sftpHost,
                username: process.env.sftpUsername,
                password: process.env.sftpPassword
            });
            await sftp.delete(remoteFile).catch(() => {});
        } finally {
            await sftp.end().catch(() => {});
        }

        await conn.query("DELETE FROM videos WHERE id = ?", [videoId]);
        return res.json({ message: "Видео удалено" });
    } catch (error) {
        console.error("Ошибка удаления видео:", error);
        return res.status(500).json({ error: "Не удалось удалить видео" });
    }
});

server.post("/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) return res.status(500).json({ error: "Не удалось завершить сессию" });
        res.clearCookie("connect.sid");
        return res.json({ redirect: "/auth.html" });
    });
});

const upload = multer({ dest: uploadPath });

server.post("/api/upload", checkAdmin, upload.single("video"), async (req, res) => {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();

    if (!title || !description || !req.file) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: "Заполните название, описание и выберите видео" });
    }

    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileName = `${Date.now()}-${safeName}`;
    const localPath = req.file.path;
    const remotePath = `/var/www/videos/${fileName}`;
    const videoBaseUrl = process.env.videoBaseUrl || `http://${process.env.sftpHost}/videos`;
    const videoUrl = `${videoBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(fileName)}`;
    const sftp = new Client();

    try {
        await sftp.connect({
            host: process.env.sftpHost,
            username: process.env.sftpUsername,
            password: process.env.sftpPassword
        });
        await sftp.put(localPath, remotePath);
        await conn.query(
            "INSERT INTO videos (title, description, videoUrl) VALUES (?, ?, ?)",
            [title, description, videoUrl]
        );

        return res.status(201).json({ message: "Видео загружено!" });
    } catch (error) {
        console.error("Ошибка загрузки видео:", error.message);
        return res.status(500).json({ error: `Не удалось отправить файл: ${error.message}` });
    } finally {
        await fs.unlink(localPath).catch(() => {});
        await sftp.end().catch(() => {});
    }
});
// Vercel imports the Express app as a serverless function.
// Keep listen() for local development and traditional Node hosting.
if (!process.env.VERCEL) {
    const port = process.env.port || 3001;
    server.listen(port, () => console.log(`Сервер работает на порту ${port}`));
}

module.exports = server;
