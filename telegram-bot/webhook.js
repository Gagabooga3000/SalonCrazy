/**
 * Webhook сервер для Railway
 */

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');
const axios = require('axios');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN) {
    console.error('TG_BOT_TOKEN не установлен!');
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);

// Устанавливаем webhook при запуске
bot.setWebHook(`${WEBHOOK_URL}/webhook`).then(() => {
    console.log('Webhook установлен:', `${WEBHOOK_URL}/webhook`);
}).catch(err => {
    console.error('Ошибка установки webhook:', err);
});

// Импортируем обработчики из index.js
// (В реальном проекте лучше вынести логику в отдельный модуль)
const botHandlers = require('./bot-handlers');

// Webhook endpoint
app.post('/webhook', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Webhook server running on port ${PORT}`);
});

