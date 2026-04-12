# Обновление проекта и переменные окружения

Краткая памятка для продакшена (Ubuntu, сервис через **systemd**) и для правки настроек без сюрпризов.

---

## Обычное обновление с GitHub

На сервере, в каталоге с клоном репозитория (например `/usr/tsender`):

```bash
cd /usr/tsender
git pull
cd server
npm install
sudo systemctl restart tsender
```

- **`npm install`** обязателен, если менялись `package.json` / `package-lock.json` (новые зависимости).
- История датчиков лежит в **`server/data/history.json`** (или в каталоге из **`DATA_DIR`**). Эта папка **не в git**, при `git pull` данные **не пропадают**.

Проверка:

```bash
sudo systemctl status tsender
curl -s http://127.0.0.1:8080/api/health
```

Логи:

```bash
journalctl -u tsender -f
```

---

## Как менять переменные окружения (systemd)

1. Откройте unit-файл сервиса (имя может отличаться, ниже пример `tsender`):

   ```bash
   sudo nano /etc/systemd/system/tsender.service
   ```

2. В секции **`[Service]`** строки вида:

   ```ini
   Environment=PORT=8080
   Environment=API_KEY=ваш_секрет
   ```

3. **Важно:** директива называется **`Environment`** (через **nn** в середине слова), не `Enviroment`. Опечатка приводит к тому, что переменная **не попадает** в процесс Node.

4. После правок:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart tsender
   ```

5. Убедиться, что переменные подхватились:

   ```bash
   sudo systemctl show tsender -p Environment
   ```

---

## Список переменных сервера (Node)

| Переменная | Значение по умолчанию | Назначение |
|------------|------------------------|------------|
| `PORT` | `8080` | Порт HTTP. |
| `API_KEY` | пусто | Если задана, `POST /api/temperature` требует заголовок **`x-api-key`** с тем же значением. |
| `RATE_LIMIT_PER_MIN` | `120` | Максимум запросов с одного IP в минуту на `POST /api/temperature`. |
| `HISTORY_LIMIT` | `1000` | Сколько последних точек хранить в памяти и в файле истории. |
| `DATA_DIR` | `server/data` (относительно каталога `server/`) | Каталог для **`history.json`**. Удобно вынести в `/var/lib/...`, чтобы не зависеть от пути репозитория. |
| `WEATHER_LAT` | координаты ст. Багаевская | Широта для Open‑Meteo (можно переопределить). |
| `WEATHER_LON` | координаты ст. Багаевская | Долгота для Open‑Meteo. |
| `WEATHER_TTL_MS` | `600000` (10 мин) | Кэш ответа погоды, миллисекунды. |

Погода запрашивается у **Open‑Meteo** без отдельного API‑ключа.

---

## Синхронизация с ESP32 (MicroPython)

Если на сервере включён **`API_KEY`**, в **`esp32-micropython/main.py`** должна совпадать строка:

```python
API_KEY = "тот же секрет"
```

После смены ключа на сервере обновите прошивку/файл на плате и перезапустите сервис.

---

## Локальный запуск (Windows / разработка)

```bash
cd server
npm install
npm run dev
```

Переменные можно задать в PowerShell перед запуском:

```powershell
$env:API_KEY="test"; $env:PORT="8080"; npm run dev
```

Или одной строкой в cmd: `set API_KEY=test&& npm run dev` (в каталоге `server`).

---

## Если что-то пошло не так

- **401** на `POST /api/temperature` — не совпал **`x-api-key`** или **`API_KEY`** на сервере пустой/не тот после рестарта.
- **Погода «не настроена»** при пустых координатах в старых версиях — в текущем коде есть значения по умолчанию; при сомнениях проверьте `GET /api/health` и логи.
- **Порт занят** — смените `PORT` или остановите другой процесс на том же порту.

Подробнее о формате API и структуре репозитория см. **`README.md`**.
