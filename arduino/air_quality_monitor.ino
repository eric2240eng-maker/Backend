/*
 * SMART IOT AIR QUALITY MONITORING SYSTEM (CORE FIRMWARE)
 * Architecture: Arduino Due (32-bit ARM Cortex-M3)
 * Connectivity: SIM800L (2G GPRS)
 * Core Sensors: PMS5003, MH-Z19C, SGP41, MQ-7, MQ-131, DHT11
 * Documentation: 12-bit ADC Resolution | 180s Telemetry Cycle
 */

#include "DHT.h"
#include "RTClib.h"
#include <Arduino.h>
#include <MHZ19.h>
#include <NOxGasIndexAlgorithm.h>
#include <SensirionI2CSgp41.h>
#include <U8g2lib.h>
#include <VOCGasIndexAlgorithm.h>
#include <Wire.h>

// ----------------------
// Pin definitions
// ----------------------
#define DHTPIN 7
#define DHTTYPE DHT11
#define MQ7_PIN A0
#define MQ131_PIN A1 // MQ-131 Ozone sensor

#define SIM800L_SERIAL Serial1
const long GSM_BAUD = 9600;


// GSM CONFIGURATION

const char *APN = "safaricom";

const char *BACKEND_URL = "switchback.proxy.rlwy.net";
const int BACKEND_PORT = 35059;
const char *BACKEND_PATH = "/api/sensor-data";
const char *PROTOCOL = "http://";

const unsigned long SEND_INTERVAL = 180000; // 3 minute telemetry interval
unsigned long lastSendTime = 0;
bool gsmReady = false;


// Devices & Algorithms

DHT dht(DHTPIN, DHTTYPE);
RTC_DS3231 rtc;
U8G2_ST7920_128X64_F_SW_SPI u8g2(U8G2_R0, 13, 11, 10, 8);
MHZ19 myMHZ19;

SensirionI2CSgp41 sgp41;
VOCGasIndexAlgorithm voc_helper;
NOxGasIndexAlgorithm nox_helper;


// Variables & Calibration Constants

int page = 0;
unsigned long lastSwitchTime = 0;
const unsigned long pageInterval = 4000;

// MQ Calibration Constants (Adjust these after your burn-in)
// R0 = Resistance in clean air (kOhms). Use Page 4 to find these.
const float MQ7_R0 = 5.0;
const float MQ131_R0 = 10.0;
const float RL_VALUE = 10.0; // Load resistor in kOhms

// Environmental Offsets
const float TEMP_OFFSET = 0.0;
const float HUM_OFFSET = 0.0;

uint16_t pm1_0 = 0, pm2_5 = 0, pm10 = 0;
int32_t voc_index = 0, nox_index = 0;
int co2_ppm = 0;

uint16_t conditioning_s = 10;

float humidity = 0;
float temperature = 0;
float CO_ppm = 0;
float O3_ppm = 0;
int mq7_raw = 0, mq131_raw = 0;

// ----------------------
// Read PMS5003 (Serial 13)
// ----------------------
bool readPMS5003() {
  if (Serial3.available() < 32)
    return false;
  uint8_t data[32];
  Serial3.readBytes(data, 32);

  if (data[0] != 0x42 || data[1] != 0x4D)
    return false;

  pm1_0 = (data[10] << 8) | data[11];
  pm2_5 = (data[12] << 8) | data[13];
  pm10 = (data[14] << 8) | data[15];
  return true;
}

// ---------------------------------------------------------
// GPRS Bearer Initialization & Connectivity Logic
// ---------------------------------------------------------
bool sendATCommand(const char *cmd, const char *expectedResponse,
                   unsigned long timeout) {
  Serial.print(F("GSM CMD: "));
  Serial.println(cmd);

  SIM800L_SERIAL.println(cmd);
  String response = "";
  unsigned long startTime = millis();

  while (millis() - startTime < timeout) {
    while (SIM800L_SERIAL.available()) {
      char c = SIM800L_SERIAL.read();
      response += c;
    }
    if (response.indexOf(expectedResponse) != -1) {
      Serial.println();
      return true;
    }
  }
  Serial.println(F("\nGSM Timeout"));
  return false;
}

bool waitForResponse(const char *expected, unsigned long timeout) {
  String response = "";
  unsigned long startTime = millis();

  while (millis() - startTime < timeout) {
    while (SIM800L_SERIAL.available()) {
      char c = SIM800L_SERIAL.read();
      response += c;
      Serial.write(c);
    }
    if (response.indexOf(expected) != -1) {
      Serial.println();
      return true;
    }
  }

  return false;
}

