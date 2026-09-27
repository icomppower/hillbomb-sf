// The Bay Bridge West Span as a far backdrop landmark (for the skyline wide, SPEC §7). The deck line is OSM
// (data/raw/baybridge-osm.json: the upper, westbound deck way); the suspension layout comes from published
// dimensions (Caltrans / Bay Area Toll Authority fact sheets): two suspension bridges end to end joined by a central
// anchorage, each with 1,160 ft (354 m) side spans and a 2,310 ft (704 m) main span; towers rise 526 ft (160 m) above
// the water; 220 ft (67 m) clearance under the deck. The first side span starts where the deck line leaves the San
// Francisco shore (the 3DEP terrain drops below sea level). Output public/landmarks/bay-bridge.json (BayFrame).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCached } from '../data/cache.mjs';
import { loadTerrain, geoToLocal, ROOT } from '../route/lib.mjs';

const osm = JSON.parse( readCached( 'baybridge-osm.json' ).toString( 'utf8' ) );
const T = loadTerrain();
// the westbound upper deck from Yerba Buena Island to San Francisco, reversed to run SF → YBI
const ways = [ 8921938, 23874736 ].map( ( id ) => osm.elements.find( ( w ) => w.id === id ) );
if ( ways.some( ( w ) => ! w ) ) throw new Error( 'bay bridge: deck ways missing from the cache' );
const pts = [ ...ways[ 1 ].geometry, ...ways[ 0 ].geometry.slice( 1 ) ].map( ( g ) => geoToLocal( g.lat, g.lon ) ).reverse();
const at = ( d ) => {

	let acc = 0;
	for ( let i = 1; i < pts.length; i ++ ) {

		const L = Math.hypot( pts[ i ].x - pts[ i - 1 ].x, pts[ i ].z - pts[ i - 1 ].z );
		if ( acc + L >= d || i === pts.length - 1 ) { const f = Math.min( 1, ( d - acc ) / L ); return { x: pts[ i - 1 ].x + ( pts[ i ].x - pts[ i - 1 ].x ) * f, z: pts[ i - 1 ].z + ( pts[ i ].z - pts[ i - 1 ].z ) * f }; }
		acc += L;

	}

};

let total = 0;
for ( let i = 1; i < pts.length; i ++ ) total += Math.hypot( pts[ i ].x - pts[ i - 1 ].x, pts[ i ].z - pts[ i - 1 ].z );
let shore = 0;
for ( let d = 0; d < total; d += 2 ) { const p = at( d ); if ( T.heightAt( p.x, p.z ) < 0 ) { shore = d; break; } }
const SIDE = 353.6, MAIN = 704.1, TOWER = 160.3, DECK = 67 + 5;
const stations = [ [ 'anchorage', 0 ], [ 'tower', SIDE ], [ 'tower', SIDE + MAIN ], [ 'anchorage', 2 * SIDE + MAIN ],
	[ 'tower', 3 * SIDE + MAIN ], [ 'tower', 3 * SIDE + 2 * MAIN ], [ 'anchorage', 4 * SIDE + 2 * MAIN ] ];
const r2 = ( v ) => Math.round( v * 100 ) / 100;
const out = {
	format: 'hillbomb-baybridge/1',
	name: 'San Francisco–Oakland Bay Bridge (West Span)',
	source: 'deck line: OpenStreetMap ways 8921938 + 23874736 (ODbL); layout: published span lengths, tower height and clearance',
	deckHeight: DECK, towerHeight: TOWER, width: 20,
	deck: [ at( 0 ), at( total ) ].map( ( p ) => [ r2( p.x ), r2( p.z ) ] ).concat( [] ),
	deckFrom: r2( shore ), deckLength: r2( total ),
	stations: stations.map( ( [ kind, d ] ) => { const p = at( shore + d ); return { kind, d: r2( shore + d ), x: r2( p.x ), z: r2( p.z ), ground: r2( T.heightAt( p.x, p.z ) ) }; } ),
	sfEnd: ( ( p ) => [ r2( p.x ), r2( p.z ), r2( Math.max( 0, T.heightAt( p.x, p.z ) ) ) ] )( at( 0 ) ),
};
mkdirSync( join( ROOT, 'public/landmarks' ), { recursive: true } );
writeFileSync( join( ROOT, 'public/landmarks/bay-bridge.json' ), JSON.stringify( out, null, 1 ) + '\n' );
console.log( `bay bridge: deck ${ total.toFixed( 0 ) } m, shore at ${ shore } m, last anchorage at ${ ( shore + 4 * SIDE + 2 * MAIN ).toFixed( 0 ) } m; ground under stations ${ out.stations.map( ( s ) => s.ground.toFixed( 0 ) ).join( ' ' ) }` );
