import SphereSnakeGame from "./SphereSnakeGame.js";

const canvas = document.getElementById("game-canvas");
const overlay = document.getElementById("overlay");
const subtitle = document.getElementById("subtitle");
const hint = document.getElementById("hint");
const viewportLabels = document.getElementById("viewport-labels");

const game = new SphereSnakeGame(canvas, overlay, subtitle, hint, viewportLabels);
game.run();
