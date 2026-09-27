// Route bake (SPEC §2): OSM way chain → metric polyline in BayFrame → 1 m arc-length centreline, smoothed with a
// curvature clamp → per-sample width, surface and height (3DEP terrain; stair flights get a linear base and a
// riser sawtooth) → sections, checkpoints, stair flights, kickers, rail crossings, obstacles and street props.
// Reads only the data/raw cache and public/terrain. Output public/route/track1.bin + index.json; byte-identical
// across runs.
//   node tools/route/build.mjs [--out dir] [--osm path]   (--osm: a fixture instead of the cached source, G2)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTerrain, loadOSM, geoToLocal, ROOT } from './lib.mjs';
import { readCached } from '../data/cache.mjs';

const args = process.argv.slice( 2 );
const opt = ( k, d ) => ( args.includes( k ) ? args[ args.indexOf( k ) + 1 ] : d );
const OUT = opt( '--out', join( ROOT, 'public/route' ) );

// ---------------------------------------------------------------- the course (OSM node ids)
// Each via is an OSM node the route passes through, in order; legs between vias are shortest paths over the
// OSM highway graph. `section` starts a named section at that via.
export const VIAS = [
	{ node: 8707161910, section: 'Coit Tower Plaza' }, // the tower's north terrace, facing the bay, tower behind
	{ node: 612024122 }, // down the two terrace flights to the parking circle
	{ node: 612024125, section: 'Telegraph Hill Blvd' }, // onto the boulevard at the summit circle
	{ node: 65322055 }, { node: 65322068 }, // its descent round the east side of the summit
	{ node: 612024923, section: 'Filbert Steps — upper flight' }, // top of the east Filbert Steps
	{ node: 612024921 }, { node: 8707276719 }, { node: 13825576331 },
	{ node: 65305869, section: 'Montgomery St crossing' }, // Montgomery Street at Filbert
	{ node: 8707276720 },
	{ node: 10767002473, section: 'Filbert Steps — lower flight' }, // the wooden steps through Grace Marchant Garden
	{ node: 10767002472 }, { node: 13207717893 },
	{ node: 7234098551, section: 'Sansome → Embarcadero' }, // foot of the steps, onto Sansome
	{ node: 7234098549 }, { node: 7234075841 }, { node: 7234075840 }, // Filbert Street through Levi's Plaza
	{ node: 2071269347, section: 'Embarcadero sprint' }, // Herb Caen Way at Pier 23, over the Greenwich St crossing
	{ node: 2071269319 }, { node: 4406692007 },
	{ node: 833665803, section: 'Ferry Building' }, // the plaza run-in along the Ferry Building's west front
	{ node: 1742314646 }, // Herb Caen Way under the clock tower: the finish line
];
const FINISH_ANCHOR = [ 37.79555, - 122.39365 ]; // Ferry Building clock tower (data/landmarks.json)
const START_ANCHOR = [ 37.80239, - 122.40582 ]; // Coit Tower
const PLAZA_WIDTH = 5; // m: the start terrace (OSM maps only its centre path)

const SKIP = new Set( [ 'elevator', 'corridor', 'platform', 'construction', 'proposed', 'motorway', 'motorway_link', 'bus_stop' ] );
// cost per metre by class: the promenade and paths over the carriageway, never along the F-line busway
const COST = { steps: 1, footway: 1, pedestrian: 1, path: 1, cycleway: 1.1, service: 1, living_street: 1, residential: 1.2,
	tertiary: 1.2, secondary: 1.8, primary: 2, primary_link: 2, busway: 6 };
const DEFAULT_WIDTH = { steps: 2.5, footway: 3, path: 3, pedestrian: 5, cycleway: 3, service: 6 };
const STREET_WIDTH = 8, PROMENADE_WIDTH = 10;
const SNAP = 3.5; // m: unconnected nodes this close are joined (crossings, sidewalk ends)
export const SURFACE = { tarmac: 0, concrete: 1, stairs: 2, woodStairs: 3, brick: 4, wood: 5 };
const RISER = 0.17; // m, when OSM gives no step_count
const LANDING = 2.5; // m of flat at a turn inside a flight

// ---------------------------------------------------------------- graph
const osm = loadOSM( opt( '--osm' ) );
const T = loadTerrain();
const pos = new Map();
const P = ( id ) => {

	let p = pos.get( id );
	if ( ! p ) {

		const n = osm.nodes.get( id );
		if ( ! n ) throw new Error( `route: node ${ id } missing from the OSM source` );
		p = geoToLocal( n.lat, n.lon );
		pos.set( id, p );

	}

	return p;

};

const adj = new Map();
const link = ( a, b, cost, way ) => {

	if ( ! adj.has( a ) ) adj.set( a, [] );
	adj.get( a ).push( { to: b, cost, way } );

};

const graphNodes = new Set();
for ( const w of osm.ways ) {

	const t = w.tags || {};
	if ( ! t.highway || SKIP.has( t.highway ) || t.area === 'yes' ) continue;
	const f = COST[ t.highway ] ?? 1.3;
	for ( let i = 1; i < w.nodes.length; i ++ ) {

		const a = w.nodes[ i - 1 ], b = w.nodes[ i ];
		const d = Math.hypot( P( a ).x - P( b ).x, P( a ).z - P( b ).z );
		link( a, b, d * f, w );
		link( b, a, d * f, w );
		graphNodes.add( a );
		graphNodes.add( b );

	}

}

