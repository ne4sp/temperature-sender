#include <WiFi.h>
#include <HTTPClient.h>

// 1) Wi‑Fi credentials
static const char *WIFI_SSID = "YOUR_WIFI_SSID";
static const char *WIFI_PASS = "YOUR_WIFI_PASSWORD";

// 2) Server endpoint (your PC IP on LAN)
// Example: "http://192.168.0.10:8080/api/temperature"
static const char *SERVER_URL = "http://192.168.0.10:8080/api/temperature";

// 3) Device metadata
static const char *DEVICE_ID = "esp32-01";

// How often to send, ms
static const uint32_t SEND_INTERVAL_MS = 2000;

// If you don't have a sensor yet, this generates a smooth temperature curve for testing
float readTemperatureCelsius() {
  const float t = millis() / 1000.0f;
  return 24.0f + 2.0f * sinf(t / 8.0f);
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("WiFi connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connected, IP: ");
  Serial.println(WiFi.localIP());
}

bool postTemperature(float celsius) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  char body[192];
  // We intentionally omit `ts` so the server timestamps the point with its own clock.
  // If you later add NTP time on ESP32, you can include Unix milliseconds as `ts`.
  snprintf(body, sizeof(body), "{\"celsius\":%.2f,\"deviceId\":\"%s\"}", (double)celsius, DEVICE_ID);

  int code = http.POST((uint8_t *)body, strlen(body));
  String resp = http.getString();
  http.end();

  Serial.print("POST ");
  Serial.print(celsius, 2);
  Serial.print("C -> code=");
  Serial.print(code);
  Serial.print(" resp=");
  Serial.println(resp);

  return code >= 200 && code < 300;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  connectWifi();
}

void loop() {
  static uint32_t lastSend = 0;
  const uint32_t now = millis();
  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;

    const float c = readTemperatureCelsius();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi lost, reconnecting...");
      connectWifi();
    }
    postTemperature(c);
  }
}

