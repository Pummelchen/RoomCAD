// The seven-room demo, restored from the original app's plan.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { point, uid } from "./core.js";
import { stairBathroomLayout } from "./furniture.js";
import { centerRoom, freshRoom } from "./room.js";
import { wallLength } from "./walls.js";


// MARK: - The seven-room demo (restored from the original app's plan)

function frontFurnitureSet(bounds) {
  const clearance = 0.05;
  // Front beds face east (rotation 90°): 2.00 × 0.90 footprint.
  const bedWidth = 2.00;
  const bedDepth = 0.90;
  const bedCenter = point(bounds.minX + clearance + bedWidth / 2, bounds.minZ + clearance + bedDepth / 2);
  return [
    { id: uid(), kind: "bed", center: bedCenter, rotationDegrees: 90 },
    {
      id: uid(), kind: "chair",
      center: point(bedCenter.x + bedWidth / 2 + 0.15 + 0.45 / 2, bounds.minZ + clearance + 0.47 / 2),
      rotationDegrees: 0,
    },
    {
      id: uid(), kind: "wardrobe",
      center: point(bounds.minX + clearance + 1.0 / 2, bounds.maxZ - clearance - 0.6 / 2),
      rotationDegrees: 0,
    },
  ];
}

function rearFurnitureSet(bounds) {
  const clearance = 0.05;
  return [
    {
      id: uid(), kind: "bed",
      center: point(bounds.minX + clearance + 0.9 / 2, bounds.minZ + clearance + 2.0 / 2),
      rotationDegrees: 0,
    },
    {
      id: uid(), kind: "wardrobe",
      center: point(bounds.minX + clearance + 0.6 / 2, bounds.minZ + 4.30),
      rotationDegrees: 90,
    },
    {
      id: uid(), kind: "chair",
      center: point(bounds.minX + clearance + 0.45 / 2, bounds.minZ + 2.35),
      rotationDegrees: 0,
    },
  ];
}

/// The original bathroom-connected concept: six front rooms, a rear Room 7,
/// and the fixed stair/bathroom core at the back. This is the default room.
export function demoRoom() {
  const room = freshRoom("7-Room Demo", 4.87, 16.44, 3.60);
  room.walls = [];
  room.doors = [];
  room.windows = [];
  room.furniture = [];

  const core = stairBathroomLayout(room);

  // Outer shell
  room.walls.push(
    { id: uid(), start: point(0, 0), end: point(room.width, 0) },
    { id: uid(), start: point(room.width, 0), end: point(room.width, room.length) },
    { id: uid(), start: point(room.width, room.length), end: point(0, room.length) },
    { id: uid(), start: point(0, room.length), end: point(0, 0) },
  );

  // Front rooms
  const corridorMinX = core.lowerOpening.minX;
  const frontRoomCount = 6;
  const standardDepth = 1.70;
  const lastFrontStart = standardDepth * (frontRoomCount - 1);
  const turnConnector = {
    minX: core.upperFlight.minX,
    maxX: core.lowerOpening.maxX,
    minZ: core.core.minZ - 0.90,
    maxZ: core.core.minZ,
  };

  for (let index = 0; index < frontRoomCount; index++) {
    const isLast = index === frontRoomCount - 1;
    const startZ = isLast ? lastFrontStart : index * standardDepth;
    const endZ = isLast ? core.core.minZ : (index + 1) * standardDepth;
    const entranceEndZ = isLast ? turnConnector.minZ : endZ;
    const entranceWall = {
      id: uid(),
      start: point(corridorMinX, startZ),
      end: point(corridorMinX, entranceEndZ),
    };
    const entranceLength = wallLength(entranceWall);
    const doorWidth = Math.min(0.90, Math.max(0.60, entranceLength - 0.20));
    const door = {
      id: uid(),
      wallID: entranceWall.id,
      offset: Math.max(0, (entranceLength - doorWidth) / 2),
      width: doorWidth,
      open: true,
      swingInside: true,
    };
    room.walls.push(entranceWall);
    room.doors.push(door);

    if (isLast) {
      room.walls.push(
        { id: uid(), start: point(core.upperFlight.minX, turnConnector.minZ), end: point(corridorMinX, turnConnector.minZ) },
        { id: uid(), start: point(core.upperFlight.minX, turnConnector.minZ), end: point(core.upperFlight.minX, endZ) },
        { id: uid(), start: point(0, endZ), end: point(core.upperFlight.minX, endZ) },
      );
    } else {
      room.walls.push({ id: uid(), start: point(0, endZ), end: point(corridorMinX, endZ) });
    }

    room.furniture.push(...frontFurnitureSet({
      minX: 0, maxX: corridorMinX, minZ: startZ, maxZ: endZ,
    }));
  }

  // Rear Room 7
  const rearStartZ = core.core.minZ;
  const rearBounds = { minX: 0, maxX: core.rearWindowEndX, minZ: rearStartZ, maxZ: room.length };
  const rearEntranceWall = {
    id: uid(),
    start: point(1.10, rearStartZ),
    end: point(1.10, core.upperFlight.maxZ),
  };
  const rearDoor = {
    id: uid(),
    wallID: rearEntranceWall.id,
    offset: core.upperFlight.minZ - rearStartZ - 0.80,
    width: 0.90,
    open: true,
    swingInside: true,
  };
  room.walls.push(
    rearEntranceWall,
    { id: uid(), start: point(1.10, core.upperFlight.maxZ), end: point(core.rearWindowEndX, core.upperFlight.maxZ) },
    { id: uid(), start: point(core.rearWindowEndX, core.upperFlight.maxZ), end: point(core.rearWindowEndX, room.length) },
  );
  room.doors.push(rearDoor);
  room.furniture.push(...rearFurnitureSet(rearBounds));

  // The two-pane rear window of Room 7
  const rearWall = room.walls.find(w => w.start.x === 0 && w.start.z === room.length);
  if (rearWall) {
    room.windows.push(
      { id: uid(), wallID: rearWall.id, offset: 0.08, width: 0.72 },
      { id: uid(), wallID: rearWall.id, offset: 0.88, width: 0.72 },
    );
  }

  // Centre the whole room on the 25 × 25 m canvas.
  centerRoom(room);
  return room;
}