// snap links: a spatial hash over the graph nodes, sorted ids for a stable order
{

	const cell = new Map(), key = ( x, z ) => `${ Math.floor( x / SNAP ) },${ Math.floor( z / SNAP ) }`;
	const ids = [ ...graphNodes ].sort( ( a, b ) => a - b );
	for ( const id of ids ) {

		const k = key( P( id ).x, P( id ).z );
		if ( ! cell.has( k ) ) cell.set( k, [] );
		cell.get( k ).push( id );

	}

	for ( const a of ids ) {

		const pa = P( a ), cx = Math.floor( pa.x / SNAP ), cz = Math.floor( pa.z / SNAP );
		const near = new Set( ( adj.get( a ) || [] ).map( ( e ) => e.to ) );
		for ( let i = - 1; i <= 1; i ++ ) for ( let j = - 1; j <= 1; j ++ ) for ( const b of cell.get( `${ cx + i },${ cz + j }` ) || [] ) {

			if ( b <= a || near.has( b ) ) continue;
			const d = Math.hypot( pa.x - P( b ).x, pa.z - P( b ).z );
			if ( d < SNAP ) {

				link( a, b, d * 1.5 + 0.5, null );
				link( b, a, d * 1.5 + 0.5, null );

			}

		}

	}

}

function shortest( from, to ) {

	if ( from === to ) return [ { node: from, way: null } ];
	const dist = new Map( [ [ from, 0 ] ] ), prev = new Map(), done = new Set();
	const heap = [ [ 0, from ] ];
	const push = ( e ) => {

		heap.push( e );
		let i = heap.length - 1;
		while ( i > 0 ) {

			const p = ( i - 1 ) >> 1;
			if ( heap[ p ][ 0 ] < e[ 0 ] || ( heap[ p ][ 0 ] === e[ 0 ] && heap[ p ][ 1 ] <= e[ 1 ] ) ) break;
			heap[ i ] = heap[ p ];
			i = p;

		}

		heap[ i ] = e;

	};

	const pop = () => {

		const top = heap[ 0 ], last = heap.pop();
		if ( heap.length ) {

			let i = 0;
			for ( ;; ) {

				const l = 2 * i + 1, r = l + 1;
				let m = i, mv = last;
				if ( l < heap.length && ( heap[ l ][ 0 ] < mv[ 0 ] || ( heap[ l ][ 0 ] === mv[ 0 ] && heap[ l ][ 1 ] < mv[ 1 ] ) ) ) { m = l; mv = heap[ l ]; }
				if ( r < heap.length && ( heap[ r ][ 0 ] < mv[ 0 ] || ( heap[ r ][ 0 ] === mv[ 0 ] && heap[ r ][ 1 ] < mv[ 1 ] ) ) ) m = r;
				if ( m === i ) break;
				heap[ i ] = heap[ m ];
				i = m;

			}

			heap[ i ] = last;

		}

		return top;

	};

	while ( heap.length ) {

		const [ d, u ] = pop();
		if ( done.has( u ) ) continue;
		done.add( u );
		if ( u === to ) break;
		for ( const e of adj.get( u ) || [] ) {

			const nd = d + e.cost;
			if ( nd < ( dist.get( e.to ) ?? Infinity ) ) {

				dist.set( e.to, nd );
				prev.set( e.to, { from: u, way: e.way } );
				push( [ nd, e.to ] );

			}

		}

	}

	if ( ! prev.has( to ) ) throw new Error( `route: no path from node ${ from } to ${ to }` );
	const out = [];
	for ( let n = to; n !== from; ) {

		const p = prev.get( n );
		out.push( { node: n, way: p.way } );
		n = p.from;

	}

	out.push( { node: from, way: null } );
	return out.reverse();

}

// ---------------------------------------------------------------- way chain → polyline
const chain = []; // { x, z, way (of the segment arriving here), node, via?: index }
for ( let v = 0; v < VIAS.length - 1; v ++ ) {

	const leg = shortest( VIAS[ v ].node, VIAS[ v + 1 ].node );
	for ( let i = v === 0 ? 0 : 1; i < leg.length; i ++ ) {

		const p = P( leg[ i ].node );
		chain.push( { x: p.x, z: p.z, way: leg[ i ].way, node: leg[ i ].node, via: i === 0 ? v : i === leg.length - 1 ? v + 1 : undefined } );

	}

}

const anchor = geoToLocal( ...FINISH_ANCHOR );

// segment attributes: the way a segment belongs to (a snap link borrows the next real way)
for ( let i = chain.length - 1; i >= 1; i -- ) if ( ! chain[ i ].way ) chain[ i ].way = chain[ i + 1 ] ? chain[ i + 1 ].way : chain[ i - 1 ].way;

function segClass( way ) {

	const t = ( way && way.tags ) || {};
	const hw = t.highway || 'footway';
	const name = t.name || '';
	let width = parseFloat( t.width );
	if ( ! ( width > 0 ) ) width = /Herb Caen/.test( name ) ? PROMENADE_WIDTH : DEFAULT_WIDTH[ hw ] ?? STREET_WIDTH;
	width = Math.min( width, PROMENADE_WIDTH );
	const s = t.surface || '';
	let surface;
	if ( hw === 'steps' ) surface = s === 'wood' ? SURFACE.woodStairs : SURFACE.stairs;
	else if ( /wood/.test( s ) ) surface = SURFACE.wood;
	else if ( /paving_stones|bricks|sett|cobble/.test( s ) || hw === 'pedestrian' && ! s ) surface = SURFACE.brick;
	else if ( /concrete|paved/.test( s ) || [ 'footway', 'path' ].includes( hw ) && ! s ) surface = SURFACE.concrete;
	else surface = SURFACE.tarmac;
	return { hw, width, surface, stepCount: parseInt( t.step_count ) || 0, wayId: way ? way.id : 0, name };

}

