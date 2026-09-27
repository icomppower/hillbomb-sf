// The ride model (SPEC §3): the INKFALL "Astra" bicycle (inkfall-astra-shuimo, app/physics.ts) re-implemented
// with named constants, on the SF route. Track coordinates (s along the line, l lateral) plus a vertical state:
// not a free rigid body. Deterministic fixed-step; metres, seconds, radians. No engine, no GPU.
//
// Additions for SF (on top of Astra, not changes to it): stair treads under the wheel probes and a speed scrub
// on stairs, per-surface grip, the route's per-sample corridor and walls instead of fixed ±5.5 / ±9 m, the
// route's real corners (v²κ pushes the rider outward), parked-car obstacles. Rider-to-rider contact is resolved
// by the race (race.js).
import { surfaceGrip } from './route.js';

export const BIKE = {
	gravitySlope: 9.81, // along-slope gravity (× slope)
	pedal: 5.3,
	boost: 9,
	drag: 0.0105, // × v²
	rolling: 0.5,
	rollingOffLine: 4.5,
	brakeGrip: 12, // brake = brakeGrip·grip + brakeBase
	brakeBase: 1,
	speedCap: 29,
	speedCapBoost: 35,
	steerBase: 1.2, // lateral target velocity = steer × ( steerBase + steerPerSpeed · v )
	steerPerSpeed: 0.17,
	traction: 6.5, // lateral velocity eases toward the target at traction · grip (1/s)
	tractionBraking: 2.1, // …while braking: the brake-slide
	halfBase: 0.9, // wheel probes ± this along the line (1.8 m wheelbase)
	rideHeight: 1.15, // probe anchor to ground at zero compression
	compressionMax: 0.66,
	spring: 85,
	damper: 5.8,
	forceMax: 100,
	pitchTorque: 1.1,
	pitchDamping: 7,
	gravity: 22, // vertical integration
	floor: 0.44, // body never below ground + floor
	spawnHeight: 1.02,
	hop: 8.7,
	hopLift: 0.14,
	hopCooldown: 0.8,
	trickRate: 8.4, // rad/s with Q / E held in the air
	trickDelay: 0.12, // s of air before a trick input rotates
	selfLevel: 1.9, // 1/s pitch toward the slope without trick input
	landingMinAir: 0.15,
	landingMaxPitchError: 1.05, // rad (≈ 60°)
	landingMaxImpact: - 18, // m/s vertical vs ground
	scorePerAirSecond: 100,
	scorePerTrick: 500,
	boostOnLanding: 8,
	boostPerTrick: 12,
	boostDrain: 24,
	boostRegen: 5.5,
	boostMax: 100,
	wetGrip: 0.43, // grip = 1 − wet × wetGrip
	crashTime: 1.7,
	crashSpeedKeep: 0.24,
	respawnInset: 0.4, // m inside the path edge after a crash
	// SF additions
	stairScrub: 0.06, // speed lost per second rolling on stairs
	cornering: 1, // × v²κ outward lateral acceleration
	wallScrapeMaxLateral: 2.5, // m/s into a wall: below this it scrapes, above it crashes
	wallBounce: 0.3,
	wallScrub: 0.012, // speed lost per step in contact with a wall (~1.4 /s at 120 Hz)
};

export function makeBike( route, s = 0, l = 0 ) {

	const b = {
		s, l, speed: 0, lv: 0, y: 0, vy: 0, pitch: 0, omega: 0, air: false, airtime: 0, rotation: 0, tricks: 0,
		boost: BIKE.boostMax, score: 0, crash: 0, crashes: 0, hopCooldown: 0, front: 0.13, rear: 0.13, slip: 0,
		landed: 0, lastTricks: 0, lastAir: 0, trickDir: 0, surface: 0, stairs: false, offLine: false, finished: false,
		boosting: false, impact: 0, crashCause: '', scrape: 0,
	};
	b.y = route.height( s, l ) + BIKE.spawnHeight;
	b.pitch = slopePitch( route, s, l );
	return b;

}

const slopePitch = ( route, s, l ) => Math.atan2( route.height( s + BIKE.halfBase, l ) - route.height( s - BIKE.halfBase, l ), 2 * BIKE.halfBase );
const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );
const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );

export function crash( b, cause = '' ) {

	if ( b.crash > 0 ) return;
	b.crash = BIKE.crashTime;
	b.crashes ++;
	b.crashCause = cause;
	b.speed *= BIKE.crashSpeedKeep;
	b.lv = 0;
	b.rotation = 0;
	b.tricks = 0;

}

