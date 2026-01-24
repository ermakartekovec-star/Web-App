// Telegram Web App
let tg = window.Telegram.WebApp;
let gameData = null;
let gapiInited = false;
let gisInited = false;
let tokenClient = null;
let accessToken = null;
let fileId = null;
let folderId = null;

// Конфигурация Google API
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const API_KEY = 'YOUR_API_KEY'; // Замените на ваш API ключ
const CLIENT_ID = 'YOUR_CLIENT_ID'; // Замените на ваш Client ID

// DOM элементы
const spinButton = document.getElementById('spinButton');
const connectButton = document.getElementById('connectButton');
const refreshButton = document.getElementById('refreshButton');
const currentNumber = document.getElementById('currentNumber');
const playersList = document.getElementById('playersList');
const drawnNumbers = document.getElementById('drawnNumbers');
const lastNumbers = document.getElementById('lastNumbers');
const drawnCount = document.getElementById('drawnCount');
const remainingCount = document.getElementById('remainingCount');
const gameStatus = document.getElementById('gameStatus');
const statusElement = document.getElementById('status');
const loadingElement = document.getElementById('loading');

// Инициализация Telegram Web App
tg.expand();
tg.setHeaderColor('#667eea');
tg.setBackgroundColor('#667eea');
tg.MainButton.setText('Вернуться в бот');
tg.MainButton.show();
tg.MainButton.onClick(() => {
    tg.close();
});

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    initGoogleAPI();
    updateUI();
    
    // Загрузка данных каждые 5 секунд
    setInterval(loadGameData, 5000);
});

// Инициализация Google API
function initGoogleAPI() {
    gapi.load('client', initializeGapiClient);
    gapi.load('picker', () => {
        console.log('Google Picker loaded');
    });
}

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        gapiInited = true;
        
        // Загружаем данные после инициализации
        loadGameData();
    } catch (error) {
        console.error('Error initializing Google API:', error);
        showError('Ошибка инициализации Google API');
    }
}

// Авторизация Google
async function authenticateGoogle() {
    loading(true);
    
    try {
        tokenClient = await google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (tokenResponse) => {
                accessToken = tokenResponse.access_token;
                gisInited = true;
                
                // Сохраняем токен
                localStorage.setItem('google_access_token', accessToken);
                
                // Находим или создаем папку LotoPR
                findOrCreateFolder();
            },
        });
        
        tokenClient.requestAccessToken();
    } catch (error) {
        console.error('Authentication error:', error);
        showError('Ошибка авторизации Google');
        loading(false);
    }
}

// Поиск или создание папки LotoPR
async function findOrCreateFolder() {
    try {
        // Ищем существующую папку
        const response = await gapi.client.drive.files.list({
            q: "name='LotoPR' and mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields: 'files(id, name)',
        });
        
        if (response.result.files.length > 0) {
            folderId = response.result.files[0].id;
            console.log('Found folder:', folderId);
            findOrCreateGameFile();
        } else {
            // Создаем новую папку
            const folderMetadata = {
                name: 'LotoPR',
                mimeType: 'application/vnd.google-apps.folder',
            };
            
            const folderResponse = await gapi.client.drive.files.create({
                resource: folderMetadata,
                fields: 'id',
            });
            
            folderId = folderResponse.result.id;
            console.log('Created folder:', folderId);
            findOrCreateGameFile();
        }
    } catch (error) {
        console.error('Folder error:', error);
        showError('Ошибка работы с папкой');
        loading(false);
    }
}

// Поиск или создание файла игры
async function findOrCreateGameFile() {
    try {
        const response = await gapi.client.drive.files.list({
            q: `name='lotto_game.json' and '${folderId}' in parents and trashed=false`,
            fields: 'files(id, name)',
        });
        
        if (response.result.files.length > 0) {
            fileId = response.result.files[0].id;
            console.log('Found file:', fileId);
            loadGameData();
        } else {
            // Создаем новый файл
            const fileMetadata = {
                name: 'lotto_game.json',
                parents: [folderId],
                mimeType: 'application/json',
            };
            
            const emptyGameData = {
                game_state: 'setup',
                players: [],
                drawn_numbers: [],
                current_number: null,
                last_action: new Date().toISOString(),
                settings: {
                    total_players: 0,
                    numbers_range: [1, 99],
                    numbers_per_card: 30
                }
            };
            
            const fileContent = JSON.stringify(emptyGameData, null, 2);
            const blob = new Blob([fileContent], { type: 'application/json' });
            
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }));
            form.append('file', blob);
            
            const fileResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
                body: form,
            });
            
            const result = await fileResponse.json();
            fileId = result.id;
            console.log('Created file:', fileId);
            loadGameData();
        }
    } catch (error) {
        console.error('File error:', error);
        showError('Ошибка работы с файлом');
        loading(false);
    }
}

