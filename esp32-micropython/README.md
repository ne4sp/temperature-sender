## ESP32 MicroPython + DHT11

Эта папка содержит пример для ESP32 на MicroPython, который читает DHT11 и отправляет:

- `celsius` (температура)
- `humidity` (влажность, %)

на сервер: `POST /api/temperature`.

### 1) Подготовка MicroPython

Установите MicroPython на ESP32 и подключитесь по serial.

### 2) Файлы

- `main.py` — основной файл (автозапуск)

### 3) Загрузка на плату

Любым удобным способом (Thonny, `mpremote`, `ampy`) загрузите `main.py` в корень файловой системы ESP32.

### 4) Настройки

В `main.py` укажите:

- `WIFI_SSID`, `WIFI_PASS`
- `SERVER_URL` (пример: `http://192.168.0.10:8080/api/temperature`)
- `DEVICE_ID`
- `DHT_PIN` (GPIO, куда подключён DATA DHT11)