bool checkNetworkRegistration() {
  Serial.println(F("Checking network registration..."));
  SIM800L_SERIAL.println("AT+CREG?");
  delay(1000);

  String response = "";
  unsigned long startTime = millis();

  while (millis() - startTime < 3000) {
    while (SIM800L_SERIAL.available()) {
      char c = SIM800L_SERIAL.read();
      response += c;
      Serial.write(c);
    }
  }

  if (response.indexOf("+CREG: 0,1") != -1 ||
      response.indexOf("+CREG: 0,5") != -1) {
    Serial.println(F("✓ Network registered"));
    return true;
  }

  Serial.println(F("✗ Not registered on network"));
  return false;
}

void initGSM() {
  Serial.println(F("\n=== Initializing GSM ==="));

  sendATCommand("AT", "OK", 2000);
  delay(500);

  sendATCommand("ATE0", "OK", 2000);
  delay(500);

  if (sendATCommand("AT+CPIN?", "READY", 5000)) {
    Serial.println(F("✓ SIM card ready"));
  } else {
    Serial.println(F("✗ SIM card error"));
    return;
  }

  sendATCommand("AT+CSQ", "OK", 2000);
  delay(500);

  if (!checkNetworkRegistration()) {
    Serial.println(F("Warning: Network not registered. Continuing anyway..."));
  }

  Serial.println(F("Checking GPRS attachment..."));
  SIM800L_SERIAL.println("AT+CGATT?");
  delay(2000);

  String attachResponse = "";
  unsigned long attachStart = millis();
  while (millis() - attachStart < 2000) {
    while (SIM800L_SERIAL.available()) {
      char c = SIM800L_SERIAL.read();
      attachResponse += c;
      Serial.write(c);
    }
  }

  if (attachResponse.indexOf("+CGATT: 0") != -1) {
    Serial.println(F("\n✗ Not attached to GPRS. Attempting to attach..."));
    sendATCommand("AT+CGATT=1", "OK", 10000);
    delay(5000);
    sendATCommand("AT+CGATT?", "+CGATT: 1", 5000);
  } else if (attachResponse.indexOf("+CGATT: 1") != -1) {
    Serial.println(F("\n✓ GPRS attached"));
  }

  Serial.println(F("Connecting to GPRS bearer..."));
  Serial.println(F("Closing any existing bearer..."));
  SIM800L_SERIAL.println("AT+SAPBR=0,1");
  delay(3000);

  sendATCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", "OK", 2000);
  delay(500);

  String apnCmd = "AT+SAPBR=3,1,\"APN\",\"" + String(APN) + "\"";
  sendATCommand(apnCmd.c_str(), "OK", 2000);
  delay(500);

  Serial.println(F("Opening GPRS bearer (this may take 30-60 seconds)..."));
  if (sendATCommand("AT+SAPBR=1,1", "OK", 65000)) {
    Serial.println(F("✓ Bearer opened"));
  } else {
    Serial.println(F("✗ Bearer open failed"));
  }
  delay(5000);

  Serial.println(F("Checking bearer status..."));
  SIM800L_SERIAL.println("AT+SAPBR=2,1");
  delay(2000);

  String bearerResponse = "";
  unsigned long startTime = millis();
  while (millis() - startTime < 3000) {
    while (SIM800L_SERIAL.available()) {
      char c = SIM800L_SERIAL.read();
      bearerResponse += c;
      Serial.write(c);
    }
  }

  if (bearerResponse.indexOf("0.0.0.0") != -1) {
    Serial.println(F("\n✗ GPRS Connection Failed: No IP assigned"));
    gsmReady = false;
    return;
  } else if (bearerResponse.indexOf("+SAPBR: 1,1") != -1) {
    Serial.println(F("\n✓ GPRS Connected with valid IP!"));
  }

  SIM800L_SERIAL.println("AT+HTTPTERM");
  delay(1000);

  sendATCommand("AT+HTTPINIT", "OK", 2000);
  delay(500);

  sendATCommand("AT+HTTPPARA=\"CID\",1", "OK", 2000);
  delay(500);

  sendATCommand("AT+HTTPSSL=0", "OK", 2000);
  delay(500);

  gsmReady = true;
  Serial.println(F("✓ GSM Module Ready!\n"));
}

