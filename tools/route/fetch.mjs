// Fetches the route source (SPEC §2): OpenStreetMap ways (highway=*, incl. highway=steps), the F-line tram
// tracks and street furniture (lamps, benches, trees) in the course bbox, from the Overpass API, into
// data/raw/route-osm.json. Adds the checksum to MANIFEST.sha256 and the licence to sources.json.
// Runs once on a machine with network; every later step reads the cache (tools/data/cache.mjs).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW } from '../data/cache.mjs';

export const BBOX = { south: 37.7945, west: - 122.4075, north: 37.8045, east: - 122.3920 };
const b = `${ BBOX.south },${ BBOX.west },${ BBOX.north },${ BBOX.east }`;
const query = `[out:json][timeout:90];
(
  way["highway"](${ b });
  way["railway"="tram"](${ b });
  node["highway"="street_lamp"](${ b });
  node["amenity"="bench"](${ b });
  node["natural"="tree"](${ b });
);
out body;
>;
out skel qt;`;

const url = 'https://overpass-api.de/api/interpreter';
const res = await fetch( url, { method: 'POST', body: 'data=' + encodeURIComponent( query ),
	headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'hillbomb-sf-data-fetch/1.0 (research build)' } } );
if ( ! res.ok ) throw new Error( `overpass HTTP ${ res.status }` );
const json = await res.json();
// stable order so the cache file is reproducible from the same OSM state
json.elements.sort( ( a, c ) => ( a.type < c.type ? - 1 : a.type > c.type ? 1 : a.id - c.id ) );
delete json.osm3s?.timestamp_areas_base;
const buf = Buffer.from( JSON.stringify( json ) );
const file = 'route-osm.json';
writeFileSync( join( RAW, file ), buf );
const sha = createHash( 'sha256' ).update( buf ).digest( 'hex' );

const man = join( RAW, 'MANIFEST.sha256' );
const lines = readFileSync( man, 'utf8' ).trim().split( '\n' ).filter( ( l ) => ! l.endsWith( '  ' + file ) );
lines.push( `${ sha }  ${ file }` );
writeFileSync( man, lines.join( '\n' ) + '\n' );

const srcPath = join( RAW, 'sources.json' );
const sources = JSON.parse( readFileSync( srcPath, 'utf8' ) );
sources[ file ] = {
	key: 'route-osm',
	title: 'OpenStreetMap ways (highway=*, highway=steps, railway=tram) and street furniture (street lamps, benches, trees), Coit Tower → Ferry Building course bbox (Overpass API)',
	licence: 'ODbL 1.0 — © OpenStreetMap contributors',
	licenceUrl: 'https://www.openstreetmap.org/copyright',
	url, query, bbox: BBOX,
	fetched: new Date().toISOString(),
	bytes: buf.length,
};
writeFileSync( srcPath, JSON.stringify( sources, null, 2 ) + '\n' );
const counts = {};
for ( const e of json.elements ) counts[ e.type ] = ( counts[ e.type ] || 0 ) + 1;
console.log( `route-osm.json ${ buf.length } bytes sha256 ${ sha }`, counts, 'osm base', json.osm3s?.timestamp_osm_base );
