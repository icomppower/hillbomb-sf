// G1 Clean fork: the removals in DECISIONS D1–D6 are done; `vite build` passes; the dependency audit passes (every
// bare import is declared, no runtime dependencies); the scene renders in headless Dawn (the real App, measured
// numerically): sky by day and night, the bay, the course and the riders.
// --negative: a removed path restored, a build-breaking import, an undeclared package, and four render sabotages.
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gate, child, arg } from './lib/gate.mjs';
import { root } from './lib/tiles.mjs';

export const REMOVED = [
	'src/player/BoatController.js', 'src/player/BoatSpray.js', 'src/player/FerryAutopilot.js', 'src/player/FerryController.js', 'src/player/Player.js',
	'src/world/BoatModel.js', 'src/world/FerryModel.js', 'src/world/FerrySpec.js', 'src/world/boat', 'src/ocean/WakeSim.js',
	'public/ferry', 'tools/ferry', 'src/world/Waypoints.js', 'src/world/Places.js', 'src/ui', 'src/audio',
	'public/audio/fish_splash.ogg', 'public/audio/reel_wind.ogg', 'public/audio/swim.ogg', 'public/audio/surf_crash.ogg', 'public/audio/boat_engine.ogg',
	'public/buildings/b_0_1.glb.deflate', 'public/buildings/b_1_4.glb.deflate', 'public/buildings/b_2_2_l2.glb.deflate',
	'public/landmarks/golden-gate-bridge_lod0.glb', 'public/landmarks/alcatraz_lod1.glb',
];

function checkRemovals( dir ) {

	return REMOVED.filter( ( p ) => existsSync( join( dir, p ) ) ).map( ( p ) => `removals: ${ p } still present` );

}