// ---------------------------------------------------------
// TELEMETRY TRANSMISSION: JSON Serialization & HTTP POST
// ---------------------------------------------------------
void sendDataToBackend() {
  //skip if primary sensor values are still zero
  if (pm2_5 == 0 && pm10 == 0 && temperature == 0.0 && humidity == 0.0 &&
      co2_ppm == 0) {
    Serial.println(F("⚠ Skipping send: sensor readings not ready (all zero)"));
    return;
  }

  Serial.println(F("\n>>> Sending data to backend..."));

  SIM800L_SERIAL.println("AT+SAPBR=2,1");
  delay(1000);

  String bearerCheck = "";
  unsigned long startTime = millis();
  while (millis() - startTime < 2000) {
    while (SIM800L_SERIAL.available()) {
      char c = SIM800L_SERIAL.read();
      bearerCheck += c;
    }
  }

  if (bearerCheck.indexOf("0.0.0.0") != -1) {
    Serial.println(F("✗ GPRS not connected (no valid IP). Skipping send."));
    return;
  }

  // Build JSON payload with ALL sensors
  String jsonData = "{";
  jsonData += "\"location\":\"Nairobi\",";
  jsonData += "\"metrics\":{";
  jsonData += "\"pm1\":" + String(pm1_0) + ",";
  jsonData += "\"pm25\":" + String(pm2_5) + ",";
  jsonData += "\"pm10\":" + String(pm10) + ",";
  jsonData += "\"co\":" + String(CO_ppm, 2) + ",";
  jsonData += "\"co2\":" + String(co2_ppm) + ",";
  jsonData += "\"o3\":" + String(O3_ppm) + ",";
  jsonData += "\"temperature\":" + String(temperature, 1) + ",";
  jsonData += "\"humidity\":" + String(humidity, 1) + ",";
  jsonData += "\"voc_index\":" + String(voc_index) + ",";
  jsonData += "\"nox_index\":" + String(nox_index);
  jsonData += "}}";

  // Serial logging for telemetry verification
  Serial.print(F("Payload: "));
  Serial.println(jsonData);

  SIM800L_SERIAL.println("AT+HTTPTERM");
  delay(500);
  sendATCommand("AT+HTTPINIT", "OK", 2000);
  delay(500);
  sendATCommand("AT+HTTPPARA=\"CID\",1", "OK", 2000);
  delay(500);

  sendATCommand("AT+HTTPSSL=0", "OK", 2000);
  delay(500);

  String fullUrl = String(PROTOCOL) + String(BACKEND_URL) + ":" +
                   String(BACKEND_PORT) + String(BACKEND_PATH);
  String urlCmd = "AT+HTTPPARA=\"URL\",\"" + fullUrl + "\"";

  sendATCommand(urlCmd.c_str(), "OK", 2000);
  delay(500);

  sendATCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 2000);
  delay(500);

  String dataCmd = "AT+HTTPDATA=" + String(jsonData.length()) + ",10000";
  SIM800L_SERIAL.println(dataCmd);
  delay(1000);

  if (waitForResponse("DOWNLOAD", 2000)) {
    SIM800L_SERIAL.println(jsonData);
    delay(2000);

    SIM800L_SERIAL.println("AT+HTTPACTION=1");
    delay(5000);

    if (waitForResponse("+HTTPACTION:", 15000)) {
      String httpResponse = "";
      unsigned long startTime = millis();
      delay(1000);

      while (millis() - startTime < 2000) {
        while (SIM800L_SERIAL.available()) {
          char c = SIM800L_SERIAL.read();
          httpResponse += c;
        }
      }

      int firstComma = httpResponse.indexOf(',');
      int secondComma = httpResponse.indexOf(',', firstComma + 1);

      if (firstComma > 0 && secondComma > firstComma) {
        String statusStr = httpResponse.substring(firstComma + 1, secondComma);
        int statusCode = statusStr.toInt();

        Serial.print(F("HTTP Status: "));
        Serial.println(statusCode);

        if (statusCode == 200 || statusCode == 201) {
          Serial.println(F("✓ Data sent successfully!"));
        } else {
          Serial.print(F("✗ HTTP Error/Redirect Code: "));
          Serial.println(statusCode);
        }
      }
      sendATCommand("AT+HTTPREAD", "OK", 3000);
    } else {
      Serial.println(F("✗ HTTP request timeout"));
    }
  } else {
    Serial.println(F("✗ Failed to enter data mode"));
  }
  delay(1000);
}

