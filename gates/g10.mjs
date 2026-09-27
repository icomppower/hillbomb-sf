// G10 Live: the GitHub Pages deploy is this build and plays from a cold load. The page is served, its baked route
// is byte-identical to the local one, and a fresh Chrome (no cache; real WebGPU on Metal) loads the game, starts
// the race and rides it: on the desktop with the keyboard and on a 390 × 844 phone with the on-screen controls.
// --negative: a URL with nothing deployed, and a stale deploy (the local route changed since).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gate, arg } from './lib/gate.mjs';
import { root } from './lib/tiles.mjs';
import { playthrough } from '../tools/browser/check.mjs';

const LIVE = arg( 'url', 'https://icomppower.github.io/hillbomb-sf/' );
const sha = ( b ) => createHash( 'sha256' ).update( b ).digest( 'hex' );

async function check( url, localRoute = readFileSync( join( root, 'public/route/index.json' ) ) ) {

	const fail = [];
	const bust = `?cold=${ Date.now() }`;
	const page = await fetch( url + bust ).catch( ( e ) => ( { ok: false, status: e.message } ) );
	if ( ! page.ok ) return [ `serve: ${ url } → ${ page.status }` ];
	const html = await page.text();
	if ( ! /<title>HILLBOMB SF<\/title>/.test( html ) ) fail.push( 'serve: the page is not HILLBOMB SF' );
	const route = await fetch( url + 'route/index.json' + bust );
	const remote = Buffer.from( await route.arrayBuffer() );
	if ( ! route.ok || sha( remote ) !== sha( localRoute ) ) fail.push( `deploy: the live route/index.json (${ route.status }) is not this build's` );
	else {

		const idx = JSON.parse( remote.toString() ), bin = await fetch( url + 'route/' + idx.file + bust );
		if ( sha( Buffer.from( await bin.arrayBuffer() ) ) !== idx.sha256 ) fail.push( 'deploy: the live track1.bin does not match its index' );

	}

	if ( fail.length ) return fail;
	for ( const device of [ 'desktop', 'phone' ] ) {

		const r = await playthrough( url, device );
		console.log( `G10 ${ device }: loaded in ${ r.loadSeconds } s, ${ r.tier } tier, ${ ( r.fps || 0 ).toFixed( 0 ) } fps, rode s ${ r.a && r.a.s.toFixed( 0 ) } → ${ r.b && r.b.s.toFixed( 0 ) } m, HUD ${ r.b && r.b.kmh } km/h ${ r.b && r.b.time }` );
		fail.push( ...r.fail.map( ( f ) => `play (${ device }): ${ f }` ) );

	}

	return fail;

}

await gate( 'G10', {
	checks: [ () => check( LIVE ) ],
	pass: `${ LIVE } serves this build and plays from a cold load (desktop keyboard + phone touch, real WebGPU)`,
	negatives: [
		{ name: 'a URL with nothing deployed', expect: /^serve/, run: () => check( LIVE.replace( 'hillbomb-sf', 'hillbomb-sf-missing' ) ) },
		{ name: 'a stale deploy (the local route changed)', expect: /^deploy/, run: () => check( LIVE, Buffer.from( readFileSync( join( root, 'public/route/index.json' ), 'utf8' ).replace( '"length":', '"length" :' ) ) ) },
	],
} );
