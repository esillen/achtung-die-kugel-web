import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

const GAME_STATE = {
  MENU_PLAYERS: "menu_players",
  MENU_BOTS: "menu_bots",
  MENU_MODE: "menu_mode",
  MENU_JUMP: "menu_jump",
  RUNNING: "running",
  ROUND_OVER: "round_over",
  MATCH_OVER: "match_over",
};

const PLAYER_STATUS = {
  ACTIVE: "active",
  OUT: "out",
  RESPAWNING: "respawning",
};

const PLAYER_COLORS = [0xff3b30, 0x34c759, 0x0a84ff, 0xffd60a];
const CONTROL_SCHEMES = [
  { label: "P1", left: "ArrowLeft", right: "ArrowRight", dash: "ArrowUp" },
  { label: "P2", left: "KeyA", right: "KeyD", dash: "KeyW" },
  { label: "P3", left: "KeyJ", right: "KeyL", dash: "KeyI" },
  { label: "P4", left: "KeyF", right: "KeyH", dash: "KeyT" },
];
const GAMEPAD_LEFT_TRIGGER = 6;
const GAMEPAD_RIGHT_TRIGGER = 7;
const GAMEPAD_A_BUTTON = 0;
const GAMEPAD_PRESS_THRESHOLD = 0.5;

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
    const left = this.getGamepadButtonValue(gamepadIndex, GAMEPAD_LEFT_TRIGGER);
    const right = this.getGamepadButtonValue(gamepadIndex, GAMEPAD_RIGHT_TRIGGER);
    return THREE.MathUtils.clamp(left - right, -1, 1);
  }

  consumeGamepadButtonPress(gamepadIndex, buttonIndex, threshold = GAMEPAD_PRESS_THRESHOLD) {
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

class SnakeTrail {
  constructor(scene, color, config) {
    this.scene = scene;
    this.config = config;
    this.baseColor = color;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });

    this.meshSegments = [];
    this.currentMesh = null;
    this.currentPoints = [];
    this.solidPoints = [];
    this.lastPlacedPoint = null;
    this.sampleSpacing = config.bodyRadius * 0.9;

    this.inGap = false;
    this.timeToNextGap = this.rand(config.gapIntervalMin, config.gapIntervalMax);
    this.gapRemaining = 0;
  }

  reset() {
    for (const mesh of this.meshSegments) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }

    this.meshSegments.length = 0;
    this.currentMesh = null;
    this.currentPoints.length = 0;
    this.solidPoints.length = 0;
    this.lastPlacedPoint = null;

    this.inGap = false;
    this.timeToNextGap = this.rand(this.config.gapIntervalMin, this.config.gapIntervalMax);
    this.gapRemaining = 0;

    this.material.color.setHex(this.baseColor);
    this.material.opacity = 1;
    this.root.visible = true;
  }

  addPoint(point, dt) {
    if (this.inGap) {
      this.lastPlacedPoint = point.clone();
      this.gapRemaining -= dt;
      if (this.gapRemaining <= 0) {
        this.inGap = false;
        this.currentMesh = null;
        this.currentPoints.length = 0;
      }
      return;
    }

    this.timeToNextGap -= dt;
    if (this.timeToNextGap <= 0) {
      this.inGap = true;
      this.gapRemaining = this.rand(this.config.gapDurationMin, this.config.gapDurationMax);
      this.timeToNextGap = this.rand(this.config.gapIntervalMin, this.config.gapIntervalMax);
      this.currentMesh = null;
      this.currentPoints.length = 0;
      this.lastPlacedPoint = point.clone();
      return;
    }

    if (!this.lastPlacedPoint) {
      this.pushSolidPoint(point.clone());
      this.lastPlacedPoint = point.clone();
      return;
    }

    const delta = point.clone().sub(this.lastPlacedPoint);
    const distance = delta.length();
    if (distance < this.sampleSpacing) {
      return;
    }

    delta.normalize();
    let traveled = this.sampleSpacing;
    while (traveled <= distance) {
      const sample = this.lastPlacedPoint.clone().addScaledVector(delta, traveled);
      sample.normalize().multiplyScalar(this.config.worldRadius + this.config.headRadius);
      this.pushSolidPoint(sample);
      traveled += this.sampleSpacing;
    }
    this.lastPlacedPoint.copy(point);
  }

  pushSolidPoint(point) {
    this.currentPoints.push(point.clone());

    if (this.currentPoints.length < 2) {
      this.solidPoints.push(point.clone());
      return;
    }

    const tubeSegments = Math.max(10, this.currentPoints.length * 2);
    const geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(this.currentPoints),
      tubeSegments,
      this.config.bodyRadius,
      8,
      false,
    );

    if (!this.currentMesh) {
      this.currentMesh = new THREE.Mesh(geometry, this.material);
      this.root.add(this.currentMesh);
      this.meshSegments.push(this.currentMesh);
    } else {
      this.currentMesh.geometry.dispose();
      this.currentMesh.geometry = geometry;
    }

    this.solidPoints.push(point.clone());
  }

  setFade(progress) {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    this.material.color.setHex(0xd9d9d9);
    this.material.opacity = 1 - p;
  }

  hide() {
    this.root.visible = false;
  }

  show() {
    this.root.visible = true;
  }

  forceGap(duration, referencePoint) {
    this.inGap = true;
    this.gapRemaining = Math.max(this.gapRemaining, duration);
    this.currentMesh = null;
    this.currentPoints.length = 0;
    if (referencePoint) {
      this.lastPlacedPoint = referencePoint.clone();
    }
  }

  dispose() {
    this.reset();
    this.material.dispose();
    this.scene.remove(this.root);
  }

  rand(min, max) {
    return min + Math.random() * (max - min);
  }
}