// ---------------------------------------------------------
// HARDWARE INITIALIZATION (setup())
// ---------------------------------------------------------
void setup() {
  Serial.begin(115200);
  u8g2.begin();
  dht.begin();
  Wire.begin();
  rtc.begin();
  sgp41.begin(Wire);

  // Upgrade ADC resolution to 12-bit (0-4095) for the Arduino Due
  analogReadResolution(12);

  // Serial Port Assignments
  Serial3.begin(9600);            // PMS5003
  Serial2.begin(9600);            // MH-Z19C
  myMHZ19.begin(Serial2);         // Link MHZ19 library
  myMHZ19.autoCalibration(false); // Disable auto-calibration to prevent drift

  SIM800L_SERIAL.begin(GSM_BAUD); // SIM800L on Serial1

  if (!rtc.begin()) {
    Serial.println("RTC not found!");
  }
  // --- HOW TO SET THE TIME PERMANENTLY ---
  // STEP 1: Uncomment the line below, and upload the code to the Arduino.
  //         (This sets the RTC to your computer's exact current time).
  // STEP 2: Immediately add the '//' back to comment the line out again.
  // STEP 3: Upload the code a SECOND time. Now the time is saved forever!

  //rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));

  if (rtc.lostPower()) {
    Serial.println("RTC lost power! Battery might be dead.");
  }
  Serial.println(F("\n================================"));
  Serial.println(F("Air Quality Monitor with GSM & CO2"));
  Serial.println(F("================================\n"));

  delay(3000);
  initGSM();
}

