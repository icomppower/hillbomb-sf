// Three AI riders (SPEC §5): an honest race, no rubber-banding. Each profile's racing line and speed profile are
// computed once at boot from the route; the controller only reads its own bike, the route, the weather and the
// riders near it. The same controller, with the AUTO profile, is the player's autopilot. Deterministic (seeded).
import { BIKE, predictAirTime } from './bike.js';
import { SURFACE, surfaceGrip } from './route.js';

export const PROFILES = {
	// the metronome: smooth line, brakes early, rolls the steps; the wet barely changes her
	NOB: { name: 'NOB', topSpeed: 29, brakesInBends: false, cornerUse: 0.72, brakeUse: 0.8, brakeSlack: 0.5, apex: 18, stairsSpeed: 9, gap: false, tricks: false,
		kickers: 'avoid', wetCare: 0.85, boost: 'steady', aggression: 0, mass: 1, risk: 0, hopLips: false, jitter: 0.02 },
	// the wall: late brakes, inside lines, leans on people; heaviest. Hardly respects the wet.
	DOGPATCH: { name: 'DOGPATCH', topSpeed: 23.5, brakesInBends: true, cornerUse: 0.95, brakeUse: 0.85, brakeSlack: 4, apex: 34, stairsSpeed: 9.5, gap: false, tricks: false,
		kickers: 'ignore', wetCare: 0.15, boost: 'any', aggression: 1, mass: 1.35, risk: 0.35, hopLips: false, jitter: 0.1 },
	// the jump hunter: gaps every flight, flips every kicker, saves boost for the Embarcadero
	SUTRO: { name: 'SUTRO', topSpeed: 30, brakesInBends: false, cornerUse: 0.75, brakeUse: 0.7, brakeSlack: 1, apex: 26, stairsSpeed: 10, gap: true, tricks: true,
		kickers: 'seek', wetCare: 0.6, boost: 'sprint', aggression: 0, mass: 0.95, risk: 0.5, hopLips: true, jitter: 0.06 },
	// the player's autopilot: clean and quick, no stunts
	AUTO: { name: 'AUTO', topSpeed: 28.5, brakesInBends: false, cornerUse: 0.8, brakeUse: 0.75, brakeSlack: 1, apex: 24, stairsSpeed: 9, gap: false, tricks: false,
		kickers: 'avoid', wetCare: 1, boost: 'sprint', aggression: 0, mass: 1, risk: 0, hopLips: false, jitter: 0 },
};

const TWO_PI = Math.PI * 2;
const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );

// the speed a rider can hold through curvature k with lateral grip g (steady state of the lateral model:
// v²k = traction·g·( steerBase + steerPerSpeed·v ))
export function cornerSpeed( k, g ) {

	const a = Math.abs( k );
	if ( a < 1e-4 ) return 99;
	const T = BIKE.traction * g;
	const p = T * BIKE.steerPerSpeed, q = T * BIKE.steerBase;
	return ( p + Math.sqrt( p * p + 4 * a * q ) ) / ( 2 * a );

}

export class RiderAI {

	constructor( route, profile, rng ) {

		this.route = route;
		this.p = typeof profile === 'string' ? PROFILES[ profile ] : profile;
		this.rng = rng;
		this.line = new Float32Array( route.n );
		this.vmax = [ 0, 1 ].map( ( wet ) => this._speedProfile( wet ) );
		this._buildLine();
		this.flipTarget = 0; // full rotations committed this jump
		this.trickAttempts = 0;
		this.overrides = null; // scripted input (tests): { hopAt, trickAt, trick }
		this.sprintS = route.sections.find( ( s ) => s.name.startsWith( 'Embarcadero' ) ).s0;
		this.lapJitter = ( rng() - 0.5 ) * 2 * this.p.jitter; // this run's form: ± a few % of pace

	}

	// racing line: toward the inside of the bend ahead, kept off the walls; kickers sought or avoided
	_buildLine() {

		const r = this.route, P = this.p;
		for ( let i = 0; i < r.n; i ++ ) {

			let k = 0;
			for ( let d = 2; d <= 14; d += 2 ) k += r.curvature( i + d );
			k /= 7;
			const e = r.edges( i );
			let l = clamp( k * P.apex * 3, e.left + 0.55, e.right - 0.55 );
			if ( P.kickers !== 'ignore' ) {

				for ( const kk of r.kickers ) {

					if ( i < kk.s0 - 25 || i > kk.s1 ) continue;
					const full = kk.l0 <= e.left + 0.3 && kk.l1 >= e.right - 0.3;
					if ( P.kickers === 'seek' ) l = clamp( ( kk.l0 + kk.l1 ) / 2, e.left + 0.55, e.right - 0.55 );
					else if ( ! full ) {

						// the wider free side of the kicker
						const leftRoom = kk.l0 - e.left, rightRoom = e.right - kk.l1;
						l = leftRoom > rightRoom ? ( e.left + kk.l0 ) / 2 : ( kk.l1 + e.right ) / 2;

					}

				}

			}

			this.line[ i ] = l;

		}

		// smooth the line so the steering does not jerk
		const out = new Float32Array( r.n );
		for ( let i = 0; i < r.n; i ++ ) {

			let s = 0, n = 0;
			for ( let d = - 5; d <= 5; d ++ ) { const j = i + d; if ( j >= 0 && j < r.n ) { s += this.line[ j ]; n ++; } }
			out[ i ] = s / n;

		}

		this.line = out;

	}

