// G2 Route bake: tools/route/build.mjs run twice from the cache with the network blocked gives byte-identical
// output, equal to the shipped public/route; length, drop and section boundaries within the frozen ranges; the
// ridden surface never more than 0.5 m from the terrain except on the stairs.
// --negative: a shifted OSM fixture, a non-deterministic bake, a floating route, a bake that reaches the network.
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gate } from './lib/gate.mjs';
import { root, runOffline, compareDirs } from './lib/tiles.mjs';
import { freeze } from './lib/thresholds.mjs';
import { Route } from '../src/sim/route.js';

const SCRIPT = 'tools/route/build.mjs';
const V = join( root, '.verify' );

function bake( script, out, extra = [] ) {

	rmSync( out, { recursive: true, force: true } );
	const r = runOffline( script, [ '--out', out, ...extra ] );
	return r.status === 0 ? [] : [ `bake: ${ script } failed — ${ ( r.stderr || r.stdout ).trim().split( '\n' ).slice( - 2 ).join( ' ' ).slice( 0, 200 ) }` ];

}

function load( dir ) {

	const index = JSON.parse( readFileSync( join( dir, 'index.json' ), 'utf8' ) );
	const b = readFileSync( join( dir, index.file ) );
	return { index, bin: b, route: new Route( index, new Float32Array( b.buffer.slice( b.byteOffset, b.byteOffset + b.length ) ) ) };

}

function checkRoute( dir ) {

	const fail = [];
	const { index, bin, route: r } = load( dir );
	if ( createHash( 'sha256' ).update( bin ).digest( 'hex' ) !== index.sha256 ) fail.push( 'bake: track1.bin sha256 differs from index.json' );
	const L = index.length, drop = index.drop;
	const lMin = freeze( 'G2.lengthMin', Math.floor( L * 0.98 ), `route length − 2 %, measured ${ L } m at first bake (2026-09-27)` );
	const lMax = freeze( 'G2.lengthMax', Math.ceil( L * 1.02 ), `route length + 2 %, measured ${ L } m at first bake (2026-09-27)` );
	const dMin = freeze( 'G2.dropMin', Math.round( drop * 0.95 * 10 ) / 10, `drop − 5 %, measured ${ drop } m (${ index.top } → ${ index.bottom } m local MSL) at first bake` );
	const dMax = freeze( 'G2.dropMax', Math.round( drop * 1.05 * 10 ) / 10, `drop + 5 %, measured ${ drop } m at first bake` );
	if ( L < lMin || L > lMax ) fail.push( `length: ${ L } m outside the frozen ${ lMin }–${ lMax } m` );
	if ( drop < dMin || drop > dMax ) fail.push( `drop: ${ drop } m outside the frozen ${ dMin }–${ dMax } m` );
	index.sections.forEach( ( s, k ) => {

		const f = freeze( `G2.section${ k + 1 }`, s.s0, `s0 (m) of "${ s.name }" at first bake; ± 5 m` );
		if ( Math.abs( s.s0 - f ) > 5 ) fail.push( `sections: "${ s.name }" starts at ${ s.s0 } m, frozen ${ f } ± 5` );

	} );
	// the ridden surface vs the terrain, off the stairs (flights ± 3 m and the landings between them)
	const S = r.stride, d = r.data;
	const stairs = ( i ) => r.flights.some( ( f, k ) => ( i >= f.s0 - 3 && i <= f.s1 + 3 ) || ( k + 1 < r.flights.length && i > f.s1 && i < r.flights[ k + 1 ].s0 && r.flights[ k + 1 ].s0 - f.s1 <= 12 ) );
	let worst = 0, at = - 1;
	for ( let i = 0; i < r.n; i ++ ) {

		if ( stairs( i ) ) continue;
		const dy = Math.abs( d[ i * S + 1 ] - d[ i * S + 6 ] );
		if ( dy > worst ) { worst = dy; at = i; }

	}

	console.log( `G2: ${ L } m, drop ${ drop } m, ${ index.sections.length } sections, ${ index.flights.length } flights; worst surface-to-terrain off the stairs ${ worst.toFixed( 2 ) } m at s ${ at }` );
	if ( worst > 0.5 ) fail.push( `terrain: the surface is ${ worst.toFixed( 2 ) } m from the terrain at s ${ at } (off the stairs, limit 0.5 m)` );
	return fail;

}

function checkBake( script = SCRIPT, extra = [], tag = 'real' ) {

	const a = join( V, `g2-${ tag }-a` ), b = join( V, `g2-${ tag }-b` );
	const fail = [ ...bake( script, a, extra ), ...bake( script, b, extra ) ];
	if ( fail.length ) return fail;
	fail.push( ...compareDirs( a, b, 'determinism (run 1 vs run 2)' ) );
	fail.push( ...compareDirs( a, join( root, 'public/route' ), 'shipped (bake vs public/route)' ) );
	fail.push( ...checkRoute( a ) );
	return fail;

}

// a mutated copy of the bake script next to the original (so its relative imports resolve)
function mutant( name, edit ) {

	const src = readFileSync( join( root, SCRIPT ), 'utf8' ), out = edit( src );
	if ( out === src ) throw new Error( `mutation ${ name } did not change the script` );
	const p = join( root, 'tools/route', `.g2-${ name }.mjs` );
	writeFileSync( p, out );
	return { script: `tools/route/.g2-${ name }.mjs`, clean: () => rmSync( p, { force: true } ) };

}

const withMutant = ( name, edit, expect ) => ( {
	name,
	expect,
	run: () => { const m = mutant( name.replace( /\W+/g, '-' ), edit ); try { return checkBake( m.script, [], name.replace( /\W+/g, '-' ) ); } finally { m.clean(); } },
} );

await gate( 'G2', {
	checks: [ () => checkBake() ],
	pass: 'route bake byte-identical ×2 offline and equal to public/route; length / drop / sections in the frozen ranges; surface within 0.5 m of the terrain off the stairs',
	negatives: [
		{
			name: 'shifted OSM fixture (every node 30 m east)',
			expect: /^shipped/,
			run: () => {

				const osm = JSON.parse( readFileSync( join( root, 'data/raw/route-osm.json' ), 'utf8' ) );
				for ( const e of osm.elements ) if ( e.type === 'node' ) e.lon += 30 / 88000;
				const p = join( V, 'g2-shifted-osm.json' );
				writeFileSync( p, JSON.stringify( osm ) );
				return checkBake( SCRIPT, [ '--osm', p ], 'shifted' );

			},
		},
		withMutant( 'non-deterministic bake', ( s ) => s.replace( '=> Math.min( ...width0.slice(', '=> Math.random() * 0.01 + Math.min( ...width0.slice(' ), /^determinism/ ),
		withMutant( 'floating route (+1 m)', ( s ) => s.replace( '	buf[ o + 1 ] = Y[ i ];', '	buf[ o + 1 ] = Y[ i ] + 1;' ), /^terrain/ ),
		withMutant( 'bake reaches the network', ( s ) => s.replace( "const osm = loadOSM( opt( '--osm' ) );", "await fetch( 'https://overpass-api.de/api/status' );\nconst osm = loadOSM( opt( '--osm' ) );" ), /^bake:/ ),
	],
} );

