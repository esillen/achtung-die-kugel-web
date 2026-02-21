import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

class SnakeTrail {
  constructor(scene, color, config) {
    this.scene = scene;
    this.config = config;
    this.baseColor = color;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    this.capGeometry = new THREE.SphereGeometry(config.bodyRadius, 10, 10);

    this.segments = [];
    this.currentSegment = null;
    this.solidPoints = [];
    this.lastPlacedPoint = null;
    this.sampleSpacing = config.bodyRadius * 0.9;

    this.inGap = false;
    this.timeToNextGap = this.rand(config.gapIntervalMin, config.gapIntervalMax);
    this.gapRemaining = 0;
  }

  reset() {
    for (const segment of this.segments) {
      if (segment.mesh) {
        this.root.remove(segment.mesh);
        segment.mesh.geometry.dispose();
      }
      this.root.remove(segment.startCap);
      this.root.remove(segment.endCap);
    }

    this.segments.length = 0;
    this.currentSegment = null;
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
        this.currentSegment = null;
      }
      return;
    }

    this.timeToNextGap -= dt;
    if (this.timeToNextGap <= 0) {
      this.inGap = true;
      this.gapRemaining = this.rand(this.config.gapDurationMin, this.config.gapDurationMax);
      this.timeToNextGap = this.rand(this.config.gapIntervalMin, this.config.gapIntervalMax);
      this.currentSegment = null;
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
    if (!this.currentSegment) {
      const startCap = new THREE.Mesh(this.capGeometry, this.material);
      const endCap = new THREE.Mesh(this.capGeometry, this.material);
      startCap.position.copy(point);
      endCap.position.copy(point);
      this.root.add(startCap);
      this.root.add(endCap);

      this.currentSegment = {
        points: [],
        mesh: null,
        startCap,
        endCap,
      };
      this.segments.push(this.currentSegment);
    }

    this.currentSegment.points.push(point.clone());
    this.currentSegment.endCap.position.copy(point);
    if (this.currentSegment.points.length === 1) {
      this.currentSegment.startCap.position.copy(point);
    }

    if (this.currentSegment.points.length < 2) {
      this.solidPoints.push(point.clone());
      return;
    }

    const tubeSegments = Math.max(10, this.currentSegment.points.length * 2);
    const geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(this.currentSegment.points),
      tubeSegments,
      this.config.bodyRadius,
      8,
      false,
    );

    if (!this.currentSegment.mesh) {
      this.currentSegment.mesh = new THREE.Mesh(geometry, this.material);
      this.root.add(this.currentSegment.mesh);
    } else {
      this.currentSegment.mesh.geometry.dispose();
      this.currentSegment.mesh.geometry = geometry;
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
    this.currentSegment = null;
    if (referencePoint) {
      this.lastPlacedPoint = referencePoint.clone();
    }
  }

  dispose() {
    this.reset();
    this.capGeometry.dispose();
    this.material.dispose();
    this.scene.remove(this.root);
  }

  rand(min, max) {
    return min + Math.random() * (max - min);
  }
}


export default SnakeTrail;
