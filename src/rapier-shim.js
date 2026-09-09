// Rapier(compat) 로더.
// compat 빌드는 wasm 을 base64 로 내장하고 있어 별도 fetch 없이 동작한다.
// jsdelivr 빌드에 따라 default / namespace 중 무엇이 오는지 달라서 여기서 흡수한다.
import * as ns from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js';

const RAPIER = (ns && ns.World) ? ns : (ns.default || ns);
export default RAPIER;
