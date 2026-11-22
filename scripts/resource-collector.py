#!/usr/bin/env python3
"""Read-only telemetry on the inference host; requires RESOURCE_COLLECTOR_TOKEN.
RAM is host used RAM excluding cache; watts/VRAM are total NVIDIA GPU readings,
not wall-socket power or model-exclusive usage. Unsupported values remain null.
"""
import datetime
import hmac
import json
import math
import os
import subprocess
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HA_URL = os.environ.get('RESOURCE_HA_URL', '').strip().rstrip('/')
HA_TOKEN = os.environ.get('RESOURCE_HA_TOKEN', '').strip()
HA_WALL_ENTITY = os.environ.get('RESOURCE_HA_WALL_ENTITY', 'sensor.servidor_potencia_local').strip()
WALL_IDLE_WATTS = os.environ.get('RESOURCE_WALL_IDLE_WATTS', '').strip()
WALL_SOURCE_INTERVAL_SECONDS = max(1.0, float(os.environ.get('RESOURCE_WALL_SOURCE_INTERVAL_SECONDS', '30')))


def _finite_non_neg(raw):
    try:
        val = float(raw)
        return val if math.isfinite(val) and val >= 0 else None
    except (TypeError, ValueError):
        return None


def sample_wall():
    if not HA_URL or not HA_TOKEN or not HA_WALL_ENTITY:
        return {}
    try:
        req = urllib.request.Request(
            f'{HA_URL}/api/states/{HA_WALL_ENTITY}',
            headers={'Authorization': f'Bearer {HA_TOKEN}', 'Accept': 'application/json'},
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if resp.status != 200:
                return {}
            payload = json.loads(resp.read().decode())
            watts = _finite_non_neg(payload.get('state'))
            stamp = payload.get('last_updated') or payload.get('last_changed')
            if watts is None or not isinstance(stamp, str):
                return {}
            return {
                'wallWatts': watts,
                'wallUpdatedAt': stamp,
                'wallSource': f'Home Assistant: {HA_WALL_ENTITY}',
                'wallEntityId': HA_WALL_ENTITY,
                'wallIdleBaselineWatts': _finite_non_neg(WALL_IDLE_WATTS) if WALL_IDLE_WATTS else None,
                'wallSourceIntervalSeconds': WALL_SOURCE_INTERVAL_SECONDS,
            }
    except (OSError, urllib.error.URLError, ValueError):
        return {}


def sample():
    memory = {}
    with open('/proc/meminfo', encoding='utf-8') as stream:
        for line in stream:
            key, value = line.split(':', 1)
            memory[key] = int(value.split()[0]) * 1024
    watts = vram = temp_c = None
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=power.draw,memory.used,temperature.gpu', '--format=csv,noheader,nounits'],
            capture_output=True, text=True, timeout=1, check=True,
        )
        rows = [line.split(',') for line in result.stdout.strip().splitlines()]
        watts = sum(float(row[0]) for row in rows)
        vram = sum(float(row[1]) * 1024 * 1024 for row in rows)
        temps = [_finite_non_neg(row[2]) for row in rows if len(row) > 2]
        valid_temps = [t for t in temps if t is not None]
        temp_c = max(valid_temps) if valid_temps else None
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    payload = {
        'sampledAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': 'host RAM; NVIDIA GPU power/VRAM (1Hz)',
        'scope': 'gpu',
        'sourceIntervalSeconds': 1,
        'ramBytes': memory['MemTotal'] - memory.get('MemAvailable', memory['MemFree']),
        'vramBytes': vram,
        'watts': watts,
        'gpuTemperatureC': temp_c,
    }
    payload.update(sample_wall())
    return payload


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + os.environ['RESOURCE_COLLECTOR_TOKEN']):
            self.send_error(401)
            return
        if self.path != '/metrics':
            self.send_error(404)
            return
        try:
            payload = json.dumps(sample()).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (OSError, KeyError, ValueError):
            self.send_error(503)


if __name__ == '__main__':
    if not os.environ.get('RESOURCE_COLLECTOR_TOKEN'):
        raise SystemExit('Set RESOURCE_COLLECTOR_TOKEN before starting the collector')
    ThreadingHTTPServer((os.environ.get('RESOURCE_COLLECTOR_BIND', '127.0.0.1'), int(os.environ.get('RESOURCE_COLLECTOR_PORT', '9109'))), Handler).serve_forever()
