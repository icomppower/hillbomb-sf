// G4 Ride (the sim, headless): an autopilot race completes; no rider's wheels ever go below the surface − 0.5 m;
// the player's finish time is inside the frozen range; a scripted backflip off the Montgomery kicker lands clean
// and pays boost, the same flip under-rotated crashes; a scripted gap of a lower Filbert flight lands past it.
// --negative: the ride model sabotaged in-process (landing tolerance, suspension, hop, gravity, crash test).
import { gate } from './lib/gate.mjs';
import { freeze } from './lib/thresholds.mjs';
import { loadRouteNode, runRace } from '../tools/sim/lib.mjs';
import { BIKE, makeBike, stepBike } from '../src/sim/bike.js';
import { RiderAI } from '../src/sim/ai.js';
import { mulberry32 } from '../src/sim/rng.js';

const route = loadRouteNode();
const DT = 1 / 120;

function checkRace() {

	const fail = [];
	let worst = Infinity, at = null;
	const race = runRace( route, { seed: 1, onTick: ( rc ) => {

		for ( const r of rc.riders ) {

			const b = r.bike;
			if ( b.crash > 0 ) continue;
			// how far a wheel is pushed into the ground past the suspension's full travel (0 when riding normally)
			const sp = Math.sin( b.pitch ) * BIKE.halfBase;
			const gap = Math.min( b.y + sp - BIKE.rideHeight + BIKE.compressionMax - route.probe( b.s + BIKE.halfBase, b.l ),
				b.y - sp - BIKE.rideHeight + BIKE.compressionMax - route.probe( b.s - BIKE.halfBase, b.l ) );
			if ( gap < worst ) { worst = gap; at = `${ r.name } at s ${ b.s.toFixed( 1 ) }`; }

		}

	} } );
	const p = race.player;
	const lo = freeze( 'G4.finishMin', Math.floor( ( p.finishTime ?? 0 ) * 0.9 * 10 ) / 10, `player autopilot (AUTO), seed 1, finish time − 10 %; measured ${ ( p.finishTime ?? 0 ).toFixed( 2 ) } s (2026-09-27)` );
	const hi = freeze( 'G4.finishMax', Math.ceil( ( p.finishTime ?? 0 ) * 1.1 * 10 ) / 10, `player autopilot (AUTO), seed 1, finish time + 10 %; measured ${ ( p.finishTime ?? 0 ).toFixed( 2 ) } s` );
	console.log( `G4: autopilot finish ${ p.finishTime === null ? 'none' : p.finishTime.toFixed( 2 ) + ' s' } (frozen ${ lo }–${ hi }), ${ p.bike.crashes } crashes; lowest wheel vs surface (past full suspension travel) ${ worst.toFixed( 2 ) } m (${ at })` );
	if ( p.finishTime === null ) fail.push( `autopilot: the player did not finish (s ${ p.bike.s.toFixed( 0 ) } of ${ route.length })` );
	else if ( p.finishTime < lo || p.finishTime > hi ) fail.push( `finish time: ${ p.finishTime.toFixed( 2 ) } s outside the frozen ${ lo }–${ hi } s` );
	if ( worst < - 0.5 ) fail.push( `height: a wheel went ${ ( - worst ).toFixed( 2 ) } m below the surface (${ at }; limit 0.5)` );
	return fail;

}

// one rider alone on the route, AUTO with scripted overrides, until it lands after real air, crashes, or 8 s
function scripted( s0, speed, over, boost = 50, minAir = 0.3, minS = - Infinity ) {

	const b = makeBike( route, s0, 0 );
	b.speed = speed;
	b.boost = boost;
	const ai = new RiderAI( route, 'AUTO', mulberry32( 7 ) );
	ai.overrides = over;
	for ( let t = 0; t < 8; t += DT ) {

		const before = b.boost;
		stepBike( b, ai.control( b, { wet: 0 }, [] ), DT, { route, wet: 0 } );
		if ( b.landed && b.lastAir > minAir && b.s > minS ) return { res: 'land', s: b.s, air: b.lastAir, tricks: b.lastTricks, boostGain: b.boost - before };
		if ( b.crash > 0 ) return { res: 'crash', cause: b.crashCause, s: b.s };

	}

	return { res: 'none', s: b.s };

}

