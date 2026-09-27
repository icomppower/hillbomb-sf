// The race controller: four riders on the route, a fixed 120 Hz step, the grid and countdown, rider contact,
// checkpoints and splits, placements, the marine-layer event (wet factor → grip) and the camera director.
// Headless and deterministic for a seed: the render reads it, never writes it (inputs come in through step()).
import { makeBike, stepBike, BIKE } from './bike.js';
import { RiderAI, PROFILES } from './ai.js';
import { Director } from './director.js';
import { substream } from './rng.js';

export const DT = 1 / 120;
export const COUNTDOWN = 3;

export const RIDERS = [
	{ id: 'player', name: 'YOU', profile: 'AUTO', kit: { body: 0x16171a, accent: 0xff7a1a } },
	{ id: 'nob', name: 'NOB', profile: 'NOB', kit: { body: 0x2f6fd6, accent: 0xf2f2f2 } },
	{ id: 'dogpatch', name: 'DOGPATCH', profile: 'DOGPATCH', kit: { body: 0xc8352b, accent: 0x1b1b1b } },
	{ id: 'sutro', name: 'SUTRO', profile: 'SUTRO', kit: { body: 0x2fb36a, accent: 0xffd23a } },
];
// grid slots on the Coit Tower terrace: two rows of two
const GRID = [ [ 4.5, - 1.1 ], [ 4.5, 1.1 ], [ 1.5, - 1.1 ], [ 1.5, 1.1 ] ];

const CONTACT_LEN = 1.6; // m along the line (two bikes' capsules)
const CONTACT_WIDTH = 0.75; // m side by side
const CONTACT_SCRUB = 0.08; // speed lost by both on contact
const WET_RISE = 1 / 20; // the marine layer soaks the ground over 20 s
const WET_FALL = 1 / 25; // and dries over 25 s
// the marine layer is densest near the water: ground below this height soaks up to twice as fast as the summit
const WET_BAND = 45;

// the wet factor on the ground at height y (local MSL m), from the layer's overall wet factor
export const wetAt = ( wet, y ) => Math.min( 1, wet * ( 1 + Math.max( 0, WET_BAND - y ) / WET_BAND ) );

export class Race {

	constructor( route, { seed = 1, autopilot = false } = {} ) {

		this.route = route;
		this.seed = seed;
		this.t = 0; // race clock (s since GO)
		this.clock = 0; // sim time since the countdown began
		this.step = 0;
		this.phase = 'countdown';
		this.countdown = COUNTDOWN;
		this.events = [];
		const fogRng = substream( seed, 99 );
		// the marine layer rolls in somewhere in sections 2–6 (Telegraph Hill Blvd … Sansome → Embarcadero):
		// one of those five sections, then a point inside it
		const sec = route.sections[ 1 + Math.floor( fogRng() * 5 ) ];
		this.weather = { mode: 'auto', fogAt: sec.s0 + fogRng() * ( sec.s1 - sec.s0 ), wet: 0, target: 0, lens: 0, started: false, startedAt: null };
		this.riders = RIDERS.map( ( def, i ) => {

			const bike = makeBike( route, GRID[ i ][ 0 ], GRID[ i ][ 1 ] );
			const ai = new RiderAI( route, def.profile, substream( seed, i + 1 ) );
			return {
				...def, index: i, bike, ai, human: i === 0 && ! autopilot, mass: PROFILES[ def.profile ].mass,
				finishTime: null, splits: [], nextCheckpoint: 0, wet: 0, position: i + 1, section: 0, tricksLanded: 0, contacts: 0,
				contactCooldown: new Float32Array( RIDERS.length ),
			};

		} );
		this.player = this.riders[ 0 ];
		this.director = new Director( route );

	}

	setAutopilot( on ) { this.player.human = ! on; }

	setWeather( mode ) {

		// 'fog' | 'dry' | 'auto'
		const w = this.weather;
		w.mode = mode;
		if ( mode === 'fog' ) w.target = 1;
		else if ( mode === 'dry' ) w.target = 0;

	}

	toggleWeather() { this.setWeather( this.weather.target > 0.5 ? 'dry' : 'fog' ); }

