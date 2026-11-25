const videoPage = document.getElementById("video-page");
const searchInput = document.querySelector(".srchbar input");
let videos = [];

async function showAdminLink() {
    const adminLink = document.getElementById("admin-link");
    if (!adminLink) return;

    try {
        const response = await fetch("/api/session");
        if (!response.ok) return;
        const session = await response.json();
        adminLink.hidden = !session.isAdmin;
    } catch (error) {
        adminLink.hidden = true;
    }
}

function showError(message) {
    videoPage.innerHTML = "";
    const error = document.createElement("p");
    error.className = "message";
    error.textContent = message;
    videoPage.append(error);
}

async function readJson(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        throw new Error("Сервер вернул не JSON. Возможно, нужно войти в аккаунт");
    }

    return response.json();
}

function showVideoList(list = videos) {
    videoPage.innerHTML = '<div class="videos"></div>';
    const container = videoPage.querySelector(".videos");

    if (list.length === 0) {
        container.innerHTML = '<p class="message">Видео пока нет</p>';
        return;
    }

    list.forEach((video) => {
        const card = document.createElement("button");
        card.className = "video-card";
        card.type = "button";
        card.innerHTML = `
            <video src="${video.videoUrl}" muted preload="metadata"></video>
            <h2></h2>
            <p></p>
        `;
        card.querySelector("h2").textContent = video.title || "Без названия";
        card.querySelector("p").textContent = video.description || "";
        card.addEventListener("click", () => showVideo(video.id));
        container.append(card);
    });
}

function showDevelopment() {
    videoPage.innerHTML = "";
    const message = document.createElement("p");
    message.className = "message";
    message.textContent = "В разработке...";
    videoPage.append(message);
}

async function loadFavorites() {
    try {
        const response = await fetch("/api/favorites");
        if (response.status === 401) {
            window.location.href = "/auth.html";
            return;
        }
        if (!response.ok) throw new Error("Не удалось загрузить понравившиеся видео");
        showVideoList(await readJson(response));
    } catch (error) {
        showError(error.message);
    }
}

async function showVideo(id) {
    try {
        const response = await fetch(`/api/videos/${id}`);
        if (response.status === 401) {
            window.location.href = "/auth.html";
            return;
        }
        if (!response.ok) throw new Error("Видео не найдено");
        const video = await readJson(response);

        videoPage.innerHTML = `
            <button class="back-button" type="button">← Все видео</button>
            <article class="video-details">
                <video controls src="${video.videoUrl}"></video>
                <h1></h1>
                <p></p>
                <button class="favorite-button" type="button"></button>
            </article>
        `;
        videoPage.querySelector("h1").textContent = video.title || "Без названия";
        videoPage.querySelector("p").textContent = video.description || "Описание отсутствует";
        const favoriteButton = videoPage.querySelector(".favorite-button");
        favoriteButton.textContent = video.isFavorite ? "♥ Убрать из понравившихся" : "♡ Нравится";
        favoriteButton.classList.toggle("active", Boolean(video.isFavorite));
        favoriteButton.addEventListener("click", async () => {
            const favoriteResponse = await fetch(`/api/videos/${id}/favorite`, { method: "POST" });
            const data = await readJson(favoriteResponse);
            if (!favoriteResponse.ok) {
                showError(data.error || "Не удалось изменить лайк");
                return;
            }
            favoriteButton.textContent = data.isFavorite
                ? "♥ Убрать из понравившихся"
                : "♡ Нравится";
            favoriteButton.classList.toggle("active", data.isFavorite);
        });
        videoPage.querySelector(".back-button").addEventListener("click", () => showVideoList());
    } catch (error) {
        showError(error.message);
    }
}

async function loadVideos() {
    try {
        const response = await fetch("/api/videos");
        if (response.status === 401) {
            window.location.href = "/auth.html";
            return;
        }
        if (!response.ok) throw new Error("Не удалось загрузить видео");
        videos = await readJson(response);
        showVideoList();
    } catch (error) {
        showError(error.message);
    }
}

searchInput.addEventListener("input", () => {
    const search = searchInput.value.toLowerCase().trim();
    showVideoList(videos.filter((video) =>
        `${video.title || ""} ${video.description || ""}`.toLowerCase().includes(search)
    ));
});

document.querySelectorAll("[data-page]").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        if (link.dataset.page === "favorites") return loadFavorites();
    });
});

showAdminLink();
loadVideos();
