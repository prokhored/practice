const express = require("express");
const { default: _default } = require("mariadb");
const db = require("mariadb");
require("dotenv").config();
const path = require("path");
const server = express();

const appPath = path.join(__dirname + "/public");
server.use(express.static(appPath));
server.get("/", (req,res) => {
    res.sendFile(path.join(appPath, "site.html"));
})

server.listen(process.env.port, () =>{
console.log(`Сервер работает на порту ${process.env.port}`);

})
