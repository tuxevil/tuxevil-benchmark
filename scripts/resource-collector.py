#!/usr/bin/env python3
"""Read-only telemetry on the inference host; requires RESOURCE_COLLECTOR_TOKEN.
RAM is host used RAM excluding cache; watts/VRAM are total NVIDIA GPU readings,
not wall-socket power or model-exclusive usage. Unsupported values remain null.
"""
import hmac
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def sample():
    memory = {}
    with open('/proc/meminfo', encoding='utf-8') as stream:
        for line in stream:
            key, value = line.split(':', 1)
            memory[key] = int(value.split()[0]) * 1024
    watts = vram = None
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=power.draw,memory.used', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=1, check=True)
        rows = [line.split(',') for line in result.stdout.strip().splitlines()]
        watts = sum(float(row[0]) for row in rows)
        vram = sum(float(row[1]) * 1024 * 1024 for row in rows)
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return {'source': 'host RAM; NVIDIA GPU power/VRAM', 'scope': 'gpu',
            'ramBytes': memory['MemTotal'] - memory.get('MemAvailable', memory['MemFree']),
            'vramBytes': vram, 'watts': watts}


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
