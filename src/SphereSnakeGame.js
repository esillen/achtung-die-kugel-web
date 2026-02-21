import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import {
  CONTROL_SCHEMES,
  DASH_FX_BASE_CAMERA,
  DEATH_CAMERA_CONFIG,
  GAME_CONFIG,
  GAMEPAD,
  MENU_DEFAULTS,
  MENU_SETTINGS_STORAGE_KEY,
  PLAYER_COLORS,
  SPHERE_AUTO_SCALE_RADII,
  SPHERE_SIZE_PRESETS,
} from "./GAMEPLAY_CONSTANTS.js";
import { GAME_STATE, PLAYER_STATUS } from "./game-state.js";
import InputManager from "./input-manager.js";
import SnakeTrail from "./snake-trail.js";
import BotBrain from "./bot-brain.js";
import { advanceOnSphere, hitsAnyTrail } from "./physics.js";

class SphereSnakeGame {
  constructor(canvas, overlay, subtitle, hint, viewportLabels) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.subtitle = subtitle;
    this.hint = hint;
    this.viewportLabels = viewportLabels;
    this.menuProgressEl = document.getElementById("menu-progress");

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
    this.isMobile = this.detectMobile();
    this.mobileMenuNumberSelection = null;
    this.mobileMenuBack = false;
    this.mobileMenuAdvance = false;
    this.mobileUseSaved = false;
    this.mobileTurnStates = new Map();
    this.menuControlPreviewEls = [];

    this.config = { ...GAME_CONFIG };

    this.menu = { ...MENU_DEFAULTS };
    this.savedMenuSettings = this.loadSavedMenuSettings();

    this.state = GAME_STATE.MENU_PLAYERS;
    this.players = [];
    this.botBrain = new BotBrain(this.config);
    this.matchWinnerId = null;
    this.celebration = null;

    this.initWorld();
    this.initCelebrationSystem();
    this.initDashEffects();
    this.initMobileControls();
    this.initMobileSteeringControls();
    this.syncOverlay();

