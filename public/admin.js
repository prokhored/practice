// финальная версия проекта
const form = document.getElementById("video-form");
const message = document.getElementById("message");
const videoList = document.getElementById("video-list");
const userList = document.getElementById("user-list");

async function loadVideos() {
    const response = await fetch("/api/admin/videos");
    const videos = await response.json();
    videoList.innerHTML = "";

    videos.forEach((video) => {
        const item = document.createElement("article");
        item.className = "admin-video";
        item.innerHTML = `
            <div class="admin-video-info">
                <strong></strong>
                <small></small>
            </div>
            <div class="admin-video-actions">
                <button class="edit-button" type="button">Изменить</button>
                <button class="delete-button" type="button">Удалить</button>
            </div>
        `;
        item.querySelector("strong").textContent = video.title || "Без названия";
        item.querySelector("small").textContent = video.videoUrl;

        item.querySelector(".edit-button").addEventListener("click", async () => {
            const title = prompt("Название видео:", video.title || "");
            if (title === null) return;
            const description = prompt("Описание видео:", video.description || "");
            if (description === null) return;

            const editResponse = await fetch(`/api/admin/videos/${video.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, description })
            });
            const data = await editResponse.json();
            message.textContent = data.message || data.error;
            if (editResponse.ok) loadVideos();
        });

        item.querySelector(".delete-button").addEventListener("click", async () => {
            if (!confirm("Удалить это видео?")) return;

            const deleteResponse = await fetch(`/api/admin/videos/${video.id}`, { method: "DELETE" });
            const data = await deleteResponse.json();
            message.textContent = data.message || data.error;
            if (deleteResponse.ok) loadVideos();
        });

        videoList.append(item);
    });
}

async function loadUsers() {
    const response = await fetch("/api/admin/users");
    const users = await response.json();

    if (!response.ok) throw new Error(users.error || "Не удалось загрузить пользователей");

    userList.innerHTML = "";
    if (users.length === 0) {
        userList.textContent = "Пользователей пока нет";
        return;
    }

    users.forEach((user) => {
        const item = document.createElement("article");
        item.className = "admin-user";
        item.innerHTML = '<div class="admin-user-info"></div><div class="admin-user-actions"><button class="block-button" type="button"></button></div>';

        const email = document.createElement("strong");
        email.textContent = user.email;
        const id = document.createElement("small");
        id.textContent = `ID: ${user.id}`;
        const blockButton = item.querySelector(".block-button");
        blockButton.textContent = user.isBlocked ? "Разблокировать" : "Заблокировать";
        blockButton.disabled = user.email === "admin";
        blockButton.addEventListener("click", async () => {
            const blocked = !Boolean(user.isBlocked);
            if (!confirm(`${blocked ? "Заблокировать" : "Разблокировать"} пользователя ${user.email}?`)) return;

            const blockResponse = await fetch(`/api/admin/users/${user.id}/block`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ blocked })
            });
            const data = await blockResponse.json();
            message.textContent = data.message || data.error;
            if (blockResponse.ok) loadUsers();
        });

        item.querySelector(".admin-user-info").append(email, id);
        userList.append(item);
    });
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Загрузка видео...";
    const fileInput = document.getElementById("video")
    const file = fileInput.files[0];

    if (!file) {
        message.textContent = "Выберите видеофайл";
        return;
    }

    const formData = new FormData();
    formData.append("title", document.getElementById("title").value);
    formData.append("description", document.getElementById("description").value);
    formData.append("video", file);
    try {
        const response = await fetch("/api/upload", {
            method: "POST",
            body: formData
        });
        const data = await response.json().catch(() => ({ error: "Сервер вернул некорректный ответ" }));
        message.textContent = data.message || data.error;

        if (response.ok) form.reset();
        if (response.ok) loadVideos();
    } catch (error) {
        message.textContent = "Не удалось связаться с сервером";
    }
});

loadVideos().catch(() => {
    videoList.textContent = "Не удалось загрузить список видео";
});

loadUsers().catch(() => {
    userList.textContent = "Не удалось загрузить список пользователей";
});

document.getElementById("logout").addEventListener("click", async () => {
    await fetch("/logout", { method: "POST" });
    window.location.href = "/auth.html";
});
