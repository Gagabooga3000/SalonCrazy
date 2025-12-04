/**
 * Telegram Bot для салона красоты Crazy
 * Node.js + node-telegram-bot-api
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');
const axios = require('axios');

// Конфигурация
const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_NAME = process.env.DB_NAME || 'crazy_salon';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || '';
const API_BASE = process.env.API_BASE || 'https://your-site.com/api';
const ADMIN_IDS = (process.env.TG_ADMIN_IDS || '').split(',').map(id => parseInt(id)).filter(Boolean);

if (!BOT_TOKEN) {
    console.error('TG_BOT_TOKEN не установлен!');
    process.exit(1);
}

// Инициализация бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Подключение к БД
let db;
(async () => {
    try {
        db = await mysql.createConnection({
            host: DB_HOST,
            user: DB_USER,
            password: DB_PASS,
            database: DB_NAME,
            connectTimeout: 10000 // 10 секунд таймаут
        });
        console.log('✅ Подключено к БД:', DB_NAME);
    } catch (error) {
        console.error('❌ Ошибка подключения к БД:', error.message);
        console.error('Проверьте переменные: DB_HOST, DB_NAME, DB_USER, DB_PASS');
        console.error('Текущий DB_HOST:', DB_HOST);
        // Не завершаем процесс, чтобы видеть ошибки в логах
        // process.exit(1);
    }
})();

// Хранилище состояний пользователей
const userStates = {};

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Регистрируем/обновляем пользователя
    await registerUser(msg.from, chatId);
    
    const keyboard = {
        reply_markup: {
            keyboard: [
                [{ text: '📅 Записаться' }, { text: '📋 Мои записи' }],
                [{ text: '🛍️ Продукция' }, { text: 'ℹ️ Контакты' }],
                [{ text: '❓ Помощь' }]
            ],
            resize_keyboard: true
        }
    };
    
    bot.sendMessage(chatId, 
        '👋 Добро пожаловать в салон красоты Crazy!\n\n' +
        'Выберите действие:',
        keyboard
    );
});

// Команда /help
bot.onText(/\/help|\/помощь|❓ Помощь/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        '📖 Доступные команды:\n\n' +
        '/start - Главное меню\n' +
        '📅 Записаться - Записаться на услугу\n' +
        '📋 Мои записи - Посмотреть свои записи\n' +
        '🛍️ Продукция - Каталог продукции\n' +
        'ℹ️ Контакты - Контактная информация\n\n' +
        'По вопросам обращайтесь к администратору.'
    );
});

// Запись на услугу
bot.onText(/📅 Записаться|Записаться/, async (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { step: 'booking_category' };
    
    try {
        const response = await axios.get(`${API_BASE}/services`);
        const services = response.data;
        
        if (services.length === 0) {
            bot.sendMessage(chatId, 'К сожалению, услуги временно недоступны.');
            return;
        }
        
        // Группируем по категориям
        const categories = [...new Set(services.map(s => s.category).filter(Boolean))];
        
        if (categories.length > 0) {
            const keyboard = {
                inline_keyboard: categories.map(cat => [{
                    text: cat,
                    callback_data: `category_${cat}`
                }])
            };
            bot.sendMessage(chatId, 'Выберите категорию услуги:', { reply_markup: keyboard });
        } else {
            // Если нет категорий, показываем все услуги
            const keyboard = {
                inline_keyboard: services.slice(0, 10).map(s => [{
                    text: `${s.title} - ${s.price} руб.`,
                    callback_data: `service_${s.id}`
                }])
            };
            bot.sendMessage(chatId, 'Выберите услугу:', { reply_markup: keyboard });
            userStates[chatId].step = 'booking_service';
        }
    } catch (error) {
        console.error('Ошибка загрузки услуг:', error);
        bot.sendMessage(chatId, 'Ошибка загрузки услуг. Попробуйте позже.');
    }
});

// Обработка callback-запросов
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const state = userStates[chatId] || {};
    
    await bot.answerCallbackQuery(query.id);
    
    if (data.startsWith('category_')) {
        const category = data.replace('category_', '');
        await showServicesByCategory(chatId, category);
    } else if (data.startsWith('service_')) {
        const serviceId = parseInt(data.replace('service_', ''));
        userStates[chatId] = { step: 'booking_master', serviceId };
        await showMasters(chatId, serviceId);
    } else if (data.startsWith('master_')) {
        const masterId = parseInt(data.replace('master_', ''));
        userStates[chatId].masterId = masterId;
        bot.sendMessage(chatId, 'Введите желаемую дату и время в формате: ДД.ММ.ГГГГ ЧЧ:ММ\nНапример: 25.12.2024 14:00');
        userStates[chatId].step = 'booking_datetime';
    } else if (data === 'master_skip') {
        userStates[chatId].masterId = null;
        bot.sendMessage(chatId, 'Введите желаемую дату и время в формате: ДД.ММ.ГГГГ ЧЧ:ММ\nНапример: 25.12.2024 14:00');
        userStates[chatId].step = 'booking_datetime';
    } else if (data.startsWith('product_')) {
        const productId = parseInt(data.replace('product_', ''));
        await showProductDetails(chatId, productId);
    } else if (data.startsWith('buy_product_')) {
        const productId = parseInt(data.replace('buy_product_', ''));
        await startProductOrder(chatId, productId);
    } else if (data.startsWith('payment_')) {
        const parts = data.replace('payment_', '').split('_');
        const orderId = parseInt(parts[0]);
        const method = parts[1];
        await processPayment(chatId, orderId, method);
    }
});

// Показ услуг по категории
async function showServicesByCategory(chatId, category) {
    try {
        const response = await axios.get(`${API_BASE}/services?category=${encodeURIComponent(category)}`);
        const services = response.data;
        
        const keyboard = {
            inline_keyboard: services.map(s => [{
                text: `${s.title} - ${s.price} руб. (${s.duration_minutes} мин)`,
                callback_data: `service_${s.id}`
            }])
        };
        
        bot.sendMessage(chatId, `Услуги категории "${category}":`, { reply_markup: keyboard });
        userStates[chatId].step = 'booking_service';
    } catch (error) {
        console.error('Ошибка:', error);
        bot.sendMessage(chatId, 'Ошибка загрузки услуг.');
    }
}

// Показ мастеров
async function showMasters(chatId, serviceId) {
    try {
        const response = await axios.get(`${API_BASE}/masters`);
        const masters = response.data.filter(m => m.active);
        
        const keyboard = {
            inline_keyboard: [
                ...masters.map(m => [{
                    text: m.name,
                    callback_data: `master_${m.id}`
                }]),
                [{ text: 'Любой мастер', callback_data: 'master_skip' }]
            ]
        };
        
        bot.sendMessage(chatId, 'Выберите мастера (или любого):', { reply_markup: keyboard });
    } catch (error) {
        console.error('Ошибка:', error);
        bot.sendMessage(chatId, 'Ошибка загрузки мастеров.');
    }
}

// Обработка текстовых сообщений (дата/время, комментарий, количество продукта)
bot.on('message', async (msg) => {
    // Пропускаем команды и callback
    if (msg.text && msg.text.startsWith('/')) return;
    if (msg.text && ['📅 Записаться', '📋 Мои записи', '🛍️ Продукция', 'ℹ️ Контакты', '❓ Помощь'].includes(msg.text)) return;
    
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userStates[chatId];
    
    if (!state || !state.step) return;
    
    if (state.step === 'booking_datetime') {
        // Парсим дату и время
        const dateMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
        if (!dateMatch) {
            bot.sendMessage(chatId, 'Неверный формат. Используйте: ДД.ММ.ГГГГ ЧЧ:ММ');
            return;
        }
        
        const [, day, month, year, hour, minute] = dateMatch;
        const dateTime = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
        
        if (isNaN(dateTime.getTime()) || dateTime < new Date()) {
            bot.sendMessage(chatId, 'Неверная дата или дата в прошлом.');
            return;
        }
        
        state.dateTime = dateTime.toISOString().slice(0, 16);
        state.step = 'booking_note';
        bot.sendMessage(chatId, 'Введите комментарий (или отправьте "-" чтобы пропустить):');
        
    } else if (state.step === 'booking_note') {
        state.note = text === '-' ? null : text;
        
        // Создаем запись
        try {
            const user = await getUserByTgId(msg.from.id);
            if (!user) {
                bot.sendMessage(chatId, 'Ошибка: пользователь не найден. Используйте /start');
                delete userStates[chatId];
                return;
            }
            
            const bookingData = {
                name: user.name,
                phone: user.phone,
                email: user.email,
                service_id: state.serviceId,
                master_id: state.masterId,
                date_time: state.dateTime,
                note: state.note,
                tg_id: msg.from.id
            };
            
            const response = await axios.post(`${API_BASE}/bookings`, bookingData);
            
            if (response.data.success) {
                bot.sendMessage(chatId,
                    '✅ Запись успешно создана!\n\n' +
                    'Мы свяжемся с вами для подтверждения.'
                );
                
                // Уведомление всем администраторам
                const serviceResponse = await axios.get(`${API_BASE}/services/${state.serviceId}`);
                const service = serviceResponse.data;
                const masterName = state.masterId ? 
                    (await axios.get(`${API_BASE}/masters/${state.masterId}`)).data.name : 
                    'Любой';
                
                const adminMessage = `📅 Новая запись через бота:\n\n` +
                    `Клиент: ${user.name}\n` +
                    `Телефон: ${user.phone}\n` +
                    `Услуга: ${service.title}\n` +
                    `Мастер: ${masterName}\n` +
                    `Дата: ${new Date(state.dateTime).toLocaleString('ru-RU')}\n` +
                    (state.note ? `Комментарий: ${state.note}` : '');
                
                await notifyAllAdmins(adminMessage);
            }
            
            delete userStates[chatId];
            
        } catch (error) {
            console.error('Ошибка создания записи:', error);
            bot.sendMessage(chatId, 'Ошибка создания записи. Попробуйте позже.');
        }
    }
});

// Мои записи
bot.onText(/📋 Мои записи|Мои записи/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const user = await getUserByTgId(msg.from.id);
        if (!user) {
            bot.sendMessage(chatId, 'Пользователь не найден. Используйте /start');
            return;
        }
        
        const response = await axios.get(`${API_BASE}/bookings?user_id=${user.id}`);
        const bookings = response.data;
        
        if (bookings.length === 0) {
            bot.sendMessage(chatId, 'У вас пока нет записей.');
            return;
        }
        
        let message = '📋 Ваши записи:\n\n';
        bookings.slice(0, 10).forEach(booking => {
            const date = new Date(booking.date_time).toLocaleString('ru-RU');
            const status = {
                'pending': '⏳ Ожидает',
                'confirmed': '✅ Подтверждена',
                'completed': '✔️ Завершена',
                'cancelled': '❌ Отменена'
            }[booking.status] || booking.status;
            
            message += `📅 ${booking.service_title || 'Услуга'}\n`;
            message += `Дата: ${date}\n`;
            message += `Статус: ${status}\n`;
            if (booking.master_name) {
                message += `Мастер: ${booking.master_name}\n`;
            }
            message += '\n';
        });
        
        bot.sendMessage(chatId, message);
        
    } catch (error) {
        console.error('Ошибка:', error);
        bot.sendMessage(chatId, 'Ошибка загрузки записей.');
    }
});

// Продукция
bot.onText(/🛍️ Продукция|Продукция/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const response = await axios.get(`${API_BASE}/products`);
        const products = response.data.filter(p => p.active && p.stock > 0);
        
        if (products.length === 0) {
            bot.sendMessage(chatId, 'Продукция временно недоступна.');
            return;
        }
        
        const keyboard = {
            inline_keyboard: products.slice(0, 10).map(p => [{
                text: `${p.title} - ${p.price} руб.`,
                callback_data: `product_${p.id}`
            }])
        };
        
        bot.sendMessage(chatId, '🛍️ Каталог продукции:', { reply_markup: keyboard });
        
    } catch (error) {
        console.error('Ошибка:', error);
        bot.sendMessage(chatId, 'Ошибка загрузки продукции.');
    }
});

// Детали продукта
async function showProductDetails(chatId, productId) {
    try {
        const response = await axios.get(`${API_BASE}/products/${productId}`);
        const product = response.data;
        
        let message = `🛍️ ${product.title}\n\n`;
        if (product.description) {
            message += `${product.description}\n\n`;
        }
        message += `💰 Цена: ${product.price} руб.\n`;
        message += `📦 В наличии: ${product.stock} шт.\n`;
        
        const keyboard = {
            inline_keyboard: [[
                { text: '🛒 Купить', callback_data: `buy_product_${productId}` }
            ]]
        };
        
        if (product.photo) {
            bot.sendPhoto(chatId, `${API_BASE.replace('/api', '')}/uploads/${product.photo}`, {
                caption: message,
                reply_markup: keyboard
            });
        } else {
            bot.sendMessage(chatId, message, { reply_markup: keyboard });
        }
        
    } catch (error) {
        console.error('Ошибка:', error);
        bot.sendMessage(chatId, 'Ошибка загрузки продукта.');
    }
}

// Начало заказа продукта
async function startProductOrder(chatId, productId) {
    try {
        const user = await getUserByTgId(chatId);
        if (!user) {
            bot.sendMessage(chatId, 'Пользователь не найден. Используйте /start');
            return;
        }
        
        const response = await axios.get(`${API_BASE}/products/${productId}`);
        const product = response.data;
        
        if (product.stock <= 0) {
            bot.sendMessage(chatId, 'Товар закончился.');
            return;
        }
        
        userStates[chatId] = { step: 'product_quantity', productId, price: product.price };
        bot.sendMessage(chatId, `Введите количество (максимум ${product.stock}):`);
        
    } catch (error) {
        console.error('Ошибка:', error);
        bot.sendMessage(chatId, 'Ошибка.');
    }
}

    } else if (state.step === 'product_quantity') {
        // Обработка количества для заказа продукта
        const quantity = parseInt(text);
        
        if (isNaN(quantity) || quantity <= 0) {
            bot.sendMessage(chatId, 'Введите корректное количество.');
            return;
        }
        
        try {
            const productResponse = await axios.get(`${API_BASE}/products/${state.productId}`);
            const product = productResponse.data;
            
            if (quantity > product.stock) {
                bot.sendMessage(chatId, `Максимальное количество: ${product.stock}`);
                return;
            }
            
            const total = product.price * quantity;
            state.quantity = quantity;
            state.total = total;
            
            const keyboard = {
                inline_keyboard: [[
                    { text: '💳 Оплатить онлайн', callback_data: `payment_${state.productId}_online` },
                    { text: '💵 Оплата при получении', callback_data: `payment_${state.productId}_cash` }
                ]]
            };
            
            bot.sendMessage(chatId,
                `Заказ:\n` +
                `Товар: ${product.title}\n` +
                `Количество: ${quantity}\n` +
                `Сумма: ${total} руб.\n\n` +
                `Выберите способ оплаты:`,
                { reply_markup: keyboard }
            );
            
            delete userStates[chatId];
            
        } catch (error) {
            console.error('Ошибка:', error);
            bot.sendMessage(chatId, 'Ошибка.');
        }
    }
});

// Обработка оплаты
async function processPayment(chatId, productId, method) {
    try {
        const user = await getUserByTgId(chatId);
        if (!user) {
            bot.sendMessage(chatId, 'Пользователь не найден.');
            return;
        }
        
        const state = userStates[chatId];
        if (!state || !state.quantity) {
            bot.sendMessage(chatId, 'Ошибка. Начните заказ заново.');
            return;
        }
        
        const orderData = {
            action: 'create_order',
            user_id: user.id,
            product_id: productId,
            quantity: state.quantity,
            payment_method: method
        };
        
        const response = await axios.post(`${API_BASE}/products`, orderData);
        
        if (response.data.success) {
            if (method === 'online') {
                bot.sendMessage(chatId,
                    '✅ Заказ создан!\n\n' +
                    'Для оплаты перейдите по ссылке:\n' +
                    '(Здесь должна быть ссылка на платежную систему)\n\n' +
                    'После оплаты заказ будет обработан.'
                );
            } else {
                bot.sendMessage(chatId,
                    '✅ Заказ создан!\n\n' +
                    'Оплата при получении (самовывоз из салона).\n' +
                    'Мы свяжемся с вами, когда заказ будет готов.'
                );
            }
            
            // Уведомление всем администраторам
            const productResponse = await axios.get(`${API_BASE}/products/${productId}`);
            const product = productResponse.data;
            
            const adminMessage = `🛍️ Новый заказ продукции:\n\n` +
                `Клиент: ${user.name}\n` +
                `Телефон: ${user.phone}\n` +
                `Товар: ${product.title}\n` +
                `Количество: ${state.quantity}\n` +
                `Сумма: ${state.total} руб.\n` +
                `Оплата: ${method === 'online' ? 'Онлайн' : 'Наличные'}`;
            
            await notifyAllAdmins(adminMessage);
        }
        
    } catch (error) {
        console.error('Ошибка:', error);
        bot.sendMessage(chatId, 'Ошибка создания заказа.');
    }
}

// Контакты
bot.onText(/ℹ️ Контакты|Контакты/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        'ℹ️ Контакты салона красоты Crazy:\n\n' +
        '📍 Адрес: г. Москва, ул. Примерная, д. 1\n' +
        '📞 Телефон: +7 (999) 123-45-67\n' +
        '🕐 Режим работы:\n' +
        'Пн-Пт: 9:00 - 20:00\n' +
        'Сб-Вс: 10:00 - 18:00\n\n' +
        '💬 Telegram: @crazy_salon_bot'
    );
});

// Регистрация пользователя
async function registerUser(from, chatId) {
    try {
        const phone = from.phone_number || null;
        const name = `${from.first_name || ''} ${from.last_name || ''}`.trim() || from.username || 'Пользователь';
        const email = null;
        
        const [rows] = await db.execute(
            'SELECT id FROM users WHERE tg_id = ?',
            [from.id]
        );
        
        if (rows.length > 0) {
            // Обновляем chat_id если изменился
            await db.execute(
                'UPDATE users SET name = ?, phone = ?, last_login = NOW() WHERE tg_id = ?',
                [name, phone, from.id]
            );
        } else {
            // Создаем нового пользователя
            await db.execute(
                'INSERT INTO users (tg_id, phone, name, email) VALUES (?, ?, ?, ?)',
                [from.id, phone, name, email]
            );
        }
    } catch (error) {
        console.error('Ошибка регистрации пользователя:', error);
    }
}

// Получение пользователя по tg_id
async function getUserByTgId(tgId) {
    if (!db) {
        console.error('БД не подключена!');
        return null;
    }
    try {
        const [rows] = await db.execute(
            'SELECT * FROM users WHERE tg_id = ?',
            [tgId]
        );
        return rows[0] || null;
    } catch (error) {
        console.error('Ошибка получения пользователя:', error.message);
        return null;
    }
}

// Получение всех администраторов с chat_id
async function getAllAdmins() {
    if (!db) {
        console.error('БД не подключена!');
        return [];
    }
    try {
        const [rows] = await db.execute(
            'SELECT chat_id FROM admins WHERE chat_id IS NOT NULL AND chat_id != ""'
        );
        return rows.map(row => row.chat_id);
    } catch (error) {
        console.error('Ошибка получения администраторов:', error.message);
        return [];
    }
}

// Отправка уведомления всем администраторам
async function notifyAllAdmins(message) {
    const adminChatIds = await getAllAdmins();
    let sentCount = 0;
    
    for (const chatId of adminChatIds) {
        try {
            await bot.sendMessage(chatId, message);
            sentCount++;
        } catch (error) {
            console.error(`Ошибка отправки админу ${chatId}:`, error);
        }
    }
    
    return sentCount;
}

// Команда регистрации администратора
bot.onText(/\/register_admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Проверяем, является ли пользователь администратором по ADMIN_IDS
    if (!ADMIN_IDS.includes(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав для регистрации администратора.');
        return;
    }
    
    try {
        // Сохраняем chat_id администратора в БД
        const [rows] = await db.execute(
            'SELECT id FROM admins WHERE chat_id = ?',
            [chatId]
        );
        
        if (rows.length > 0) {
            bot.sendMessage(chatId, '✅ Вы уже зарегистрированы как администратор.');
        } else {
            // Ищем админа по tg_id или обновляем первый доступный
            const [adminRows] = await db.execute(
                'SELECT id FROM admins LIMIT 1'
            );
            
            if (adminRows.length > 0) {
                // Обновляем существующего админа
                await db.execute(
                    'UPDATE admins SET chat_id = ? WHERE id = ?',
                    [chatId, adminRows[0].id]
                );
            } else {
                // Создаем нового админа
                await db.execute(
                    'INSERT INTO admins (username, password_hash, role, chat_id) VALUES (?, ?, ?, ?)',
                    [`admin_${userId}`, '', 'admin', chatId]
                );
            }
            
            bot.sendMessage(chatId, 
                '✅ Вы успешно зарегистрированы как администратор!\n\n' +
                'Теперь вы будете получать уведомления о новых записях и заказах.'
            );
        }
    } catch (error) {
        console.error('Ошибка регистрации админа:', error);
        bot.sendMessage(chatId, '❌ Ошибка регистрации. Обратитесь к разработчику.');
    }
});

// Админские команды
bot.onText(/\/list_bookings/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Проверяем, является ли пользователь администратором
    const [adminRows] = await db.execute(
        'SELECT id FROM admins WHERE chat_id = ?',
        [chatId]
    );
    
    if (adminRows.length === 0 && !ADMIN_IDS.includes(msg.from.id)) {
        bot.sendMessage(chatId, 'Доступ запрещен.');
        return;
    }
    
    try {
        const response = await axios.get(`${API_BASE}/bookings?status=pending`);
        const bookings = response.data;
        
        if (bookings.length === 0) {
            bot.sendMessage(chatId, 'Нет записей, ожидающих подтверждения.');
            return;
        }
        
        let message = '📋 Записи, ожидающие подтверждения:\n\n';
        bookings.slice(0, 10).forEach(booking => {
            message += `ID: ${booking.id}\n`;
            message += `Клиент: ${booking.name}\n`;
            message += `Услуга: ${booking.service_title}\n`;
            message += `Дата: ${new Date(booking.date_time).toLocaleString('ru-RU')}\n\n`;
        });
        
        bot.sendMessage(chatId, message);
        
    } catch (error) {
        console.error('Ошибка:', error);
        bot.sendMessage(chatId, 'Ошибка загрузки записей.');
    }
});

console.log('🤖 Бот запущен и готов к работе!');
console.log('📊 Проверка переменных окружения:');
console.log('  - TG_BOT_TOKEN:', BOT_TOKEN ? '✅ Установлен' : '❌ НЕ УСТАНОВЛЕН');
console.log('  - DB_HOST:', DB_HOST);
console.log('  - DB_NAME:', DB_NAME);
console.log('  - API_BASE:', API_BASE);
console.log('  - TG_ADMIN_IDS:', ADMIN_IDS.length > 0 ? ADMIN_IDS : '❌ НЕ УСТАНОВЛЕН');
console.log('  - БД подключена:', db ? '✅ Да' : '❌ Нет');