// ---------------------------------------------------------------- resample, smooth, curvature clamp
function resample( pts, step ) {

	const out = [ { ...pts[ 0 ] } ];
	let carry = 0;
	for ( let i = 1; i < pts.length; i ++ ) {

		const a = pts[ i - 1 ], b = pts[ i ];
		const L = Math.hypot( b.x - a.x, b.z - a.z );
		if ( L < 1e-9 ) continue;
		let t = step - carry;
		while ( t <= L + 1e-9 ) {

			const f = t / L;
			out.push( { x: a.x + ( b.x - a.x ) * f, z: a.z + ( b.z - a.z ) * f, seg: i } );
			t += step;

		}

		carry = L - ( t - step );

	}

	const last = pts[ pts.length - 1 ], e = out[ out.length - 1 ];
	if ( Math.hypot( last.x - e.x, last.z - e.z ) > 0.05 ) out.push( { x: last.x, z: last.z, seg: pts.length - 1 } );
	return out;

}

let pts = resample( chain, 1 );
pts[ 0 ].seg = 1;
// per-sample class (from the raw chain) before smoothing moves the points
const cls = pts.map( ( p ) => segClass( chain[ Math.min( chain.length - 1, p.seg ) ].way ) );
// widths: the narrowest within ±3 m so a street never bleeds into a staircase
const width0 = cls.map( ( c ) => c.width );
const width = width0.map( ( _, i ) => Math.min( ...width0.slice( Math.max( 0, i - 3 ), i + 4 ) ) );

function smoothPass( p, lo, hi, k ) {

	const q = p.map( ( v ) => ( { ...v } ) );
	for ( let i = Math.max( 1, lo ); i <= Math.min( p.length - 2, hi ); i ++ ) {

		q[ i ].x = p[ i ].x + k * ( ( p[ i - 1 ].x + p[ i + 1 ].x ) / 2 - p[ i ].x );
		q[ i ].z = p[ i ].z + k * ( ( p[ i - 1 ].z + p[ i + 1 ].z ) / 2 - p[ i ].z );

	}

	return q;

}

for ( let k = 0; k < 6; k ++ ) pts = smoothPass( pts, 0, pts.length, 0.5 );
const curvature = ( p, i, h = 2 ) => {

	const a = p[ Math.max( 0, i - h ) ], b = p[ i ], c = p[ Math.min( p.length - 1, i + h ) ];
	const ab = Math.hypot( b.x - a.x, b.z - a.z ), bc = Math.hypot( c.x - b.x, c.z - b.z ), ac = Math.hypot( c.x - a.x, c.z - a.z );
	const cross = Math.abs( ( b.x - a.x ) * ( c.z - a.z ) - ( b.z - a.z ) * ( c.x - a.x ) );
	return ab * bc * ac > 1e-9 ? 2 * cross / ( ab * bc * ac ) : 0;

};

const rMin = ( i ) => Math.max( 5, width[ i ] / 2 + 2.5 );
// every violator per round (curvature over ±3 sample chords, 15 % margin for the resample), until none are left
let clampRounds = 0;
for ( ; clampRounds < 4000; clampRounds ++ ) {

	const bad = [];
	for ( let i = 3; i < pts.length - 3; i ++ ) if ( curvature( pts, i, 3 ) * rMin( i ) * 1.15 > 1 ) bad.push( i );
	if ( ! bad.length ) break;
	for ( const i of bad ) pts = smoothPass( pts, i - 5, i + 5, 0.5 );

}

// Catmull-Rom through the smoothed points, then exact 1 m arc length
function catmull( p ) {

	const out = [];
	for ( let i = 0; i < p.length - 1; i ++ ) {

		const p0 = p[ Math.max( 0, i - 1 ) ], p1 = p[ i ], p2 = p[ i + 1 ], p3 = p[ Math.min( p.length - 1, i + 2 ) ];
		for ( let k = 0; k < 8; k ++ ) {

			const t = k / 8, t2 = t * t, t3 = t2 * t;
			const f = ( a, b, c, d ) => 0.5 * ( 2 * b + ( - a + c ) * t + ( 2 * a - 5 * b + 4 * c - d ) * t2 + ( - a + 3 * b - 3 * c + d ) * t3 );
			out.push( { x: f( p0.x, p1.x, p2.x, p3.x ), z: f( p0.z, p1.z, p2.z, p3.z ), src: i + t } );

		}

	}

	out.push( { ...p[ p.length - 1 ], src: p.length - 1 } );
	return out;

}

const dense = catmull( pts );
const center = resample( dense, 1 ).map( ( q, i ) => ( { x: q.x, z: q.z, src: i === 0 ? 0 : dense[ Math.min( dense.length - 1, q.seg ) ].src } ) );
const N = center.length;
const srcIdx = ( i ) => Math.min( cls.length - 1, Math.round( center[ i ].src ) );
const C = center.map( ( _, i ) => cls[ srcIdx( i ) ] );
const W = center.map( ( _, i ) => width[ srcIdx( i ) ] );
const SURF = C.map( ( c ) => c.surface );

