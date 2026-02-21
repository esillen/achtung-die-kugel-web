import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { GAMEPAD } from "./GAMEPLAY_CONSTANTS.js";

class InputManager {
  constructor() {
    this.down = new Set();
    this.justPressed = new Set();
    this.gamepadPrevButtonValues = new Map();

    window.addEventListener("keydown", (event) => {
      if (!this.down.has(event.code)) {
        this.justPressed.add(event.code);
      }
      this.down.add(event.code);

      const block = [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Backspace",
        "Space",
        "Digit0",
        "Digit1",
        "Digit2",
        "Digit3",
        "Digit4",
        "Numpad0",
        "Numpad1",
        "Numpad2",
        "Numpad3",
        "Numpad4",
      ];

      if (block.includes(event.code)) {
        event.preventDefault();
      }
    });

    window.addEventListener("keyup", (event) => {
      this.down.delete(event.code);
    });

    this.snapshotGamepadButtons();
  }

  isDown(code) {
    return this.down.has(code);
  }

  consumePress(code) {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }

  getGamepad(index) {
    if (!navigator.getGamepads) {
      return null;
    }
    const pads = navigator.getGamepads();
    if (!pads || !pads[index]) {
      return null;
    }
    return pads[index];
  }

  getGamepadButtonValue(gamepadIndex, buttonIndex) {
    const gamepad = this.getGamepad(gamepadIndex);
    if (!gamepad || !gamepad.buttons || !gamepad.buttons[buttonIndex]) {
      return 0;
    }
    return THREE.MathUtils.clamp(gamepad.buttons[buttonIndex].value ?? 0, 0, 1);
  }

  getGamepadTurn(gamepadIndex) {
    const left = this.getGamepadButtonValue(gamepadIndex, GAMEPAD.LEFT_TRIGGER);
    const right = this.getGamepadButtonValue(gamepadIndex, GAMEPAD.RIGHT_TRIGGER);
    return THREE.MathUtils.clamp(left - right, -1, 1);
  }

  consumeGamepadButtonPress(gamepadIndex, buttonIndex, threshold = GAMEPAD.PRESS_THRESHOLD) {
    const key = `${gamepadIndex}:${buttonIndex}`;
    const current = this.getGamepadButtonValue(gamepadIndex, buttonIndex);
    const prev = this.gamepadPrevButtonValues.get(key) ?? 0;
    return current >= threshold && prev < threshold;
  }

  snapshotGamepadButtons() {
    this.gamepadPrevButtonValues.clear();
    if (!navigator.getGamepads) {
      return;
    }

    const pads = navigator.getGamepads();
    if (!pads) {
      return;
    }

    for (let gamepadIndex = 0; gamepadIndex < pads.length; gamepadIndex += 1) {
      const pad = pads[gamepadIndex];
      if (!pad || !pad.buttons) {
        continue;
      }
      for (let buttonIndex = 0; buttonIndex < pad.buttons.length; buttonIndex += 1) {
        const value = THREE.MathUtils.clamp(pad.buttons[buttonIndex]?.value ?? 0, 0, 1);
        this.gamepadPrevButtonValues.set(`${gamepadIndex}:${buttonIndex}`, value);
      }
    }
  }

  endFrame() {
    this.justPressed.clear();
    this.snapshotGamepadButtons();
  }
}


export default InputManager;
