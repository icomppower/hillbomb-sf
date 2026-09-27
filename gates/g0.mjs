// G0 Data: the route's OSM source is cached, checksummed and its licence recorded; the reused bay-crossing tiles
// (terrain, buildings, landmarks) are present and match the sha256 their indexes carry.
// --negative: a corrupted cache file, a missing licence, a missing manifest entry, an altered tile.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gate } from './lib/gate.mjs';
import { root } from './lib/tiles.mjs';

const sha = ( p ) => createHash( 'sha256' ).update( readFileSync( p ) ).digest( 'hex' );

function checkCache( raw ) {

	const fail = [];
	const man = join( raw, 'MANIFEST.sha256' );
	if ( ! existsSync( man ) ) return [ 'cache: MANIFEST.sha256 missing' ];
	const want = Object.fromEntries( readFileSync( man, 'utf8' ).trim().split( '\n' ).map( ( l ) => l.split( /\s+/ ).reverse() ) );
	const file = 'route-osm.json';
	if ( ! want[ file ] ) fail.push( `cache: ${ file } not in MANIFEST.sha256` );
	else if ( ! existsSync( join( raw, file ) ) ) fail.push( `cache: ${ file } missing` );
	else if ( sha( join( raw, file ) ) !== want[ file ] ) fail.push( `cache: ${ file } checksum mismatch` );
	const sources = JSON.parse( readFileSync( join( raw, 'sources.json' ), 'utf8' ) );
	const s = sources[ file ];
	if ( ! s || ! /ODbL/.test( s.licence || '' ) || ! /openstreetmap\.org\/copyright/.test( s.licenceUrl || '' ) ) fail.push( `licence: ${ file } has no ODbL licence entry in sources.json` );
	if ( s && ! s.fetched ) fail.push( `licence: ${ file } has no fetch date` );
	// every other cached source the reused tiles were built from still verifies
	for ( const [ f, h ] of Object.entries( want ) ) if ( f !== file && existsSync( join( raw, f ) ) && sha( join( raw, f ) ) !== h ) fail.push( `cache: ${ f } checksum mismatch` );
	return fail;

}

function checkTiles( pub ) {

	const fail = [];
	let n = 0;
	const verify = ( dir, name, want ) => {

		n ++;
		const p = join( pub, dir, name );
		if ( ! existsSync( p ) ) fail.push( `tiles: ${ dir }/${ name } missing` );
		else if ( sha( p ) !== want ) fail.push( `tiles: ${ dir }/${ name } sha256 differs from its index (not the bay-crossing tile)` );

	};

	const terrain = JSON.parse( readFileSync( join( pub, 'terrain/index.json' ), 'utf8' ) );
	for ( const f of terrain.files ) verify( 'terrain', f.name, f.sha256 );
	const buildings = JSON.parse( readFileSync( join( pub, 'buildings/index.json' ), 'utf8' ) );
	for ( const f of buildings.files ) { verify( 'buildings', f.name, f.sha256 ); for ( const l of f.lods || [] ) verify( 'buildings', l.name, l.sha256 ); }
	const landmarks = JSON.parse( readFileSync( join( pub, 'landmarks/index.json' ), 'utf8' ) );
	for ( const l of landmarks.landmarks ) for ( const lod of l.lods ) verify( 'landmarks', lod.name, lod.sha256 );
	if ( n < 300 ) fail.push( `tiles: only ${ n } reused tiles listed` );
	console.log( `G0: ${ n } reused tiles checked (terrain ${ terrain.files.length }, buildings ${ buildings.files.length } × 3 LODs, landmark LODs)` );
	return fail;

}

const RAW = join( root, 'data/raw' ), PUB = join( root, 'public' );
const fx = join( root, '.verify/g0-neg' );
const fixture = ( name, mutate ) => ( {
	name,
	run: () => {

		const d = join( fx, name.replace( /\W+/g, '-' ) );
		rmSync( d, { recursive: true, force: true } );
		mkdirSync( join( d, 'raw' ), { recursive: true } );
		for ( const f of [ 'MANIFEST.sha256', 'sources.json', 'route-osm.json' ] ) cpSync( join( RAW, f ), join( d, 'raw', f ) );
		mkdirSync( join( d, 'pub' ) );
		for ( const t of [ 'terrain', 'buildings', 'landmarks' ] ) cpSync( join( PUB, t ), join( d, 'pub', t ), { recursive: true } );
		mutate( d );
		return [ ...checkCache( join( d, 'raw' ) ), ...checkTiles( join( d, 'pub' ) ) ];

	},
} );

await gate( 'G0', {
	checks: [ () => checkCache( RAW ), () => checkTiles( PUB ) ],
	pass: 'route OSM source cached + checksummed + ODbL recorded; every reused bay-crossing tile matches its sha256',
	negatives: [
		fixture( 'corrupted route cache', ( d ) => { const p = join( d, 'raw/route-osm.json' ); const b = readFileSync( p ); b[ 100 ] ^= 1; writeFileSync( p, b ); } ),
		fixture( 'licence missing', ( d ) => { const p = join( d, 'raw/sources.json' ); const j = JSON.parse( readFileSync( p, 'utf8' ) ); delete j[ 'route-osm.json' ].licence; writeFileSync( p, JSON.stringify( j ) ); } ),
		fixture( 'manifest entry missing', ( d ) => { const p = join( d, 'raw/MANIFEST.sha256' ); writeFileSync( p, readFileSync( p, 'utf8' ).split( '\n' ).filter( ( l ) => ! l.includes( 'route-osm' ) ).join( '\n' ) ); } ),
		fixture( 'altered terrain tile', ( d ) => { const p = join( d, 'pub/terrain/t_7_7.bin' ); const b = readFileSync( p ); b[ 50 ] ^= 0xff; writeFileSync( p, b ); } ),
		fixture( 'missing landmark LOD', ( d ) => { rmSync( join( d, 'pub/landmarks/coit-tower_lod0.glb' ) ); } ),
	],
} );