class BotBrain {
  constructor(config) {
    this.config = config;
  }

  decide(player, players, predictedHeads) {
    const candidates = [-1, 0, 1];
    let bestTurn = 0;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const score = this.scoreCandidate(player, candidate, players, predictedHeads);
      if (score > bestScore) {
        bestScore = score;
        bestTurn = candidate;
      }
    }

    return bestTurn;
  }

  scoreCandidate(player, turn, players, predictedHeads) {
    const sim = {
      pos: player.pos.clone(),
      up: player.up.clone(),
      forward: player.forward.clone(),
      right: player.right.clone(),
    };

    const simDt = this.config.botSimDt;
    let minDist = 99999;

    for (let step = 0; step < this.config.botSimSteps; step += 1) {
      advanceOnSphere(sim, turn, simDt, this.config.turnRate, this.config.speed, this.config.worldRadius, this.config.headRadius);

      if (hitsAnyTrail(sim.pos, players, this.config, player, true)) {
        return -10000 + step * 25;
      }

      for (const other of players) {
        if (other.id === player.id || other.status !== PLAYER_STATUS.ACTIVE) {
          continue;
        }
        const predicted = predictedHeads.get(other.id);
        if (!predicted || !predicted[step]) {
          continue;
        }
        minDist = Math.min(minDist, sim.pos.distanceTo(predicted[step]));
      }
    }

    return minDist * 6 + this.localSafety(player, turn, players) * 4;
  }

  localSafety(player, turn, players) {
    const sim = {
      pos: player.pos.clone(),
      up: player.up.clone(),
      forward: player.forward.clone(),
      right: player.right.clone(),
    };

    for (let step = 0; step < 10; step += 1) {
      advanceOnSphere(sim, turn, 0.08, this.config.turnRate, this.config.speed, this.config.worldRadius, this.config.headRadius);
      if (hitsAnyTrail(sim.pos, players, this.config, player, true)) {
        return step - 10;
      }
    }

    return 10;
  }
}

function advanceOnSphere(state, turn, dt, turnRate, speed, worldRadius, headRadius) {
  const yaw = new THREE.Quaternion().setFromAxisAngle(state.up, turn * turnRate * dt);
  state.forward.applyQuaternion(yaw).normalize();

  const moved = state.pos.clone().addScaledVector(state.forward, speed * dt);
  const radial = moved.clone().normalize();
  state.pos.copy(radial.multiplyScalar(worldRadius + headRadius));

  const nextUp = state.pos.clone().normalize();
  state.forward.projectOnPlane(nextUp).normalize();

  if (state.forward.lengthSq() < 1e-5) {
    state.forward.copy(state.right).projectOnPlane(nextUp).normalize();
  }

  state.up.copy(nextUp);
  state.right.crossVectors(state.forward, state.up).normalize();
  state.forward.crossVectors(state.up, state.right).normalize();
}

function hitsAnyTrail(point, players, config, selfPlayer, includeOthers) {
  const r2 = config.collisionRadius * config.collisionRadius;

  for (const player of players) {
    if (!player.trailCollidable) {
      continue;
    }

    if (!includeOthers && player.id !== selfPlayer.id) {
      continue;
    }

    const pts = player.trail.solidPoints;
    const ownTailIgnore = player.id === selfPlayer.id ? config.safeTailIgnoreCount : 0;
    const end = Math.max(0, pts.length - ownTailIgnore);

    for (let i = 0; i < end; i += 2) {
      if (point.distanceToSquared(pts[i]) <= r2) {
        return true;
      }
    }
  }

  return false;
}