// ----------------------
//  Main LOOP
// ----------------------
void loop() {

  readPMS5003();
  // Read MH-Z19C from Serial2
  co2_ppm = myMHZ19.getCO2();
  // SGP41 Reading
  uint16_t srawVoc = 0, srawNox = 0;
  if (conditioning_s > 0) {
    sgp41.executeConditioning(0x8000, 0x6666, srawVoc);
    conditioning_s--;
  } else {
    sgp41.measureRawSignals(0x8000, 0x6666, srawVoc, srawNox);
  }
  voc_index = voc_helper.process(srawVoc);
  nox_index = nox_helper.process(srawNox);

  // Environment Readings
  humidity = dht.readHumidity() + HUM_OFFSET;
  temperature = dht.readTemperature() + TEMP_OFFSET;

  // --- CALIBRATED & SMOOTHED MQ-7 READ (Carbon Monoxide) ---
  long mq7_sum = 0;
  // Stochastic Signal Conditioning: Analog Oversampling to eliminate heater
  // noise
  for (int i = 0; i < 10; i++) {
    mq7_sum += analogRead(MQ7_PIN);
    delay(2);
  }
  mq7_raw = mq7_sum / 10;

  // Convert 12-bit ADC integer (0-4095) to physical voltage (3.3V Logic)
  float v7 = (mq7_raw * 3.3) / 4095.0;
  if (v7 > 0.1) {
    // Calculate sensor resistance (Rs) using voltage divider relationship
    float rs7 = ((3.3 * RL_VALUE) / v7) - RL_VALUE;
    // Normalize resistance against clean-air baseline (R0)
    float ratio7 = rs7 / MQ7_R0;
    // Logarithmic Linearization: Apply reverse power-law from manufacturer
    // sensitivity curves
    CO_ppm = pow(10, ((log10(ratio7) - 0.5) / -0.8));
  } else {
    CO_ppm = 0; // Guard for zero-voltage / clean air conditions
  }

  // --- CALIBRATED & SMOOTHED MQ-131 READ (Ozone) ---
  long mq131_sum = 0;
  // Digital low-pass filtering via cumulative averaging (10 samples)
  for (int i = 0; i < 10; i++) {
    mq131_sum += analogRead(MQ131_PIN);
    delay(2);
  }
  mq131_raw = mq131_sum / 10;

  // Precision 12-bit Voltage Mapping
  float v131 = (mq131_raw * 3.3) / 4095.0;
  if (v131 > 0.1) {
    // Instantaneous sensor resistance computation
    float rs131 = ((3.3 * RL_VALUE) / v131) - RL_VALUE;
    // Normalize against Ozone-specific baseline
    float ratio131 = rs131 / MQ131_R0;
    // Extract concentration using specific log-log characteristics for MQ-131
    O3_ppm = pow(10, ((log10(ratio131) + 1.1) / -1.0));
  } else {
    O3_ppm = 0; // Fail-safe for baseline air
  }

  DateTime now = rtc.now();
  char timeStr[10], dateStr[12];
  sprintf(timeStr, "%02d:%02d:%02d", now.hour(), now.minute(), now.second());
  sprintf(dateStr, "%02d/%02d/%d", now.day(), now.month(), now.year());

  if (millis() - lastSwitchTime > pageInterval) {
    page = (page + 1) % 5;
    lastSwitchTime = millis();
  }

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);

  // HEADER 
  u8g2.drawStr(0, 10, timeStr);
  u8g2.drawStr(65, 10, dateStr);
  u8g2.drawHLine(0, 13, 128);

  // --- PAGE 0: PARTICULATE MATTER ---
  if (page == 0) {
    u8g2.drawStr(35, 25, "[ PM LEVELS ]");
    char p1[20], p25[20], p10[20];
    sprintf(p1, "PM1.0: %d ug/m3", pm1_0);
    sprintf(p25, "PM2.5: %d ug/m3", pm2_5);
    sprintf(p10, "PM10 : %d ug/m3", pm10);

    u8g2.drawStr(5, 40, p1);
    u8g2.drawStr(5, 52, p25);
    u8g2.drawStr(5, 64, p10);
  }

  // --- PAGE 1: SGP41 VOC & NOX ---
  else if (page == 1) {
    u8g2.drawStr(30, 25, "[ VOC & NOX ]");
    if (conditioning_s > 0) {
      u8g2.drawStr(10, 45, "Warming up...");
      u8g2.setCursor(85, 45);
      u8g2.print(conditioning_s);
      u8g2.print("s");
    } else {
      char vStr[20], nStr[20];
      sprintf(vStr, "VOC Index: %ld", voc_index);
      sprintf(nStr, "NOx Index: %ld", nox_index);
      u8g2.drawStr(10, 45, vStr);
      u8g2.drawStr(10, 60, nStr);
    }
  }

  // --- PAGE 2: ENVIRONMENT (Temp, Hum, CO, CO2, 03) ---
  else if (page == 2) {
    u8g2.setFont(u8g2_font_5x8_tr);     // smaller font
    u8g2.drawStr(30, 20, "ENV");        // short + higher
    u8g2.setFont(u8g2_font_ncenB08_tr); // restore normal font

    char tStr[20], hStr[20], coStr[20], co2Str[20], o3Str[20];

    sprintf(tStr, "Temp: %.1f C", temperature);
    sprintf(hStr, "Hum : %.1f %%", humidity);
    sprintf(coStr, "CO  : %.1f ppm", CO_ppm);
    sprintf(co2Str, "CO2 : %d ppm", co2_ppm);
    sprintf(o3Str, "O3  : %.2f ppm", O3_ppm); // ✅ ozone

    // Compact vertical spacing
    u8g2.drawStr(5, 24, tStr);
    u8g2.drawStr(5, 34, hStr);
    u8g2.drawStr(5, 44, coStr);
    u8g2.drawStr(5, 54, co2Str);
    u8g2.drawStr(5, 64, o3Str);
  }
  // --- PAGE 3: ADVICE ---
  else if (page == 3) {
    u8g2.drawStr(30, 25, "[ ADVICE ]");
    if (CO_ppm < 5 && pm2_5 < 12 && voc_index < 150 && co2_ppm < 800) {
      u8g2.drawStr(15, 50, "Air Quality: GOOD");
    } else if (CO_ppm > 9 || voc_index > 300 || pm2_5 > 35 || co2_ppm > 1200) {
      u8g2.drawStr(15, 50, "DANGER: VENTILATE!");
    } else {
      u8g2.drawStr(15, 50, "Quality: MODERATE");
    }
  }

  // --- PAGE 4: CALIBRATION DATA ---
  else if (page == 4) {
    u8g2.drawStr(20, 25, "[ RAW SENSORS ]");
    char r7[20], r131[20], rCO2[20];
    sprintf(r7, "Raw MQ7 : %d", mq7_raw);
    sprintf(r131, "Raw O3  : %d", mq131_raw);
    sprintf(rCO2, "Raw CO2 : %d", co2_ppm);

    u8g2.drawStr(5, 40, r7);
    u8g2.drawStr(5, 52, r131);
    u8g2.drawStr(5, 64, rCO2);
  }

  u8g2.sendBuffer();

 
  // TELEMETRY TIMING LOGIC

  unsigned long currentTime = millis();
  if (currentTime - lastSendTime >= SEND_INTERVAL) {
    if (gsmReady && conditioning_s == 0) {
      sendDataToBackend();
    } else if (!gsmReady) {
      Serial.println(F("GSM not ready, attempting to reinitialize..."));
      initGSM();
    }
    lastSendTime = currentTime;
  }

  delay(100);
}
