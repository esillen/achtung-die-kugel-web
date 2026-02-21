export const PLAYER_COLORS = [0xff3b30, 0x34c759, 0x0a84ff, 0xffd60a];

export const CONTROL_SCHEMES = [
  { label: "P1", left: "ArrowLeft", right: "ArrowRight", dash: "ArrowUp" },
  { label: "P2", left: "KeyA", right: "KeyD", dash: "KeyW" },
  { label: "P3", left: "KeyJ", right: "KeyL", dash: "KeyI" },
  { label: "P4", left: "KeyF", right: "KeyH", dash: "KeyT" },
];

export const GAMEPAD = {
  LEFT_TRIGGER: 6,
  RIGHT_TRIGGER: 7,
  JUMP_BUTTON: 0,
  PRESS_THRESHOLD: 0.5,
};

export const GAME_CONFIG = {
  worldRadius: 24,
  speed: 9,
  turnRate: 2.05,
  bodyRadius: 0.36,
  headRadius: 0.62,
  collisionRadius: 0.62,
  safeTailIgnoreCount: 18,
  cameraDistance: 10.2,
  cameraHeight: 6.8,
  gapIntervalMin: 1.3,
  gapIntervalMax: 2.9,
  gapDurationMin: 0.16,
  gapDurationMax: 0.31,
  botSimSteps: 22,
  botSimDt: 0.12,
  fadeDuration: 2,
  spawnGraceDuration: 2,
  scorePerHit: 1,
  dashCooldown: 5,
  dashDistance: 5.4,
  dashGapDuration: 0.34,
  dashScreenFlash: 0.16,
};

export const MENU_DEFAULTS = {
  humans: 2,
  bots: 0,
  continuous: false,
  jumpMode: false,
};

export const MENU_SETTINGS_STORAGE_KEY = "achtung-die-kugel.menu-settings.v1";
