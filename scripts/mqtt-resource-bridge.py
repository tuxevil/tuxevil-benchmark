#!/usr/bin/env python3
"""Read-only MQTT 3.1.1 subscriber exposing normalized metrics on loopback.
No publish/control messages are sent. Values require publisher timestamps.
"""
import datetime
import hmac
import json
import math
import os
import socket
import struct
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CACHE = {}
LOCK = threading.Lock()
GPU_TOPIC = os.environ.get('RESOURCE_MQTT_GPU_TOPIC', 'benchmark/host/gpu/attributes')
PROCESS_TOPIC = os.environ.get('RESOURCE_MQTT_PROCESS_TOPIC', 'benchmark/host/processes/attributes')
WALL_TOPIC = os.environ.get('RESOURCE_MQTT_WALL_TOPIC', '').strip()
HA_URL = os.environ.get('RESOURCE_HA_URL', '').strip().rstrip('/')
HA_TOKEN = os.environ.get('RESOURCE_HA_TOKEN', '').strip()
HA_WALL_ENTITY = os.environ.get('RESOURCE_HA_WALL_ENTITY', 'sensor.servidor_potencia_local').strip()
HA_POLL_SECONDS = max(0.5, float(os.environ.get('RESOURCE_HA_POLL_SECONDS', '2')))
WALL_SOURCE_INTERVAL_SECONDS = max(1.0, float(os.environ.get('RESOURCE_WALL_SOURCE_INTERVAL_SECONDS', '30')))
MAX_AGE = float(os.environ.get('RESOURCE_MQTT_MAX_AGE_SECONDS', '25'))
WALL_MAX_AGE = float(os.environ.get('RESOURCE_WALL_MAX_AGE_SECONDS', '90'))
WALL_IDLE_WATTS = os.environ.get('RESOURCE_WALL_IDLE_WATTS', '').strip()
HA_WALL_KEY = '__ha_wall__'


def mqtt_string(value):
    raw = value.encode()
    return struct.pack('!H', len(raw)) + raw


def send(sock, header, payload):
    size = len(payload)
    raw = bytearray([header])
    while True:
        digit = size % 128
        size //= 128
        raw.append(digit | (128 if size else 0))
        if not size:
            break
    sock.sendall(raw + payload)


def read_exact(sock, size):
    raw = b''
    while len(raw) < size:
        chunk = sock.recv(size - len(raw))
        if not chunk:
            raise EOFError()
        raw += chunk
    return raw


def packet(sock):
    header = read_exact(sock, 1)[0]
    size, multiplier = 0, 1
    for _ in range(4):
        digit = read_exact(sock, 1)[0]
        size += (digit & 127) * multiplier
        if digit < 128:
            break
        multiplier *= 128
    else:
        raise ValueError('invalid MQTT length')
    if size > 2 * 1024 * 1024:
        raise ValueError('MQTT payload too large')
    return header, read_exact(sock, size)