function checkBuild( dir ) {

	const out = join( root, '.verify', 'g1-build-' + Math.random().toString( 36 ).slice( 2 ) );
	const r = spawnSync( join( root, 'node_modules/.bin/vite' ), [ 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error' ], { cwd: dir, encoding: 'utf8' } );
	const ok = r.status === 0 && existsSync( join( out, 'index.html' ) ) && existsSync( join( out, 'route/track1.bin' ) );
	rmSync( out, { recursive: true, force: true } );
	return ok ? [] : [ `build: vite build failed — ${ ( r.stderr || r.stdout || 'no index.html / route in dist' ).trim().split( '\n' ).slice( 0, 2 ).join( ' ' ) }` ];

}

function sourceFiles( dir ) {

	const out = [];
	const walk = ( p ) => {

		if ( ! existsSync( p ) ) return;
		for ( const e of readdirSync( p, { withFileTypes: true } ) ) {

			const f = join( p, e.name );
			if ( e.isDirectory() ) { if ( e.name !== 'node_modules' ) walk( f ); } else if ( /\.(m?js)$/.test( e.name ) ) out.push( f );

		}

	};

	for ( const d of [ 'src', 'tools', 'gates', 'test' ] ) walk( join( dir, d ) );
	return out;

}

function checkAudit( extra = [], pkgPatch = null ) {

	const pkg = { ...JSON.parse( readFileSync( join( root, 'package.json' ), 'utf8' ) ), ...( pkgPatch || {} ) };
	const declared = new Set( [ ...Object.keys( pkg.dependencies || {} ), ...Object.keys( pkg.devDependencies || {} ) ] );
	const builtins = new Set( builtinModules ), fail = [];
	if ( Object.keys( pkg.dependencies || {} ).length ) fail.push( `audit: runtime dependencies declared (${ Object.keys( pkg.dependencies ).join( ', ' ) }); the game ships none` );
	const files = [ ...sourceFiles( root ).map( ( f ) => [ relative( root, f ), readFileSync( f, 'utf8' ) ] ), ...extra ];
	for ( const [ file, src ] of files ) {

		const code = src.replace( /\/\*[\s\S]*?\*\//g, '' ).replace( /^\s*\/\/.*$/gm, '' );
		for ( const m of code.matchAll( /(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(=])import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm ) ) {

			const spec = m[ 1 ] || m[ 2 ] || m[ 3 ];
			if ( ! spec || spec.startsWith( '.' ) || spec.startsWith( '/' ) || /^https?:/.test( spec ) ) continue;
			if ( spec.startsWith( 'node:' ) || builtins.has( spec.split( '/' )[ 0 ] ) ) continue;
			const name = spec.startsWith( '@' ) ? spec.split( '/' ).slice( 0, 2 ).join( '/' ) : spec.split( '/' )[ 0 ];
			if ( ! declared.has( name ) ) fail.push( `audit: ${ file } imports '${ spec }', not declared in package.json` );
			// src/ runs in the browser: nothing from npm at runtime
			if ( file.startsWith( 'src/' ) ) fail.push( `audit: ${ file } imports package '${ spec }' at runtime` );

		}

	}

	return fail;

}

// ---- the render check, in a child (one App per process)
async function render( sabotage ) {

	const { bootApp } = await import( '../tools/headless/app.mjs' );
	const W = 960, Hh = 540;
	const H = await bootApp( { width: W, height: Hh, query: '?capture=1&noAudio' } );
	const app = H.app, api = globalThis.__HILLBOMB, game = app.game, fail = [];
	const S = {
		ocean: () => Object.defineProperty( app.ocean, 'visible', { get: () => false, set: () => {} } ),
		sun: () => { const f = app.updateSun.bind( app ); app.updateSun = () => { const t = app.settings.timeOfDay; app.settings.timeOfDay = 13; f(); app.settings.timeOfDay = t; }; },
		course: () => { for ( const m of [ game.ribbon, game.furniture ] ) Object.defineProperty( m, 'visible', { get: () => false, set: () => {} } ); },
		riders: () => { for ( const m of game.models ) Object.defineProperty( m.mesh, 'visible', { get: () => false, set: () => {} } ); },
	};
	if ( sabotage ) S[ sabotage ]();
	const band = ( px, y0, y1, x0 = 0, x1 = 1 ) => {

		let r = 0, g = 0, b = 0, n = 0;
		for ( let y = Math.floor( y0 * Hh ); y < Math.floor( y1 * Hh ); y ++ ) for ( let x = Math.floor( x0 * W ); x < Math.floor( x1 * W ); x ++ ) {

			const k = ( y * W + x ) * 4; r += px[ k ]; g += px[ k + 1 ]; b += px[ k + 2 ]; n ++;

		}

		return { r: r / n, g: g / n, b: b / n, l: ( r + g + b ) / ( 3 * n ) };

	};
	const diff = ( a, b, y0, y1, x0 = 0, x1 = 1 ) => {

		let s = 0, n = 0;
		for ( let y = Math.floor( y0 * Hh ); y < Math.floor( y1 * Hh ); y ++ ) for ( let x = Math.floor( x0 * W ); x < Math.floor( x1 * W ); x ++ ) {

			const k = ( y * W + x ) * 4;
			s += Math.abs( a[ k ] - b[ k ] ) + Math.abs( a[ k + 1 ] - b[ k + 1 ] ) + Math.abs( a[ k + 2 ] - b[ k + 2 ] ); n += 3;

		}

		return s / n;

	};
	const frames = async ( hours, n = 24, dt = 1 / 30 ) => { app.settings.timeOfDay = hours; H.frames( n, dt ); return H.readPixels(); };
	// on, off, and on again: the second "on" gives the frame-to-frame noise floor for the same scene
	const toggle = async ( objs, hours ) => {

		const was = objs.map( ( o ) => o.visible );
		const on = await frames( hours, 12, 0 );
		const on2 = await frames( hours, 12, 0 );
		objs.forEach( ( o ) => { o.visible = false; } );
		const off = await frames( hours, 12, 0 );
		objs.forEach( ( o, i ) => { o.visible = was[ i ]; } );
		return [ on, off, on2 ];

	};

	// the skyline wide: sky above, the bay and the city below
	api.camera( 'wide' );
	await frames( 13, 30 );
	const day = await frames( 13, 16, 0 );
	const [ withSea, noSea ] = await toggle( [ app.ocean ], 13 );
	await frames( 19.3, 40 ); // through dusk: the sky readback and temporal history lag a jump of ten hours
	const night = await frames( 23, 60 );
	// the course and the riders: the chase camera on the lower Filbert Steps, riders placed around the player
	api.camera( 'chase' );
	api.seek( 0.17 );
	const R = game.race.riders;
	R.forEach( ( r, i ) => { if ( i ) { r.bike.s = R[ 0 ].bike.s + 0.6 + i * 0.9; r.bike.l = ( i - 2 ) * 0.55; r.bike.y = game.route.height( r.bike.s ) + 1.02; } } );
	api.step( 1 );
	await frames( 17.45, 30 );
	const [ withCourse, noCourse, withCourse2 ] = await toggle( [ game.ribbon, game.furniture ], 17.45 );
	const [ withRiders, noRiders, withRiders2 ] = await toggle( game.models.map( ( m ) => m.mesh ), 17.45 );
	const sky = band( day, 0, 0.25 ), skyNight = band( night, 0, 0.25 );
	const seaD = diff( withSea, noSea, 0.35, 1 ), courseD = diff( withCourse, noCourse, 0.45, 1 ), riderD = diff( withRiders, noRiders, 0.3, 1, 0.3, 0.7 );
	const courseN = diff( withCourse, withCourse2, 0.45, 1 ), riderN = diff( withRiders, withRiders2, 0.3, 1, 0.3, 0.7 );
	console.log( `log: render: sky day L ${ sky.l.toFixed( 1 ) } (r ${ sky.r.toFixed( 0 ) } b ${ sky.b.toFixed( 0 ) }), night L ${ skyNight.l.toFixed( 1 ) }; bay on/off Δ ${ seaD.toFixed( 1 ) }; course on/off Δ ${ courseD.toFixed( 1 ) } (noise ${ courseN.toFixed( 2 ) }); riders on/off Δ ${ riderD.toFixed( 2 ) } (noise ${ riderN.toFixed( 2 ) }); errors ${ H.errors.length }` );
	const errors = H.errors.filter( ( e ) => ! /localstorage-file|trace-warnings/.test( e ) );
	if ( errors.length ) fail.push( `render: ${ errors.length } console/GPU errors, first: ${ errors[ 0 ].slice( 0, 160 ) }` );
	if ( ! ( sky.l >= 60 && sky.l <= 250 && sky.b > sky.r ) ) fail.push( `render-sky: daytime sky L ${ sky.l.toFixed( 1 ) }, b ${ sky.b.toFixed( 0 ) } vs r ${ sky.r.toFixed( 0 ) } (want L 60–250, blue > red)` );
	if ( ! ( skyNight.l < 0.35 * sky.l ) ) fail.push( `render-sky: night sky L ${ skyNight.l.toFixed( 1 ) } not below 35 % of day ${ sky.l.toFixed( 1 ) }` );
	if ( ! ( seaD > 4 ) ) fail.push( `render-ocean: hiding the bay changes the lower frame by only ${ seaD.toFixed( 1 ) } (want > 4)` );
	if ( ! ( courseD > 4 && courseD > 4 * courseN ) ) fail.push( `render-course: hiding the ribbon and furniture changes the lower frame by ${ courseD.toFixed( 1 ) } (want > 4 and > 4× the noise ${ courseN.toFixed( 2 ) })` );
	if ( ! ( riderD > 1 && riderD > 2.5 * riderN ) ) fail.push( `render-riders: hiding the riders changes the centre by ${ riderD.toFixed( 2 ) } (want > 1 and > 2.5× the noise ${ riderN.toFixed( 2 ) })` );
	return fail;

}

if ( process.argv.includes( '--render' ) ) {

	const fail = await render( arg( 'sabotage' ) );
	console.log( 'RESULT ' + JSON.stringify( fail ) );
	process.exit( 0 );

}

const renderChild = ( sabotage = '' ) => {

	const r = child( import.meta.url, [ '--render', ...( sabotage ? [ '--sabotage=' + sabotage ] : [] ) ] );
	return r.error ? [ `render: ${ r.error }` ] : r;

};

// fixture tree for the removal / build negatives
const fx = join( root, '.verify', 'g1-neg' );
const fixture = () => {

	rmSync( fx, { recursive: true, force: true } );
	mkdirSync( fx, { recursive: true } );
	for ( const f of [ 'index.html', 'vite.config.js', 'package.json' ] ) cpSync( join( root, f ), join( fx, f ) );
	cpSync( join( root, 'src' ), join( fx, 'src' ), { recursive: true } );
	cpSync( join( root, 'public' ), join( fx, 'public' ), { recursive: true } );
	return fx;

};

await gate( 'G1', {
	checks: [ () => checkRemovals( root ), () => checkBuild( root ), () => checkAudit(), () => renderChild() ],
	pass: 'D1–D6 removals done, vite build passes, dependency audit clean (no runtime deps), sky / bay / course / riders render in headless Dawn',
	negatives: [
		{ name: 'removed path restored (src/player/FerryController.js)', expect: /^removals/, run: () => { const d = fixture(); writeFileSync( join( d, 'src/player/FerryController.js' ), 'export class FerryController {}\n' ); return checkRemovals( d ); } },
		{ name: 'import of a deleted module', expect: /^build/, run: () => { const d = fixture(); const p = join( d, 'src/App.js' ); writeFileSync( p, "import { Player } from './player/Player.js';\nconsole.log( Player );\n" + readFileSync( p, 'utf8' ) ); return checkBuild( d ); } },
		{ name: "undeclared package ('three')", expect: /^audit/, run: () => checkAudit( [ [ 'src/fixture.js', "import * as THREE from 'three';\n" ] ] ) },
		{ name: 'a runtime dependency declared', expect: /^audit/, run: () => checkAudit( [], { dependencies: { 'harbor-engine': 'file:../harbor-engine' } } ) },
		{ name: 'ocean never drawn', expect: /^render-ocean/, run: () => renderChild( 'ocean' ) },
		{ name: 'sun frozen at noon', expect: /^render-sky/, run: () => renderChild( 'sun' ) },
		{ name: 'course never drawn', expect: /^render-course/, run: () => renderChild( 'course' ) },
		{ name: 'riders never drawn', expect: /^render-riders/, run: () => renderChild( 'riders' ) },
	],
} );
