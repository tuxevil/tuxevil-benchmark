import { expect, it } from "vitest";
import type { TurnResult } from "@/lib/contracts";
import { createSimulatedDevice, gradeSimulatedDevice, runSimulatedDeviceTool } from "@/lib/stateful-tool-sandbox";

it("starts each sample with fresh state and rejects extra keys", () => {
  const device = createSimulatedDevice();
  expect(runSimulatedDeviceTool(device, "set_wifi", { enabled: false, bluetoothEnabled: false }))
    .toEqual({ ok: false, error: "INVALID_ARGUMENTS" });
  expect(device).toEqual({ wifiEnabled: true, bluetoothEnabled: true });
  expect(runSimulatedDeviceTool(device, "set_wifi", '{"enabled":false}'))
    .toEqual({ ok: true, state: { wifiEnabled: false, bluetoothEnabled: true } });
  expect(createSimulatedDevice()).toEqual({ wifiEnabled: true, bluetoothEnabled: true });
});

it("scores a written claim or undispatched mutation as a failure", () => {
  const turn: TurnResult = {
    id: "synthetic", stepOrder: 1, userMessage: "", responseText: "Wi-Fi desactivado.",
    thinking: null, ttftMs: null, inputTokens: null, outputTokens: null, tokPerSec: null,
    totalDurationMs: null, toolCalls: [{ function: { name: "set_wifi", arguments: { enabled: false } } }],
  };
  expect(gradeSimulatedDevice([turn])).toMatchObject({
    passed: false,
    details: { actions: 0, stateGoalReached: false, finalState: { wifiEnabled: true, bluetoothEnabled: true } },
  });
});