def timestamp(data):
    try:
        stamp = datetime.datetime.fromisoformat(data['actualizado'].replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            return None
        return stamp.timestamp()
    except (KeyError, TypeError, ValueError):
        return None


def numeric(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def normalize(cache, now):
    def fresh(topic, max_age=MAX_AGE):
        value = cache.get(topic, {})
        stamp = timestamp(value)
        return value if stamp is not None and 0 <= now - stamp <= max_age else {}
    gpu, processes = fresh(GPU_TOPIC), fresh(PROCESS_TOPIC)
    wall = fresh(HA_WALL_KEY, WALL_MAX_AGE) or (fresh(WALL_TOPIC, WALL_MAX_AGE) if WALL_TOPIC else {})
    rows = processes.get('procesos_cpu', [])
    # A top-N process list may omit the inference process: report null, never zero.
    inference = [p for p in rows if p.get('proceso') == os.environ.get('RESOURCE_MQTT_PROCESS_NAME', 'llama-server')]
    ram = [numeric(p.get('memoria_rss_mb')) for p in inference]
    ram_bytes = sum(ram) * 1024 * 1024 if ram and all(v is not None for v in ram) else None
    vram = numeric(gpu.get('memory_used_mb'))
    wall_watts = numeric(wall.get('power_watts'))
    idle_baseline = numeric(float(WALL_IDLE_WATTS)) if WALL_IDLE_WATTS else None
    return {'source': 'MQTT: inference process RSS / GPU', 'scope': 'gpu',
            'ramBytes': ram_bytes, 'vramBytes': vram * 1024 * 1024 if vram is not None else None,
            'watts': numeric(gpu.get('power_watts')),
            'wallWatts': wall_watts,
            'wallUpdatedAt': wall.get('actualizado') if wall_watts is not None else None,
            'wallSource': wall.get('source') if wall_watts is not None else None,
            'wallEntityId': wall.get('entity_id') if wall_watts is not None else None,
            'wallIdleBaselineWatts': idle_baseline,
            'wallSourceIntervalSeconds': numeric(wall.get('intervalo_muestreo_s')),
            'gpuTemperatureC': numeric(gpu.get('temperature_c')),
            'gpuTemperatureLimitC': numeric(gpu.get('temperature_limit_c')),
            'thermalThrottlingActive': gpu.get('thermal_throttling_active') if isinstance(gpu.get('thermal_throttling_active'), bool) else None,
            'thermalHwSeconds': numeric(gpu.get('thermal_slowdown_hw_seconds')),
            'thermalSwSeconds': numeric(gpu.get('thermal_slowdown_sw_seconds')),
            'sourceIntervalSeconds': processes.get('intervalo_muestreo_s'),
            'gpuUpdatedAt': gpu.get('actualizado'), 'processUpdatedAt': processes.get('actualizado')}


def parse_ha_wall_state(state_payload, entity_id=HA_WALL_ENTITY, source_interval_seconds=WALL_SOURCE_INTERVAL_SECONDS):
    if not isinstance(state_payload, dict):
        return None
    raw_state = state_payload.get('state')
    try:
        watts = numeric(float(raw_state))
    except (TypeError, ValueError):
        watts = None
    stamp = state_payload.get('last_updated') or state_payload.get('last_changed')
    if watts is None or not isinstance(stamp, str):
        return None
    return {
        'power_watts': watts,
        'actualizado': stamp,
        'entity_id': entity_id,
        'source': f'Home Assistant: {entity_id}',
        'intervalo_muestreo_s': source_interval_seconds,
    }


def poll_ha_wall():
    if not HA_URL or not HA_TOKEN or not HA_WALL_ENTITY:
        return
    url = f'{HA_URL}/api/states/{HA_WALL_ENTITY}'
    while True:
        try:
            req = urllib.request.Request(url, headers={'Authorization': f'Bearer {HA_TOKEN}', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status == 200:
                    parsed = parse_ha_wall_state(json.loads(resp.read().decode()))
                    if parsed:
                        with LOCK:
                            CACHE[HA_WALL_KEY] = parsed
        except (OSError, urllib.error.URLError, ValueError):
            pass
        time.sleep(HA_POLL_SECONDS)


def subscribe():
    while True:
        try:
            with socket.create_connection((os.environ['RESOURCE_MQTT_HOST'], int(os.environ.get('RESOURCE_MQTT_PORT', '1883'))), 5) as sock:
                sock.settimeout(3)
                send(sock, 16, mqtt_string('MQTT') + bytes([4, 194]) + struct.pack('!H', 30) + mqtt_string('benchmark-' + uuid.uuid4().hex[:12]) + mqtt_string(os.environ['RESOURCE_MQTT_USER']) + mqtt_string(os.environ['RESOURCE_MQTT_PASSWORD']))
                header, payload = packet(sock)
                if header != 32 or payload != b'\x00\x00':
                    raise ValueError('MQTT connection refused')
                topics = [GPU_TOPIC, PROCESS_TOPIC] + ([WALL_TOPIC] if WALL_TOPIC else [])
                subscribe_payload = b'\x00\x01' + b''.join(mqtt_string(t) + b'\x00' for t in topics)
                send(sock, 130, subscribe_payload)
                last_ping = time.monotonic()
                while True:
                    try:
                        header, payload = packet(sock)
                        if header >> 4 == 3:
                            size = int.from_bytes(payload[:2], 'big')
                            topic = payload[2:2+size].decode()
                            offset = 2+size+(2 if (header >> 1) & 3 else 0)
                            if topic in topics:
                                data = json.loads(payload[offset:])
                                if isinstance(data, dict):
                                    with LOCK:
                                        CACHE[topic] = data
                    except socket.timeout:
                        pass
                    if time.monotonic() - last_ping >= 10:
                        send(sock, 192, b'')
                        last_ping = time.monotonic()
        except (OSError, EOFError, ValueError):
            with LOCK:
                CACHE.clear()
            time.sleep(3)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/metrics':
            self.send_error(404)
            return
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + os.environ['RESOURCE_COLLECTOR_TOKEN']):
            self.send_error(401)
            return
        with LOCK:
            sample = normalize(CACHE, time.time())
        payload = json.dumps(sample).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    for key in ['RESOURCE_MQTT_HOST', 'RESOURCE_MQTT_USER', 'RESOURCE_MQTT_PASSWORD', 'RESOURCE_COLLECTOR_TOKEN']:
        if not os.environ.get(key):
            raise SystemExit('Missing required environment: ' + key)
    threading.Thread(target=subscribe, daemon=True).start()
    if HA_URL and HA_TOKEN and HA_WALL_ENTITY:
        threading.Thread(target=poll_ha_wall, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('RESOURCE_COLLECTOR_PORT', '9109'))), Handler).serve_forever()