// input: { pedal, brake, steer (-1..1), boost, hop, trick (-1 front / +1 back / 0) }
// env: { route, wet }
export function stepBike( b, input, dt, env ) {

	const route = env.route, K = BIKE;
	b.landed = 0;
	b.impact = 0;
	b.scrape = Math.max( 0, b.scrape - dt );
	b.hopCooldown = Math.max( 0, b.hopCooldown - dt );
	if ( b.finished ) {

		// roll out past the line, braking
		b.speed = Math.max( 0, b.speed - 6 * dt );
		b.s = Math.min( route.length, b.s + b.speed * dt );
		b.y = route.height( b.s, b.l ) + K.spawnHeight;
		b.air = false;
		return;

	}

	if ( b.crash > 0 ) {

		// down for crashTime, then back on the line with the kept speed
		b.crash -= dt;
		if ( b.crash <= 0 ) {

			const e = route.edges( b.s );
			b.l = clamp( b.l, e.left + K.respawnInset, e.right - K.respawnInset );
			b.y = route.height( b.s, b.l ) + K.spawnHeight;
			b.vy = 0;
			b.pitch = slopePitch( route, b.s, b.l );
			b.omega = 0;
			b.air = false;
			b.airtime = 0;

		}

		return;

	}

	const oldGround = route.height( b.s, b.l );
	const slope = ( route.height( b.s + 1, b.l ) - route.height( b.s - 1, b.l ) ) / 2;
	const surf = route.surface( b.s );
	b.surface = surf;
	const grip = ( 1 - env.wet * K.wetGrip ) * surfaceGrip( surf, env.wet );
	const boosting = input.boost && b.boost > 1 && b.speed > 2;
	b.boosting = boosting;
	b.boost = clamp( b.boost + ( boosting ? - K.boostDrain : K.boostRegen ) * dt, 0, K.boostMax );

	const lim = route.limits( b.s );
	const offLine = b.l < lim.softL || b.l > lim.softR;
	b.offLine = offLine;
	const accel = - slope * K.gravitySlope + ( input.pedal ? K.pedal : 0 ) + ( boosting ? K.boost : 0 ) - K.drag * b.speed * b.speed
		- ( offLine ? K.rollingOffLine : K.rolling ) - ( input.brake ? K.brakeGrip * grip + K.brakeBase : 0 );
	b.speed = clamp( b.speed + accel * dt, 0, boosting ? K.speedCapBoost : K.speedCap );
	b.stairs = ! b.air && route.isStairs( b.s );
	if ( b.stairs ) b.speed *= 1 - K.stairScrub * dt;

	const lateralTarget = input.steer * ( K.steerBase + b.speed * K.steerPerSpeed );
	const traction = ( input.brake ? K.tractionBraking : K.traction ) * grip;
	b.lv += ( lateralTarget - b.lv ) * Math.min( 1, traction * dt );
	// the route's corners: holding a line through a bend takes v²κ of lateral grip (on the ground only)
	if ( ! b.air ) b.lv -= K.cornering * b.speed * b.speed * route.curvature( b.s ) * dt;
	b.slip = ( input.brake ? Math.abs( b.lv ) / 5 : Math.abs( lateralTarget - b.lv ) / 8 ) * ( b.speed / 20 );
	b.l += b.lv * dt;
	b.s = Math.min( route.length, b.s + b.speed * dt );
	if ( b.s >= route.length ) b.finished = true;

	const lim2 = route.limits( b.s );
	if ( b.l < lim2.hardL || b.l > lim2.hardR ) {

		// a building wall: a glancing touch scrapes along it (speed scrub, bounced off); a slam, or running off
		// the open side of the path, is a crash
		const left = b.l < lim2.hardL, wall = left ? lim2.wallL : lim2.wallR;
		if ( wall && Math.abs( b.lv ) < K.wallScrapeMaxLateral ) {

			b.l = left ? lim2.hardL : lim2.hardR;
			b.lv = ( left ? 1 : - 1 ) * Math.abs( b.lv ) * K.wallBounce;
			b.speed *= 1 - K.wallScrub;
			b.scrape = 0.25;

		} else {

			crash( b, wall ? 'wall' : 'off the line' );
			return;

		}

	}

	for ( const o of route.obstacles ) {

		if ( Math.abs( o.s - b.s ) > 3 ) continue;
		if ( Math.abs( b.s - o.s ) < o.halfWid + 0.4 && Math.abs( b.l - o.l ) < o.halfLen + 0.3 && b.y - route.height( b.s, b.l ) < o.h + 0.6 ) {

			crash( b, 'car' );
			return;

		}

	}

	const newGround = route.height( b.s, b.l ), gv = ( newGround - oldGround ) / dt;
	const frontGround = route.probe( b.s + K.halfBase, b.l ), rearGround = route.probe( b.s - K.halfBase, b.l );
	const frontAnchor = b.y + Math.sin( b.pitch ) * K.halfBase, rearAnchor = b.y - Math.sin( b.pitch ) * K.halfBase;
	b.front = clamp( frontGround + K.rideHeight - frontAnchor, 0, K.compressionMax );
	b.rear = clamp( rearGround + K.rideHeight - rearAnchor, 0, K.compressionMax );
	const frontForce = b.front > 0 ? clamp( b.front * K.spring - ( b.vy + b.omega * K.halfBase - gv ) * K.damper, 0, K.forceMax ) : 0;
	const rearForce = b.rear > 0 ? clamp( b.rear * K.spring - ( b.vy - b.omega * K.halfBase - gv ) * K.damper, 0, K.forceMax ) : 0;
	const contact = b.front > 0 || b.rear > 0;
	const wasAir = b.air;
	b.air = ! contact;

	if ( contact && wasAir && b.airtime > K.landingMinAir ) {

		const sp = Math.atan2( frontGround - rearGround, 2 * K.halfBase );
		const err = Math.abs( wrap( b.pitch - sp ) );
		b.impact = b.vy - gv;
		if ( err > K.landingMaxPitchError || b.vy - gv < K.landingMaxImpact ) {

			crash( b, err > K.landingMaxPitchError ? 'rotation' : 'impact' );
			return;

		}

		b.landed = 1;
		b.lastTricks = b.tricks;
		b.lastAir = b.airtime;
		b.score += Math.round( b.airtime * K.scorePerAirSecond ) + b.tricks * K.scorePerTrick;
		b.boost = clamp( b.boost + K.boostOnLanding + b.tricks * K.boostPerTrick, 0, K.boostMax );
		b.pitch = sp;
		b.omega *= 0.3;
		b.rotation = 0;
		b.tricks = 0;
		b.airtime = 0;

	}

	if ( contact && wasAir && b.airtime <= K.landingMinAir ) {

		b.airtime = 0;
		b.rotation = 0;
		b.tricks = 0;

	}

	if ( b.air ) {

		b.airtime += dt;
		if ( input.trick && b.airtime > K.trickDelay ) {

			const turn = input.trick * K.trickRate * dt;
			b.rotation += turn;
			b.pitch += turn;
			b.trickDir = Math.sign( input.trick );
			b.tricks = Math.floor( Math.abs( b.rotation ) / ( Math.PI * 2 ) );

		} else {

			const desired = Math.atan2( frontGround - rearGround, 2 * K.halfBase );
			b.pitch += wrap( desired - b.pitch ) * dt * K.selfLevel;

		}

	} else {

		b.omega += ( ( frontForce - rearForce ) * K.pitchTorque - b.omega * K.pitchDamping ) * dt;
		b.pitch += b.omega * dt;

	}

	b.vy += ( frontForce + rearForce - K.gravity ) * dt;
	b.y += b.vy * dt;
	if ( input.hop && contact && b.hopCooldown === 0 ) {

		b.vy = Math.max( b.vy, gv ) + K.hop;
		b.y += K.hopLift;
		b.hopCooldown = K.hopCooldown;
		b.air = true;
		b.airtime = 0;

	}

	if ( b.y < newGround + K.floor ) {

		b.y = newGround + K.floor;
		b.vy = Math.max( b.vy, gv );

	}

}

// seconds until the bike would touch down from its current vertical state (ballistic, K.gravity), against the
// ground under its predicted path; used by the AI (trick commitment) and the camera director (air shots)
export function predictAirTime( b, route, maxT = 3 ) {

	let y = b.y, vy = b.vy, s = b.s;
	const dt = 1 / 60;
	for ( let t = 0; t < maxT; t += dt ) {

		vy -= BIKE.gravity * dt;
		y += vy * dt;
		s += b.speed * dt;
		if ( y - BIKE.rideHeight + BIKE.compressionMax * 0.2 < route.probe( s, b.l ) ) return t;

	}

	return maxT;

}
