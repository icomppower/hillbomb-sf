// The game layer: owns the race (src/sim), steps it at a fixed 120 Hz (at most 4 catch-up steps a frame) with
// render interpolation, and turns it into pictures and sound: the ribbon and furniture, four posed riders, the
// camera director's shots (spring-damped chase, FOV kick on boost, impact shake), the marine layer (haze
// density, dimmed sun, wet ground, drizzle, lens droplets), particles, HUD, menus, persistence, and the
// ?capture=1 API (window.__HILLBOMB) for the gates.
import { Vector3, Color, MathUtils } from '../engine/index.js';
import { G } from '../engine/render/Frame.js';
import { Race, RIDERS, DT } from '../sim/race.js';
import { buildRibbon } from './Ribbon.js';
import { buildFurniture } from './Furniture.js';
import { RiderModel } from './RiderModel.js';
import { Particles } from './Particles.js';
import { Controls, wantsTouch } from './Controls.js';
import { Hud, NullHud, fmt } from './Hud.js';
import { GameAudio } from './Audio.js';

const MAX_CATCHUP = 4;
const BODY_ABOVE_GROUND = 1.02; // sim body anchor → ground under the bike at rest
const BLURBS = {
	player: 'Black kit, orange accent. Your line, your risk.',
	nob: 'The metronome. Smooth line, brakes early, rolls the steps. The wet barely touches her.',
	dogpatch: 'The wall. Late brakes, inside lines, leans on you. Heaviest rider out there.',
	sutro: 'The jump hunter. Gaps every flight, flips every kicker, saves boost for the Embarcadero.',
};
const SHOT_ALIAS = { chase: 'chase', side: 'air', wide: 'skyline', finish: 'finish', steps: 'steps' };
const BEST_KEY = 'hillbomb-sf-best';

// localStorage, wrapped (private windows throw); skipped headless (no real DOM)
const hasDom = () => typeof document !== 'undefined' && !! document.head;
const store = {
	get( k ) { if ( ! hasDom() ) return null; try { return JSON.parse( localStorage.getItem( k ) ); } catch ( e ) { return null; } },
	set( k, v ) { if ( ! hasDom() ) return; try { localStorage.setItem( k, JSON.stringify( v ) ); } catch ( e ) { /* private mode: no persistence */ } },
};

export class Game {

	constructor( app ) {

		this.app = app;
		this.route = app.route;
		this.qs = app.qs;
		this.capture = this.qs.has( 'capture' );
		this.mode = 'title'; // title | race | paused | settings | results
		this.acc = 0;
		this.forceShot = null;
		this.camPos = new Vector3();
		this.camLook = new Vector3();
		this.camFov = 62;
		this.shake = 0;
		this.lastShot = null;
		this.frames = 0;
		this.best = store.get( BEST_KEY );

	}

	async init() {

		const app = this.app, scene = app.scene, route = this.route;
		this.controls = new Controls( app.input );
		this.ribbon = buildRibbon( route );
		scene.add( this.ribbon );
		const furn = buildFurniture( route, ( x, z ) => app.terrainData.heightAt( x, z ) );
		this.furniture = furn.mesh;
		scene.add( this.furniture );
		for ( const l of furn.lamps ) app.localLights.add( { position: new Vector3( l.x, l.y, l.z ), color: new Color( 1.0, 0.72, 0.45 ), intensity: 7, range: 18, kind: 'lamp' } );
		this.models = RIDERS.map( ( r ) => new RiderModel( r.kit ) );
		for ( const m of this.models ) scene.add( m.mesh );
		this.particles = new Particles();
		scene.add( this.particles.mesh, this.particles.rain );
		this.hud = typeof document !== 'undefined' && document.head ? new Hud( { riders: RIDERS.map( ( r ) => ( { ...r, blurb: BLURBS[ r.id ] } ) ), route } ) : new NullHud();
		this.touch = wantsTouch( this.qs );
		if ( this.touch ) { this.controls.installTouch( this.hud.root ); this.hud.setTouch( true ); }
		this.audio = new GameAudio();
		this.newRace( Number( this.qs.get( 'seed' ) ) || ( this.capture ? 1 : ( Math.random() * 1e9 ) >>> 0 ) );
		if ( this.capture ) {

			this.mode = 'race';
			this.manual = true;
			this.hud.setRacing( true );
			this._installCapture();

		} else {

			this.showTitle();

		}

		this._placeCamera( 0, true );

	}