	// one fixed step; `input` is the player's (ignored while on autopilot)
	tick( input = {} ) {

		const dt = DT;
		this.step ++;
		this.clock += dt;
		this._weather( dt );
		if ( this.phase === 'countdown' ) {

			const before = Math.ceil( this.countdown );
			this.countdown -= dt;
			if ( Math.ceil( this.countdown ) !== before && this.countdown > 0 ) this.events.push( { type: 'count', n: Math.ceil( this.countdown ) } );
			if ( this.countdown <= 0 ) {

				this.phase = 'racing';
				this.events.push( { type: 'go' } );

			}

			this.director.update( this, dt );
			return;

		}

		this.t += dt;
		const bikes = this.riders.map( ( r ) => r.bike );
		for ( const r of this.riders ) {

			const b = r.bike;
			const env = { route: this.route, wet: wetAt( this.weather.wet, this.route.height( b.s ) ) };
			r.wet = env.wet;
			const others = bikes.filter( ( o ) => o !== b );
			const inp = r.human ? input : r.ai.control( b, env, others );
			r.input = inp;
			const wasCrash = b.crash > 0, wasFinished = b.finished;
			stepBike( b, inp, dt, env );
			if ( b.crash > 0 && ! wasCrash ) this.events.push( { type: 'crash', rider: r.index, cause: b.crashCause } );
			if ( b.landed ) {

				if ( b.lastTricks > 0 ) r.tricksLanded += b.lastTricks;
				this.events.push( { type: 'land', rider: r.index, air: b.lastAir, tricks: b.lastTricks, dir: b.trickDir } );

			}

			// checkpoints and splits
			const cps = this.route.checkpoints;
			while ( r.nextCheckpoint < cps.length && b.s >= cps[ r.nextCheckpoint ].s ) {

				r.splits.push( this.t );
				this.events.push( { type: 'checkpoint', rider: r.index, k: r.nextCheckpoint, t: this.t } );
				r.nextCheckpoint ++;

			}

			const sec = this.route.sectionAt( b.s );
			if ( sec !== r.section ) {

				r.section = sec;
				if ( r.index === 0 ) this.events.push( { type: 'section', k: sec, name: this.route.sections[ sec ].name } );

			}

			if ( b.finished && ! wasFinished ) {

				r.finishTime = this.t;
				this.events.push( { type: 'finish', rider: r.index, t: this.t } );

			}

		}

		this._contacts( dt );
		this._placements();
		// the marine layer arrives when the leader reaches its point
		const w = this.weather;
		if ( w.mode === 'auto' && ! w.started && Math.max( ...bikes.map( ( b ) => b.s ) ) >= w.fogAt ) {

			w.started = true;
			w.startedAt = this.t;
			w.target = 1;
			this.events.push( { type: 'fog' } );

		}

		if ( this.phase === 'racing' && this.player.finishTime !== null ) this.phase = 'finished';
		this.director.update( this, dt );

	}

	_weather( dt ) {

		const w = this.weather;
		if ( w.wet < w.target ) w.wet = Math.min( w.target, w.wet + WET_RISE * dt );
		else if ( w.wet > w.target ) w.wet = Math.max( w.target, w.wet - WET_FALL * dt );
		// drizzle on the lens while the air is wet; it dries off faster than the ground
		if ( w.wet > 0.03 && w.target > 0 ) w.lens = Math.min( 1, w.lens + dt * 0.6 );
		else w.lens = Math.max( 0, w.lens - dt * 0.15 );

	}

	// lateral capsules: contact pushes both apart (heavier riders push harder) and scrubs speed once per touch
	_contacts( dt ) {

		const R = this.riders;
		for ( let i = 0; i < R.length; i ++ ) for ( let j = i + 1; j < R.length; j ++ ) {

			const a = R[ i ], b = R[ j ], A = a.bike, B = b.bike;
			a.contactCooldown[ j ] = Math.max( 0, a.contactCooldown[ j ] - dt );
			if ( A.crash > 0 || B.crash > 0 || A.finished || B.finished ) continue;
			const ds = B.s - A.s, dl = B.l - A.l;
			if ( Math.abs( ds ) >= CONTACT_LEN || Math.abs( dl ) >= CONTACT_WIDTH || Math.abs( A.y - B.y ) > 1 ) continue;
			const push = ( CONTACT_WIDTH - Math.abs( dl ) ), sgn = Math.sign( dl ) || ( i < j ? 1 : - 1 );
			const m = a.mass + b.mass;
			A.l -= sgn * push * ( b.mass / m );
			B.l += sgn * push * ( a.mass / m );
			A.lv -= sgn * 2.5 * ( b.mass / m );
			B.lv += sgn * 2.5 * ( a.mass / m );
			if ( a.contactCooldown[ j ] === 0 ) {

				A.speed *= 1 - CONTACT_SCRUB;
				B.speed *= 1 - CONTACT_SCRUB;
				a.contacts ++;
				b.contacts ++;
				a.contactCooldown[ j ] = 0.6;
				this.events.push( { type: 'contact', a: i, b: j } );

			}

		}

	}

	_placements() {

		const order = [ ...this.riders ].sort( ( a, b ) => {

			if ( a.finishTime !== null && b.finishTime !== null ) return a.finishTime - b.finishTime;
			if ( a.finishTime !== null ) return - 1;
			if ( b.finishTime !== null ) return 1;
			return b.bike.s - a.bike.s || a.index - b.index;

		} );
		order.forEach( ( r, k ) => { r.position = k + 1; } );

	}

	get allFinished() { return this.riders.every( ( r ) => r.finishTime !== null ); }

	// a compact snapshot for tests and the capture API
	snapshot() {

		return {
			seed: this.seed, t: this.t, step: this.step, phase: this.phase, countdown: Math.max( 0, this.countdown ),
			weather: { ...this.weather },
			shot: this.director.shot.name,
			riders: this.riders.map( ( r ) => ( {
				name: r.name, s: r.bike.s, l: r.bike.l, y: r.bike.y, speed: r.bike.speed, air: r.bike.air, pitch: r.bike.pitch,
				boost: r.bike.boost, score: r.bike.score, crashes: r.bike.crashes, crashing: r.bike.crash > 0, finished: r.bike.finished,
				finishTime: r.finishTime, position: r.position, splits: [ ...r.splits ], tricksLanded: r.tricksLanded,
				trickAttempts: r.ai.trickAttempts, contacts: r.contacts, wet: r.wet, ground: this.route.height( r.bike.s, r.bike.l ),
			} ) ),
		};

	}

}

export { BIKE };
