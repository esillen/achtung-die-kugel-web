import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

const GAME_STATE = {
  MENU_PLAYERS: "menu_players",
  MENU_BOTS: "menu_bots",
  RUNNING: "running",
  ROUND_OVER: "round_over",
};

const PLAYER_COLORS = [0xff3b30, 0x34c759, 0x0a84ff, 0xffd60a];
const CONTROL_SCHEMES = [
  { label: "P1: Arrow Left/Right", left: "ArrowLeft", right: "ArrowRight" },
  { label: "P2: A / D", left: "KeyA", right: "KeyD" },
  { label: "P3: J / L", left: "KeyJ", right: "KeyL" },
  { label: "P4: F / H", left: "KeyF", right: "KeyH" },
];

class InputManager {
  constructor() {
    this.down = new Set();
    this.justPressed = new Set();

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

  consumeAnyPress(codes) {
    for (const code of codes) {
      if (this.consumePress(code)) {
        return code;
      }
    }
    return null;
  }

  endFrame() {
    this.justPressed.clear();
  }
}

class DynamicInstancedSegment {
  constructor(scene, geometry, material, initialCapacity = 512) {
    this.scene = scene;
    this.geometry = geometry;
    this.material = material;
    this.capacity = initialCapacity;
    this.count = 0;
    this.temp = new THREE.Matrix4();

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.scene.add(this.mesh);
  }

  addPoint(position) {
    if (this.count >= this.capacity) {
      this.expand();
    }

    this.temp.makeTranslation(position.x, position.y, position.z);
    this.mesh.setMatrixAt(this.count, this.temp);
    this.count += 1;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  expand() {
    const nextCapacity = this.capacity * 2;
    const nextMesh = new THREE.InstancedMesh(this.geometry, this.material, nextCapacity);
    nextMesh.frustumCulled = false;
    nextMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < this.count; i += 1) {
      this.mesh.getMatrixAt(i, this.temp);
      nextMesh.setMatrixAt(i, this.temp);
    }

    nextMesh.count = this.count;
    nextMesh.instanceMatrix.needsUpdate = true;

    this.scene.remove(this.mesh);
    this.mesh = nextMesh;
    this.capacity = nextCapacity;
    this.scene.add(this.mesh);
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}

class SnakeTrail {
  constructor(scene, color, config) {
    this.scene = scene;
    this.config = config;
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.ballGeometry = new THREE.SphereGeometry(config.bodyRadius, 10, 10);
    this.material = new THREE.MeshBasicMaterial({ color });

    this.segments = [];
    this.currentSegment = null;
    this.solidPoints = [];
    this.lastPlacedPoint = null;
    this.sampleSpacing = config.bodyRadius * 0.95;

    this.inGap = false;
    this.timeToNextGap = this.rand(config.gapIntervalMin, config.gapIntervalMax);
    this.gapRemaining = 0;
  }

  reset() {
    for (const segment of this.segments) {
      segment.dispose();
    }
    this.segments.length = 0;
    this.currentSegment = null;
    this.solidPoints.length = 0;
    this.lastPlacedPoint = null;

    this.inGap = false;
    this.timeToNextGap = this.rand(this.config.gapIntervalMin, this.config.gapIntervalMax);
    this.gapRemaining = 0;
  }

  addPoint(point, dt) {
    if (this.inGap) {
      this.lastPlacedPoint = point.clone();
      this.gapRemaining -= dt;
      if (this.gapRemaining <= 0) {
        this.inGap = false;
        this.currentSegment = null;
      }
      return false;
    }

    this.timeToNextGap -= dt;
    if (this.timeToNextGap <= 0) {
      this.inGap = true;
      this.gapRemaining = this.rand(this.config.gapDurationMin, this.config.gapDurationMax);
      this.timeToNextGap = this.rand(this.config.gapIntervalMin, this.config.gapIntervalMax);
      this.currentSegment = null;
      this.lastPlacedPoint = point.clone();
      return false;
    }

    if (!this.currentSegment) {
      this.currentSegment = new DynamicInstancedSegment(this.root, this.ballGeometry, this.material);
      this.segments.push(this.currentSegment);
    }

    if (!this.lastPlacedPoint) {
      this.currentSegment.addPoint(point);
      this.solidPoints.push(point.clone());
      this.lastPlacedPoint = point.clone();
      return true;
    }

    const delta = point.clone().sub(this.lastPlacedPoint);
    const distance = delta.length();
    if (distance < this.sampleSpacing) {
      return false;
    }

    delta.normalize();
    let traveled = this.sampleSpacing;
    while (traveled <= distance) {
      const sample = this.lastPlacedPoint.clone().addScaledVector(delta, traveled);
      sample.normalize().multiplyScalar(this.config.worldRadius + this.config.headRadius);
      this.currentSegment.addPoint(sample);
      this.solidPoints.push(sample);
      traveled += this.sampleSpacing;
    }
    this.lastPlacedPoint.copy(point);
    return true;
  }