// Загрузка данных игры
async function loadGameData() {
    if (!fileId || !accessToken) return;
    
    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                // Токен истек, нужна повторная авторизация
                localStorage.removeItem('google_access_token');
                accessToken = null;
                statusElement.textContent = 'Не подключено';
                statusElement.className = 'status offline';
                return;
            }
            throw new Error('Failed to load data');
        }
        
        gameData = await response.json();
        
        // Обновляем интерфейс
        updateUI();
        updateWheel();
        
        // Обновляем статус
        statusElement.textContent = 'Подключено';
        statusElement.className = 'status online';
        
        loading(false);
    } catch (error) {
        console.error('Load data error:', error);
        statusElement.textContent = 'Ошибка подключения';
        statusElement.className = 'status offline';
    }
}

// Сохранение данных игры
async function saveGameData() {
    if (!fileId || !accessToken || !gameData) return;
    
    try {
        gameData.last_action = new Date().toISOString();
        
        const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(gameData),
        });
        
        if (!response.ok) {
            throw new Error('Failed to save data');
        }
        
        console.log('Game data saved');
    } catch (error) {
        console.error('Save data error:', error);
        showError('Ошибка сохранения данных');
    }
}

// Обновление интерфейса
function updateUI() {
    if (!gameData) return;
    
    // Обновляем список игроков
    updatePlayersList();
    
    // Обновляем историю чисел
    updateDrawnNumbers();
    
    // Обновляем последние числа
    updateLastNumbers();
    
    // Обновляем статистику
    updateStats();
    
    // Обновляем текущее число
    if (gameData.current_number) {
        currentNumber.textContent = gameData.current_number;
        currentNumber.style.color = '#f56565';
    } else {
        currentNumber.textContent = '?';
        currentNumber.style.color = '#2d3748';
    }
    
    // Обновляем статус игры
    const statusMap = {
        'setup': 'Настройка',
        'playing': 'В процессе',
        'finished': 'Завершена'
    };
    gameStatus.textContent = statusMap[gameData.game_state] || '-';
    
    // Активируем/деактивируем кнопку
    if (gameData.game_state === 'playing' && gisInited) {
        spinButton.disabled = false;
    } else {
        spinButton.disabled = true;
    }
}

// Обновление списка игроков
function updatePlayersList() {
    if (!gameData || !gameData.players) return;
    
    playersList.innerHTML = '';
    gameData.players.forEach((player, index) => {
        const marked = player.marked_numbers ? player.marked_numbers.length : 0;
        const total = player.card ? player.card.length : 30;
        const playerElement = document.createElement('div');
        playerElement.className = 'player-item';
        playerElement.innerHTML = `
            <strong>${player.name}</strong>
            <span>${marked}/${total}</span>
        `;
        playersList.appendChild(playerElement);
    });
}

// Обновление истории чисел
function updateDrawnNumbers() {
    if (!gameData || !gameData.drawn_numbers) return;
    
    drawnNumbers.innerHTML = gameData.drawn_numbers.join(', ') || '-';
}

// Обновление последних чисел
function updateLastNumbers() {
    if (!gameData || !gameData.drawn_numbers) return;
    
    lastNumbers.innerHTML = '';
    const lastNumbersList = gameData.drawn_numbers.slice(-10).reverse();
    
    lastNumbersList.forEach((num, index) => {
        const chip = document.createElement('div');
        chip.className = index === 0 ? 'number-chip recent' : 'number-chip';
        chip.textContent = num;
        lastNumbers.appendChild(chip);
    });
}