	newRace( seed ) {

		this.seed = seed >>> 0;
		this.race = new Race( this.route, { seed: this.seed, autopilot: this.qs.has( 'autopilot' ) } );
		this.prev = this.race.riders.map( ( r ) => this._vis( r.bike ) );
		this.acc = 0;
		this.resultsShown = false;
		this.finishAt = null;
		this.lastShot = null;
		this.boostFov = 0;
		for ( const m of this.models || [] ) m.crank = 0;

	}

	_vis( b ) { return { s: b.s, l: b.l, y: b.y, pitch: b.pitch, lv: b.lv, speed: b.speed }; }

	// ---------------------------------------------------------------- flow
	showTitle() {

		this.mode = 'title';
		this.hud.setRacing( false );
		this.hud.showTitle( { best: this.best && this.best.time, touch: this.touch }, () => this.startRace() );

	}

	startRace( seed = null ) {

		if ( seed !== null ) this.newRace( seed );
		this.mode = 'race';
		this.hud.hideScreens();
		this.hud.setRacing( true );
		this.audio.resume();
		this.app.input.requestLock?.();

	}

	restart() {

		this.newRace( this.seed );
		this.startRace();

	}

	togglePause() {

		if ( this.mode === 'race' ) {

			this.mode = 'paused';
			this.hud.showPause( { resume: () => this.togglePause(), restart: () => this.restart(), settings: () => this.openSettings() } );

		} else if ( this.mode === 'paused' || this.mode === 'settings' ) {

			this.mode = 'race';
			this.hud.hideScreens();

		}

	}

	openSettings() {

		const back = this.mode === 'title' ? 'title' : this.mode === 'results' ? 'results' : 'paused';
		this.mode = 'settings';
		this._settingsBack = back;
		const s = () => ( {
			muted: this.audio.muted, fog: this.race.weather.target > 0.5, time: this.timeName || 'Golden hour',
			autopilot: ! this.race.player.human, tier: this.app.quality.name,
		} );
		const h = {
			mute: () => { this.audio.setMuted( ! this.audio.muted ); this.hud.showSettings( s(), h ); },
			fog: () => { this.race.toggleWeather(); this.hud.showSettings( s(), h ); },
			time: () => { this.timeName = this.app.cycleTime(); this.hud.showSettings( s(), h ); },
			autopilot: () => { this.race.setAutopilot( this.race.player.human ); this.hud.showSettings( s(), h ); },
			tier: () => {

				const next = { low: 'high', high: 'mobile', mobile: 'low' }[ this.app.quality.name ] || 'low';
				const u = new URL( location.href );
				u.searchParams.set( 'tier', next );
				location.href = u.toString();

			},
			close: () => this._closeSettings(),
		};
		this.hud.showSettings( s(), h );

	}

	_closeSettings() {

		const back = this._settingsBack;
		if ( back === 'title' ) this.showTitle();
		else if ( back === 'results' ) this._showResults();
		else { this.mode = 'paused'; this.togglePause(); }

	}

	// ---------------------------------------------------------------- per frame (before the sun / render)
	update( dt ) {

		const app = this.app, input = app.input, race = this.race;
		this.frames ++;
		this.controls.pollGamepad();
		const hit = ( c ) => input.hit( c );
		if ( hit( 'KeyM' ) ) { this.audio.setMuted( ! this.audio.muted ); this.hud.message( this.audio.muted ? 'Sound off' : 'Sound on' ); }
		if ( hit( 'KeyV' ) ) { race.toggleWeather(); this.hud.message( race.weather.target > 0.5 ? 'Marine layer on' : 'Marine layer clearing' ); }
		if ( hit( 'KeyT' ) ) { this.timeName = app.cycleTime(); this.hud.message( this.timeName ); }
		if ( this.mode === 'title' && ( hit( 'Enter' ) || hit( 'Space' ) || this.controls.pad.startHit ) ) this.startRace();
		else if ( hit( 'KeyR' ) && this.mode !== 'title' ) this.restart();
		else if ( ( hit( 'KeyP' ) || hit( 'Escape' ) || this.controls.pad.startHit ) && ( this.mode === 'race' || this.mode === 'paused' ) ) this.togglePause();
		else if ( hit( 'KeyH' ) ) { if ( this.mode === 'settings' ) this._closeSettings(); else this.openSettings(); }

		// ---- fixed-step sim
		if ( this.mode === 'race' && ! this.manual ) {

			this.acc += Math.min( dt, 0.25 );
			let n = 0;
			while ( this.acc >= DT && n < MAX_CATCHUP ) {

				this._tick();
				this.acc -= DT;
				n ++;

			}

			if ( n === MAX_CATCHUP ) this.acc = Math.min( this.acc, DT ); // drop the backlog rather than spiral

		}

		const alpha = this.manual ? 1 : Math.min( 1, this.acc / DT );
		this._pose( dt, alpha );
		this._placeCamera( dt );
		if ( race.phase === 'finished' && this.finishAt === null ) this.finishAt = performance.now();
		if ( this.finishAt !== null && ! this.resultsShown && ! this.capture && performance.now() - this.finishAt > 3500 ) this._showResults();

	}