  dispose() {
    this.reset();
    this.ballGeometry.dispose();
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
    let minDist = Infinity;
    const horizon = this.config.botSimSteps;

    for (let step = 0; step < horizon; step += 1) {
      advanceOnSphere(sim, turn, simDt, this.config.turnRate, this.config.speed, this.config.worldRadius, this.config.headRadius);

      const collision = hitsAnyTrail(sim.pos, players, this.config, player.id, true);
      if (collision) {
        return -10000 + step * 30;
      }

      for (const other of players) {
        if (other.id === player.id) {
          continue;
        }
        const prediction = predictedHeads.get(other.id)[step];
        const dist = sim.pos.distanceTo(prediction);
        minDist = Math.min(minDist, dist);
      }
    }

    const immediateSafety = this.localSafety(player, turn, players);
    return minDist * 8 + immediateSafety * 4;
  }

  localSafety(player, turn, players) {
    const sim = {
      pos: player.pos.clone(),
      up: player.up.clone(),
      forward: player.forward.clone(),
      right: player.right.clone(),
    };

    const simDt = 0.08;
    for (let step = 0; step < 10; step += 1) {
      advanceOnSphere(sim, turn, simDt, this.config.turnRate, this.config.speed, this.config.worldRadius, this.config.headRadius);
      if (hitsAnyTrail(sim.pos, players, this.config, player.id, true)) {
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

function hitsAnyTrail(point, players, config, playerId, includeOthers) {
  const r2 = config.collisionRadius * config.collisionRadius;

  for (const player of players) {
    if (!includeOthers && player.id !== playerId) {
      continue;
    }

    const pts = player.trail.solidPoints;
    const ownTailIgnore = player.id === playerId ? config.safeTailIgnoreCount : 0;
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
      cameraLookAhead: 5.8,
      gapIntervalMin: 1.3,
      gapIntervalMax: 2.9,
      gapDurationMin: 0.16,
      gapDurationMax: 0.31,
      botSimSteps: 22,
      botSimDt: 0.12,
    };

    this.menu = {
      humans: 2,
      bots: 0,
    };

    this.state = GAME_STATE.MENU_PLAYERS;
    this.players = [];
    this.botBrain = new BotBrain(this.config);

    this.initWorld();
    this.syncMenuOverlay();

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

  buildPlayers() {
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
        color,
        isBot,
        trail,
        headMesh,
        camera,
        control: !isBot ? CONTROL_SCHEMES[i] : null,
        turnInput: 0,
        pos: new THREE.Vector3(),
        up: new THREE.Vector3(),
        forward: new THREE.Vector3(),
        right: new THREE.Vector3(),
      });
    }

    this.resetRound();
    this.refreshViewportLabels();
  }

  resetRound() {
    const count = this.players.length;

    for (let i = 0; i < count; i += 1) {
      const player = this.players[i];
      player.trail.reset();

      const angle = (i / Math.max(1, count)) * Math.PI * 2;
      const spawnUp = new THREE.Vector3(Math.cos(angle), 0.27, Math.sin(angle)).normalize();
      const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();

      player.up.copy(spawnUp);
      player.pos.copy(spawnUp).multiplyScalar(this.config.worldRadius + this.config.headRadius);
      player.forward.copy(tangent).projectOnPlane(player.up).normalize();
      player.right.crossVectors(player.forward, player.up).normalize();

      player.headMesh.position.copy(player.pos);
      this.updateCamera(player);
      player.turnInput = 0;
    }
  }

  syncMenuOverlay() {
    this.overlay.classList.remove("hidden");

    if (this.state === GAME_STATE.MENU_PLAYERS) {
      this.subtitle.textContent = `Choose human players (1-4): ${this.menu.humans}`;
      this.hint.textContent = "Press 1,2,3,4 to choose human players.\nThen press Space to choose bot count.\nControls: P1 Arrows, P2 A/D, P3 J/L, P4 F/H.";
      return;
    }

    if (this.state === GAME_STATE.MENU_BOTS) {
      const maxBots = 4 - this.menu.humans;
      this.subtitle.textContent = `Choose bots (0-${maxBots}): ${this.menu.bots}`;
      this.hint.textContent = "Press number keys to set bot count.\nPress Space to start.";
      return;
    }

    if (this.state === GAME_STATE.ROUND_OVER) {
      this.subtitle.textContent = "Round Over";
      this.hint.textContent = "Press Space to try again.";
    }
  }

  startRound() {
    if (!this.players.length) {
      this.buildPlayers();
    } else {
      this.resetRound();
    }

    this.state = GAME_STATE.RUNNING;
    this.overlay.classList.add("hidden");
    this.clock.getDelta();
  }

  updateMenu() {
    if (this.state === GAME_STATE.MENU_PLAYERS) {
      const selectedPlayers = this.readNumberKey(1, 4);
      if (selectedPlayers !== null) {
        this.menu.humans = selectedPlayers;
        this.menu.bots = Math.min(this.menu.bots, 4 - selectedPlayers);
        this.syncMenuOverlay();
      }
    }

    if (this.state === GAME_STATE.MENU_BOTS) {
      const maxBots = 4 - this.menu.humans;
      const selectedBots = this.readNumberKey(0, maxBots);
      if (selectedBots !== null) {
        this.menu.bots = selectedBots;
        this.syncMenuOverlay();
      }
    }

    if (!this.input.consumePress("Space")) {
      return;
    }

    if (this.state === GAME_STATE.MENU_PLAYERS) {
      this.state = GAME_STATE.MENU_BOTS;
      this.syncMenuOverlay();
      return;
    }

    if (this.state === GAME_STATE.MENU_BOTS) {
      this.buildPlayers();
      this.startRound();
      return;
    }

    if (this.state === GAME_STATE.ROUND_OVER) {
      this.startRound();
    }
  }

  readNumberKey(min, max) {
    const map = [
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

    for (const [code, value] of map) {
      if (value >= min && value <= max && this.input.consumePress(code)) {
        return value;
      }
    }

    return null;
  }

  updateRunning(dt) {
    for (const player of this.players) {
      if (!player.isBot) {
        const left = this.input.isDown(player.control.left);
        const right = this.input.isDown(player.control.right);

        if (left && !right) {
          player.turnInput = 1;
        } else if (right && !left) {
          player.turnInput = -1;
        } else {
          player.turnInput = 0;
        }
      }
    }

    const predictedHeads = this.predictHeads();

    for (const player of this.players) {
      if (player.isBot) {
        player.turnInput = this.botBrain.decide(player, this.players, predictedHeads);
      }
    }

    for (const player of this.players) {
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
    }

    let crashed = false;
    for (const player of this.players) {
      if (hitsAnyTrail(player.pos, this.players, this.config, player.id, true)) {
        crashed = true;
        break;
      }
    }

    if (crashed) {
      this.state = GAME_STATE.ROUND_OVER;
      this.syncMenuOverlay();
      return;
    }

    for (const player of this.players) {
      this.updateCamera(player);
    }
  }

  predictHeads() {
    const predicted = new Map();

    for (const player of this.players) {
      const sim = {
        pos: player.pos.clone(),
        up: player.up.clone(),
        forward: player.forward.clone(),
        right: player.right.clone(),
      };

      const list = [];
      const turn = player.turnInput;
      for (let i = 0; i < this.config.botSimSteps; i += 1) {
        advanceOnSphere(
          sim,
          turn,
          this.config.botSimDt,
          this.config.turnRate,
          this.config.speed,
          this.config.worldRadius,
          this.config.headRadius,
        );
        list.push(sim.pos.clone());
      }
      predicted.set(player.id, list);
    }

    return predicted;
  }

  updateCamera(player) {
    const back = player.forward.clone().multiplyScalar(-this.config.cameraDistance);
    const up = player.up.clone().multiplyScalar(this.config.cameraHeight);
    const desired = player.pos.clone().add(back).add(up);
    const target = player.pos.clone().addScaledVector(player.forward, this.config.cameraLookAhead);
    player.camera.position.copy(desired);
    player.camera.lookAt(target);
  }

  getViewports() {
    const n = this.players.length;
    if (n === 1) {
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
      const label = document.createElement("div");
      label.className = "viewport-label";
      label.style.borderColor = `#${player.color.toString(16).padStart(6, "0")}`;
      label.textContent = player.isBot ? `${player.name} BOT` : player.name;
      this.viewportLabels.appendChild(label);
      player.labelEl = label;
    }
  }

  render() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer.setViewport(0, 0, width, height);
    this.renderer.setScissorTest(false);
    this.renderer.clear();

    const viewports = this.getViewports();
    this.renderer.setScissorTest(true);

    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i];
      const v = viewports[i];
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
    }

    this.renderer.setScissorTest(false);
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  run = () => {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === GAME_STATE.RUNNING) {
      this.updateRunning(dt);
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
