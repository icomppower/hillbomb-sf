// Node helpers for the headless sim (gates, tuning): the baked route read from public/route.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Route } from '../../src/sim/route.js';
import { Race } from '../../src/sim/race.js';

export const ROOT = join( dirname( fileURLToPath( import.meta.url ) ), '../..' );

export function loadRouteNode( dir = join( ROOT, 'public/route' ) ) {

	const index = JSON.parse( readFileSync( join( dir, 'index.json' ), 'utf8' ) );
	const b = readFileSync( join( dir, index.file ) );
	return new Route( index, new Float32Array( b.buffer.slice( b.byteOffset, b.byteOffset + b.length ) ) );

}

// run a whole race headless: every rider on its AI (the player on AUTO), until all finish or the cap
export function runRace( route, { seed = 1, weather = null, cap = 400, onTick = null } = {} ) {

	const race = new Race( route, { seed, autopilot: true } );
	if ( weather ) race.setWeather( weather );
	while ( ! race.allFinished && race.clock < cap ) {

		race.tick();
		if ( onTick ) onTick( race );
		race.events.length = 0;

	}

	return race;

}
