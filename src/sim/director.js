// Camera director (SPEC §7): picks the shot from the sim state, logs every cut, and computes each shot's camera
// pose as a pure function of the sim state (the render only adds the chase cam's spring damping). Hard cuts are
// at least 4 s apart and never happen while the player is on a landing approach.
import { predictAirTime } from './bike.js';

// minShot: s between cuts; skyline: s the skyline wide holds; finishReverse: m before the line; airMin: s of
// predicted air that calls the side-dolly
// rivalAfter: s of racing before the rival cam may fire (the grid is bunched); rivalClosing: m/s of closing speed
// that counts as a pass; stepsMin: m, the shortest flight worth the stair camera; chaseMin: s the chase holds after
// a cut back to it (no ping-pong)
export const DIRECTOR = { minShot: 4, skyline: 5, finishReverse: 120, airMin: 0.6, rivalAfter: 12, rivalClosing: 1.5, stepsMin: 20, chaseMin: 6 };
// fixed world points for the skyline wide: Coit Tower, and the Bay Bridge's west span beyond the bay
const COIT = { x: 2803, z: 2744 };
const BAY_BRIDGE = { x: 5785, z: 3433 };

export class Director {

	constructor( route ) {

		this.route = route;
		this.shot = { name: 'chase', t0: 0 };
		this.log = [ { t: 0, shot: 'chase', s: 0 } ];
		this.skylineUsed = false;
		this.lastRivalGap = new Map();
		this.time = 0;

	}

	_cut( name, race, params = {} ) {

		const b = race.player.bike;
		this.shot = { name, t0: this.time, s0: b.s, ...params };
		this.log.push( { t: this.time, shot: name, s: Math.round( b.s * 10 ) / 10 } );

	}

	update( race, dt ) {

		this.time += dt;
		const r = this.route, b = race.player.bike, sh = this.shot;
		const age = this.time - sh.t0;
		const remaining = b.air ? predictAirTime( b, r ) : 0;
		const landingApproach = b.air && remaining < 0.6;
		const canCut = age >= ( sh.name === 'chase' && sh.t0 > 0 ? DIRECTOR.chaseMin : DIRECTOR.minShot ) && ! landingApproach;

		// what the state asks for, by priority
		let want = 'chase', params = {};
		const flight = r.flights.find( ( f ) => b.s > f.s0 - 4 && b.s < f.s1 - 1 && ( f.s1 - f.s0 ) >= DIRECTOR.stepsMin );
		const sec = r.sections[ r.sectionAt( b.s ) ].name;
		let rival = null;
		for ( const o of race.riders ) {

			if ( o === race.player || o.bike.crash > 0 ) continue;
			const gap = Math.abs( o.bike.s - b.s ), prev = this.lastRivalGap.get( o.index ) ?? gap;
			this.lastRivalGap.set( o.index, gap );
			// a real pass: close, closing fast, and not the start bunch
			if ( gap < 3 && ( prev - gap ) / dt >= DIRECTOR.rivalClosing && race.t >= DIRECTOR.rivalAfter && ! rival ) rival = o;

		}

		if ( race.phase !== 'countdown' && r.length - b.s < DIRECTOR.finishReverse ) want = 'finish';
		else if ( b.air && b.airtime < 0.25 && b.airtime + remaining > DIRECTOR.airMin ) { want = 'air'; params = { side: this._openSide( b.s ) }; }
		else if ( ! this.skylineUsed && race.t >= DIRECTOR.minShot && b.s > r.sections[ 1 ].s0 && b.s < r.sections[ 2 ].s0 - 10 ) want = 'skyline';
		else if ( flight && /Filbert/.test( sec ) ) { want = 'steps'; params = { flight: r.flights.indexOf( flight ), side: this._openSide( ( flight.s0 + flight.s1 ) / 2 ) }; }
		else if ( rival ) { want = 'rival'; params = { rival: rival.index }; }

		// hold the current shot while its reason lasts (and always for its minimum)
		const holds = {
			chase: false,
			finish: true,
			air: b.air || this.time - ( sh.landedAt ?? this.time ) < 0.6,
			skyline: age < DIRECTOR.skyline,
			steps: sh.flight !== undefined && b.s < r.flights[ sh.flight ].s1 + 3,
			rival: rival !== null,
		};
		if ( sh.name === 'air' && ! b.air && sh.landedAt === undefined ) sh.landedAt = this.time;

		if ( want !== sh.name && canCut ) {

			const priority = [ 'finish', 'air', 'skyline', 'steps', 'rival', 'chase' ];
			const stay = holds[ sh.name ] && priority.indexOf( sh.name ) <= priority.indexOf( want );
			if ( ! stay ) {

				if ( want === 'skyline' ) this.skylineUsed = true;
				this._cut( want, race, params );

			}

		}

	}