// ---------------------------------------------------------------- wall clearance (buildings either side)
// Per sample, the free distance to the nearest building on the left and on the right (DataSF footprints that
// are extruded, plus the ground-level hull of each landmark model), capped at 15 m. The ribbon and the corridor
// limits never reach into a wall.
const WALL_CAP = 15;
function landmarkHulls() {

	const idx = JSON.parse( readFileSync( join( ROOT, 'public/landmarks/index.json' ), 'utf8' ) );
	const hulls = [];
	for ( const l of idx.landmarks ) {

		const b = readFileSync( join( ROOT, 'public/landmarks', l.lods[ 0 ].name ) );
		const jl = b.readUInt32LE( 12 ), js = JSON.parse( b.subarray( 20, 20 + jl ).toString() ), bin = b.subarray( 20 + jl + 8 );
		const pts = [];
		for ( const node of js.nodes ) {

			if ( node.mesh === undefined ) continue;
			const a = js.accessors[ js.meshes[ node.mesh ].primitives[ 0 ].attributes.POSITION ], bv = js.bufferViews[ a.bufferView ];
			const off = ( bv.byteOffset || 0 ) + ( a.byteOffset || 0 ), t = node.translation || [ 0, 0, 0 ];
			for ( let i = 0; i < a.count; i ++ ) {

				const y = bin.readFloatLE( off + i * 12 + 4 );
				if ( y > ( l.ground || 0 ) + 12 ) continue;
				pts.push( { x: bin.readFloatLE( off + i * 12 ) + t[ 0 ], z: bin.readFloatLE( off + i * 12 + 8 ) + t[ 2 ] } );

			}

		}

		if ( pts.length < 3 ) continue;
		pts.sort( ( a, b ) => a.x - b.x || a.z - b.z );
		const cross = ( o, a, b ) => ( a.x - o.x ) * ( b.z - o.z ) - ( a.z - o.z ) * ( b.x - o.x );
		const lo = [], hi = [];
		for ( const p of pts ) { while ( lo.length >= 2 && cross( lo[ lo.length - 2 ], lo[ lo.length - 1 ], p ) <= 0 ) lo.pop(); lo.push( p ); }
		for ( let i = pts.length - 1; i >= 0; i -- ) { const p = pts[ i ]; while ( hi.length >= 2 && cross( hi[ hi.length - 2 ], hi[ hi.length - 1 ], p ) <= 0 ) hi.pop(); hi.push( p ); }
		hulls.push( { name: l.name, pts: lo.slice( 0, - 1 ).concat( hi.slice( 0, - 1 ) ) } );

	}

	return hulls;

}

const polys = [];
{

	const bIdx = JSON.parse( readFileSync( join( ROOT, 'public/buildings/index.json' ), 'utf8' ) );
	const excluded = new Set( bIdx.landmarkExclusions.map( ( e ) => String( e.id ) ) );
	const gj = JSON.parse( readCached( 'sf-buildings.geojson' ).toString( 'utf8' ) );
	for ( const f of gj.features ) {

		if ( excluded.has( 'sf' + f.properties.sf16_bldgid ) || excluded.has( String( f.properties.sf16_bldgid ) ) ) continue;
		const g = f.geometry;
		const rings = g.type === 'Polygon' ? [ g.coordinates[ 0 ] ] : g.coordinates.map( ( q ) => q[ 0 ] );
		for ( const r of rings ) polys.push( { pts: r.map( ( [ lon, lat ] ) => geoToLocal( lat, lon ) ) } );

	}

	for ( const h of landmarkHulls() ) polys.push( h );
	for ( const q of polys ) {

		q.x0 = Math.min( ...q.pts.map( ( p ) => p.x ) ); q.x1 = Math.max( ...q.pts.map( ( p ) => p.x ) );
		q.z0 = Math.min( ...q.pts.map( ( p ) => p.z ) ); q.z1 = Math.max( ...q.pts.map( ( p ) => p.z ) );

	}

}

const nearPolys = polys.filter( ( q ) => center.some( ( c, i ) => i % 5 === 0 && c.x > q.x0 - 25 && c.x < q.x1 + 25 && c.z > q.z0 - 25 && c.z < q.z1 + 25 ) );
function inPoly( pts, x, z ) {

	let c = false;
	for ( let i = 0, k = pts.length - 1; i < pts.length; k = i ++ ) {

		const a = pts[ i ], b = pts[ k ];
		if ( ( a.z > z ) !== ( b.z > z ) && x < ( b.x - a.x ) * ( z - a.z ) / ( b.z - a.z ) + a.x ) c = ! c;

	}

	return c;

}

const walled = ( cand, x, z ) => cand.some( ( q ) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1 && inPoly( q.pts, x, z ) );
const tangentOf = ( pts, i ) => {

	const a = pts[ Math.max( 0, i - 1 ) ], b = pts[ Math.min( pts.length - 1, i + 1 ) ];
	const d = Math.hypot( b.x - a.x, b.z - a.z ) || 1;
	return { x: ( b.x - a.x ) / d, z: ( b.z - a.z ) / d };

};

