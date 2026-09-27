// Fetches the San Francisco–Oakland Bay Bridge deck (OSM motorway bridge ways, West Span, with geometry) into
// data/raw/baybridge-osm.json, checksum in MANIFEST.sha256, licence in sources.json. The skyline wide (SPEC §7)
// needs the bridge; bay-crossing never modelled it. Tries the Overpass mirrors in turn.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW } from '../data/cache.mjs';

const BBOX = '37.785,-122.395,37.815,-122.36';
const query = `[out:json][timeout:90];way["bridge"="yes"]["highway"="motorway"]["bridge:name"~"Bay Bridge"](${ BBOX });out body geom;`;
const MIRRORS = [ 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter' ];
let json = null, used = null;
for ( const url of MIRRORS ) {

	try {

		const r = await fetch( url, { method: 'POST', body: 'data=' + encodeURIComponent( query ), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'hillbomb-sf-data-fetch/1.0 (research build)' } } );
		const t = await r.text();
		if ( r.ok && t.trim().startsWith( '{' ) ) { json = JSON.parse( t ); used = url; break; }

	} catch ( e ) { /* next mirror */ }

}

if ( ! json ) throw new Error( 'overpass: every mirror failed' );
json.elements.sort( ( a, b ) => a.id - b.id );
const buf = Buffer.from( JSON.stringify( json ) ), file = 'baybridge-osm.json';
writeFileSync( join( RAW, file ), buf );
const sha = createHash( 'sha256' ).update( buf ).digest( 'hex' );
const man = join( RAW, 'MANIFEST.sha256' );
const lines = readFileSync( man, 'utf8' ).trim().split( '\n' ).filter( ( l ) => ! l.endsWith( '  ' + file ) );
lines.push( `${ sha }  ${ file }` );
writeFileSync( man, lines.join( '\n' ) + '\n' );
const src = join( RAW, 'sources.json' ), sources = JSON.parse( readFileSync( src, 'utf8' ) );
sources[ file ] = { key: 'baybridge-osm', title: 'OpenStreetMap: San Francisco–Oakland Bay Bridge deck (motorway bridge ways with geometry), West Span, via the Overpass API',
	licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright', url: used, query, fetched: new Date().toISOString(), bytes: buf.length };
writeFileSync( src, JSON.stringify( sources, null, 2 ) + '\n' );
console.log( `${ file } ${ buf.length } bytes, ${ json.elements.length } ways, sha ${ sha.slice( 0, 12 ) } via ${ used }` );
