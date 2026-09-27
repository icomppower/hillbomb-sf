// G7 Director (the sim, headless): one seeded autopilot run's shot log has a steps low-track, an air side-dolly,
// the skyline wide and the finish reverse; no two cuts are less than 4 s apart; the log is a pure function of the
// sim state (a second run of the same seed logs the same cuts).
// --negative: the director's rules sabotaged in-process.
import { gate } from './lib/gate.mjs';
import { loadRouteNode, runRace } from '../tools/sim/lib.mjs';
import { DIRECTOR } from '../src/sim/director.js';

const route = loadRouteNode();
const SEED = 1;

function shotLog( onTick = null ) {

	return runRace( route, { seed: SEED, onTick } ).director.log;

}

function check( onTick = null ) {

	const fail = [], log = shotLog( onTick );
	const names = new Set( log.map( ( c ) => c.shot ) );
	console.log( `G7: ${ log.length } cuts: ${ log.map( ( c ) => `${ c.t.toFixed( 1 ) }s ${ c.shot }` ).join( ', ' ) }` );
	for ( const want of [ 'steps', 'air', 'skyline', 'finish' ] ) if ( ! names.has( want ) ) fail.push( `shots: no "${ want }" shot in the seeded run` );
	let minGap = Infinity;
	for ( let i = 1; i < log.length; i ++ ) minGap = Math.min( minGap, log[ i ].t - log[ i - 1 ].t );
	if ( minGap < DIRECTOR_MIN - 1e-6 ) fail.push( `cuts: two cuts ${ minGap.toFixed( 2 ) } s apart (limit ${ DIRECTOR_MIN } s)` );
	const again = shotLog( onTick );
	if ( JSON.stringify( again ) !== JSON.stringify( log ) ) fail.push( 'determinism: a second run of the same seed logged different cuts' );
	return fail;

}

const DIRECTOR_MIN = 4; // SPEC §7, independent of the director's own setting
const sabotage = ( name, patch, expect, onTick = null ) => ( {
	name, expect,
	run: () => {

		const saved = { ...DIRECTOR };
		Object.assign( DIRECTOR, patch );
		try { return check( onTick ); } finally { Object.assign( DIRECTOR, saved ); }

	},
} );

await gate( 'G7', {
	checks: [ () => check() ],
	pass: 'seeded run logs steps low-track, air side-dolly, skyline wide and finish reverse; cuts ≥ 4 s apart; same seed, same cuts',
	negatives: [
		sabotage( 'cuts every second', { minShot: 1 }, /^cuts/ ),
		sabotage( 'air shots need 99 s of air', { airMin: 99 }, /"air"/ ),
		sabotage( 'finish reverse from 0 m', { finishReverse: 0 }, /"finish"/ ),
		sabotage( 'skyline already used', {}, /"skyline"/, ( race ) => { race.director.skylineUsed = true; } ),
		sabotage( 'a random cut', {}, /^(cuts|determinism)/, ( race ) => { if ( race.step === 1000 && Math.random() < 2 ) race.director._cut( 'rival', race, { rival: 1 } ); if ( race.step === 1000 + Math.floor( Math.random() * 200 ) ) race.director._cut( 'chase', race ); } ),
	],
} );