// occupancy along the lateral line through sample i, from -WALL_CAP to +WALL_CAP in 0.1 m steps
function lateralFree( pts, i ) {

	const t = tangentOf( pts, i ), r = { x: - t.z, z: t.x }, c = pts[ i ];
	const cand = nearPolys.filter( ( q ) => c.x > q.x0 - WALL_CAP && c.x < q.x1 + WALL_CAP && c.z > q.z0 - WALL_CAP && c.z < q.z1 + WALL_CAP );
	const n = Math.round( WALL_CAP * 10 ), free = new Uint8Array( 2 * n + 1 );
	for ( let k = - n; k <= n; k ++ ) free[ k + n ] = walled( cand, c.x + r.x * k / 10, c.z + r.z * k / 10 ) ? 0 : 1;
	return { free, n, r };

}

// Push the centreline into the free gap where a wall reaches into the corridor (the foot of the Filbert Steps
// runs hard along an apartment block): offset toward the gap, narrow the path only when the gap is narrower.
{

	const off = new Float32Array( N );
	for ( let i = 0; i < N; i ++ ) {

		const { free, n } = lateralFree( center, i ), hw = W[ i ] / 2;
		let k0 = n;
		if ( ! free[ n ] ) { for ( let d = 1; d <= n; d ++ ) { if ( free[ n + d ] ) { k0 = n + d; break; } if ( free[ n - d ] ) { k0 = n - d; break; } } }
		let a = k0, b = k0;
		while ( a > 0 && free[ a - 1 ] ) a --;
		while ( b < 2 * n && free[ b + 1 ] ) b ++;
		const lo = ( a - n ) / 10, hi = ( b - n ) / 10;
		if ( hi - lo >= 2 * hw + 0.4 ) off[ i ] = Math.min( Math.max( 0, lo + hw + 0.2 ), hi - hw - 0.2 );
		else { off[ i ] = ( lo + hi ) / 2; W[ i ] = Math.max( 1.6, hi - lo - 0.4 ); }

	}

	// spread each push over its neighbours (the largest nearby push, feathered) so the line bends smoothly
	const sm = new Float32Array( N );
	for ( let i = 0; i < N; i ++ ) {

		let v = 0;
		for ( let k = - 8; k <= 8; k ++ ) { const j = i + k; if ( j < 0 || j >= N ) continue; const w = 1 - Math.abs( k ) / 9; if ( Math.abs( off[ j ] * w ) > Math.abs( v ) ) v = off[ j ] * w; }
		sm[ i ] = v;

	}

	const moved = center.map( ( c, i ) => { const t = tangentOf( center, i ); return { ...c, x: c.x - t.z * sm[ i ], z: c.z + t.x * sm[ i ] }; } );
	for ( let i = 0; i < N; i ++ ) { center[ i ].x = moved[ i ].x; center[ i ].z = moved[ i ].z; }

}

const WALL = [ new Float32Array( N ), new Float32Array( N ) ]; // [ left, right ]
for ( let i = 0; i < N; i ++ ) {

	const { free, n } = lateralFree( center, i );
	let L = 0, R = 0;
	if ( free[ n ] ) {

		while ( L < n && free[ n - L - 1 ] ) L ++;
		while ( R < n && free[ n + R + 1 ] ) R ++;
		L = L >= n ? WALL_CAP : ( L + 1 ) / 10;
		R = R >= n ? WALL_CAP : ( R + 1 ) / 10;

	}

	WALL[ 0 ][ i ] = L;
	WALL[ 1 ][ i ] = R;

}

// ---------------------------------------------------------------- vias → sections
const viaS = [];
for ( let v = 0; v < VIAS.length; v ++ ) {

	const p = P( VIAS[ v ].node );
	// nearest centre sample after the previous via
	let best = - 1, bd = Infinity;
	for ( let i = viaS.length ? viaS[ viaS.length - 1 ] : 0; i < N; i ++ ) {

		const d = Math.hypot( center[ i ].x - p.x, center[ i ].z - p.z );
		if ( d < bd - 1e-6 ) { bd = d; best = i; }
		if ( d > bd + 60 ) break;

	}

	viaS.push( best );

}

const sections = [];
VIAS.forEach( ( v, k ) => { if ( v.section ) sections.push( { name: v.section, s0: viaS[ k ] } ); } );
sections.forEach( ( s, k ) => { s.s1 = k + 1 < sections.length ? sections[ k + 1 ].s0 : N - 1; } );
// the start terrace is a plaza: wide enough for the grid of four
for ( let i = 0; i < sections[ 1 ].s0 - 3; i ++ ) W[ i ] = Math.max( W[ i ], PLAZA_WIDTH );

// ---------------------------------------------------------------- heights
const ground = center.map( ( p ) => T.heightAt( p.x, p.z ) );
const isStair = ( i ) => SURF[ i ] === SURFACE.stairs || SURF[ i ] === SURFACE.woodStairs;
let Y = ground.map( ( _, i ) => {

	// 7 m moving average off the stairs
	let s = 0, n = 0;
	for ( let k = - 3; k <= 3; k ++ ) { const j = i + k; if ( j >= 0 && j < N ) { s += ground[ j ]; n ++; } }
	return s / n;

} );