	_tick( input = null ) {

		const race = this.race;
		this.prev = race.riders.map( ( r ) => this._vis( r.bike ) );
		race.tick( input || this.controls.read() );
		for ( const e of race.events ) this._event( e );
		race.events.length = 0;

	}

	_event( e ) {

		const race = this.race, hud = this.hud, you = e.rider === 0;
		this.audio.event( e, race );
		switch ( e.type ) {

			case 'count': hud.countdown( e.n ); break;
			case 'go': hud.countdown( 0 ); break;
			case 'section': hud.section( e.name, e.k ); break;
			case 'fog': hud.message( 'The marine layer is rolling in' ); break;
			case 'land':
				if ( you ) {

					this.shake = Math.max( this.shake, Math.min( 0.5, e.air * 0.35 ) );
					if ( e.tricks > 0 ) hud.trick( `${ e.dir > 0 ? 'BACKFLIP' : 'FRONTFLIP' }${ e.tricks > 1 ? ' ×' + e.tricks : '' } +${ Math.round( e.air * 100 ) + e.tricks * 500 }` );
					else if ( e.air > 0.6 ) hud.trick( `AIR ${ e.air.toFixed( 1 ) }s +${ Math.round( e.air * 100 ) }` );

				}

				this._burst( e.rider, 10 );
				break;
			case 'crash':
				if ( you ) { hud.message( e.cause === 'wall' ? 'INTO THE WALL' : e.cause === 'rotation' ? 'UNDER-ROTATED' : e.cause === 'impact' ? 'CASED IT' : 'CRASH', 'is-bad' ); this.shake = 1; }
				this._burst( e.rider, 22 );
				break;
			case 'contact': if ( e.a === 0 || e.b === 0 ) this.shake = Math.max( this.shake, 0.25 ); break;
			case 'checkpoint':
				if ( you ) {

					const best = this.best && this.best.splits && this.best.splits[ e.k ];
					hud.split( best !== undefined && best !== null ? e.t - best : null, `Checkpoint ${ e.k + 1 }` );

				}

				break;
			case 'finish':
				if ( you ) {

					const p = race.player;
					const newBest = ! this.best || p.finishTime < this.best.time;
					this.newBest = newBest;
					if ( newBest ) { this.best = { time: p.finishTime, splits: [ ...p.splits ] }; store.set( BEST_KEY, this.best ); }
					hud.message( `${ p.position }${ [ 'th', 'st', 'nd', 'rd' ][ p.position ] || 'th' } · ${ fmt( p.finishTime ) }`, 'is-good' );

				}

				break;

		}

	}

	_showResults() {

		const race = this.race, p = race.player;
		this.resultsShown = true;
		this.mode = 'results';
		const order = [ ...race.riders ].sort( ( a, b ) => a.position - b.position ).map( ( r ) => ( {
			position: r.position, name: r.name, time: r.finishTime, crashes: r.bike.crashes, you: r.index === 0,
		} ) );
		this.hud.showResults( { position: p.position, time: p.finishTime, score: p.bike.score, best: this.best && this.best.time, newBest: this.newBest, order },
			{ restart: () => { this.newRace( ( this.seed + 1 ) >>> 0 ); this.startRace(); } } );

	}

	// ---------------------------------------------------------------- riders
	_interp( i, alpha ) {

		const a = this.prev[ i ], b = this.race.riders[ i ].bike;
		const L = ( x, y ) => x + ( y - x ) * alpha;
		return { s: L( a.s, b.s ), l: L( a.l, b.l ), y: L( a.y, b.y ), pitch: L( a.pitch, b.pitch ), lv: L( a.lv, b.lv ), speed: L( a.speed, b.speed ) };

	}

