import time

import network
import ujson
import urequests
from machine import Pin

import dht

WIFI_SSID = "YOUR_WIFI_SSID"
WIFI_PASS = "YOUR_WIFI_PASSWORD"

# Example: "http://192.168.0.10:8080/api/temperature"
SERVER_URL = "http://192.168.0.10:8080/api/temperature"

DEVICE_ID = "esp32-dht11-01"

# GPIO number where DHT11 DATA pin is connected
DHT_PIN = 15

# Send interval (ms)
SEND_INTERVAL_MS = 2000


def wifi_connect():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if wlan.isconnected():
        return wlan

    wlan.connect(WIFI_SSID, WIFI_PASS)
    t0 = time.ticks_ms()
    while not wlan.isconnected():
        if time.ticks_diff(time.ticks_ms(), t0) > 20000:
            raise RuntimeError("WiFi connect timeout")
        time.sleep_ms(250)
    return wlan


def read_dht11(sensor):
    # DHT11 needs a small delay between reads (>= 1s)
    sensor.measure()
    t = sensor.temperature()
    h = sensor.humidity()
    return float(t), float(h)


def post_measurement(celsius, humidity):
    payload = {
        "celsius": celsius,
        "humidity": humidity,
        "deviceId": DEVICE_ID,
    }
    headers = {"Content-Type": "application/json"}
    resp = None
    try:
        resp = urequests.post(
            SERVER_URL, data=ujson.dumps(payload), headers=headers
        )
        # reading content allows socket reuse on some ports/firmwares
        _ = resp.text
        return 200 <= resp.status_code < 300
    finally:
        if resp is not None:
            resp.close()


def main():
    wifi_connect()
    sensor = dht.DHT11(Pin(DHT_PIN, Pin.IN, Pin.PULL_UP))

    while True:
        try:
            c, h = read_dht11(sensor)
            ok = post_measurement(c, h)
            # small sleep even on success
            time.sleep_ms(SEND_INTERVAL_MS if ok else 1500)
        except Exception:
            # simple recovery loop: wait and retry, reconnect Wi‑Fi if needed
            try:
                wlan = network.WLAN(network.STA_IF)
                if not wlan.isconnected():
                    wifi_connect()
            except Exception:
                pass
            time.sleep_ms(1500)


main()