// stair flights: maximal stair runs, split at way boundaries and at turns > 30° (a landing there)
const flights = [];
{

	const heading = ( i ) => Math.atan2( center[ Math.min( N - 1, i + 1 ) ].x - center[ Math.max( 0, i - 1 ) ].x, center[ Math.min( N - 1, i + 1 ) ].z - center[ Math.max( 0, i - 1 ) ].z );
	let i = 0;
	while ( i < N ) {

		if ( ! isStair( i ) ) { i ++; continue; }
		let j = i;
		while ( j + 1 < N && isStair( j + 1 ) && C[ j + 1 ].wayId === C[ i ].wayId ) j ++;
		// split this way's run at sharp turns (the landing replaces LANDING m of steps)
		const cuts = [ i ];
		for ( let k = i + 3; k < j - 3; k ++ ) {

			let dh = heading( k + 2 ) - heading( k - 2 );
			dh = Math.atan2( Math.sin( dh ), Math.cos( dh ) );
			if ( Math.abs( dh ) > 0.52 && k - cuts[ cuts.length - 1 ] > 5 ) cuts.push( k );

		}

		cuts.push( j + 1 );
		const totalLen = j + 1 - i, steps = C[ i ].stepCount;
		for ( let c = 0; c < cuts.length - 1; c ++ ) {

			const a = c === 0 ? cuts[ c ] : cuts[ c ] + Math.ceil( LANDING / 2 ), b = c === cuts.length - 2 ? cuts[ c + 1 ] - 1 : cuts[ c + 1 ] - Math.ceil( LANDING / 2 ) - 1;
			if ( b - a < 2 ) continue;
			flights.push( { s0: a, s1: b, wayId: C[ i ].wayId, stepShare: steps ? Math.max( 2, Math.round( steps * ( b - a + 1 ) / totalLen ) ) : 0, wood: SURF[ i ] === SURFACE.woodStairs } );

		}

		i = j + 1;

	}

	// landing samples inside a way's run stay flat stairs-surface? No: they are landings (same material, flat)
	for ( let k = 0; k < N; k ++ ) if ( isStair( k ) && ! flights.some( ( f ) => k >= f.s0 && k <= f.s1 ) ) SURF[ k ] = SURF[ k ] === SURFACE.woodStairs ? SURFACE.wood : SURFACE.concrete;

}

// base heights: each flight linear top → bottom (terrain at its ends); landings and gaps hold the flight ends;
// everything off the stairs keeps the smoothed terrain
for ( const f of flights ) {

	const h0 = Y[ f.s0 ], h1 = Y[ f.s1 ];
	for ( let k = f.s0; k <= f.s1; k ++ ) Y[ k ] = h0 + ( h1 - h0 ) * ( k - f.s0 ) / ( f.s1 - f.s0 );
	const drop = Math.max( 0, h0 - h1 );
	f.risers = f.stepShare || Math.max( 2, Math.round( drop / RISER ) );
	f.riser = drop / f.risers;
	f.tread = ( f.s1 - f.s0 ) / f.risers;
	f.h0 = h0;
	f.h1 = h1;

}

// landings between flights of one run: flat at the upper flight's bottom, then a short blend to the next top
for ( let k = 0; k + 1 < flights.length; k ++ ) {

	const a = flights[ k ], b = flights[ k + 1 ];
	if ( b.s0 - a.s1 > 12 ) continue;
	for ( let i = a.s1 + 1; i < b.s0; i ++ ) Y[ i ] = a.h1 + ( b.h0 - a.h1 ) * ( i - a.s1 ) / ( b.s0 - a.s1 );

}

// ---------------------------------------------------------------- camber (streets only, from the terrain's cross slope)
const tangent = ( i ) => {

	const a = center[ Math.max( 0, i - 1 ) ], b = center[ Math.min( N - 1, i + 1 ) ];
	const d = Math.hypot( b.x - a.x, b.z - a.z ) || 1;
	return { x: ( b.x - a.x ) / d, z: ( b.z - a.z ) / d };

};

const CAMBER = center.map( ( p, i ) => {

	if ( ! [ 'residential', 'tertiary', 'service', 'primary', 'secondary' ].includes( C[ i ].hw ) ) return 0;
	const t = tangent( i ), r = { x: - t.z, z: t.x };
	const cs = ( T.heightAt( p.x + r.x * 3, p.z + r.z * 3 ) - T.heightAt( p.x - r.x * 3, p.z - r.z * 3 ) ) / 6;
	return Math.max( - 0.03, Math.min( 0.03, cs ) );

} );

// ---------------------------------------------------------------- rail crossings (F-line tracks, railway=tram)
const rails = [];
{

	const tram = osm.ways.filter( ( w ) => ( w.tags || {} ).railway === 'tram' );
	for ( let i = 0; i + 1 < N; i ++ ) {

		const a = center[ i ], b = center[ i + 1 ];
		for ( const w of tram ) for ( let k = 1; k < w.nodes.length; k ++ ) {

			const c = P( w.nodes[ k - 1 ] ), d = P( w.nodes[ k ] );
			const den = ( b.x - a.x ) * ( d.z - c.z ) - ( b.z - a.z ) * ( d.x - c.x );
			if ( Math.abs( den ) < 1e-9 ) continue;
			const t = ( ( c.x - a.x ) * ( d.z - c.z ) - ( c.z - a.z ) * ( d.x - c.x ) ) / den;
			const u = ( ( c.x - a.x ) * ( b.z - a.z ) - ( c.z - a.z ) * ( b.x - a.x ) ) / den;
			if ( t >= 0 && t < 1 && u >= 0 && u <= 1 ) rails.push( round( i + t, 2 ) );

		}

	}

}

// ---------------------------------------------------------------- kickers at real features
// { s: lip position, len: run-up length, h: lip height, l0, l1: lateral extent, kind }
const kickers = [];
const secStart = ( name ) => sections.find( ( s ) => s.name.startsWith( name ) ).s0;
const secEnd = ( name ) => sections.find( ( s ) => s.name.startsWith( name ) ).s1;
const kicker = ( s, kind, h = 0.9, len = 4, l0 = null, l1 = null ) => {

	const hw = W[ Math.round( s ) ] / 2;
	kickers.push( { s: Math.round( s ), len, h, l0: l0 ?? - hw, l1: l1 ?? hw, kind } );

};

