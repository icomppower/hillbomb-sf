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