	// curvature-derived speed limit per metre, then a backward braking pass that respects the grade
	_speedProfile( wet ) {

		const r = this.route, P = this.p, n = r.n;
		const v = new Float32Array( n );
		for ( let i = 0; i < n; i ++ ) {

			const surf = r._i( i, 4 );
			// the grip this rider believes it has: wetCare = how much of the wet it allows for
			const g = ( 1 - wet * P.wetCare * BIKE.wetGrip ) * surfaceGrip( surf, wet * P.wetCare ) * P.cornerUse;
			let lim = cornerSpeed( r.curvature( i ), g );
			if ( r.isStairs( i ) && ! P.gap ) lim = Math.min( lim, P.stairsSpeed * ( 1 - 0.3 * wet * P.wetCare ) );
			if ( r.isStairs( i ) && P.gap ) lim = Math.min( lim, P.stairsSpeed );
			v[ i ] = Math.min( lim, BIKE.speedCapBoost );

		}

		for ( let i = n - 2; i >= 0; i -- ) {

			const slope = r.height( i + 1 ) - r.height( i );
			const g = surfaceGrip( r._i( i, 4 ), wet * P.wetCare ) * ( 1 - wet * P.wetCare * BIKE.wetGrip );
			// braking decel available on this metre: brakes + rolling (+ the stair scrub), less gravity pulling
			// downhill. On a steep flight gravity can beat the brakes (negative): then the speed has to come
			// off before the flight, never assume a minimum decel.
			const stairs = r.isStairs( i ) ? BIKE.stairScrub * v[ i + 1 ] : 0;
			const decel = ( BIKE.brakeGrip * g + BIKE.brakeBase + BIKE.rolling ) * P.brakeUse + stairs + slope * 9.81;
			v[ i ] = Math.min( v[ i ], Math.sqrt( Math.max( 1, v[ i + 1 ] * v[ i + 1 ] + 2 * decel ) ) );

		}

		return v;

	}

	targetSpeed( s, wet ) {

		const i = Math.max( 0, Math.min( this.route.n - 1, Math.round( s ) ) );
		const a = this.vmax[ 0 ][ i ], b = this.vmax[ 1 ][ i ];
		return ( a + ( b - a ) * wet ) * ( 1 + this.lapJitter );

	}