// the plaza wall where the route leaves the summit circle
kicker( secStart( 'Telegraph' ) + 6, 'plaza wall', 0.7, 3.5 );
// the Montgomery curb: where the crossing reaches the street's far kerb, first street sample after the steps
{

	const a = secStart( 'Montgomery' ), b = secEnd( 'Montgomery' );
	let s = a;
	for ( let i = a; i < b; i ++ ) if ( [ 'residential', 'tertiary' ].includes( C[ i ].hw ) ) s = i;
	kicker( s + 1, 'Montgomery curb', 1.1, 4 );

}

// landing platforms on the lower Filbert Steps: the lip at the end of each landing between flights
for ( let k = 0; k + 1 < flights.length; k ++ ) {

	const a = flights[ k ], b = flights[ k + 1 ];
	if ( a.s1 < secStart( 'Filbert Steps — lower' ) || a.s1 > secEnd( 'Filbert Steps — lower' ) ) continue;
	if ( b.s0 - a.s1 < 3 || b.s0 - a.s1 > 12 ) continue;
	kicker( b.s0 - 0.5, 'landing platform', 0.45, Math.min( 2.5, b.s0 - a.s1 - 0.5 ) );

}

// the Sansome curb: first Sansome/Filbert street sample after the steps
{

	const a = secStart( 'Sansome' );
	let s = a;
	for ( let i = a; i < a + 40; i ++ ) if ( [ 'residential', 'tertiary' ].includes( C[ i ].hw ) ) { s = i; break; }
	kicker( s, 'Sansome curb', 0.7, 4 );

}

// planters and benches along the Embarcadero: every 110 m, alternating sides, 3 m wide
{

	const a = secStart( 'Embarcadero' ) + 60, b = secEnd( 'Embarcadero' ) - 60;
	let side = 1;
	for ( let s = a; s < b; s += 110 ) {

		const hw = W[ s ] / 2, c = side * ( hw - 2.2 );
		kicker( s, side > 0 ? 'planter' : 'bench', 0.7, 4.5, c - 1.5, c + 1.5 );
		side = - side;

	}

}

// ---------------------------------------------------------------- checkpoints (5, at section boundaries)
const checkpoints = sections.slice( 2, 7 ).map( ( s ) => ( { s: s.s0, name: s.name } ) );

// ---------------------------------------------------------------- props: OSM street furniture near the line, else seeded
const toTrack = ( x, z, hint = 0 ) => {

	let best = hint, bd = Infinity;
	for ( let i = 0; i < N; i ++ ) {

		const d = ( center[ i ].x - x ) ** 2 + ( center[ i ].z - z ) ** 2;
		if ( d < bd ) { bd = d; best = i; }

	}

	const t = tangent( best ), r = { x: - t.z, z: t.x };
	return { s: best, l: ( x - center[ best ].x ) * r.x + ( z - center[ best ].z ) * r.z, d: Math.sqrt( bd ) };

};

const props = [];
{

	const kind = ( t ) => ( t.highway === 'street_lamp' ? 'lamp' : t.amenity === 'bench' ? 'bench' : t.natural === 'tree' ? 'tree' : null );
	const ids = [ ...osm.nodes.keys() ].sort( ( a, b ) => a - b );
	for ( const id of ids ) {

		const n = osm.nodes.get( id ), k = n.tags && kind( n.tags );
		if ( ! k ) continue;
		const p = geoToLocal( n.lat, n.lon ), tr = toTrack( p.x, p.z );
		if ( tr.d > 30 || Math.abs( tr.l ) < W[ tr.s ] / 2 + 0.6 ) continue;
		props.push( { kind: k, x: round( p.x, 2 ), z: round( p.z, 2 ), y: round( T.heightAt( p.x, p.z ), 2 ), osm: id } );

	}

	// seeded palms and lamps along the promenade and the streets where OSM has none within 25 m
	let seed = 12345;
	const rnd = () => ( ( seed = ( seed * 1103515245 + 12345 ) >>> 0 ) / 4294967296 );
	for ( let s = 20; s < N - 10; s += 18 ) {

		const t = tangent( s ), r = { x: - t.z, z: t.x }, c = center[ s ];
		if ( isStair( s ) || SURF[ s ] === SURFACE.wood ) continue;
		for ( const side of [ - 1, 1 ] ) {

			const off = side * ( W[ s ] / 2 + 1.2 + rnd() * 0.6 );
			const x = c.x + r.x * off, z = c.z + r.z * off;
			if ( props.some( ( q ) => ( q.x - x ) ** 2 + ( q.z - z ) ** 2 < 25 * 25 ) ) continue;
			const promenade = /Herb Caen/.test( C[ s ].name );
			const kind = promenade ? ( side > 0 ? 'lamp' : 'palm' ) : rnd() < 0.5 ? 'lamp' : 'tree';
			props.push( { kind, x: round( x, 2 ), z: round( z, 2 ), y: round( T.heightAt( x, z ), 2 ), seeded: true } );

		}

	}

}