class SphereSnakeGame {
  constructor(canvas, overlay, subtitle, hint, viewportLabels) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.subtitle = subtitle;
    this.hint = hint;
    this.viewportLabels = viewportLabels;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04070d);

    this.spectatorCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.spectatorCenter = new THREE.Vector3(0, this.config?.worldRadius || 24, 0);

    this.clock = new THREE.Clock();
    this.input = new InputManager();

    this.config = {
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
      scorePerHit: 1,
      dashCooldown: 5,
      dashDistance: 5.4,
      dashGapDuration: 0.34,
      dashScreenFlash: 0.16,
    };

    this.menu = {
      humans: 2,
      bots: 0,
      continuous: false,
      jumpMode: false,
    };

    this.state = GAME_STATE.MENU_PLAYERS;
    this.players = [];
    this.botBrain = new BotBrain(this.config);
    this.matchWinnerId = null;
    this.celebration = null;

    this.initWorld();
    this.initCelebrationSystem();
    this.initDashEffects();
    this.syncOverlay();

    window.addEventListener("resize", () => this.onResize());
  }

  initWorld() {
    const world = new THREE.Mesh(
      new THREE.SphereGeometry(this.config.worldRadius, 52, 52),
      new THREE.MeshBasicMaterial({
        color: 0x294569,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.scene.add(world);

    const grid = new THREE.Mesh(
      new THREE.SphereGeometry(this.config.worldRadius + 0.03, 30, 30),
      new THREE.MeshBasicMaterial({ color: 0x3a5f8d, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    this.scene.add(grid);
  }

  initCelebrationSystem() {
    this.celebrationGroup = new THREE.Group();
    this.scene.add(this.celebrationGroup);

    this.crownGroup = new THREE.Group();
    this.celebrationGroup.add(this.crownGroup);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.25, 16, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd54f }),
    );
    ring.rotation.x = Math.PI / 2;
    this.crownGroup.add(ring);

    for (let i = 0; i < 8; i += 1) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.7, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc107 }),
      );
      const a = (i / 8) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 1.1, 0.45, Math.sin(a) * 1.1);
      spike.lookAt(0, 1.1, 0);
      this.crownGroup.add(spike);
    }

    this.sparkPool = [];
    const sparkColors = [0xfff176, 0xff8a65, 0x4fc3f7, 0xce93d8];
    for (let i = 0; i < 240; i += 1) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.09 + Math.random() * 0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color: sparkColors[i % sparkColors.length], transparent: true, opacity: 0 }),
      );
      spark.visible = false;
      this.celebrationGroup.add(spark);
      this.sparkPool.push({ mesh: spark, velocity: new THREE.Vector3(), life: 0, maxLife: 0 });
    }

    this.celebrationGroup.visible = false;
  }

  initDashEffects() {
    this.dashEffectPool = [];
    for (let i = 0; i < 80; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.dashEffectPool.push({ mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 0 });
    }
  }

  createPlayers() {
    for (const player of this.players) {
      player.trail.dispose();
      this.scene.remove(player.headMesh);
    }
    this.players.length = 0;

    const humans = this.menu.humans;
    const bots = this.menu.bots;
    const total = humans + bots;

    for (let i = 0; i < total; i += 1) {
      const isBot = i >= humans;
      const color = PLAYER_COLORS[i];

      const trail = new SnakeTrail(this.scene, color, this.config);
      const headMesh = new THREE.Mesh(
        new THREE.SphereGeometry(this.config.headRadius, 16, 16),
        new THREE.MeshBasicMaterial({ color }),
      );
      this.scene.add(headMesh);

      const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);

      this.players.push({
        id: i,
        name: `P${i + 1}`,
        score: 0,
        isBot,
        color,
        control: !isBot ? CONTROL_SCHEMES[i] : null,
        camera,
        headMesh,
        trail,
        trailCollidable: true,
        status: PLAYER_STATUS.ACTIVE,
        respawnTimer: 0,
        turnInput: 0,
        dashCooldown: this.config.dashCooldown,
        dashRequested: false,
        dashFlashTimer: 0,
        pos: new THREE.Vector3(),
        up: new THREE.Vector3(),
        forward: new THREE.Vector3(),
        right: new THREE.Vector3(),
      });
    }

    this.resetRound();
    this.refreshViewportLabels();
  }

  spawnPlayer(player, angleHint = null) {
    const attempts = 18;

    for (let i = 0; i < attempts; i += 1) {
      const angle = angleHint !== null && i === 0 ? angleHint : Math.random() * Math.PI * 2;
      const up = new THREE.Vector3(Math.cos(angle), 0.26 + (Math.random() - 0.5) * 0.15, Math.sin(angle)).normalize();
      const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();

      const pos = up.clone().multiplyScalar(this.config.worldRadius + this.config.headRadius);
      if (!hitsAnyTrail(pos, this.players, this.config, player, true)) {
        player.up.copy(up);
        player.pos.copy(pos);
        player.forward.copy(tangent).projectOnPlane(player.up).normalize();
        player.right.crossVectors(player.forward, player.up).normalize();
        break;
      }
    }

    player.headMesh.visible = true;
    player.headMesh.position.copy(player.pos);
    player.trail.show();
    player.trail.material.color.setHex(player.color);
    player.trail.material.opacity = 1;
    player.trailCollidable = true;
    player.status = PLAYER_STATUS.ACTIVE;
    player.respawnTimer = 0;
    player.turnInput = 0;
    player.dashCooldown = this.config.dashCooldown;
    player.dashRequested = false;
    player.dashFlashTimer = 0;
    this.updateCamera(player);
  }

  resetRound() {
    const count = this.players.length;

    for (let i = 0; i < count; i += 1) {
      const player = this.players[i];
      player.trail.reset();
      const angle = (i / Math.max(1, count)) * Math.PI * 2;
      this.spawnPlayer(player, angle);
    }

    this.updateViewportLabels();
  }

  syncOverlay() {
    this.overlay.classList.remove("hidden");
    const controls = this.getTitleControlsText();

    if (this.state === GAME_STATE.MENU_PLAYERS) {
      this.subtitle.textContent = `Choose human players (1-4): ${this.menu.humans}`;
      this.hint.textContent = `Press 1-4 to choose humans.\nPress Space to choose bots.\n\n${controls}`;
      return;
    }

    if (this.state === GAME_STATE.MENU_BOTS) {
      const maxBots = 4 - this.menu.humans;
      this.subtitle.textContent = `Choose bots (0-${maxBots}): ${this.menu.bots}`;
      this.hint.textContent = `Press number keys for bots.\nPress Space to choose mode.\n\n${controls}`;
      return;
    }

    if (this.state === GAME_STATE.MENU_MODE) {
      this.subtitle.textContent = `Mode: ${this.menu.continuous ? "Continuous" : "Normal"}`;
      this.hint.textContent = `Press 0 for Normal, 1 for Continuous.\nPress Space to choose jump mode.\n\n${controls}`;
      return;
    }

    if (this.state === GAME_STATE.MENU_JUMP) {
      this.subtitle.textContent = `Jump Mode: ${this.menu.jumpMode ? "On" : "Off"}`;
      this.hint.textContent =
        `Press 0 for no jump mode, 1 for jump mode.\nPress Space to start.\nDash keys: P1 UpArrow, P2 W, P3 I, P4 T.\n\n${controls}`;
      return;
    }

    if (this.state === GAME_STATE.ROUND_OVER) {
      this.subtitle.textContent = "Round Over";
      this.hint.textContent = "Press Space for next round.";
      return;
    }

    if (this.state === GAME_STATE.MATCH_OVER) {
      const winner = this.players.find((p) => p.id === this.matchWinnerId);
      const lines = this.players
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((p, index) => `${index === 0 ? "CROWN " : ""}${p.name}: ${p.score}`)
        .join("\n");
      this.subtitle.textContent = `Match Over - ${winner ? winner.name : "Winner"}`;
      this.hint.textContent = `${lines}\n\nPress Space for new match.`;
    }
  }

  getTitleControlsText() {
    const humanCount = THREE.MathUtils.clamp(this.menu.humans, 1, CONTROL_SCHEMES.length);
    const lines = [];
    for (let i = 0; i < humanCount; i += 1) {
      const control = CONTROL_SCHEMES[i];
      lines.push(
        `${control.label}: Keyboard ${this.codeLabel(control.left)}/${this.codeLabel(control.right)} steer, ${this.codeLabel(control.dash)} jump | Gamepad ${
          i + 1
        }: LT/RT steer (analog), A jump`,
      );
    }
    return lines.join("\n");
  }

  codeLabel(code) {
    const map = {
      ArrowLeft: "Left",
      ArrowRight: "Right",
      ArrowUp: "Up",
      KeyA: "A",
      KeyD: "D",
      KeyW: "W",
      KeyJ: "J",
      KeyL: "L",
      KeyI: "I",
      KeyF: "F",
      KeyH: "H",
      KeyT: "T",
    };
    return map[code] || code;
  }

  targetScore() {
    return Math.max(1, (this.players.length - 1) * 10);
  }

  startMatch() {
    this.createPlayers();
    this.stopCelebration();
    this.state = GAME_STATE.RUNNING;
    this.overlay.classList.add("hidden");
    this.clock.getDelta();
  }

  startNextRound() {
    this.resetRound();
    this.state = GAME_STATE.RUNNING;
    this.overlay.classList.add("hidden");
    this.clock.getDelta();
  }

  updateMenu() {
    if (this.state === GAME_STATE.MENU_PLAYERS) {
      const selected = this.readNumberKey(1, 4);
      if (selected !== null) {
        this.menu.humans = selected;
        this.menu.bots = Math.min(this.menu.bots, 4 - selected);
        this.syncOverlay();
      }
    }

    if (this.state === GAME_STATE.MENU_BOTS) {
      const maxBots = 4 - this.menu.humans;
      const selected = this.readNumberKey(0, maxBots);
      if (selected !== null) {
        this.menu.bots = selected;
        this.syncOverlay();
      }
    }

    if (this.state === GAME_STATE.MENU_MODE) {
      if (this.input.consumePress("Digit0") || this.input.consumePress("Numpad0")) {
        this.menu.continuous = false;
        this.syncOverlay();
      }
      if (this.input.consumePress("Digit1") || this.input.consumePress("Numpad1")) {
        this.menu.continuous = true;
        this.syncOverlay();
      }
    }

    if (this.state === GAME_STATE.MENU_JUMP) {
      if (this.input.consumePress("Digit0") || this.input.consumePress("Numpad0")) {
        this.menu.jumpMode = false;
        this.syncOverlay();
      }
      if (this.input.consumePress("Digit1") || this.input.consumePress("Numpad1")) {
        this.menu.jumpMode = true;
        this.syncOverlay();
      }
    }

    if (!this.input.consumePress("Space")) {
      return;
    }

    if (this.state === GAME_STATE.MENU_PLAYERS) {
      this.state = GAME_STATE.MENU_BOTS;
      this.syncOverlay();
      return;
    }

    if (this.state === GAME_STATE.MENU_BOTS) {
      this.state = GAME_STATE.MENU_MODE;
      this.syncOverlay();
      return;
    }

    if (this.state === GAME_STATE.MENU_MODE) {
      this.state = GAME_STATE.MENU_JUMP;
      this.syncOverlay();
      return;
    }

    if (this.state === GAME_STATE.MENU_JUMP) {
      this.startMatch();
      return;
    }

    if (this.state === GAME_STATE.ROUND_OVER) {
      this.startNextRound();
      return;
    }

    if (this.state === GAME_STATE.MATCH_OVER) {
      this.matchWinnerId = null;
      this.stopCelebration();
      this.state = GAME_STATE.MENU_PLAYERS;
      this.syncOverlay();
    }
  }

  readNumberKey(min, max) {
    const keyMap = [
      ["Digit0", 0],
      ["Digit1", 1],
      ["Digit2", 2],
      ["Digit3", 3],
      ["Digit4", 4],
      ["Numpad0", 0],
      ["Numpad1", 1],
      ["Numpad2", 2],
      ["Numpad3", 3],
      ["Numpad4", 4],
    ];

    for (const [code, value] of keyMap) {
      if (value >= min && value <= max && this.input.consumePress(code)) {
        return value;
      }
    }

    return null;
  }

  updateRunning(dt) {
    this.updateRespawningPlayers(dt);
    this.updateDashEffects(dt);

    for (const player of this.players) {
      player.dashFlashTimer = Math.max(0, player.dashFlashTimer - dt);
    }

    const activePlayers = this.players.filter((p) => p.status === PLAYER_STATUS.ACTIVE);

    for (const player of activePlayers) {
      player.dashCooldown = Math.max(0, player.dashCooldown - dt);
      player.dashRequested = false;

      if (!player.isBot) {
        const left = this.input.isDown(player.control.left);
        const right = this.input.isDown(player.control.right);
        const keyboardTurn = left && !right ? 1 : right && !left ? -1 : 0;
        const gamepadTurn = this.input.getGamepadTurn(player.id);
        player.turnInput = THREE.MathUtils.clamp(keyboardTurn + gamepadTurn, -1, 1);

        const gamepadJumpPressed = this.input.consumeGamepadButtonPress(player.id, GAMEPAD_A_BUTTON);
        const keyboardJumpPressed = this.input.consumePress(player.control.dash);
        if (this.menu.jumpMode && (keyboardJumpPressed || gamepadJumpPressed)) {
          player.dashRequested = true;
        }
      }
    }

    const predictedHeads = this.predictHeads(activePlayers);

    for (const player of activePlayers) {
      if (player.isBot) {
        player.turnInput = this.botBrain.decide(player, this.players, predictedHeads);
        if (this.menu.jumpMode && player.dashCooldown <= 0 && this.shouldBotDash(player)) {
          player.dashRequested = true;
        }
      }
    }

    for (const player of activePlayers) {
      advanceOnSphere(
        player,
        player.turnInput,
        dt,
        this.config.turnRate,
        this.config.speed,
        this.config.worldRadius,
        this.config.headRadius,
      );
      player.headMesh.position.copy(player.pos);
      player.trail.addPoint(player.pos, dt);

      if (this.menu.jumpMode && player.dashRequested && player.dashCooldown <= 0) {
        this.performDash(player);
      }
    }

    const crashed = [];
    for (const player of activePlayers) {
      if (hitsAnyTrail(player.pos, this.players, this.config, player, true)) {
        crashed.push(player);
      }
    }

    for (const player of crashed) {
      if (player.status !== PLAYER_STATUS.ACTIVE) {
        continue;
      }
      this.handleCrash(player);
    }

    for (const player of this.players) {
      if (player.status === PLAYER_STATUS.ACTIVE) {
        this.updateCamera(player);
      }
    }

    this.updateViewportLabels();
  }

  shouldBotDash(player) {
    const checkState = {
      pos: player.pos.clone(),
      up: player.up.clone(),
      forward: player.forward.clone(),
      right: player.right.clone(),
    };

    let dangerSoon = false;
    for (let i = 0; i < 8; i += 1) {
      advanceOnSphere(
        checkState,
        player.turnInput,
        0.08,
        this.config.turnRate,
        this.config.speed,
        this.config.worldRadius,
        this.config.headRadius,
      );
      if (hitsAnyTrail(checkState.pos, this.players, this.config, player, true)) {
        dangerSoon = true;
        break;
      }
    }

    if (!dangerSoon) {
      return false;
    }

    const dashState = {
      pos: player.pos.clone(),
      up: player.up.clone(),
      forward: player.forward.clone(),
      right: player.right.clone(),
    };

    advanceOnSphere(
      dashState,
      player.turnInput,
      this.config.dashDistance / this.config.speed,
      this.config.turnRate,
      this.config.speed,
      this.config.worldRadius,
      this.config.headRadius,
    );

    return !hitsAnyTrail(dashState.pos, this.players, this.config, player, true);
  }

  performDash(player) {
    const dashDt = this.config.dashDistance / this.config.speed;
    advanceOnSphere(
      player,
      player.turnInput,
      dashDt,
      this.config.turnRate,
      this.config.speed,
      this.config.worldRadius,
      this.config.headRadius,
    );

    player.headMesh.position.copy(player.pos);
    player.trail.forceGap(this.config.dashGapDuration, player.pos);
    player.dashCooldown = this.config.dashCooldown;
    player.dashFlashTimer = this.config.dashScreenFlash;

    this.spawnDashBurst(player);
  }

  handleCrash(player) {
    const survivors = this.players.filter((p) => p.status === PLAYER_STATUS.ACTIVE && p.id !== player.id);
    for (const survivor of survivors) {
      survivor.score += this.config.scorePerHit;
    }

    if (this.menu.continuous) {
      this.beginFadeRespawn(player);
      this.updateViewportLabels();
      const winner = this.players.find((p) => p.score >= this.targetScore());
      if (winner) {
        this.endMatch(winner);
      }
      return;
    }

    player.status = PLAYER_STATUS.OUT;
    player.headMesh.visible = false;
    player.turnInput = 0;

    const activeLeft = this.players.filter((p) => p.status === PLAYER_STATUS.ACTIVE).length;
    if (activeLeft <= 1) {
      const winner = this.players.find((p) => p.score >= this.targetScore());
      if (winner) {
        this.endMatch(winner);
      } else {
        this.state = GAME_STATE.ROUND_OVER;
        this.syncOverlay();
      }
    }
  }

  beginFadeRespawn(player) {
    player.status = PLAYER_STATUS.RESPAWNING;
    player.respawnTimer = this.config.fadeDuration;
    player.trailCollidable = false;
    player.headMesh.visible = false;
    player.turnInput = 0;
  }

  updateRespawningPlayers(dt) {
    for (const player of this.players) {
      if (player.status !== PLAYER_STATUS.RESPAWNING) {
        continue;
      }

      player.respawnTimer -= dt;
      const progress = 1 - Math.max(0, player.respawnTimer) / this.config.fadeDuration;
      player.trail.setFade(progress);

      if (player.respawnTimer <= 0) {
        player.trail.reset();
        this.spawnPlayer(player);
      }
    }
  }

  spawnDashBurst(player) {
    const origin = player.pos.clone().addScaledVector(player.forward, -0.6);
    const back = player.forward.clone().multiplyScalar(-1);
    const up = player.up.clone();
    const right = player.right.clone();

    for (let i = 0; i < 12; i += 1) {
      const fx = this.dashEffectPool.find((entry) => entry.life >= entry.maxLife || !entry.mesh.visible);
      if (!fx) {
        break;
      }

      const spreadA = (Math.random() - 0.5) * 0.7;
      const spreadB = (Math.random() - 0.5) * 0.7;
      const dir = back
        .clone()
        .addScaledVector(right, spreadA)
        .addScaledVector(up, spreadB)
        .normalize();

      fx.mesh.visible = true;
      fx.mesh.position.copy(origin).addScaledVector(dir, Math.random() * 0.6);
      fx.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      fx.velocity.copy(dir.multiplyScalar(18 + Math.random() * 9));
      fx.life = 0;
      fx.maxLife = 0.14 + Math.random() * 0.12;
      fx.mesh.material.opacity = 0.95;
      fx.mesh.scale.set(1, 0.6 + Math.random() * 0.8, 1);
    }
  }

  updateDashEffects(dt) {
    for (const fx of this.dashEffectPool) {
      if (!fx.mesh.visible) {
        continue;
      }
      fx.life += dt;
      if (fx.life >= fx.maxLife) {
        fx.mesh.visible = false;
        continue;
      }
      fx.mesh.position.addScaledVector(fx.velocity, dt);
      fx.mesh.material.opacity = 1 - fx.life / fx.maxLife;
    }
  }

  predictHeads(activePlayers) {
    const predicted = new Map();

    for (const player of activePlayers) {
      const sim = {
        pos: player.pos.clone(),
        up: player.up.clone(),
        forward: player.forward.clone(),
        right: player.right.clone(),
      };

      const points = [];
      for (let i = 0; i < this.config.botSimSteps; i += 1) {
        advanceOnSphere(
          sim,
          player.turnInput,
          this.config.botSimDt,
          this.config.turnRate,
          this.config.speed,
          this.config.worldRadius,
          this.config.headRadius,
        );
        points.push(sim.pos.clone());
      }

      predicted.set(player.id, points);
    }

    return predicted;
  }

  endMatch(winner) {
    this.matchWinnerId = winner.id;
    this.state = GAME_STATE.MATCH_OVER;
    this.startCelebration(winner);
    this.syncOverlay();
  }

  startCelebration(winner) {
    this.celebrationGroup.visible = true;
    this.celebration = {
      center: winner.pos.clone(),
      time: 0,
    };
    this.spectatorCenter.copy(winner.pos);

    this.crownGroup.position.copy(winner.pos).addScaledVector(winner.up, 1.9);

    for (const spark of this.sparkPool) {
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.1) * 2,
        (Math.random() - 0.5) * 2,
      ).normalize();

      spark.mesh.visible = true;
      spark.mesh.position.copy(this.celebration.center).addScaledVector(dir, Math.random() * 1.2);
      spark.velocity.copy(dir.multiplyScalar(8 + Math.random() * 8));
      spark.life = 0;
      spark.maxLife = 1.2 + Math.random() * 1.6;
      spark.mesh.material.opacity = 1;
    }
  }

  stopCelebration() {
    this.celebrationGroup.visible = false;
    this.celebration = null;
    for (const spark of this.sparkPool) {
      spark.mesh.visible = false;
    }
  }

  updateCelebration(dt) {
    if (!this.celebration) {
      return;
    }

    this.celebration.time += dt;
    const t = this.celebration.time;

    this.crownGroup.position.y = this.celebration.center.y + 2 + Math.sin(t * 3.2) * 0.4;
    this.crownGroup.rotation.y += dt * 1.2;

    for (const spark of this.sparkPool) {
      spark.life += dt;
      if (spark.life >= spark.maxLife) {
        const dir = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.2) * 2,
          (Math.random() - 0.5) * 2,
        ).normalize();
        spark.mesh.position.copy(this.celebration.center).addScaledVector(dir, Math.random() * 0.8);
        spark.velocity.copy(dir.multiplyScalar(7 + Math.random() * 10));
        spark.life = 0;
        spark.maxLife = 1 + Math.random() * 1.8;
        spark.mesh.material.opacity = 1;
      }

      spark.velocity.y -= dt * 4.5;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.mesh.material.opacity = Math.max(0, 1 - spark.life / spark.maxLife);
    }

    const orbitRadius = 14;
    const orbitHeight = 7.5;
    const orbitSpeed = 0.45;
    this.spectatorCamera.position.set(
      this.celebration.center.x + Math.cos(t * orbitSpeed) * orbitRadius,
      this.celebration.center.y + orbitHeight,
      this.celebration.center.z + Math.sin(t * orbitSpeed) * orbitRadius,
    );
    this.spectatorCamera.lookAt(this.celebration.center);
  }

  updateCamera(player) {
    const back = player.forward.clone().multiplyScalar(-this.config.cameraDistance);
    const up = player.up.clone().multiplyScalar(this.config.cameraHeight);
    const desired = player.pos.clone().add(back).add(up);
    player.camera.position.copy(desired);
    player.camera.lookAt(player.pos);
  }

  getViewports() {
    const n = this.players.length;
    if (n <= 1) {
      return [{ x: 0, y: 0, w: 1, h: 1 }];
    }
    if (n === 2) {
      return [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 1 },
      ];
    }

    return [
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    ].slice(0, n);
  }

  refreshViewportLabels() {
    this.viewportLabels.innerHTML = "";

    for (const player of this.players) {
      const el = document.createElement("div");
      el.className = "viewport-label";
      el.style.borderColor = `#${player.color.toString(16).padStart(6, "0")}`;
      this.viewportLabels.appendChild(el);
      player.labelEl = el;

      const dashFlashEl = document.createElement("div");
      dashFlashEl.className = "dash-flash";
      this.viewportLabels.appendChild(dashFlashEl);
      player.dashFlashEl = dashFlashEl;
    }

    this.updateViewportLabels();
  }

  updateViewportLabels() {
    for (const player of this.players) {
      if (!player.labelEl) {
        continue;
      }

      const parts = [player.name];
      if (player.isBot) {
        parts.push("BOT");
      }
      if (player.status === PLAYER_STATUS.OUT) {
        parts.push("OUT");
      }
      if (player.status === PLAYER_STATUS.RESPAWNING) {
        parts.push("RESPAWN");
      }
      parts.push(`S:${player.score}`);
      if (this.menu.jumpMode && player.status === PLAYER_STATUS.ACTIVE) {
        parts.push(`D:${player.dashCooldown <= 0 ? "READY" : player.dashCooldown.toFixed(1)}`);
      }
      player.labelEl.textContent = parts.join(" ");
    }
  }

  render() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer.setViewport(0, 0, width, height);
    this.renderer.setScissorTest(false);
    this.renderer.clear();

    if (this.state === GAME_STATE.MATCH_OVER) {
      this.viewportLabels.style.display = "none";
      this.renderer.render(this.scene, this.spectatorCamera);
      return;
    }

    this.viewportLabels.style.display = this.state === GAME_STATE.RUNNING || this.state === GAME_STATE.ROUND_OVER ? "block" : "none";

    const viewports = this.getViewports();
    this.renderer.setScissorTest(true);

    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i];
      const v = viewports[i];
      if (!v) {
        continue;
      }

      const vx = Math.floor(v.x * width);
      const vy = Math.floor(v.y * height);
      const vw = Math.floor(v.w * width);
      const vh = Math.floor(v.h * height);

      player.camera.aspect = Math.max(0.1, vw / Math.max(1, vh));
      player.camera.updateProjectionMatrix();

      this.renderer.setViewport(vx, vy, vw, vh);
      this.renderer.setScissor(vx, vy, vw, vh);
      this.renderer.render(this.scene, player.camera);

      if (player.labelEl) {
        player.labelEl.style.left = `${vx + 8}px`;
        player.labelEl.style.top = `${height - vy - vh + 8}px`;
      }

      if (player.dashFlashEl) {
        const opacity = this.menu.jumpMode ? Math.max(0, player.dashFlashTimer / this.config.dashScreenFlash) : 0;
        player.dashFlashEl.style.left = `${vx + 3}px`;
        player.dashFlashEl.style.top = `${height - vy - vh + 3}px`;
        player.dashFlashEl.style.width = `${Math.max(0, vw - 6)}px`;
        player.dashFlashEl.style.height = `${Math.max(0, vh - 6)}px`;
        player.dashFlashEl.style.opacity = opacity.toFixed(3);
      }
    }

    this.renderer.setScissorTest(false);
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.spectatorCamera.aspect = window.innerWidth / window.innerHeight;
    this.spectatorCamera.updateProjectionMatrix();
  }

  run = () => {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === GAME_STATE.RUNNING) {
      this.updateRunning(dt);
    } else if (this.state === GAME_STATE.MATCH_OVER) {
      this.updateCelebration(dt);
      this.updateMenu();
    } else {
      this.updateMenu();
    }

    this.render();
    this.input.endFrame();
    requestAnimationFrame(this.run);
  };
}

const canvas = document.getElementById("game-canvas");
const overlay = document.getElementById("overlay");
const subtitle = document.getElementById("subtitle");
const hint = document.getElementById("hint");
const viewportLabels = document.getElementById("viewport-labels");

const game = new SphereSnakeGame(canvas, overlay, subtitle, hint, viewportLabels);
game.run();