	_pose( dt, alpha ) {

		const route = this.route;
		this.vis = [];
		for ( let i = 0; i < this.race.riders.length; i ++ ) {

			const r = this.race.riders[ i ], b = r.bike, v = this._interp( i, alpha ), m = this.models[ i ];
			const w = route.world( v.s, v.l, 0, {} );
			v.x = w.x; v.z = w.z;
			const k = route.curvature( v.s );
			const yaw = route.heading( v.s ) + Math.atan2( v.lv, Math.max( 3, v.speed ) ) * 0.6;
			const lean = MathUtils.clamp( v.speed * v.speed * k / 9.81 + v.lv * 0.04, - 0.6, 0.6 );
			const inp = r.input || {};
			m.mesh.position.set( w.x, v.y - BODY_ABOVE_GROUND, w.z );
			m.mesh.rotation.set( - v.pitch, yaw, - lean, 'YXZ' );
			m.pose( { speed: v.speed, pedal: !! inp.pedal && ! b.air, compression: ( b.front + b.rear ) / 2, steer: inp.steer || 0, trick: b.air ? inp.trick || 0 : 0,
				crash: b.crash, air: b.air, dt, tuck: b.air && inp.trick ? 1 : 0 } );
			this.vis.push( v );
			// dust / spray / wood chips off the rear wheel when skidding, braking hard or chattering down steps
			if ( ! b.air && b.crash <= 0 && v.speed > 5 && ( b.slip > 0.35 || b.stairs || ( inp.brake && v.speed > 9 ) ) && Math.random() < 0.5 ) {

				const wet = r.wet > 0.3;
				const kind = wet ? 'spray' : b.surface === 3 || b.surface === 5 ? 'chips' : 'dust';
				const t = route.tangent( v.s );
				this.particles.emit( kind, new Vector3( w.x - t.x * 0.55, v.y - BODY_ABOVE_GROUND + 0.05, w.z - t.z * 0.55 ), new Vector3( t.x * v.speed, 0, t.z * v.speed ), 1 );

			}

		}

	}

	_burst( i, n ) {

		const v = this.vis && this.vis[ i ];
		if ( ! v ) return;
		const t = this.route.tangent( v.s ), wet = this.race.riders[ i ].wet > 0.3;
		this.particles.emit( wet ? 'spray' : 'dust', new Vector3( v.x, v.y - BODY_ABOVE_GROUND + 0.1, v.z ), new Vector3( t.x * v.speed * 0.5, 0, t.z * v.speed * 0.5 ), n );

	}

	// ---------------------------------------------------------------- camera
	_placeCamera( dt, snap = false ) {

		const app = this.app;
		if ( app.freeCam ) return;
		const race = this.race, dir = race.director;
		if ( this.forceShot ) {

			if ( dir.shot.name !== SHOT_ALIAS[ this.forceShot ] ) {

				const name = SHOT_ALIAS[ this.forceShot ];
				const b = race.player.bike;
				dir.shot = { name, t0: dir.time, s0: b.s, side: dir._openSide( b.s ), flight: 0 };

			}

		}

		const p = ( this.vis && this.vis[ 0 ] ) || { ...this._vis( race.player.bike ), ...race.route.world( race.player.bike.s, race.player.bike.l, 0, {} ) };
		const pose = this.mode === 'title' && ! this.capture ? dir.pose( race, { ...p, s: 5, l: 0 } ) : dir.pose( race, p );
		if ( this.mode === 'title' && ! this.capture ) {

			// title: the skyline wide, slowly drifting
			const sky = { ...dir.shot };
			dir.shot = { name: 'skyline', t0: 0 };
			const q = dir.pose( race, p );
			dir.shot = sky;
			const a = performance.now() * 0.00004;
			Object.assign( pose, q );
			pose.eye.x += Math.sin( a ) * 30;
			pose.eye.z += Math.cos( a ) * 20;

		}

		const cut = pose.name !== this.lastShot || snap;
		this.lastShot = pose.name;
		const eye = new Vector3( pose.eye.x, pose.eye.y, pose.eye.z ), look = new Vector3( pose.target.x, pose.target.y, pose.target.z );
		if ( cut ) { this.camPos.copy( eye ); this.camLook.copy( look ); }
		else if ( pose.name === 'chase' ) {

			// spring-damped chase: the eye lags, the aim leads a little less
			this.camPos.lerp( eye, 1 - Math.exp( - dt * 7 ) );
			this.camLook.lerp( look, 1 - Math.exp( - dt * 12 ) );

		} else { this.camPos.copy( eye ); this.camLook.copy( look ); }

		// FOV kick on boost, impact shake
		const b = race.player.bike;
		this.boostFov += ( ( b.boosting ? 9 : 0 ) + Math.min( 6, b.speed * 0.15 ) - this.boostFov ) * ( 1 - Math.exp( - dt * 4 ) );
		const cam = app.camera;
		cam.position.copy( this.camPos );
		if ( this.shake > 0.001 ) {

			const s = this.shake * 0.12;
			cam.position.x += ( Math.random() - 0.5 ) * s;
			cam.position.y += ( Math.random() - 0.5 ) * s;
			cam.position.z += ( Math.random() - 0.5 ) * s;
			this.shake *= Math.exp( - dt * 6 );

		}

		// never below the ground the camera stands over
		const g = app.terrainData.heightAt( cam.position.x, cam.position.z );
		if ( cam.position.y < g + 0.35 ) cam.position.y = g + 0.35;
		cam.lookAt( this.camLook );
		const fov = pose.fov + ( pose.name === 'chase' ? this.boostFov : 0 );
		if ( Math.abs( cam.fov - fov ) > 0.01 ) { cam.fov = fov; cam.updateProjectionMatrix(); }

	}