    window.addEventListener("resize", () => this.onResize());
  }

  initWorld() {
    this.worldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.config.worldRadius, 52, 52),
      new THREE.MeshBasicMaterial({
        color: 0x294569,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.scene.add(this.worldMesh);

    this.worldGridMesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.config.worldRadius + 0.03, 30, 30),
      new THREE.MeshBasicMaterial({ color: 0x3a5f8d, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    this.scene.add(this.worldGridMesh);
  }

  getScaledWorldRadius() {
    const total = Math.max(1, this.menu.humans + this.menu.bots);
    return SPHERE_AUTO_SCALE_RADII[Math.min(total, SPHERE_AUTO_SCALE_RADII.length) - 1];
  }

  getWorldRadiusForMenuSize(sizeSetting) {
    if (sizeSetting === 0) {
      return this.getScaledWorldRadius();
    }
    return SPHERE_SIZE_PRESETS[Math.max(1, Math.min(9, sizeSetting)) - 1];
  }

  applySphereSizeFromMenu() {
    const radius = this.getWorldRadiusForMenuSize(this.menu.sphereSize);
    const scale = radius / GAME_CONFIG.worldRadius;

    this.config.worldRadius = radius;
    this.config.speed = GAME_CONFIG.speed * scale;
    this.config.cameraDistance = GAME_CONFIG.cameraDistance * scale;
    this.config.cameraHeight = GAME_CONFIG.cameraHeight * scale;
    this.config.dashDistance = GAME_CONFIG.dashDistance * scale;

    if (this.worldMesh) {
      this.worldMesh.geometry.dispose();
      this.worldMesh.geometry = new THREE.SphereGeometry(radius, 52, 52);
    }
    if (this.worldGridMesh) {
      this.worldGridMesh.geometry.dispose();
      this.worldGridMesh.geometry = new THREE.SphereGeometry(radius + 0.03, 30, 30);
    }

    this.spectatorCenter.set(0, radius, 0);
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

  detectMobile() {
    return (
      navigator.maxTouchPoints > 0 ||
      window.matchMedia?.("(pointer: coarse)")?.matches ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    );
  }

  initMobileControls() {
    this.mobileMenuControlsEl = document.createElement("div");
    this.mobileMenuControlsEl.className = "mobile-controls";
    this.overlay.appendChild(this.mobileMenuControlsEl);

    this.mobileSteeringEl = document.createElement("div");
    this.mobileSteeringEl.className = "mobile-steering";
    document.body.appendChild(this.mobileSteeringEl);
  }

  initMobileSteeringControls() {
    if (!this.isMobile) {
      return;
    }
  }

  getMobileTurnForPlayer(player) {
    if (!this.isMobile || player.isBot || player.id > 1) {
      return 0;
    }
    const state = this.mobileTurnStates.get(player.id) || { left: false, right: false };
    const hasLeft = state.left;
    const hasRight = state.right;
    if (hasLeft && !hasRight) {
      return 1;
    }
    if (hasRight && !hasLeft) {
      return -1;
    }
    return 0;
  }

  setMobileMenuButtons(buttons) {
    if (!this.mobileMenuControlsEl) {
      return;
    }

    if (buttons.length === 0) {
      this.mobileMenuControlsEl.innerHTML = "";
      this.mobileMenuControlsEl.style.display = "none";
      return;
    }

    this.mobileMenuControlsEl.style.display = "flex";
    this.mobileMenuControlsEl.innerHTML = "";

    for (const button of buttons) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "mobile-btn";
      if (button.kind === "number") {
        el.classList.add("mobile-btn-choice");
      } else if (button.kind === "back") {
        el.classList.add("mobile-btn-back");
      } else if (button.kind === "saved") {
        el.classList.add("mobile-btn-saved");
      } else if (button.kind === "advance") {
        el.classList.add("mobile-btn-advance");
      }
      el.textContent = button.label;
      el.addEventListener("click", () => {
        if (button.kind === "number") {
          this.mobileMenuNumberSelection = button.value;
        } else if (button.kind === "back") {
          this.mobileMenuBack = true;
        } else if (button.kind === "advance") {
          this.mobileMenuAdvance = true;
        } else if (button.kind === "saved") {
          this.mobileUseSaved = true;
        }
      });
      this.mobileMenuControlsEl.appendChild(el);
    }
  }

  setMobileSteeringControls() {
    if (!this.mobileSteeringEl) {
      return;
    }

    if (!this.isMobile || this.state !== GAME_STATE.RUNNING) {
      this.mobileSteeringEl.style.display = "none";
      this.mobileSteeringEl.innerHTML = "";
      this.mobileTurnStates.clear();
      return;
    }

    const humanPlayers = this.players.filter((player) => !player.isBot).slice(0, 2);
    if (humanPlayers.length === 0) {
      this.mobileSteeringEl.style.display = "none";
      this.mobileSteeringEl.innerHTML = "";
      this.mobileTurnStates.clear();
      return;
    }

    this.mobileSteeringEl.style.display = "grid";
    this.mobileSteeringEl.classList.toggle("two-player", humanPlayers.length === 2);
    this.mobileSteeringEl.innerHTML = "";

    const bindHold = (buttonEl, playerId, side) => {
      const setPressed = (pressed) => {
        const current = this.mobileTurnStates.get(playerId) || { left: false, right: false };
        current[side] = pressed;
        this.mobileTurnStates.set(playerId, current);
      };
      buttonEl.addEventListener("pointerdown", (event) => {
        setPressed(true);
        if (event.cancelable) {
          event.preventDefault();
        }
      });
      buttonEl.addEventListener("pointerup", () => setPressed(false));
      buttonEl.addEventListener("pointercancel", () => setPressed(false));
      buttonEl.addEventListener("pointerleave", () => setPressed(false));
    };

    for (const player of humanPlayers) {
      this.mobileTurnStates.set(player.id, { left: false, right: false });

      const group = document.createElement("div");
      group.className = "mobile-steer-group";

      const leftBtn = document.createElement("button");
      leftBtn.type = "button";
      leftBtn.className = "mobile-steer-btn";
      leftBtn.textContent = humanPlayers.length === 1 ? "LEFT" : `${player.name} L`;
      bindHold(leftBtn, player.id, "left");

      const rightBtn = document.createElement("button");
      rightBtn.type = "button";
      rightBtn.className = "mobile-steer-btn";
      rightBtn.textContent = humanPlayers.length === 1 ? "RIGHT" : `${player.name} R`;
      bindHold(rightBtn, player.id, "right");

      group.appendChild(leftBtn);
      group.appendChild(rightBtn);
      this.mobileSteeringEl.appendChild(group);
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
        spawnGraceTimer: this.config.spawnGraceDuration,
          turnInput: 0,
        dashCooldown: this.config.dashCooldown,
        dashRequested: false,
        dashFlashTimer: 0,
        eyeTime: Math.random() * Math.PI * 2,
        blinkTimer: 1.2 + Math.random() * 2.2,
        blinkProgress: 0,
        blinkDuration: 0.1,
        blinkPendingSecond: false,
        deathEyeWobbleActive: false,
        deathEyeWobbleTime: 0,
        deathEyeWobbleDuration: 0.62,
        deathEyeWobblePhase: Math.random() * Math.PI * 2,
        deathEyeFreezeLeftX: 0,
        deathEyeFreezeLeftY: 0,
        deathEyeFreezeRightX: 0,
        deathEyeFreezeRightY: 0,
        deathCameraTime: 0,
        deathCameraDir: Math.random() < 0.5 ? -1 : 1,
        pos: new THREE.Vector3(),
        up: new THREE.Vector3(),
        forward: new THREE.Vector3(),
        right: new THREE.Vector3(),
      });

      this.attachGooglyEyes(this.players[this.players.length - 1]);
      this.configureHeadRenderPriority(this.players[this.players.length - 1]);
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
    player.trail.show();
    player.trail.material.color.setHex(player.color);
    player.trail.material.opacity = 1;
    player.trailCollidable = true;
    player.status = PLAYER_STATUS.ACTIVE;
    player.respawnTimer = 0;
    player.spawnGraceTimer = this.config.spawnGraceDuration;
    player.turnInput = 0;
    player.dashCooldown = 0;
    player.dashRequested = false;
    player.dashFlashTimer = 0;
    player.eyeTime = Math.random() * Math.PI * 2;
    player.blinkTimer = 1.2 + Math.random() * 2.2;
    player.blinkProgress = 0;
    player.blinkDuration = 0.1;
    player.blinkPendingSecond = false;
    player.deathEyeWobbleActive = false;
    player.deathEyeWobbleTime = 0;
    player.deathEyeWobblePhase = Math.random() * Math.PI * 2;
    player.deathCameraTime = 0;
    player.deathCameraDir = Math.random() < 0.5 ? -1 : 1;
    this.updateHeadVisuals(player, 0);
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
    this.clearMenuControlPreview();
    this.updateMenuProgress();

    if (this.state === GAME_STATE.MENU_PLAYERS) {
      const maxHumans = this.isMobile ? 2 : 4;
      this.subtitle.textContent = "Select number of players";
      this.hint.textContent = `You can click buttons or press number keys. ${!this.isMobile && this.savedMenuSettings ? "\nPress Enter to start the game with your last settings." : ""}`;
      this.setMobileMenuButtons([
        { kind: "number", value: 1, label: "(1) One" },
        { kind: "number", value: 2, label: "(2) Two" },
        ...(maxHumans >= 3 ? [{ kind: "number", value: 3, label: "(3) Three" }] : []),
        ...(maxHumans >= 4 ? [{ kind: "number", value: 4, label: "(4) Four" }] : []),
      ]);
      this.setMobileSteeringControls();
      return;
    }

    if (this.state === GAME_STATE.MENU_BOTS) {
      const maxBots = 4 - this.menu.humans;
      this.subtitle.textContent = "Select number of bots";
      this.hint.textContent = "Choose bots with number keys.";
      this.setMobileMenuButtons(
        [{ kind: "back", label: "(backspace) Back" }]
          .concat([...Array(maxBots + 1).keys()].map((value) => ({ kind: "number", value, label: `(${value}) ${value}` }))),
      );
      this.setMobileSteeringControls();
      return;
    }

    if (this.state === GAME_STATE.MENU_SIZE) {
      const current = this.menu.sphereSize;
      this.subtitle.textContent = "Select sphere size";
      this.hint.textContent = `0 = scaling with players (current radius ${this.getScaledWorldRadius().toFixed(0)}).\n1-9 = fixed size.\nCurrent: ${current}\nPress Space to use last saved size and continue.`;
      this.setMobileMenuButtons(
        [{ kind: "back", label: "(backspace) Back" }]
          .concat([...Array(10).keys()].map((value) => ({ kind: "number", value, label: value === 0 ? "(0) Auto" : `(${value}) ${value}` })))
          .concat(this.savedMenuSettings ? [{ kind: "saved", label: `(space) Use Last (${this.formatSizeLabel(this.savedMenuSettings.sphereSize)})` }] : []),
      );
      this.setMobileSteeringControls();
      return;
    }

    if (this.state === GAME_STATE.MENU_MODE) {
      this.subtitle.textContent = "Select mode";
      this.hint.textContent = "You can click buttons or press number keys.\nPress Space to use last saved mode and continue.";
      this.setMobileMenuButtons([
        { kind: "back", label: "(backspace) Back" },
        { kind: "number", value: 1, label: "(1) Normal" },
        { kind: "number", value: 2, label: "(2) Continuous" },
        ...(this.savedMenuSettings
          ? [{ kind: "saved", label: `(space) Use Last (${this.savedMenuSettings.continuous ? "mode continuous" : "mode normal"})` }]
          : []),
      ]);
      this.setMobileSteeringControls();
      return;
    }

    if (this.state === GAME_STATE.MENU_JUMP) {
      this.subtitle.textContent = "Play with jumps?";
      this.hint.textContent = "You can click buttons or press number keys.\nPress Space to use last saved jump setting and start.";
      this.setMobileMenuButtons([
        { kind: "back", label: "(backspace) Back" },
        { kind: "number", value: 1, label: "(1) Off" },
        { kind: "number", value: 2, label: "(2) On" },
        ...(this.savedMenuSettings ? [{ kind: "saved", label: `(space) Use Last (${this.savedMenuSettings.jumpMode ? "jumps on" : "jumps off"})` }] : []),
      ]);
      this.setMobileSteeringControls();
      return;
    }

    if (this.state === GAME_STATE.MENU_READY) {
      this.subtitle.textContent = "Ready";
      this.hint.textContent = "Check your controls below.\nPress Space to start.";
      this.setMobileMenuButtons([
        { kind: "back", label: "(backspace) Back" },
        { kind: "advance", label: "(space) Start Game" },
      ]);
      this.showMenuControlPreview();
      this.setMobileSteeringControls();
      return;
    }

    if (this.state === GAME_STATE.ROUND_OVER) {
      this.subtitle.textContent = "Round Over";
      this.hint.textContent = "Press Space for next round.";
      this.setMobileMenuButtons([{ kind: "advance", label: "Next Round" }]);
      this.setMobileSteeringControls();
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
      this.setMobileMenuButtons([{ kind: "advance", label: "New Match" }]);
      this.setMobileSteeringControls();
    }
  }

  formatSizeLabel(sizeValue) {
    return sizeValue === 0 ? "size scaling" : `size ${sizeValue}`;
  }

  pluralize(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  updateMenuProgress() {
    if (!this.menuProgressEl) {
      return;
    }

    const isMenuState =
      this.state === GAME_STATE.MENU_PLAYERS ||
      this.state === GAME_STATE.MENU_BOTS ||
      this.state === GAME_STATE.MENU_SIZE ||
      this.state === GAME_STATE.MENU_MODE ||
      this.state === GAME_STATE.MENU_JUMP ||
      this.state === GAME_STATE.MENU_READY;

    if (!isMenuState) {
      this.menuProgressEl.style.display = "none";
      return;
    }

    this.menuProgressEl.classList.remove("is-pending");
    if (this.state === GAME_STATE.MENU_PLAYERS) {
      this.menuProgressEl.style.display = "none";
      return;
    }

    this.menuProgressEl.style.display = "block";
    const players = this.pluralize(this.menu.humans, "player", "players");
    const bots = this.pluralize(this.menu.bots, "bot", "bots");
    const size = this.formatSizeLabel(this.menu.sphereSize);
    const mode = this.menu.continuous ? "mode continuous" : "mode normal";
    const jumps = this.menu.jumpMode ? "jumps on" : "jumps off";

    if (this.state === GAME_STATE.MENU_BOTS) {
      this.menuProgressEl.classList.add("is-pending");
      this.menuProgressEl.innerHTML = `${players} -> <span class="dots"><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>`;
      return;
    }
    if (this.state === GAME_STATE.MENU_SIZE) {
      this.menuProgressEl.classList.add("is-pending");
      this.menuProgressEl.innerHTML = `${players} -> ${bots} -> <span class="dots"><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>`;
      return;
    }
    if (this.state === GAME_STATE.MENU_MODE) {
      this.menuProgressEl.classList.add("is-pending");
      this.menuProgressEl.innerHTML = `${players} -> ${bots} -> ${size} -> <span class="dots"><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>`;
      return;
    }
    if (this.state === GAME_STATE.MENU_JUMP) {
      this.menuProgressEl.classList.add("is-pending");
      this.menuProgressEl.innerHTML =
        `${players} -> ${bots} -> ${size} -> ${mode} -> <span class="dots"><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>`;
      return;
    }
    if (this.state === GAME_STATE.MENU_READY) {
      this.menuProgressEl.textContent = `${players} -> ${bots} -> ${size} -> ${mode} -> ${jumps}`;
      return;
    }
    this.menuProgressEl.textContent = `${players} -> ${bots} -> ${size} -> ${mode} -> ${jumps}`;
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

  attachGooglyEyes(player) {
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const whiteGeo = new THREE.SphereGeometry(0.18, 10, 10);
    const pupilGeo = new THREE.SphereGeometry(0.068, 8, 8);

    const leftEye = new THREE.Mesh(whiteGeo, whiteMat);
    const rightEye = new THREE.Mesh(whiteGeo, whiteMat);
    leftEye.position.set(-0.23, 0.17, 0.56);
    rightEye.position.set(0.23, 0.17, 0.56);

    const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
    const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
    leftPupil.position.set(0, 0, 0.12);
    rightPupil.position.set(0, 0, 0.12);

    leftEye.add(leftPupil);
    rightEye.add(rightPupil);
    player.headMesh.add(leftEye);
    player.headMesh.add(rightEye);

    player.leftPupil = leftPupil;
    player.rightPupil = rightPupil;
    player.leftEye = leftEye;
    player.rightEye = rightEye;
  }

  configureHeadRenderPriority(player) {
    // Keep face readable over overlapping trail fragments, while preserving normal occlusion.
    player.headMesh.renderOrder = 90;
    player.headMesh.traverse((node) => {
      if (!node.isMesh || !node.material) {
        return;
      }
      node.renderOrder = 90;
      node.material.depthTest = true;
      node.material.depthWrite = true;
      node.material.polygonOffset = true;
      node.material.polygonOffsetFactor = -1;
      node.material.polygonOffsetUnits = -1;
    });
  }

  updateHeadVisuals(player, dt) {
    player.headMesh.position.copy(player.pos);

    const zAxis = player.forward.clone().normalize();
    const yAxis = player.up.clone().normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    player.headMesh.quaternion.setFromRotationMatrix(basis);

    const inSpawnGrace = player.status === PLAYER_STATUS.ACTIVE && player.spawnGraceTimer > 0;
    const headOpacity = inSpawnGrace ? 0.58 : 1;
    player.headMesh.traverse((node) => {
      if (!node.isMesh || !node.material) {
        return;
      }
      node.material.transparent = headOpacity < 0.999;
      node.material.opacity = headOpacity;
    });

    if (!player.leftPupil || !player.rightPupil) {
      return;
    }

    if (player.leftEye && player.rightEye) {
      if (dt > 0) {
        if (player.blinkProgress > 0) {
          player.blinkProgress = Math.min(1, player.blinkProgress + dt / player.blinkDuration);
          if (player.blinkProgress >= 1) {
            if (player.blinkPendingSecond) {
              player.blinkPendingSecond = false;
              player.blinkProgress = 0.0001;
              player.blinkDuration = 0.08;
            } else {
              player.blinkProgress = 0;
              player.blinkTimer = 1.1 + Math.random() * 3.4;
            }
          }
        } else {
          player.blinkTimer -= dt;
          if (player.blinkTimer <= 0) {
            player.blinkProgress = 0.0001;
            player.blinkDuration = 0.08 + Math.random() * 0.05;
            player.blinkPendingSecond = Math.random() < 0.16;
          }
        }
      }

      const blinkAmount = player.blinkProgress > 0 ? Math.sin(player.blinkProgress * Math.PI) : 0;
      const eyeScaleY = 1 - blinkAmount * 0.92;
      player.leftEye.scale.set(1, eyeScaleY, 1);
      player.rightEye.scale.set(1, eyeScaleY, 1);
    }

    player.eyeTime += dt * 7.5;
    let lx = Math.sin(player.eyeTime * 1.9) * 0.03;
    let ly = Math.cos(player.eyeTime * 2.3) * 0.025;
    let rx = Math.sin(player.eyeTime * 2.2 + 0.8) * 0.03;
    let ry = Math.cos(player.eyeTime * 1.7 + 0.35) * 0.025;

    if (player.deathEyeWobbleActive) {
      player.deathEyeWobbleTime += dt;
      const progress = THREE.MathUtils.clamp(player.deathEyeWobbleTime / player.deathEyeWobbleDuration, 0, 1);
      const damp = (1 - progress) * (1 - progress);
      const t = player.deathEyeWobblePhase + player.deathEyeWobbleTime * 32;
      const amp = 0.07 * damp;
      lx += Math.sin(t * 1.13) * amp;
      ly += Math.cos(t * 0.87) * amp;
      rx += Math.sin(t * 0.97 + 0.9) * amp;
      ry += Math.cos(t * 1.21 + 0.4) * amp;

      if (progress >= 1) {
        player.deathEyeWobbleActive = false;
        player.deathEyeFreezeLeftX = lx;
        player.deathEyeFreezeLeftY = ly;
        player.deathEyeFreezeRightX = rx;
        player.deathEyeFreezeRightY = ry;
      }
    } else if (player.status !== PLAYER_STATUS.ACTIVE) {
      lx = player.deathEyeFreezeLeftX;
      ly = player.deathEyeFreezeLeftY;
      rx = player.deathEyeFreezeRightX;
      ry = player.deathEyeFreezeRightY;
    }

    player.leftPupil.position.set(lx, ly, 0.11);
    player.rightPupil.position.set(rx, ry, 0.11);
  }

  targetScore() {
    return Math.max(1, (this.players.length - 1) * 10);
  }

  startMatch() {
    this.saveMenuSettings();
    this.applySphereSizeFromMenu();
    this.createPlayers();
    this.stopCelebration();
    this.state = GAME_STATE.RUNNING;
    this.overlay.classList.add("hidden");
    this.clearMenuControlPreview();
    this.setMobileSteeringControls();
    this.clock.getDelta();
  }

  startNextRound() {
    this.resetRound();
    this.state = GAME_STATE.RUNNING;
    this.overlay.classList.add("hidden");
    this.clearMenuControlPreview();
    this.setMobileSteeringControls();
    this.clock.getDelta();
  }

  updateMenu() {
    if (this.handleMenuBack()) {
      return;
    }

    if (this.state === GAME_STATE.MENU_PLAYERS) {
      const enterPressed = this.input.consumePress("Enter") || this.input.consumePress("NumpadEnter");
      const useSavedPressed = this.mobileUseSaved;
      this.mobileUseSaved = false;
      if ((enterPressed || useSavedPressed) && this.savedMenuSettings) {
        this.applyMenuSettings(this.savedMenuSettings);
        this.startMatch();
        return;
      }
    }

    if (this.state === GAME_STATE.MENU_PLAYERS) {
      const selected = this.readNumberKey(1, this.isMobile ? 2 : 4);
      if (selected !== null) {
        this.menu.humans = selected;
        this.menu.bots = Math.min(this.menu.bots, 4 - selected);
        this.state = GAME_STATE.MENU_BOTS;
        this.syncOverlay();
        return;
      }
    }

    if (this.state === GAME_STATE.MENU_BOTS) {
      const maxBots = 4 - this.menu.humans;
      const selected = this.readNumberKey(0, maxBots);
      if (selected !== null) {
        this.menu.bots = selected;
        this.state = GAME_STATE.MENU_SIZE;
        this.syncOverlay();
        return;
      }
    }

    if (this.state === GAME_STATE.MENU_SIZE) {
      const selected = this.readNumberKey(0, 9);
      if (selected !== null) {
        this.menu.sphereSize = selected;
        this.state = GAME_STATE.MENU_MODE;
        this.syncOverlay();
        return;
      }

      const useLastPressed = this.input.consumePress("Space") || this.mobileUseSaved;
      this.mobileUseSaved = false;
      if (useLastPressed) {
        if (this.savedMenuSettings) {
          this.menu.sphereSize = this.savedMenuSettings.sphereSize;
        }
        this.state = GAME_STATE.MENU_MODE;
        this.syncOverlay();
        return;
      }
    }

    if (this.state === GAME_STATE.MENU_MODE) {
      const selected = this.readNumberKey(1, 2);
      if (selected === 1) {
        this.menu.continuous = false;
        this.state = GAME_STATE.MENU_JUMP;
        this.syncOverlay();
        return;
      }
      if (selected === 2) {
        this.menu.continuous = true;
        this.state = GAME_STATE.MENU_JUMP;
        this.syncOverlay();
        return;
      }

      const useLastPressed = this.input.consumePress("Space") || this.mobileUseSaved;
      this.mobileUseSaved = false;
      if (useLastPressed) {
        if (this.savedMenuSettings) {
          this.menu.continuous = this.savedMenuSettings.continuous;
        }
        this.state = GAME_STATE.MENU_JUMP;
        this.syncOverlay();
        return;
      }
    }

    if (this.state === GAME_STATE.MENU_JUMP) {
      const selected = this.readNumberKey(1, 2);
      if (selected === 1) {
        this.menu.jumpMode = false;
        this.state = GAME_STATE.MENU_READY;
        this.syncOverlay();
        return;
      }
      if (selected === 2) {
        this.menu.jumpMode = true;
        this.state = GAME_STATE.MENU_READY;
        this.syncOverlay();
        return;
      }

      const useLastPressed = this.input.consumePress("Space") || this.mobileUseSaved;
      this.mobileUseSaved = false;
      if (useLastPressed && this.savedMenuSettings) {
        this.menu.jumpMode = this.savedMenuSettings.jumpMode;
        this.state = GAME_STATE.MENU_READY;
        this.syncOverlay();
        return;
      }
    }

    if (this.state === GAME_STATE.MENU_READY) {
      const startPressed = this.input.consumePress("Space") || this.input.consumePress("Enter") || this.input.consumePress("NumpadEnter") || this.mobileMenuAdvance;
      this.mobileMenuAdvance = false;
      if (startPressed) {
        this.startMatch();
        return;
      }
    }

    if (this.state === GAME_STATE.ROUND_OVER) {
      const next = this.input.consumePress("Space") || this.mobileMenuAdvance;
      this.mobileMenuAdvance = false;
      if (!next) {
        return;
      }
      this.startNextRound();
      return;
    }

    if (this.state === GAME_STATE.MATCH_OVER) {
      const restart = this.input.consumePress("Space") || this.mobileMenuAdvance;
      this.mobileMenuAdvance = false;
      if (!restart) {
        return;
      }
      this.matchWinnerId = null;
      this.stopCelebration();
      this.state = GAME_STATE.MENU_PLAYERS;
      this.syncOverlay();
    }
  }

  handleMenuBack() {
    const pressed = this.input.consumePress("Backspace") || this.mobileMenuBack;
    this.mobileMenuBack = false;
    if (!pressed) {
      return false;
    }

    if (this.state === GAME_STATE.MENU_BOTS) {
      this.state = GAME_STATE.MENU_PLAYERS;
      this.syncOverlay();
      return true;
    }
    if (this.state === GAME_STATE.MENU_MODE) {
      this.state = GAME_STATE.MENU_SIZE;
      this.syncOverlay();
      return true;
    }
    if (this.state === GAME_STATE.MENU_SIZE) {
      this.state = GAME_STATE.MENU_BOTS;
      this.syncOverlay();
      return true;
    }
    if (this.state === GAME_STATE.MENU_JUMP) {
      this.state = GAME_STATE.MENU_MODE;
      this.syncOverlay();
      return true;
    }
    if (this.state === GAME_STATE.MENU_READY) {
      this.state = GAME_STATE.MENU_JUMP;
      this.syncOverlay();
      return true;
    }
    return false;
  }

  readNumberKey(min, max) {
    if (this.mobileMenuNumberSelection !== null) {
      const value = this.mobileMenuNumberSelection;
      this.mobileMenuNumberSelection = null;
      if (value >= min && value <= max) {
        return value;
      }
    }

    const keyMap = [
      ["Digit0", 0],
      ["Digit1", 1],
      ["Digit2", 2],
      ["Digit3", 3],
      ["Digit4", 4],
      ["Digit5", 5],
      ["Digit6", 6],
      ["Digit7", 7],
      ["Digit8", 8],
      ["Digit9", 9],
      ["Numpad0", 0],
      ["Numpad1", 1],
      ["Numpad2", 2],
      ["Numpad3", 3],
      ["Numpad4", 4],
      ["Numpad5", 5],
      ["Numpad6", 6],
      ["Numpad7", 7],
      ["Numpad8", 8],
      ["Numpad9", 9],
    ];

    for (const [code, value] of keyMap) {
      if (value >= min && value <= max && this.input.consumePress(code)) {
        return value;
      }
    }

    return null;
  }

  loadSavedMenuSettings() {
    try {
      const raw = localStorage.getItem(MENU_SETTINGS_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return this.sanitizeMenuSettings(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  sanitizeMenuSettings(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return null;
    }

    const humans = Number(candidate.humans);
    const bots = Number(candidate.bots);
    const sphereSize = Number(candidate.sphereSize ?? MENU_DEFAULTS.sphereSize);
    const continuous = Boolean(candidate.continuous);
    const jumpMode = Boolean(candidate.jumpMode);

    const maxHumans = this.isMobile ? 2 : 4;
    if (!Number.isInteger(humans) || humans < 1 || humans > maxHumans) {
      return null;
    }
    if (!Number.isInteger(bots) || bots < 0) {
      return null;
    }

    const maxBots = 4 - humans;
    if (bots > maxBots) {
      return null;
    }
    if (!Number.isInteger(sphereSize) || sphereSize < 0 || sphereSize > 9) {
      return null;
    }

    return { humans, bots, sphereSize, continuous, jumpMode };
  }

  applyMenuSettings(settings) {
    this.menu.humans = this.isMobile ? Math.min(settings.humans, 2) : settings.humans;
    this.menu.bots = Math.min(settings.bots, 4 - this.menu.humans);
    this.menu.sphereSize = settings.sphereSize;
    this.menu.continuous = settings.continuous;
    this.menu.jumpMode = settings.jumpMode;
  }

  clearMenuControlPreview() {
    for (const el of this.menuControlPreviewEls) {
      el.remove();
    }
    this.menuControlPreviewEls.length = 0;
  }

  showMenuControlPreview() {
    this.clearMenuControlPreview();
    const total = this.menu.humans + this.menu.bots;
    const humanCount = this.menu.humans;
    const viewports = this.getViewportsForCount(total);

    for (let i = 0; i < humanCount; i += 1) {
      const control = CONTROL_SCHEMES[i];
      const text = this.menu.jumpMode
        ? `${control.label} ${this.codeLabel(control.left)}/${this.codeLabel(control.right)} + ${this.codeLabel(control.dash)}`
        : `${control.label} ${this.codeLabel(control.left)}/${this.codeLabel(control.right)}`;
      const el = document.createElement("div");
      el.className = "viewport-label menu-control-preview";
      el.style.borderColor = `#${PLAYER_COLORS[i].toString(16).padStart(6, "0")}`;
      el.textContent = text;
      this.viewportLabels.appendChild(el);
      this.menuControlPreviewEls.push(el);

      const v = viewports[i];
      if (!v) {
        continue;
      }
      const width = window.innerWidth;
      const height = window.innerHeight;
      const vx = Math.floor(v.x * width);
      const vy = Math.floor(v.y * height);
      const vw = Math.floor(v.w * width);
      const vh = Math.floor(v.h * height);
      el.style.left = `${vx + 8}px`;
      el.style.top = `${height - vy - vh + 8}px`;
      el.style.maxWidth = `${Math.max(100, vw - 16)}px`;
    }
  }

  saveMenuSettings() {
    const settings = this.sanitizeMenuSettings(this.menu);
    if (!settings) {
      return;
    }

    this.savedMenuSettings = settings;
    try {
      localStorage.setItem(MENU_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      // Ignore storage failures (private mode/quota/security settings).
    }
  }

  updateRunning(dt) {
    this.updateRespawningPlayers(dt);
    this.updateDashEffects(dt);

    for (const player of this.players) {
      player.dashFlashTimer = Math.max(0, player.dashFlashTimer - dt);
      if (player.status === PLAYER_STATUS.ACTIVE) {
        player.spawnGraceTimer = Math.max(0, player.spawnGraceTimer - dt);
      }
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
        const mobileTurn = this.getMobileTurnForPlayer(player);
        player.turnInput = THREE.MathUtils.clamp(keyboardTurn + gamepadTurn + mobileTurn, -1, 1);

        const gamepadJumpPressed = this.input.consumeGamepadButtonPress(player.id, GAMEPAD.JUMP_BUTTON);
        const keyboardJumpPressed = this.input.consumePress(player.control.dash);
        if (this.menu.jumpMode && player.spawnGraceTimer <= 0 && (keyboardJumpPressed || gamepadJumpPressed)) {
          player.dashRequested = true;
        }
      }
    }

    const predictedHeads = this.predictHeads(activePlayers);

    for (const player of activePlayers) {
      if (player.isBot) {
        player.turnInput = this.botBrain.decide(player, this.players, predictedHeads);
        if (this.menu.jumpMode && player.spawnGraceTimer <= 0 && player.dashCooldown <= 0 && this.shouldBotDash(player)) {
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
      this.updateHeadVisuals(player, dt);
      if (player.spawnGraceTimer <= 0) {
        player.trail.addPoint(player.pos, dt);
      }

      if (this.menu.jumpMode && player.spawnGraceTimer <= 0 && player.dashRequested && player.dashCooldown <= 0) {
        this.performDash(player);
      }
    }

    const crashed = [];
    for (const player of activePlayers) {
      if (player.spawnGraceTimer > 0) {
        continue;
      }
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
      } else if (player.status === PLAYER_STATUS.OUT || player.status === PLAYER_STATUS.RESPAWNING) {
        this.updateHeadVisuals(player, dt);
        this.updateDeathCamera(player, dt);
      }
    }

    this.updateViewportLabels();
  }

  updateRoundOver(dt) {
    for (const player of this.players) {
      if (player.status === PLAYER_STATUS.ACTIVE) {
        this.updateCamera(player);
      } else if (player.status === PLAYER_STATUS.OUT || player.status === PLAYER_STATUS.RESPAWNING) {
        this.updateHeadVisuals(player, dt);
        this.updateDeathCamera(player, dt);
      }
    }
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

    this.updateHeadVisuals(player, 0);
    player.trail.forceGap(this.config.dashGapDuration, player.pos);
    player.dashCooldown = this.config.dashCooldown;
    player.dashFlashTimer = this.config.dashScreenFlash;

    this.spawnDashBurst(player);
  }

  handleCrash(player) {
    player.deathEyeWobbleActive = true;
    player.deathEyeWobbleTime = 0;
    player.deathEyeWobblePhase = Math.random() * Math.PI * 2;
    player.deathCameraTime = 0;
    player.deathCameraDir = Math.random() < 0.5 ? -1 : 1;
    this.updateHeadVisuals(player, 0);

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
    player.headMesh.visible = true;
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
    player.headMesh.visible = true;
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
    const cameraLen = Math.hypot(this.config.cameraDistance, this.config.cameraHeight);
    const baseCameraLen = Math.hypot(DASH_FX_BASE_CAMERA.distance, DASH_FX_BASE_CAMERA.height);
    const fxScale = THREE.MathUtils.clamp(cameraLen / baseCameraLen, 0.55, 2.6);

    const origin = player.pos.clone().addScaledVector(player.forward, -0.6 * fxScale);
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
      fx.mesh.position.copy(origin).addScaledVector(dir, Math.random() * 0.6 * fxScale);
      fx.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      fx.velocity.copy(dir.multiplyScalar((18 + Math.random() * 9) * fxScale));
      fx.life = 0;
      fx.maxLife = 0.14 + Math.random() * 0.12;
      fx.mesh.material.opacity = 0.95;
      fx.mesh.scale.set(fxScale, (0.6 + Math.random() * 0.8) * fxScale, fxScale);
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
    const up = winner.up.clone().normalize();
    const right = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-5) {
      right.crossVectors(up, new THREE.Vector3(1, 0, 0));
    }
    right.normalize();
    const forward = new THREE.Vector3().crossVectors(right, up).normalize();

    this.celebrationGroup.visible = true;
    this.celebration = {
      center: winner.pos.clone(),
      up,
      right,
      forward,
      time: 0,
    };
    this.spectatorCenter.copy(winner.pos);

    this.crownGroup.position.copy(winner.pos).addScaledVector(up, 1.9);

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
    const crownBob = 1.9 + Math.sin(t * 3.2) * 0.28;
    const crownPos = this.celebration.center.clone().addScaledVector(this.celebration.up, crownBob);
    this.crownGroup.position.copy(crownPos);
    const crownAlign = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.celebration.up);
    const crownSpin = new THREE.Quaternion().setFromAxisAngle(this.celebration.up, t * 1.2);
    this.crownGroup.quaternion.copy(crownSpin).multiply(crownAlign);

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

    const orbitRadius = 13.8;
    const orbitLift = 5.7;
    const orbitSpeed = 0.45;
    const orbitAngle = t * orbitSpeed;
    const orbitOffset = this.celebration.right
      .clone()
      .multiplyScalar(Math.cos(orbitAngle) * orbitRadius)
      .addScaledVector(this.celebration.forward, Math.sin(orbitAngle) * orbitRadius)
      .addScaledVector(this.celebration.up, orbitLift);
    this.spectatorCamera.position.copy(this.celebration.center).add(orbitOffset);
    this.spectatorCamera.up.copy(this.spectatorCamera.position.clone().normalize());
    this.spectatorCamera.lookAt(this.celebration.center);
  }

  updateCamera(player) {
    const back = player.forward.clone().multiplyScalar(-this.config.cameraDistance);
    const up = player.up.clone().multiplyScalar(this.config.cameraHeight);
    const desired = player.pos.clone().add(back).add(up);
    player.camera.position.copy(desired);
    player.camera.up.copy(player.forward);
    player.camera.lookAt(player.pos);
  }

  updateDeathCamera(player, dt) {
    player.deathCameraTime += dt;
    const t = Math.min(1, player.deathCameraTime / DEATH_CAMERA_CONFIG.swingDuration);
    const ease = 1 - Math.pow(1 - t, 3);
    const swingAngle = ease * 2.55 * player.deathCameraDir;

    const orbit = player.forward
      .clone()
      .multiplyScalar(-this.config.cameraDistance * DEATH_CAMERA_CONFIG.orbitDistanceFactor)
      .applyAxisAngle(player.up, swingAngle);
    const up = player.up.clone().multiplyScalar(this.config.cameraHeight * DEATH_CAMERA_CONFIG.liftFactor);
    const desired = player.pos.clone().add(orbit).add(up);

    player.camera.position.copy(desired);
    player.camera.up.copy(player.up);
    player.camera.lookAt(player.pos.clone().addScaledVector(player.up, 0.1));
  }

  getViewportsForCount(n) {
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

  getViewports() {
    return this.getViewportsForCount(this.players.length);
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

      const dashCooldownEl = document.createElement("div");
      dashCooldownEl.className = "dash-cooldown";
      this.viewportLabels.appendChild(dashCooldownEl);
      player.dashCooldownEl = dashCooldownEl;
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
      if (player.status === PLAYER_STATUS.ACTIVE && player.spawnGraceTimer > 0) {
        parts.push(`SAFE:${player.spawnGraceTimer.toFixed(1)}`);
      }
      parts.push(`S:${player.score}`);
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

    const showLabels =
      this.state === GAME_STATE.RUNNING ||
      this.state === GAME_STATE.ROUND_OVER ||
      this.state === GAME_STATE.MENU_READY;
    this.viewportLabels.style.display = showLabels ? "block" : "none";

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

      if (player.dashCooldownEl) {
        const spawnCoolingDown = player.status === PLAYER_STATUS.ACTIVE && player.spawnGraceTimer > 0;
        const jumpCoolingDown = this.menu.jumpMode && player.status === PLAYER_STATUS.ACTIVE && player.dashCooldown > 0;
        const isCoolingDown = spawnCoolingDown || jumpCoolingDown;
        if (!isCoolingDown) {
          player.dashCooldownEl.style.opacity = "0";
        } else {
          const normalized = spawnCoolingDown
            ? THREE.MathUtils.clamp(player.spawnGraceTimer / this.config.spawnGraceDuration, 0, 1)
            : THREE.MathUtils.clamp(player.dashCooldown / this.config.dashCooldown, 0, 1);
          const headNdc = player.pos.clone().project(player.camera);
          if (headNdc.z < -1 || headNdc.z > 1) {
            player.dashCooldownEl.style.opacity = "0";
            continue;
          }
          const px = vx + (headNdc.x * 0.5 + 0.5) * vw;
          const py = height - (vy + (headNdc.y * 0.5 + 0.5) * vh);
          player.dashCooldownEl.style.left = `${px - 16}px`;
          player.dashCooldownEl.style.top = `${py + 24}px`;
          player.dashCooldownEl.style.setProperty("--cooldown-half-angle", `${(normalized * 180).toFixed(2)}deg`);
          player.dashCooldownEl.style.setProperty("--cooldown-color", spawnCoolingDown ? "rgba(255, 222, 120, 0.95)" : "rgba(160, 226, 255, 0.95)");
          player.dashCooldownEl.style.opacity = "1";
        }
      }
    }

    this.renderer.setScissorTest(false);
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.spectatorCamera.aspect = window.innerWidth / window.innerHeight;
    this.spectatorCamera.updateProjectionMatrix();
    if (this.state === GAME_STATE.MENU_READY) {
      this.showMenuControlPreview();
    }
  }

  run = () => {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === GAME_STATE.RUNNING) {
      this.updateRunning(dt);
    } else if (this.state === GAME_STATE.ROUND_OVER) {
      this.updateRoundOver(dt);
      this.updateMenu();
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


export default SphereSnakeGame;
