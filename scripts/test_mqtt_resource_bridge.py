import importlib.util
import unittest
from pathlib import Path
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('bridge', Path(__file__).with_name('mqtt-resource-bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
class TelemetryTests(unittest.TestCase):
    def test_fresh_gpu_and_process(self):
        now = 1800000000
        stamp = datetime.fromtimestamp(now, timezone.utc).isoformat()
        cache = {bridge.GPU_TOPIC: {'actualizado': stamp, 'power_watts': 120, 'memory_used_mb': 200, 'temperature_c': 72, 'thermal_throttling_active': True, 'thermal_slowdown_hw_seconds': 3.5}, bridge.PROCESS_TOPIC: {'actualizado': stamp, 'procesos_cpu': [{'proceso': 'llama-server', 'memoria_rss_mb': 100}]}}
        result = bridge.normalize(cache, now)
        self.assertEqual(result['watts'], 120)
        self.assertEqual(result['gpuTemperatureC'], 72)
        self.assertTrue(result['thermalThrottlingActive'])
        self.assertEqual(result['thermalHwSeconds'], 3.5)
        self.assertEqual(result['ramBytes'], 100 * 1024 * 1024)
        self.assertEqual(result['vramBytes'], 200 * 1024 * 1024)
        self.assertIsNone(bridge.normalize(cache, now+100)['watts'])
        self.assertIsNone(bridge.normalize(cache, now+100)['gpuTemperatureC'])
        self.assertIsNone(bridge.normalize(cache, now+100)['thermalThrottlingActive'])
    def test_missing_process_is_unknown(self):
        self.assertIsNone(bridge.normalize({}, 1800000000)['ramBytes'])
    def test_disconnect_is_not_infinite_read(self):
        class Socket:
            def recv(self, _): return b''
        with self.assertRaises(EOFError): bridge.read_exact(Socket(), 10)
if __name__ == '__main__': unittest.main()
