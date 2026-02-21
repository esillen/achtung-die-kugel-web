import { PLAYER_STATUS } from "./game-state.js";
import { advanceOnSphere, hitsAnyTrail } from "./physics.js";

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


export default BotBrain;
