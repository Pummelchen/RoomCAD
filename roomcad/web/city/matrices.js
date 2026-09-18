// The city's scratch vectors, quaternions and the two box-matrix helpers.
//
// Part of city.js, which is split under roomcad/web/city/.

import * as THREE from "three";

export const _m = new THREE.Matrix4();
export const _arrowFace = new THREE.Matrix4();
export const _arrowRoll = new THREE.Matrix4();
export const _arrowScale = new THREE.Matrix4();
export const _paint = new THREE.Color();
export const _q = new THREE.Quaternion();
export const _pos = new THREE.Vector3();
export const _scale = new THREE.Vector3();
export const _euler = new THREE.Euler();
export const _color = new THREE.Color();
export const _colorB = new THREE.Color();

/// Composes a box transform. `into` lets a caller supply its own matrix, which
/// matters for the traffic: it runs every frame, and allocating a fresh Matrix4
/// three times per car was roughly 11,500 throwaway objects a second.
export function boxMatrix(x, y, z, w, h, d, rotY = 0, into = null) {
  _pos.set(x, y, z);
  _scale.set(w, h, d);
  _q.setFromEuler(_euler.set(0, rotY, 0));
  return (into || new THREE.Matrix4()).compose(_pos, _q, _scale);
}

/// The same, but leaning. `pitch` is the nose going down under the brakes and
/// up under power; `roll` is the body leaning out of a corner. Applied in the
/// vehicle's own frame — yaw first, then the lean about the axes that yaw
/// leaves pointing along and across the vehicle — so a car diving under braking
/// dives towards where it is going rather than towards north.
export function bodyMatrix(x, y, z, w, h, d, rotY, pitch, roll, into = null) {
  _pos.set(x, y, z);
  _scale.set(w, h, d);
  // The body is modelled with its LENGTH along local X, so leaning about that
  // axis is roll and nodding about local Z is pitch. Taking the Euler angles in
  // the order they are named instead gives a car that leans sideways under the
  // brakes and lifts its nose going round a corner.
  _q.setFromEuler(_euler.set(roll, rotY, pitch, "YXZ"));
  return (into || new THREE.Matrix4()).compose(_pos, _q, _scale);
}
