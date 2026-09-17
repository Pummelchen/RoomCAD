// The room model, and the public entry point for it.
//
// Split into roomcad/web/plan/ so each part is navigable; this file re-exports
// all of them, so `import * as P from "./plan.js"` keeps working exactly as it
// did when the whole model was one file. Five modules and every test import it
// as a namespace, so none of them had to change.

export * from "./plan/core.js";
export * from "./plan/room.js";
export * from "./plan/grid.js";
export * from "./plan/walls.js";
export * from "./plan/hit.js";
export * from "./plan/openings.js";
export * from "./plan/furniture.js";
export * from "./plan/labels.js";
export * from "./plan/rooms.js";
export * from "./plan/captions.js";
export * from "./plan/sanitize.js";
export * from "./plan/layout-grid.js";
export * from "./plan/layout-slice.js";
export * from "./plan/layout-partition.js";
export * from "./plan/layout.js";
export * from "./plan/demo.js";
export * from "./plan/rcad.js";