function checkTricks() {

	const fail = [];
	const k = route.kickers.find( ( q ) => q.kind === 'Montgomery curb' );
	const flip = scripted( k.s - 20, 9, { speed: 9, speedUntil: k.s, hopAt: k.s, trick: 1, turns: 1, lateral: 0 } );
	const under = scripted( k.s - 20, 9, { speed: 9, speedUntil: k.s, hopAt: k.s, trick: 1, turns: 1, under: 0.55, lateral: 0 } );
	// the lower Filbert flight to gap: the biggest drop that a hop can clear (≤ 12 m long, ≤ 7 m drop)
	const sec = route.sections.find( ( q ) => q.name.startsWith( 'Filbert Steps — lower' ) );
	const f = route.flights.filter( ( q ) => q.s0 >= sec.s0 && q.s1 <= sec.s1 && q.s1 - q.s0 <= 12 && q.h0 - q.h1 <= 7 ).sort( ( a, b ) => ( b.h0 - b.h1 ) - ( a.h0 - a.h1 ) )[ 0 ];
	// the first touchdown after the hop (any air) must be past the foot of the flight
	const gap = scripted( f.s0 - 12, 7, { speed: 7, speedUntil: f.s0, hopAt: f.s0 - 0.8, lateral: 0 }, 50, 0.1, f.s0 - 0.5 );
	console.log( `G4: backflip off the Montgomery kicker (s ${ k.s }): ${ JSON.stringify( flip ) }; under-rotated: ${ JSON.stringify( under ) }; gap of the ${ ( f.h0 - f.h1 ).toFixed( 1 ) } m flight ${ f.s0 }–${ f.s1 }: ${ JSON.stringify( gap ) }` );
	if ( ! ( flip.res === 'land' && flip.tricks >= 1 ) ) fail.push( `backflip: off the Montgomery kicker → ${ flip.res }${ flip.cause ? ' (' + flip.cause + ')' : '' }, ${ flip.tricks ?? 0 } tricks (want a clean landing with 1)` );
	else if ( ! ( flip.boostGain > 0 ) ) fail.push( `backflip: landed but boost did not rise (${ flip.boostGain.toFixed( 1 ) })` );
	if ( ! ( under.res === 'crash' && under.cause === 'rotation' ) ) fail.push( `under-rotation: a flip stopped at 55 % → ${ under.res } (want a rotation crash)` );
	if ( ! ( gap.res === 'land' && gap.s >= f.s1 + 0.5 ) ) fail.push( `gap: the lower flight ${ f.s0 }–${ f.s1 } → first touchdown ${ gap.res } at s ${ gap.s.toFixed( 1 ) } (want past the foot, ${ f.s1 + 0.5 })` );
	return fail;

}

// run the checks with BIKE constants changed, then restore them
const sabotage = ( name, patch, expect ) => ( {
	name, expect,
	run: () => {

		const saved = { ...BIKE };
		Object.assign( BIKE, patch );
		try { return [ ...checkRace(), ...checkTricks() ]; } finally { Object.assign( BIKE, saved ); }

	},
} );

await gate( 'G4', {
	checks: [ checkRace, checkTricks ],
	pass: 'autopilot race completes inside the frozen time, wheels never 0.5 m under the surface, Montgomery backflip lands (+boost), under-rotation crashes, lower-flight gap lands',
	negatives: [
		sabotage( 'landing tolerance 0.2 rad', { landingMaxPitchError: 0.2 }, /^backflip/ ),
		sabotage( 'no crash test on landings', { landingMaxPitchError: 10 }, /^under-rotation/ ),
		sabotage( 'soft suspension, no floor', { spring: 12, floor: - 3 }, /^height/ ),
		sabotage( 'weak hop', { hop: 2.5 }, /^gap/ ),
		sabotage( 'no downhill gravity', { gravitySlope: 0 }, /^(finish time|autopilot)/ ),
	],
} );
