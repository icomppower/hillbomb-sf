// G3 Georeference: the start is at Coit Tower and the finish at the Ferry Building clock tower, within 10 m of each
// landmark's ground-level footprint (DECISIONS D8: both models reach further than 10 m from their anchors), the
// tower behind the start and abeam the finish; the Filbert Steps flights the route rides begin and end within
// 10 m of their OSM endpoints.
// --negative: a route traced from shifted OSM, a route cut 60 m short of the finish, a mis-traced lower flight.
import { readFileSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { gate } from './lib/gate.mjs';
import { root, runOffline } from './lib/tiles.mjs';
import { Route } from '../src/sim/route.js';
import { landmarkHulls, loadOSM, geoToLocal } from '../tools/route/lib.mjs';

const TOL = 10;
const load = ( dir ) => {

	const index = JSON.parse( readFileSync( join( dir, 'index.json' ), 'utf8' ) );
	const b = readFileSync( join( dir, index.file ) );
	return new Route( index, new Float32Array( b.buffer.slice( b.byteOffset, b.byteOffset + b.length ) ) );

};

function distToHull( pts, x, z ) {

	let inside = true, best = Infinity;
	for ( let i = 0; i < pts.length; i ++ ) {

		const a = pts[ i ], b = pts[ ( i + 1 ) % pts.length ];
		const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez;
		const t = Math.max( 0, Math.min( 1, ( ( x - a.x ) * ex + ( z - a.z ) * ez ) / L2 ) );
		best = Math.min( best, Math.hypot( x - a.x - ex * t, z - a.z - ez * t ) );
		if ( ex * ( z - a.z ) - ez * ( x - a.x ) < 0 ) inside = false; // counter-clockwise hull: outside of an edge

	}

	return inside ? 0 : best;

}

function check( dir ) {

	const fail = [], r = load( dir ), hulls = landmarkHulls();
	const hull = ( name ) => hulls.find( ( h ) => h.name === name ).pts;
	const idx = JSON.parse( readFileSync( join( root, 'public/landmarks/index.json' ), 'utf8' ) );
	const anchor = ( name ) => { const a = idx.landmarks.find( ( l ) => l.name === name ).anchor; return { x: a[ 0 ], z: a[ 1 ] }; };

	// start: the grid's front row (the start line)
	const sStart = 4.5, c0 = r.center( sStart ), t0 = r.tangent( sStart ), coit = anchor( 'Coit Tower' );
	const dStart = distToHull( hull( 'Coit Tower' ), c0.x, c0.z );
	const away = { x: c0.x - coit.x, z: c0.z - coit.z }, al = Math.hypot( away.x, away.z );
	const behind = Math.acos( ( away.x * t0.x + away.z * t0.z ) / al ) * 180 / Math.PI;
	// finish: the last sample; the tower abeam (its anchor projects near the line along the route)
	const L = r.length, c1 = r.center( L ), t1 = r.tangent( L ), fb = anchor( 'Ferry Building' );
	const dFinish = distToHull( hull( 'Ferry Building' ), c1.x, c1.z );
	const along = ( fb.x - c1.x ) * t1.x + ( fb.z - c1.z ) * t1.z;
	console.log( `G3: start ${ dStart.toFixed( 1 ) } m from the Coit Tower footprint, tower ${ behind.toFixed( 0 ) }° off dead astern; finish ${ dFinish.toFixed( 1 ) } m from the Ferry Building footprint, clock tower ${ along.toFixed( 1 ) } m along the line` );
	if ( ! ( dStart <= TOL ) ) fail.push( `start: ${ dStart.toFixed( 1 ) } m from Coit Tower's footprint (limit ${ TOL })` );
	if ( ! ( behind <= 45 ) ) fail.push( `start: Coit Tower is ${ behind.toFixed( 0 ) }° off directly behind the grid (limit 45°)` );
	if ( ! ( dFinish <= TOL ) ) fail.push( `finish: ${ dFinish.toFixed( 1 ) } m from the Ferry Building's footprint (limit ${ TOL })` );
	if ( ! ( Math.abs( along ) <= 12 ) ) fail.push( `finish: the clock tower is ${ along.toFixed( 1 ) } m along the line from the finish (limit 12, abeam)` );

	// the Filbert Steps flights: each OSM steps way the route rides, both ends within 10 m of the route
	const osm = loadOSM();
	const ways = new Map( osm.ways.map( ( w ) => [ w.id, w ] ) );
	const near = ( lat, lon, hint = - 1, window = 60 ) => { const p = geoToLocal( lat, lon ); return r.toTrack( p.x, p.z, hint, window ).d; };
	const filbert = [ ...new Set( r.flights.map( ( f ) => f.osm ) ) ].map( ( id ) => ways.get( id ) ).filter( ( w ) => w && /Filbert Steps/.test( w.tags.name || '' ) );
	let worst = 0;
	for ( const w of filbert ) for ( const id of [ w.nodes[ 0 ], w.nodes[ w.nodes.length - 1 ] ] ) {

		// measured against the stretch of line that rides this way (its flights ± 15 m), not the whole route
		const fl = r.flights.filter( ( f ) => f.osm === w.id ), a = Math.min( ...fl.map( ( f ) => f.s0 ) ), b = Math.max( ...fl.map( ( f ) => f.s1 ) );
		const n = osm.nodes.get( id ), d = near( n.lat, n.lon, ( a + b ) / 2, ( b - a ) / 2 + 15 );
		worst = Math.max( worst, d );
		if ( d > TOL ) fail.push( `Filbert: steps way ${ w.id } end node ${ id } is ${ d.toFixed( 1 ) } m from the route (limit ${ TOL })` );

	}

	if ( filbert.length < 3 ) fail.push( `Filbert: the route rides only ${ filbert.length } OSM "Filbert Steps" flights` );
	let viaWorst = 0;
	for ( const v of r.index.vias ) { const n = osm.nodes.get( v.node ); viaWorst = Math.max( viaWorst, near( n.lat, n.lon ) ); }
	// (reported, not gated: the Blvd → Filbert Steps switchback is a 6 m U-turn the curvature clamp rides as a chord, D11)
	console.log( `G3: ${ filbert.length } Filbert Steps ways, worst endpoint ${ worst.toFixed( 1 ) } m from the route; worst via node ${ viaWorst.toFixed( 1 ) } m` );
	return fail;

}

const V = join( root, '.verify' );
const fixture = ( name, edit ) => {

	const d = join( V, 'g3-' + name );
	rmSync( d, { recursive: true, force: true } );
	mkdirSync( d, { recursive: true } );
	copyFileSync( join( root, 'public/route/index.json' ), join( d, 'index.json' ) );
	copyFileSync( join( root, 'public/route/track1.bin' ), join( d, 'track1.bin' ) );
	edit( d );
	return d;

};

await gate( 'G3', {
	checks: [ () => check( join( root, 'public/route' ) ) ],
	pass: 'start at Coit Tower (tower behind the grid), finish under the Ferry Building clock tower, the Filbert Steps flights on their OSM ways, all within 10 m',
	negatives: [
		{
			name: 'route traced from OSM shifted 30 m east',
			expect: /^(start|finish|Filbert)/,
			run: () => {

				const osm = JSON.parse( readFileSync( join( root, 'data/raw/route-osm.json' ), 'utf8' ) );
				for ( const e of osm.elements ) if ( e.type === 'node' ) e.lon += 30 / 88000;
				const p = join( V, 'g3-shifted-osm.json' ), out = join( V, 'g3-shifted' );
				writeFileSync( p, JSON.stringify( osm ) );
				const res = runOffline( 'tools/route/build.mjs', [ '--out', out, '--osm', p ] );
				if ( res.status !== 0 ) throw new Error( 'shifted bake failed' );
				// the shifted route is checked against the real landmarks and the real OSM
				return check( out );

			},
		},
		{
			name: 'route cut 60 m short of the finish',
			expect: /^finish/,
			run: () => check( fixture( 'short', ( d ) => {

				const p = join( d, 'index.json' ), j = JSON.parse( readFileSync( p, 'utf8' ) );
				j.samples -= 60; j.length -= 60;
				writeFileSync( p, JSON.stringify( j ) );

			} ) ),
		},
		{
			name: 'lower Filbert flight mis-traced 12 m sideways',
			expect: /^Filbert/,
			run: () => check( fixture( 'mistraced', ( d ) => {

				const j = JSON.parse( readFileSync( join( d, 'index.json' ), 'utf8' ) ), p = join( d, 'track1.bin' ), b = readFileSync( p );
				const f = new Float32Array( b.buffer.slice( b.byteOffset, b.byteOffset + b.length ) ), sec = j.sections[ 4 ];
				for ( let i = sec.s0; i < sec.s1; i ++ ) f[ i * j.stride + 2 ] += 12; // z: across the east–west flights
				writeFileSync( p, Buffer.from( f.buffer ) );

			} ) ),
		},
	],
} );
