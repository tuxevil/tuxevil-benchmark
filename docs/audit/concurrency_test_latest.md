# Test rápido de concurrencia y VRAM por slots — unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL

Fecha: 2026-11-28T00:00:32.849Z

- **GPU:** Quadro RTX 4000 (8 GiB)
- **Parámetros de prueba:** `enable_thinking: false`, `temperature: 0`, `max_tokens: 160`, prompts únicos por petición (sin caché compartida).
- **Restauración final:** no restaurado

## 1. Uso de VRAM y capacidad por configuración de slots

| Slots pedidos | Slots reales | KV cache | Contexto total | Contexto/slot aprox | Capas GPU | Pesos GPU | VRAM idle | VRAM libre | Warning / Error |
|---:|---:|:---:|---:|---:|:---:|---:|---:|---:|---|
| 8 | **8** | auto | 131,072 | 16,384 | 36/36 | 1.45 GiB | 4.90 GiB | 3.10 GiB | OK |

## 2. Throughput y latencia por ráfaga concurrente

| Perfil (slots / KV) | Concurrencia (N) | OK | Throughput total | Decode medio / req | Decode mín / req | TTFT p50 | TTFT p95 | Wall-clock | VRAM pico | GPU W / °C |
|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 slots (auto) | 1 | 1/1 | **122.98 tok/s** | 128.72 tok/s | 128.72 tok/s | 58 ms | 58 ms | 1.30 s | 4.90 GiB | 36.7 W / 35 °C |
| 8 slots (auto) | 4 | 4/4 | **312.04 tok/s** | 83.98 tok/s | 81.22 tok/s | 110 ms | 141 ms | 2.05 s | 4.90 GiB | 36.7 W / 35 °C |
| 8 slots (auto) | 8 | 8/8 | **423.7 tok/s** | 59.07 tok/s | 56.44 tok/s | 180 ms | 300 ms | 3.02 s | 4.90 GiB | 36.7 W / 35 °C |
| 8 slots (auto) | 12 | 12/12 | **391.43 tok/s** | 67.78 tok/s | 55.94 tok/s | 219 ms | 2984 ms | 4.90 s | 5.05 GiB | 98.4 W / 44 °C |
