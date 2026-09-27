// G5 Race (the sim, headless): five seeds, marine layer on its seeded schedule. All three AI riders finish every
// run; DOGPATCH crashes at least once across the five; SUTRO attempts ≥ 3 tricks in every run; the finish-time
// spread (slowest vs fastest of all four riders) stays ≤ 25 % in every run. No rubber-banding: the AI reads only
// its own bike, the route, the weather and the riders beside it.
// --negative: the rider profiles sabotaged in-process.
import { gate } from './lib/gate.mjs';
import { loadRouteNode, runRace } from '../tools/sim/lib.mjs';
import { PROFILES } from '../src/sim/ai.js';

const route = loadRouteNode();
const SEEDS = [ 1, 2, 3, 4, 5 ];

function check() {

	const fail = [];
	let dogCrashes = 0;
	for ( const seed of SEEDS ) {

		const race = runRace( route, { seed } );
		const R = race.riders, t = R.map( ( r ) => r.finishTime );
		const line = R.map( ( r ) => `${ r.name } ${ r.finishTime === null ? 'DNF' : r.finishTime.toFixed( 1 ) } c${ r.bike.crashes }${ r.name === 'SUTRO' ? ' tricks ' + r.ai.trickAttempts : '' }` ).join( ' · ' );
		console.log( `G5 seed ${ seed } (fog at ${ race.weather.fogAt.toFixed( 0 ) } m): ${ line }` );
		for ( const r of R.slice( 1 ) ) if ( r.finishTime === null ) fail.push( `finish: ${ r.name } did not finish seed ${ seed } (s ${ r.bike.s.toFixed( 0 ) })` );
		dogCrashes += R.find( ( r ) => r.name === 'DOGPATCH' ).bike.crashes;
		const sutro = R.find( ( r ) => r.name === 'SUTRO' );
		if ( sutro.ai.trickAttempts < 3 ) fail.push( `SUTRO: ${ sutro.ai.trickAttempts } trick attempts in seed ${ seed } (want ≥ 3)` );
		if ( t.every( ( x ) => x !== null ) ) {

			const spread = ( Math.max( ...t ) - Math.min( ...t ) ) / Math.min( ...t );
			if ( spread > 0.25 ) fail.push( `spread: ${ ( spread * 100 ).toFixed( 1 ) } % in seed ${ seed } (limit 25 %)` );

		}

	}

	console.log( `G5: DOGPATCH crashes across the five seeds: ${ dogCrashes }` );
	if ( dogCrashes < 1 ) fail.push( 'DOGPATCH: no crash across five seeds (want ≥ 1)' );
	return fail;

}

const sabotage = ( name, who, patch, expect ) => ( {
	name, expect,
	run: () => {

		const saved = { ...PROFILES[ who ] };
		Object.assign( PROFILES[ who ], patch );
		try { return check(); } finally { Object.assign( PROFILES[ who ], saved ); }

	},
} );

await gate( 'G5', {
	checks: [ check ],
	pass: 'five seeds: all AI finish every run, DOGPATCH crashes, SUTRO attempts ≥ 3 tricks per run, finish spread ≤ 25 %',
	negatives: [
		sabotage( 'DOGPATCH rides like NOB', 'DOGPATCH', { cornerUse: 0.55, brakeSlack: 0.5, brakesInBends: false, wetCare: 1, stairsSpeed: 7 }, /^DOGPATCH/ ),
		sabotage( 'SUTRO never flips', 'SUTRO', { tricks: false }, /^SUTRO/ ),
		sabotage( 'NOB crawls', 'NOB', { topSpeed: 12, stairsSpeed: 3 }, /^spread/ ),
		sabotage( 'NOB stalls', 'NOB', { topSpeed: 1, stairsSpeed: 0.5 }, /^finish/ ),
	],
} );