// Обновление статистики
function updateStats() {
    if (!gameData) return;
    
    const drawn = gameData.drawn_numbers ? gameData.drawn_numbers.length : 0;
    const remaining = 99 - drawn;
    
    drawnCount.textContent = drawn;
    remainingCount.textContent = remaining;
}

// Обновление колеса
function updateWheel() {
    const canvas = document.getElementById('wheelCanvas');
    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 10;
    
    // Очищаем canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Рисуем фон колеса
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#f7fafc';
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Рисуем сектора с числами
    if (gameData && gameData.drawn_numbers) {
        const drawnSet = new Set(gameData.drawn_numbers);
        
        for (let i = 1; i <= 99; i++) {
            const angle = (i / 99) * Math.PI * 2;
            const startAngle = angle - Math.PI / 198;
            const endAngle = angle + Math.PI / 198;
            
            // Цвет в зависимости от того, выпало ли число
            if (drawnSet.has(i)) {
                ctx.fillStyle = '#cbd5e0';
                ctx.strokeStyle = '#a0aec0';
            } else {
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#e2e8f0';
            }
            
            // Рисуем сектор
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius - 2, startAngle, endAngle);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }
    
    // Рисуем обводку
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 3;
    ctx.stroke();
}

// Кручение колеса
spinButton.addEventListener('click', async () => {
    if (!gameData || gameData.game_state !== 'playing') {
        showError('Игра не начата или завершена');
        return;
    }
    
    if (!gameData.drawn_numbers) {
        gameData.drawn_numbers = [];
    }
    
    // Генерируем случайное число, которого еще не было
    const availableNumbers = Array.from({length: 99}, (_, i) => i + 1)
        .filter(num => !gameData.drawn_numbers.includes(num));
    
    if (availableNumbers.length === 0) {
        showError('Все числа уже выпали!');
        return;
    }
    
    const randomIndex = Math.floor(Math.random() * availableNumbers.length);
    const newNumber = availableNumbers[randomIndex];
    
    // Анимация вращения
    spinButton.disabled = true;
    spinButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Крутится...';
    
    // Простая анимация
    let spins = 0;
    const maxSpins = 30;
    const spinInterval = setInterval(() => {
        const tempNumber = Math.floor(Math.random() * 99) + 1;
        currentNumber.textContent = tempNumber;
        currentNumber.style.color = '#ed8936';
        
        spins++;
        if (spins >= maxSpins) {
            clearInterval(spinInterval);
            
            // Устанавливаем финальное число
            currentNumber.textContent = newNumber;
            currentNumber.style.color = '#f56565';
            
            // Обновляем данные
            gameData.current_number = newNumber;
            gameData.drawn_numbers.push(newNumber);
            
            // Сохраняем
            saveGameData().then(() => {
                spinButton.disabled = false;
                spinButton.innerHTML = '<i class="fas fa-play"></i> Крутить колесо';
                
                // Обновляем интерфейс
                updateUI();
                updateWheel();
                
                // Показываем уведомление
                showNotification(`Выпало число: ${newNumber}`);
                
                // Виброотклик в Telegram
                if (tg.platform !== 'unknown') {
                    tg.HapticFeedback.impactOccurred('heavy');
                }
            });
        }
    }, 50);
});

// Подключение к Google Drive
connectButton.addEventListener('click', () => {
    if (accessToken) {
        showNotification('Уже подключено!');
        return;
    }
    
    authenticateGoogle();
});

// Обновление данных
refreshButton.addEventListener('click', () => {
    loadGameData();
    showNotification('Данные обновлены');
});

// Показать уведомление
function showNotification(message) {
    if (tg.platform !== 'unknown') {
        tg.showAlert(message);
    } else {
        alert(message);
    }
}

// Показать ошибку
function showError(message) {
    if (tg.platform !== 'unknown') {
        tg.showPopup({
            title: 'Ошибка',
            message: message,
            buttons: [{ type: 'ok' }]
        });
    } else {
        alert('Ошибка: ' + message);
    }
}

// Индикатор загрузки
function loading(show) {
    loadingElement.style.display = show ? 'flex' : 'none';
}

// Проверяем сохраненный токен при загрузке
const savedToken = localStorage.getItem('google_access_token');
if (savedToken) {
    accessToken = savedToken;
    gisInited = true;
    statusElement.textContent = 'Подключаемся...';
    loadGameData();
}