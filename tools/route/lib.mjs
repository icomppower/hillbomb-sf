// Shared helpers for the route pipeline (Node only): the bay terrain heightfield read from the baked tiles
// (public/terrain, the same heights the game renders), WGS84 → BayFrame, and the cached OSM route source.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toUTM } from '../geo/utm.mjs';
import { toLocal } from '../../src/world/BayFrame.js';
import { readCached } from '../data/cache.mjs';

export const ROOT = join( dirname( fileURLToPath( import.meta.url ) ), '../..' );

export function geoToLocal( lat, lon ) {

	const [ E, N ] = toUTM( lat, lon );
	return toLocal( E, N );

}

// Plain bilinear sampler over the terrain tiles (no HeightField: its coast-distance pass is not needed here)
export function loadTerrain( dir = join( ROOT, 'public/terrain' ) ) {

	const index = JSON.parse( readFileSync( join( dir, 'index.json' ), 'utf8' ) );
	const { res, tile, size } = index;
	const h = new Float32Array( res * res );
	for ( const f of index.files ) {

		const raw = inflateSync( readFileSync( join( dir, f.name ) ) );
		const dv = new DataView( raw.buffer, raw.byteOffset, raw.byteLength );
		for ( let y = 0; y < tile; y ++ ) for ( let x = 0; x < tile; x ++ ) h[ ( f.j * tile + y ) * res + f.i * tile + x ] = dv.getInt16( ( y * tile + x ) * 2, true ) / 100;

	}

	const texel = size / res, origin = - size / 2;
	// same convention as src/world/HeightField.js heightAt (texel centres)
	const at = ( x, z ) => {

		const fx = ( x - origin ) / texel - 0.5, fz = ( z - origin ) / texel - 0.5;
		const x0 = Math.max( 0, Math.min( res - 2, Math.floor( fx ) ) ), z0 = Math.max( 0, Math.min( res - 2, Math.floor( fz ) ) );
		const tx = Math.max( 0, Math.min( 1, fx - x0 ) ), tz = Math.max( 0, Math.min( 1, fz - z0 ) );
		const i = z0 * res + x0;
		const a = h[ i ] + ( h[ i + 1 ] - h[ i ] ) * tx, b = h[ i + res ] + ( h[ i + res + 1 ] - h[ i + res ] ) * tx;
		return a + ( b - a ) * tz;

	};

	return { heightAt: at, index, heights: h, res, size, texel, origin };

}

export function loadOSM( path = null ) {

	const j = JSON.parse( ( path ? readFileSync( path ) : readCached( 'route-osm.json' ) ).toString( 'utf8' ) );
	const nodes = new Map(), ways = [];
	for ( const e of j.elements ) {

		if ( e.type === 'node' ) nodes.set( e.id, e );
		else if ( e.type === 'way' ) ways.push( e );

	}

	return { nodes, ways, raw: j };

}

// ground-level footprint of each landmark model: the convex hull (x, z) of its LOD0 vertices below ground + 12 m
export function landmarkHulls() {

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
