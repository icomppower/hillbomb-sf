// G6 Weather (the real App, headless Dawn, capture API): weather('fog') → lens droplets on screen within 3 s and
// the player's grip reduced within 20 s (with the haze thickened and the ribbon wet); weather('dry') → the wet
// factor, the lens and the haze back to clear within 30 s.
// --negative: a slow layer, no lens hook, a slow drain, no haze.
import { gate, child, arg } from './lib/gate.mjs';

async function run( sabotage ) {

	const { bootApp } = await import( '../tools/headless/app.mjs' );
	const { WEATHER } = await import( '../src/sim/race.js' );
	const { surfaceGrip } = await import( '../src/sim/route.js' );
	const { BIKE } = await import( '../src/sim/bike.js' );
	const H = await bootApp( { width: 640, height: 360, query: '?capture=1&noAudio' } );
	const api = globalThis.__HILLBOMB, game = H.app.game, fail = [];
	const S = {
		slow: () => { WEATHER.rise = 1 / 60; },
		lens: () => { game.applyLens = () => {}; },
		drain: () => { WEATHER.fall = 1 / 90; },
		haze: () => { const f = game.applyWeather.bind( game ); game.applyWeather = () => { f(); H.app.haze.density.value = 1.6; }; },
	};
	if ( sabotage ) S[ sabotage ]();
	api.autopilot( true );
	H.frames( 4 );
	// advance t seconds of sim, a rendered frame every 1/4 s (the lens and haze are render-side)
	const advance = ( t ) => { for ( let k = 0; k < t * 4; k ++ ) { api.step( 30 ); H.frames( 1, 0.25 ); } };
	const grip = () => {

		const st = api.state(), p = st.riders[ 0 ], b = game.race.player.bike;
		return ( 1 - p.wet * BIKE.wetGrip ) * surfaceGrip( game.route.surface( b.s ), p.wet );

	};
	const dryGrip = grip();
	api.weather( 'fog' );
	let lensAt = null, gripAt = null;
	for ( let t = 0.25; t <= 22; t += 0.25 ) {

		advance( 0.25 );
		const st = api.state();
		if ( lensAt === null && st.fx.lens > 0 ) lensAt = t;
		if ( gripAt === null && grip() <= dryGrip * 0.62 ) gripAt = t;

	}

	const fog = api.state();
	console.log( `log: fog: lens droplets at ${ lensAt } s, grip ${ dryGrip.toFixed( 2 ) } → ${ grip().toFixed( 2 ) } (reduced at ${ gripAt } s), haze ${ fog.fx.haze.toFixed( 1 ) }, ribbon wet ${ fog.fx.ribbonWet.toFixed( 2 ) }, drizzle ${ fog.fx.drizzle }` );
	if ( ! ( lensAt !== null && lensAt <= 3 ) ) fail.push( `lens: no droplets within 3 s of the fog (first at ${ lensAt } s)` );
	if ( ! ( gripAt !== null && gripAt <= 20 ) ) fail.push( `grip: not reduced to ≤ 62 % within 20 s of the fog (at ${ gripAt } s; now ${ grip().toFixed( 2 ) } of ${ dryGrip.toFixed( 2 ) })` );
	if ( ! ( fog.fx.haze > 15 ) ) fail.push( `haze: the marine layer did not thicken the haze (density ${ fog.fx.haze.toFixed( 1 ) }, want > 15)` );
	if ( ! ( fog.fx.ribbonWet > 0.9 ) ) fail.push( `wet: the ribbon is not wet in the fog (${ fog.fx.ribbonWet.toFixed( 2 ) })` );

	api.weather( 'dry' );
	let clearAt = null;
	for ( let t = 0.25; t <= 32; t += 0.25 ) {

		advance( 0.25 );
		const st = api.state();
		if ( clearAt === null && st.weather.wet === 0 && st.fx.lens === 0 && st.fx.haze < 1.7 ) clearAt = t;

	}

	console.log( `log: dry: wet, lens and haze cleared at ${ clearAt } s` );
	if ( ! ( clearAt !== null && clearAt <= 30 ) ) fail.push( `drain: not clear within 30 s of weather('dry') (at ${ clearAt } s)` );
	return fail;

}

if ( process.argv.includes( '--run' ) ) {

	console.log( 'RESULT ' + JSON.stringify( await run( arg( 'sabotage' ) ) ) );
	process.exit( 0 );

}

const runChild = ( s = '' ) => { const r = child( import.meta.url, [ '--run', ...( s ? [ '--sabotage=' + s ] : [] ) ] ); return r.error ? [ `run: ${ r.error }` ] : r; };

await gate( 'G6', {
	checks: [ () => runChild() ],
	pass: "fog: lens droplets ≤ 3 s, grip reduced ≤ 20 s, haze thick, ribbon wet; dry: clear ≤ 30 s",
	negatives: [
		{ name: 'layer three times slower', expect: /^grip/, run: () => runChild( 'slow' ) },
		{ name: 'no lens droplets', expect: /^lens/, run: () => runChild( 'lens' ) },
		{ name: 'drains in 90 s', expect: /^drain/, run: () => runChild( 'drain' ) },
		{ name: 'haze never thickens', expect: /^haze/, run: () => runChild( 'haze' ) },
	],
} );
