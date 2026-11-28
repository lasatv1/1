/**
 * Plain-JS subset of satellite.js (SGP4/SDP4 orbit propagation, MIT licence).
 * The package index also re-exports an optional WebAssembly build that isn't needed here
 * and breaks the production bundle, so only the pure-JS modules are imported.
 */
export { json2satrec } from '../../node_modules/satellite.js/dist/io.js';
export { propagate, gstime } from '../../node_modules/satellite.js/dist/propagation.js';
export { eciToGeodetic, degreesLat, degreesLong } from '../../node_modules/satellite.js/dist/transforms.js';
export type { SatRec } from '../../node_modules/satellite.js/dist/propagation/SatRec.js';