	// the side of the line with more room to a wall (+1 right, -1 left)
	_openSide( s ) {

		return this.route.wallRight( s ) >= this.route.wallLeft( s ) ? 1 : - 1;

	}

	// camera pose for the current shot: { eye, target, fov }. `p` is the player's rendered pose (interpolated):
	// { s, l, y, x, z } — pure function of the sim state + this shot's parameters.
	pose( race, p ) {

		const r = this.route, sh = this.shot, out = { eye: {}, target: {}, fov: 62, name: sh.name };
		const rider = { x: p.x, y: p.y, z: p.z };
		switch ( sh.name ) {

			case 'steps': {

				// low at the side of the flight, a few steps down from the rider, looking back up at it
				const f = r.flights[ sh.flight ];
				const sc = Math.min( f.s1 + 1, Math.max( f.s0 + 3, sh.s0 + 9 ) );
				const side = sh.side, room = side > 0 ? r.wallRight( sc ) : r.wallLeft( sc );
				const off = side * Math.max( 0.4, Math.min( room - 0.35, r.halfWidth( sc ) + 0.6 ) );
				r.world( sc, off, 0.9, out.eye );
				Object.assign( out.target, rider );
				out.target.y += 0.6;
				out.fov = 60;
				break;

			}

			case 'air': {

				// dolly alongside the rider through the air, on the open side
				const t = r.tangent( p.s ), room = sh.side > 0 ? r.wallRight( p.s ) : r.wallLeft( p.s );
				const off = Math.max( 1.2, Math.min( 6.5, room - 0.5 - Math.abs( p.l ) ) );
				out.eye.x = rider.x + t.rx * sh.side * off - t.x * 1.2;
				out.eye.z = rider.z + t.rz * sh.side * off - t.z * 1.2;
				out.eye.y = rider.y + 0.4;
				Object.assign( out.target, rider );
				out.target.y += 0.5;
				out.fov = 55;
				break;

			}

			case 'skyline': {

				// high west of the tower: Coit Tower, the bay and the Bay Bridge in one frame
				const g = r.height( 0 );
				out.eye.x = COIT.x - 150;
				out.eye.z = COIT.z - 40;
				out.eye.y = g + 55;
				out.target.x = BAY_BRIDGE.x;
				out.target.z = BAY_BRIDGE.z;
				out.target.y = 40;
				out.fov = 50;
				break;

			}

			case 'rival': {

				const o = race.riders[ sh.rival ].bike;
				const sm = Math.max( p.s, o.s ) + 5, lm = ( p.l + o.l ) / 2, side = this._openSide( sm );
				const room = side > 0 ? r.wallRight( sm ) : r.wallLeft( sm );
				r.world( sm, lm + side * Math.max( 0, Math.min( 2.2, room - 0.5 - Math.abs( lm ) ) ), 1.3, out.eye );
				r.world( ( p.s + o.s ) / 2, lm, 0.9, out.target );
				out.fov = 56;
				break;

			}

			case 'finish': {

				// past the line on the open side of the promenade, facing back north up the Embarcadero through the
				// finish gantry, the clock tower rising at the edge of the frame
				const L = r.length, t = r.tangent( L ), c = r.center( L );
				const side = r.wallLeft( L ) < r.wallRight( L ) ? 1 : - 1; // away from the Ferry Building
				const off = side * Math.min( 3.5, r.halfWidth( L ) - 0.5 );
				out.eye.x = c.x + t.x * 14 + t.rx * off;
				out.eye.z = c.z + t.z * 14 + t.rz * off;
				out.eye.y = r.height( L ) + 1.2;
				r.world( Math.max( 0, L - 60 ), - off * 0.4, 0, out.target );
				out.target.y += 7;
				out.fov = 72;
				break;

			}

			default: {

				// chase: behind and above, inside the walls
				const sb = Math.max( 0, p.s - 4.4 ), e = r.edges( sb );
				const l = Math.max( e.left + 0.3, Math.min( e.right - 0.3, p.l * 0.7 ) );
				r.world( sb, l, 1.95, out.eye );
				out.eye.y = Math.max( out.eye.y, rider.y + 1.0 );
				r.world( Math.min( r.length, p.s + 6 ), p.l * 0.5, 0.7, out.target );
				out.target.y = Math.max( out.target.y, rider.y + 0.35 );
				out.fov = 62;

			}

		}

		return out;

	}

}
