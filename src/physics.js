import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

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


export { advanceOnSphere, hitsAnyTrail };