	// ---------------------------------------------------------------- weather (after the atmosphere readback)
	applyWeather() {

		const app = this.app, w = this.race.weather, fog = w.wet;
		this.fogVis = fog;
		if ( app.haze ) app.haze.density.value = 1.6 + fog * 30;
		G.sunColor.value.multiplyScalar( 1 - 0.72 * fog );
		G.skyIrradiance.value.multiplyScalar( 1 - 0.3 * fog );
		this.ribbon.material.uniforms.wet.value = fog;

	}

	// lens droplets: drizzle on the lens while the layer is in (after the lens' own update)
	applyLens( dt ) {

		const lens = this.app.post.lens, w = this.race.weather;
		if ( w.lens > 0 ) {

			this._lensT = ( this._lensT || 0 ) + dt;
			if ( this._lensT > 5 ) { this._lensT = 0; lens.seed.value = ( lens.seed.value + 17.31 ) % 97; }
			lens.age.value = 0.4 + this._lensT;
			lens.wet.value = Math.max( lens.wet.value, w.lens * 0.8 );

		}

	}

	// after the frame is submitted: particles (next frame), HUD, audio
	afterRender( dt ) {

		const race = this.race;
		this.particles.update( dt, this.app.camera, this.fogVis > 0.15 ? this.fogVis : 0 );
		if ( this.mode !== 'title' ) this.hud.update( race, race.player );
		this.audio.update( dt, { race, camera: this.app.camera, game: this } );

	}

	// ---------------------------------------------------------------- capture API (SPEC §11)
	_installCapture() {

		const game = this, app = this.app;
		window.__HILLBOMB = {
			ready: true,
			start() { game.startRace(); game.manual = true; return true; },
			reset( seed ) { game.newRace( seed ?? game.seed ); game.mode = 'race'; game.forceShot = null; game.controls.override = null; return game.seed; },
			seek( progress ) {

				const b = game.race.player.bike, s = Math.max( 0, Math.min( 1, progress ) ) * game.route.length;
				b.s = s; b.l = 0; b.y = game.route.height( s ) + BODY_ABOVE_GROUND; b.vy = 0; b.air = false; b.crash = 0; b.finished = s >= game.route.length;
				b.pitch = Math.atan2( game.route.height( s + 0.9 ) - game.route.height( s - 0.9 ), 1.8 );
				game.prev = game.race.riders.map( ( r ) => game._vis( r.bike ) );
				return s;

			},
			step( frames = 1 ) { for ( let i = 0; i < frames; i ++ ) game._tick(); return game.race.step; },
			camera( name ) { game.forceShot = name && SHOT_ALIAS[ name ] ? name : null; return game.forceShot; },
			input( partial ) { game.controls.override = partial ? { ...( game.controls.override || {} ), ...partial } : null; return game.controls.override; },
			autopilot( on ) { game.race.setAutopilot( !! on ); return ! game.race.player.human; },
			weather( mode ) { game.race.setWeather( mode ); return mode; },
			ai( i, overrides ) { game.race.riders[ i ].ai.overrides = overrides; },
			state() {

				const s = game.race.snapshot(), mr = app.engine.meshRenderer;
				return {
					...s,
					shotLog: game.race.director.log,
					render: { draws: mr.stats.draws, triangles: mr.stats.triangles, fps: app.fps || 0, cpuMs: app.cpuMs || 0, frames: game.frames },
					camera: { x: app.camera.position.x, y: app.camera.position.y, z: app.camera.position.z, fov: app.camera.fov, shot: game.lastShot },
					fx: { haze: app.haze ? app.haze.density.value : null, lens: app.post.lens.wet.value, ribbonWet: game.ribbon.material.uniforms.wet.value, drizzle: game.particles.rain.count },
					hud: { ...game.hud.values },
				};

			},
		};

	}

}