// parked cars along Montgomery and Sansome (the OSM street ways), against the kerb either side of where the
// route crosses or joins them: world-space obstacles off the racing line (the sim tests them in track space)
const obstacles = [];
for ( const street of [ 'Montgomery Street', 'Sansome Street' ] ) {

	const first = obstacles.length;

	const ways = osm.ways.filter( ( w ) => ( w.tags || {} ).name === street && ( w.tags || {} ).highway ).sort( ( a, b ) => a.id - b.id );
	for ( const w of ways ) for ( let k = 1; k < w.nodes.length; k ++ ) {

		const a = P( w.nodes[ k - 1 ] ), b = P( w.nodes[ k ] ), L = Math.hypot( b.x - a.x, b.z - a.z );
		if ( L < 1 ) continue;
		const dx = ( b.x - a.x ) / L, dz = ( b.z - a.z ) / L, yaw = Math.atan2( dx, dz );
		for ( let t = 3; t < L - 3; t += 6.5 ) for ( const side of [ - 1, 1 ] ) {

			const off = side * ( STREET_WIDTH / 2 - 1.1 );
			const x = a.x + dx * t - dz * off, z = a.z + dz * t + dx * off;
			const tr = toTrack( x, z );
			// within 45 m of the route, never on it (4 m clear of the corridor edge)
			if ( tr.d > 45 || Math.abs( tr.l ) < W[ tr.s ] / 2 + 1.6 && tr.d < 12 ) continue;
			if ( obstacles.length - first >= 12 || obstacles.some( ( o ) => ( o.x - x ) ** 2 + ( o.z - z ) ** 2 < 25 ) ) continue;
			obstacles.push( { kind: 'car', x: round( x, 2 ), z: round( z, 2 ), y: round( T.heightAt( x, z ), 2 ), yaw: round( yaw, 4 ), halfLen: 2.2, halfWid: 0.9, h: 1.45, s: tr.s, l: round( tr.l, 2 ) } );

		}

	}

}

// ---------------------------------------------------------------- write
function round( v, d = 3 ) { const m = 10 ** d; return Math.round( v * m ) / m; }

const STRIDE = 9; // x, y, z, halfWidth, surface, camber, terrain (unsmoothed ground, for G2), wallLeft, wallRight
const buf = new Float32Array( N * STRIDE );
for ( let i = 0; i < N; i ++ ) {

	const o = i * STRIDE;
	buf[ o ] = center[ i ].x;
	buf[ o + 1 ] = Y[ i ];
	buf[ o + 2 ] = center[ i ].z;
	buf[ o + 3 ] = W[ i ] / 2;
	buf[ o + 4 ] = SURF[ i ];
	buf[ o + 5 ] = CAMBER[ i ];
	buf[ o + 6 ] = ground[ i ];
	buf[ o + 7 ] = WALL[ 0 ][ i ];
	buf[ o + 8 ] = WALL[ 1 ][ i ];

}

const bin = Buffer.from( buf.buffer );
const sha = createHash( 'sha256' ).update( bin ).digest( 'hex' );
const drop = Y[ 0 ] - Y[ N - 1 ];
const index = {
	format: 'hillbomb-route/1',
	name: 'Coit Tower → Ferry Building',
	frame: 'BayFrame (x east, z south, y up, local MSL metres)',
	source: 'data/raw/route-osm.json (OSM, ODbL) + public/terrain (USGS 3DEP)',
	file: 'track1.bin', sha256: sha, stride: STRIDE, fields: [ 'x', 'y', 'z', 'halfWidth', 'surface', 'camber', 'terrain', 'wallLeft', 'wallRight' ],
	samples: N, spacing: 1, length: N - 1, drop: round( drop, 2 ), top: round( Y[ 0 ], 2 ), bottom: round( Y[ N - 1 ], 2 ),
	surfaces: SURFACE,
	vias: VIAS.map( ( v, k ) => ( { node: v.node, s: viaS[ k ] } ) ),
	sections, checkpoints,
	flights: flights.map( ( f ) => ( { s0: f.s0, s1: f.s1, h0: round( f.h0 ), h1: round( f.h1 ), risers: f.risers, riser: round( f.riser, 4 ), tread: round( f.tread, 4 ), wood: f.wood, osm: f.wayId } ) ),
	kickers, rails, obstacles, props,
	finish: { anchor: [ round( anchor.x, 2 ), round( anchor.z, 2 ) ] },
	start: { anchor: ( ( a ) => [ round( a.x, 2 ), round( a.z, 2 ) ] )( geoToLocal( ...START_ANCHOR ) ) },
};
mkdirSync( OUT, { recursive: true } );
writeFileSync( join( OUT, 'track1.bin' ), bin );
writeFileSync( join( OUT, 'index.json' ), JSON.stringify( index, null, 1 ) + '\n' );
console.log( `route: ${ N - 1 } m, drop ${ drop.toFixed( 1 ) } m (${ Y[ 0 ].toFixed( 1 ) } → ${ Y[ N - 1 ].toFixed( 1 ) }), ${ sections.length } sections, ${ flights.length } flights, ${ kickers.length } kickers, ${ rails.length } rail crossings, ${ obstacles.length } cars, ${ props.length } props, sha ${ sha.slice( 0, 12 ) }` );
for ( const s of sections ) console.log( `  ${ String( s.s0 ).padStart( 5 ) }–${ String( s.s1 ).padEnd( 5 ) } ${ s.name }  (${ Y[ s.s0 ].toFixed( 1 ) } → ${ Y[ s.s1 ].toFixed( 1 ) } m)` );