	// input for this step: { pedal, brake, steer, boost, hop, trick }
	control( b, env, others = [] ) {

		const r = this.route, P = this.p;
		const input = { pedal: false, brake: false, steer: 0, boost: false, hop: false, trick: 0 };
		if ( b.crash > 0 || b.finished ) return input;

		// ---- line: target lateral, with a feed-forward for the bend
		let lt = this.line[ Math.max( 0, Math.min( r.n - 1, Math.round( b.s + 2 ) ) ) ];
		if ( P.aggression > 0 ) {

			// closes the door: leans into a rival alongside within 1.2 m
			for ( const o of others ) {

				if ( o.crash > 0 || o.finished ) continue;
				const ds = o.s - b.s, dl = o.l - b.l;
				if ( Math.abs( ds ) < 1.2 && Math.abs( dl ) < 2.2 ) { lt = o.l - Math.sign( dl || 1 ) * 0.45; break; }

			}

		}

		else {

			// racecraft: a rider just ahead on this line → take the side with more room to pass
			for ( const o of others ) {

				if ( o.crash > 0 || o.finished ) continue;
				const ds = o.s - b.s, dl = o.l - b.l;
				if ( ds > - 0.5 && ds < 4 && Math.abs( dl ) < 1.1 ) {

					const e0 = r.edges( b.s );
					lt = o.l - e0.left > e0.right - o.l ? o.l - 1.25 : o.l + 1.25;
					break;

				}

			}

		}

		const e = r.edges( b.s );
		lt = clamp( lt, e.left + 0.45, e.right - 0.45 );
		const grip = ( 1 - env.wet * BIKE.wetGrip ) * surfaceGrip( r.surface( b.s ), env.wet );
		const k = r.curvature( b.s );
		const need = b.speed * b.speed * k / ( BIKE.traction * grip );
		const cap = BIKE.steerBase + BIKE.steerPerSpeed * b.speed;
		input.steer = clamp( need / cap + ( ( lt - b.l ) * 1.4 - b.lv * 0.35 ) / cap * 2.2, - 1, 1 );

		// ---- speed
		// the pace this rider holds where nothing else limits it (heavier riders top out lower)
		let vt = Math.min( this.targetSpeed( b.s, env.wet ), P.topSpeed * ( 1 + this.lapJitter ) + ( b.boosting ? 6 : 0 ) );
		for ( let d = 2; d <= 10; d += 4 ) vt = Math.min( vt, this.targetSpeed( b.s + d, env.wet ) + d * 0.35 );
		// (the Astra model applies pedal and brake in the air as on the ground)
		if ( b.speed < vt - 0.3 ) input.pedal = true;
		if ( b.speed > vt + P.brakeSlack ) input.brake = true;
		// braking drops lateral traction to the brake-slide: a careful rider does not brake while the bend
		// needs more grip than a sliding tyre has (a late braker does, and slides)
		if ( input.brake && ! P.brakesInBends && Math.abs( b.speed * b.speed * k ) > BIKE.tractionBraking * grip * cap * 0.9 ) input.brake = false;

		// ---- boost
		const straight = Math.abs( k ) < 0.02 && vt > b.speed + 2 && ! b.air;
		if ( P.boost === 'any' ) input.boost = straight && b.boost > 20;
		else if ( P.boost === 'steady' ) input.boost = straight && b.boost > 60;
		else if ( P.boost === 'sprint' ) input.boost = straight && b.s > this.sprintS && b.boost > 5;

		// ---- hops: kicker lips (SUTRO), the top of a flight it gaps (SUTRO), scripted
		if ( ! b.air ) {

			if ( P.hopLips ) for ( const kk of r.kickers ) {

				if ( ! ( b.s > kk.s - 0.7 && b.s <= kk.s && b.l >= kk.l0 && b.l <= kk.l1 ) ) continue;
				// the landing impact a hop here would bring (launch off the lip, fall to the ground past it);
				// a risky rider sometimes goes anyway
				const vy = b.speed * 1.3 * kk.h / kk.len + BIKE.hop, drop = kk.h + Math.max( 0, r.height( kk.s ) - r.height( kk.s + b.speed ) );
				const impact = Math.sqrt( vy * vy + 2 * BIKE.gravity * drop );
				if ( this._lipRoll === undefined || this._lipKicker !== kk ) { this._lipKicker = kk; this._lipRoll = this.rng(); }
				if ( impact < 16.5 || this._lipRoll < P.risk * 0.25 ) input.hop = true;

			}
			if ( P.gap ) {

				const f = r.flights.find( ( q ) => b.s > q.s0 - 1.6 && b.s < q.s0 - 0.3 );
				if ( f && f.s1 - f.s0 <= 16 && f.h0 - f.h1 < 6.5 ) input.hop = true;

			}

		}

		// ---- tricks: commit to the rotations the predicted air time allows (a risky rider cuts it fine)
		if ( P.tricks ) {

			if ( b.air && b.airtime < 0.05 && this.flipTarget === 0 ) {

				const T = predictAirTime( b, r );
				const per = TWO_PI / BIKE.trickRate;
				// now and then a risky rider commits one rotation more than the air allows
				const greedy = this.rng() < P.risk * 0.1 ? 1 : 0;
				const n = Math.floor( ( T - BIKE.trickDelay - 0.15 ) / per ) + ( greedy && T > per ? 1 : 0 );
				if ( n >= 1 ) { this.flipTarget = Math.min( n, 2 ); this.trickAttempts ++; }

			}

			if ( b.air && this.flipTarget > 0 && Math.abs( b.rotation ) < this.flipTarget * TWO_PI ) input.trick = 1;
			if ( ! b.air ) this.flipTarget = 0;

		}

		// ---- scripted overrides (tests: a backflip off a kicker, a gap)
		const o = this.overrides;
		if ( o ) {

			if ( o.hopAt !== undefined && ! b.air && b.s > o.hopAt - 0.6 && b.s <= o.hopAt + 0.2 ) input.hop = true;
			if ( o.trick && b.air ) input.trick = Math.abs( b.rotation ) < ( o.turns ?? 1 ) * TWO_PI * ( o.under ?? 1 ) ? o.trick : 0;
			if ( o.speed !== undefined && b.s < ( o.speedUntil ?? Infinity ) ) {

				input.pedal = b.speed < o.speed;
				input.brake = b.speed > o.speed + 1;

			}

			if ( o.lateral !== undefined ) input.steer = clamp( ( ( o.lateral - b.l ) * 1.4 - b.lv * 0.35 ) / cap * 2.2, - 1, 1 );

		}

		return input;

	}

}

export { SURFACE };
