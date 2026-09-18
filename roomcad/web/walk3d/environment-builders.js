// Walk3D: environment builders.
//
// Part of walk3d.js; applied to `Walk3D.prototype` there, so `this` is the
// viewer and every method still reaches every other one.

import * as THREE from "three";
import { pass, mrt, output, emissive, normalView } from "three/tsl";
import { ssao } from "three/addons/tsl/display/SSAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { store } from "../store.js";
import {
  DAY_BACKGROUND,
  FOG_FAR,
  FOG_NEAR,
  NIGHT_BACKGROUND,
  OVERCAST_SKY,
  SKY_DOME_MAX,
  TWILIGHT_BACKGROUND,
} from "./constants.js";
import { clamp01, smoothstep01, sunForHour } from "./sun.js";

export const environment_builders = {

  /// A large unlit sky dome so the gradient rotates naturally with the camera.
  ///
  /// It is sized from the city's reach, not from a constant: the dome has to
  /// contain everywhere the player can walk, and the neighbourhood city.js
  /// builds is wider than the 200 m sphere this used to be. The cap keeps it
  /// inside the camera's far plane, where it is not clipped away, and the
  /// viewer-centred followSky() below keeps it around the player whatever its
  /// radius. `BackSide` stays: the dome is meant to be looked at from inside.
  buildSky(room) {
    const building = this.currentBuildingBounds || this.buildingBounds(room);
    const radius = Math.min(this.cityReach(building), SKY_DOME_MAX);
    const geo = new THREE.SphereGeometry(radius, 32, 16);
    const mat = new THREE.MeshBasicMaterial({
      map: this.skyTexture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.position.set(building.centerX, this.floorY(), building.centerZ);
    sky.renderOrder = -10;
    // Not a solid: a shot must not be able to hit the sky dome, or the 60 m
    // fallback range in shoot() is dead and the paint lands 380 m away.
    sky.userData.environment = true;
    this.scene.add(sky);
    this.skyMesh = sky;
    this.buildClouds(room);
  },

  /// Keeps the sky dome around the viewer.
  ///
  /// A dome with `BackSide` is only ever seen from inside it, so its centre is
  /// the one thing that must never be walked away from. Centred on the building
  /// it could be: the city reaches about 272 m from the plot even for a small
  /// room, and the outermost streets — and the roofs above them — are places
  /// the player can stand. Moving with the camera means there is no edge to
  /// reach, whatever the room's size.
  followSky() {
    if (!this.skyMesh) return;
    this.skyMesh.position.set(
      this.camera.position.x, this.floorY(), this.camera.position.z);
  },

  /// Sun direction as a unit vector (North = -Z, azimuth clockwise from North,
  /// matching the 2D editor where the top of the plan is North 0°).
  sunDirectionVec(altitude, azimuth) {
    const alt = Math.max(altitude, 0.05); // keep it just above the horizon at night
    return new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(alt),  // East  (+X)
      Math.sin(alt),                       // up    (+Y)
      -Math.cos(azimuth) * Math.cos(alt)   // North (-Z)
    );
  },

  /// Forgets what the lighting was last applied for. A rebuild leaves the new
  /// scene — sun, sky, cloud decks — at its own defaults, and the no-change
  /// guard in applyTimeOfDay() would otherwise skip lighting it because the
  /// store's hour, lights and weather have not moved.
  invalidateTimeOfDay() {
    this.appliedHour = undefined;
    this.appliedWeather = undefined;
    this.appliedLightsOn = undefined;
    this.appliedCityKey = undefined;
  },

  /// Positions the sun, sky and ambient light for the current store.timeOfDay
  /// hour (24 h clock). Called after a build and whenever the time (or the L
  /// lighting mode) changes.
  applyTimeOfDay() {
    if (!this.sun || !this.sunTarget) return;
    const hour = store.timeOfDay;
    // This also runs from the store's change subscription on every emit while
    // 3D is visible — in the inspector that is once per keystroke. Everything
    // below is a function of these values alone, and it is not free: several
    // Colours, the weather materials, all three cloud decks and all six of the
    // city's light bands. When none of them moved there is nothing to redo.
    // The city's key is one of them, because a rebuilt neighbourhood comes up
    // at its own defaults even at an unchanged hour; a rebuilt scene
    // invalidates the lot outright.
    if (hour === this.appliedHour
        && store.weather === this.appliedWeather
        && this.lightsOn === this.appliedLightsOn
        && this.city.key === this.appliedCityKey) return;
    this.appliedHour = hour;
    this.appliedWeather = store.weather;
    this.appliedLightsOn = this.lightsOn;
    this.appliedCityKey = this.city.key;
    const { altitude, azimuth } = sunForHour(hour);
    const altDeg = altitude * 180 / Math.PI;

    // dayAmount ramps 0 (deep night) → 1 (full day) through civil twilight;
    // twilight peaks as the sun crosses the horizon (sunrise/sunset tint).
    const dayAmount = smoothstep01(-6, 3, altDeg);
    const nightAmount = 1 - dayAmount;
    const twilight = clamp01(1 - Math.abs(altDeg + 1.5) / 7);

    // Sun position + intensity (the L toggle still switches the room to
    // placed-lights-only, which turns the sun off).
    this.sunDir = this.sunDirectionVec(altitude, azimuth);
    this.aimSun();

    const day = this.lightsOn;
    // Weather first: the city owns it, and the sun, fog and cloud deck all
    // have to agree with what is falling out of the sky.
    this.city.setWeather(store.weather);
    const air = this.city.atmosphere();
    this.sun.intensity = 2.8 * dayAmount * (day ? 1 : 0) * (1 - air.dim);
    // Ambient sky keeps the interior readable at twilight and night.
    // Overcast loses the sun but gains bounced light off the cloud base, which
    // is why a grey day is flat rather than simply dark.
    if (this.hemisphere) {
      this.hemisphere.intensity = 0.55 * (0.06 + 0.94 * dayAmount) * (1 + air.dim * 0.5);
    }
    if (this.fill) this.fill.intensity = 0.35 * dayAmount * (day ? 1 : 0);

    // Sky + fog colour: day → warm twilight → deep night.
    const sky = new THREE.Color(DAY_BACKGROUND)
      .lerp(new THREE.Color(TWILIGHT_BACKGROUND), twilight)
      .lerp(new THREE.Color(NIGHT_BACKGROUND), nightAmount * (1 - twilight * 0.5));
    // Weather washes the colour out of the sky towards flat grey, and closes
    // the fog in around the viewer.
    if (air.haze > 0) sky.lerp(new THREE.Color(OVERCAST_SKY), air.haze * 0.55 * dayAmount);
    this.scene.background = sky;
    if (this.scene.fog) {
      this.scene.fog.color.copy(sky);
      this.scene.fog.near = FOG_NEAR * (1 - air.haze * 0.5);
      this.scene.fog.far = FOG_FAR * (1 - air.haze * 0.62);
    }
    if (this.skyMesh) this.skyMesh.visible = dayAmount > 0.3;

    // Clouds stay in the sky after dark, but as dim silhouettes rather than
    // bright white, and they catch the twilight tint as it passes.
    const cloudColor = new THREE.Color(0xffffff)
      .lerp(new THREE.Color(0xffc9a6), twilight * 0.8)
      .lerp(new THREE.Color(0x2a3346), nightAmount * (1 - twilight * 0.6));
    for (const layer of this.cloudLayers || []) {
      layer.mat.color.copy(cloudColor);
      layer.mat.opacity = Math.min(1, layer.base * (0.30 + 0.70 * dayAmount) * (1 + air.haze * 1.4));
    }

    // Image-based lighting only while the sun is actually up.
    this.scene.environment = (day && dayAmount > 0.05) ? this.environment : null;

    // The city follows the same effective daylight as the sun, so the L
    // toggle darkens the whole world rather than just the room.
    this.city.applyTimeOfDay(dayAmount * (day ? 1 : 0));

    // Room fixtures only light in placed-lights mode (the L toggle).
    for (const l of this.pointLights) l.visible = !day;
    for (const e of this.fixtureEmissives) e.mat.emissiveIntensity = day ? 0 : e.on;

  },

  /// Applies the current lighting: uniform daylight (placed lights off) or
  /// placed-lights-only, further shaped by the time of day (sun and sky).
  toggleLights() {
    this.lightsOn = !this.lightsOn;
    this.applyTimeOfDay();
  },

  // MARK: Post-processing (SSAO + bloom, WebGPU TSL)

  setupPostProcessing() {
    try {
      this.setupSaoBloom();
    } catch (err) {
      console.error("SSAO/bloom failed, falling back to direct render:", err);
      this.renderPipeline = null;
    }
  },

  setupSaoBloom() {
    this.renderPipeline = new THREE.RenderPipeline(this.renderer);

    // One scene pass that also writes view-space normals (for SSAO) and the
    // emissive term (for a selective bloom that ignores the white floor).
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive, normal: normalView }));

    const scenePassColor = scenePass.getTextureNode('output');
    const scenePassDepth = scenePass.getTextureNode('depth');
    const scenePassNormal = scenePass.getTextureNode('normal');

    // Soft-contact shadows: screen-space ambient occlusion.
    const ssaoPass = ssao(scenePassDepth, scenePassNormal, this.camera);
    ssaoPass.samples.value = 16;
    ssaoPass.radius.value = 0.5;
    ssaoPass.intensity.value = 1.2;
    ssaoPass.bias.value = 0.025;
    ssaoPass.resolutionScale = 0.5;

    // Bloom only the emissive surfaces (room lights), so the
    // white marble tiles stay flat instead of glowing.
    const emissivePass = scenePass.getTextureNode('emissive');
    const bloomPass = bloom(emissivePass, 0.55, 0.5, 0.85);

    this.renderPipeline.outputNode = scenePassColor.mul(ssaoPass.r).add(bloomPass);
  }
};
