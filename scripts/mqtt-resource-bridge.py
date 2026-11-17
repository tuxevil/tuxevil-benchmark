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
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CACHE = {}
LOCK = threading.Lock()
GPU_TOPIC = os.environ.get('RESOURCE_MQTT_GPU_TOPIC', 'benchmark/host/gpu/attributes')
PROCESS_TOPIC = os.environ.get('RESOURCE_MQTT_PROCESS_TOPIC', 'benchmark/host/processes/attributes')
MAX_AGE = float(os.environ.get('RESOURCE_MQTT_MAX_AGE_SECONDS', '25'))


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
    def fresh(topic):
        value = cache.get(topic, {})
        stamp = timestamp(value)
        return value if stamp is not None and 0 <= now - stamp <= MAX_AGE else {}
    gpu, processes = fresh(GPU_TOPIC), fresh(PROCESS_TOPIC)
    rows = processes.get('procesos_cpu', [])
    # A top-N process list may omit the inference process: report null, never zero.
    inference = [p for p in rows if p.get('proceso') == os.environ.get('RESOURCE_MQTT_PROCESS_NAME', 'llama-server')]
    ram = [numeric(p.get('memoria_rss_mb')) for p in inference]
    ram_bytes = sum(ram) * 1024 * 1024 if ram and all(v is not None for v in ram) else None
    vram = numeric(gpu.get('memory_used_mb'))
    return {'source': 'MQTT: inference process RSS / GPU', 'scope': 'gpu',
            'ramBytes': ram_bytes, 'vramBytes': vram * 1024 * 1024 if vram is not None else None,
            'watts': numeric(gpu.get('power_watts')),
            'gpuTemperatureC': numeric(gpu.get('temperature_c')),
            'gpuTemperatureLimitC': numeric(gpu.get('temperature_limit_c')),
            'thermalThrottlingActive': gpu.get('thermal_throttling_active') if isinstance(gpu.get('thermal_throttling_active'), bool) else None,
            'thermalHwSeconds': numeric(gpu.get('thermal_slowdown_hw_seconds')),
            'thermalSwSeconds': numeric(gpu.get('thermal_slowdown_sw_seconds')),
            'sourceIntervalSeconds': processes.get('intervalo_muestreo_s'),
            'gpuUpdatedAt': gpu.get('actualizado'), 'processUpdatedAt': processes.get('actualizado')}


def subscribe():
    while True:
        try:
            with socket.create_connection((os.environ['RESOURCE_MQTT_HOST'], int(os.environ.get('RESOURCE_MQTT_PORT', '1883'))), 5) as sock:
                sock.settimeout(3)
                send(sock, 16, mqtt_string('MQTT') + bytes([4, 194]) + struct.pack('!H', 30) + mqtt_string('benchmark-' + uuid.uuid4().hex[:12]) + mqtt_string(os.environ['RESOURCE_MQTT_USER']) + mqtt_string(os.environ['RESOURCE_MQTT_PASSWORD']))
                header, payload = packet(sock)
                if header != 32 or payload != b'\x00\x00':
                    raise ValueError('MQTT connection refused')
                send(sock, 130, b'\x00\x01' + mqtt_string(GPU_TOPIC) + b'\x00' + mqtt_string(PROCESS_TOPIC) + b'\x00')
                last_ping = time.monotonic()
                while True:
                    try:
                        header, payload = packet(sock)
                        if header >> 4 == 3:
                            size = int.from_bytes(payload[:2], 'big')
                            topic = payload[2:2+size].decode()
                            offset = 2+size+(2 if (header >> 1) & 3 else 0)
                            if topic in (GPU_TOPIC, PROCESS_TOPIC):
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
    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('RESOURCE_COLLECTOR_PORT', '9109'))), Handler).serve_forever()
