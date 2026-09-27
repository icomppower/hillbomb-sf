// The track surface authority (SPEC §2). Built from the baked route (public/route/track1.bin + index.json,
// tools/route/build.mjs). The physics, the AI, the camera director and the rendered ribbon all read this one
// object, so what the rider feels is what is drawn. Track coordinates: s = metres along the centreline from the
// start, l = lateral metres, positive to the rider's right. Pure JS: no engine, no GPU.

export const SURFACE = { tarmac: 0, concrete: 1, stairs: 2, woodStairs: 3, brick: 4, wood: 5, rail: 6 };
export const SURFACE_NAMES = [ 'tarmac', 'concrete', 'stairs', 'wood stairs', 'brick', 'wood', 'rail' ];

// grip multiplier per surface (SPEC §3), dry → wet
const GRIP_DRY = [ 1.0, 0.95, 0.95, 0.85, 0.9, 0.85, 0.5 ];
const GRIP_WET = [ 1.0, 0.95, 0.95, 0.6, 0.9, 0.6, 0.5 ];
export const surfaceGrip = ( surface, wet ) => GRIP_DRY[ surface ] + ( GRIP_WET[ surface ] - GRIP_DRY[ surface ] ) * wet;

const RAIL_HALF = 0.15; // m: an F-line rail crossing is 0.3 m of steel
const KICKER_DROP = 0.4; // m: the lip falls away over this length
const SOFT_MARGIN = 0.3; // m past the path edge before the off-line drag
const HARD_MARGIN = 2.5; // m past the path edge before a crash (walls come first)
const HARD_MARGIN_STAIRS = 1.0; // …on stairs and the wooden landings: railings, garden beds and drops either side
const WALL_GAP = 0.25; // m: a rider this close to a wall has hit it

export class Route {

	constructor( index, data ) {

		this.index = index;
		this.data = data instanceof Float32Array ? data : new Float32Array( data );
		this.stride = index.stride;
		this.n = index.samples;
		this.length = index.length;
		this.sections = index.sections;
		this.checkpoints = index.checkpoints;
		this.flights = index.flights;
		this.kickers = index.kickers.map( ( k ) => ( { ...k, s0: k.s - k.len, s1: k.s + KICKER_DROP } ) );
		this.rails = index.rails;
		this.obstacles = index.obstacles;
		this.props = index.props;
		this.curv = this._curvature();

	}

	// ---------------------------------------------------------------- raw fields
	_f( s, k ) {

		const t = Math.max( 0, Math.min( this.n - 1.000001, s ) );
		const i = Math.floor( t ), f = t - i, o = i * this.stride + k;
		return this.data[ o ] + ( this.data[ o + this.stride ] - this.data[ o ] ) * f;

	}

	_i( s, k ) {

		const i = Math.max( 0, Math.min( this.n - 1, Math.round( s ) ) );
		return this.data[ i * this.stride + k ];

	}

	halfWidth( s ) { return this._f( s, 3 ); }
	camber( s ) { return this._f( s, 5 ); }
	terrain( s ) { return this._f( s, 6 ); }
	wallLeft( s ) { return this._f( s, 7 ); }
	wallRight( s ) { return this._f( s, 8 ); }

	// the path edges (left negative), never inside a wall
	edges( s ) {

		const hw = this.halfWidth( s );
		return { left: - Math.min( hw, this.wallLeft( s ) - 0.1 ), right: Math.min( hw, this.wallRight( s ) - 0.1 ) };

	}

	// lateral limits: past `soft` the rider is off the line (drag); past `hard` it crashes
	limits( s ) {

		const e = this.edges( s ), hw = this.halfWidth( s );
		const wl = this.wallLeft( s ) - WALL_GAP, wr = this.wallRight( s ) - WALL_GAP;
		const k = this._i( s, 4 );
		const m = k === SURFACE.stairs || k === SURFACE.woodStairs || k === SURFACE.wood ? HARD_MARGIN_STAIRS : HARD_MARGIN;
		return {
			softL: e.left - SOFT_MARGIN, softR: e.right + SOFT_MARGIN,
			hardL: - Math.min( hw + m, wl ), hardR: Math.min( hw + m, wr ),
			// which hard limits are building walls (a rider can scrape along a wall; off the open side it crashes)
			wallL: wl < hw + m, wallR: wr < hw + m,
		};

	}

	surface( s ) {

		for ( const r of this.rails ) if ( Math.abs( s - r ) < RAIL_HALF ) return SURFACE.rail;
		return this._i( s, 4 );

	}

	isStairs( s ) {

		const k = this._i( s, 4 );
		return ( k === SURFACE.stairs || k === SURFACE.woodStairs ) && this.flightAt( s ) !== null;

	}

	// ---------------------------------------------------------------- geometry
	center( s, out = {} ) {

		out.x = this._f( s, 0 );
		out.y = this._f( s, 1 );
		out.z = this._f( s, 2 );
		return out;

	}

	// unit tangent (x, z) and right vector at s
	tangent( s, out = {} ) {

		const a = Math.max( 0, s - 1 ), b = Math.min( this.n - 1, s + 1 );
		const dx = this._f( b, 0 ) - this._f( a, 0 ), dz = this._f( b, 2 ) - this._f( a, 2 );
		const d = Math.hypot( dx, dz ) || 1;
		out.x = dx / d;
		out.z = dz / d;
		out.rx = - out.z;
		out.rz = out.x;
		return out;

	}

	heading( s ) {

		const t = this.tangent( s );
		return Math.atan2( t.x, t.z );

	}

	// signed curvature (1/m, positive = turning right), smoothed over ±3 m; from the baked centreline
	_curvature() {

		const n = this.n, k = new Float32Array( n ), S = this.stride, d = this.data;
		for ( let i = 0; i < n; i ++ ) {

			const a = Math.max( 0, i - 3 ), b = Math.min( n - 1, i + 3 );
			if ( i - a < 3 || b - i < 3 ) continue;
			const h0 = Math.atan2( d[ i * S ] - d[ a * S ], d[ i * S + 2 ] - d[ a * S + 2 ] );
			const h1 = Math.atan2( d[ b * S ] - d[ i * S ], d[ b * S + 2 ] - d[ i * S + 2 ] );
			let dh = h1 - h0;
			dh = Math.atan2( Math.sin( dh ), Math.cos( dh ) );
			// heading measured from +z toward +x: a clockwise turn seen from above is a right turn
			k[ i ] = - 2 * dh / ( b - a );

		}

		return k;

	}

	curvature( s ) {

		const i = Math.max( 0, Math.min( this.n - 1, Math.round( s ) ) );
		return this.curv[ i ];

	}

	// world position of a track point at height h above the surface
	world( s, l, h = 0, out = {} ) {

		const t = this.tangent( s ), c = this.center( s );
		out.x = c.x + t.rx * l;
		out.z = c.z + t.rz * l;
		out.y = this.height( s, l ) + h;
		return out;

	}

	// ---------------------------------------------------------------- heights
	// smooth surface: the centreline height + camber (no kickers, no stair risers)
	baseHeight( s, l = 0 ) {

		return this._f( s, 1 ) + this.camber( s ) * l;

	}

	kickerHeight( s, l ) {

		let h = 0;
		for ( const k of this.kickers ) {

			if ( s < k.s0 || s >= k.s1 || l < k.l0 || l > k.l1 ) continue;
			const d = s - k.s;
			const v = d < 0 ? k.h * Math.pow( ( d + k.len ) / k.len, 1.3 ) : k.h * ( 1 - d / KICKER_DROP );
			if ( v > h ) h = v;

		}

		return h;

	}

	// the ground the physics rides on: smooth surface + kickers
	height( s, l = 0 ) {

		return this.baseHeight( s, l ) + this.kickerHeight( s, l );

	}

	flightAt( s ) {

		const F = this.flights;
		let lo = 0, hi = F.length - 1;
		while ( lo <= hi ) {

			const m = ( lo + hi ) >> 1;
			if ( s < F[ m ].s0 ) hi = m - 1;
			else if ( s > F[ m ].s1 ) lo = m + 1;
			else return F[ m ];

		}

		return null;

	}

	// the stair treads relative to the smooth flight line (±riser/2); 0 off the stairs
	stairOffset( s ) {

		const f = this.flightAt( s );
		if ( ! f ) return 0;
		const u = ( s - f.s0 ) / f.tread;
		const k = Math.min( f.risers - 1, Math.floor( u ) );
		const linear = f.h0 + ( f.h1 - f.h0 ) * ( s - f.s0 ) / ( f.s1 - f.s0 );
		const tread = f.h0 - f.riser * ( k + 0.5 );
		return tread - linear;

	}

	// what a wheel touches: the ground with the stair treads in it
	probe( s, l = 0 ) {

		return this.height( s, l ) + this.stairOffset( s );

	}

	// SPEC §2: route.sample( s, lateral ) → height, normal, surface, width, camber
	sample( s, l = 0, out = {} ) {

		const e = 0.5;
		const h = this.probe( s, l );
		const dhs = ( this.height( s + e, l ) - this.height( s - e, l ) ) / ( 2 * e );
		const dhl = ( this.height( s, l + e ) - this.height( s, l - e ) ) / ( 2 * e );
		const t = this.tangent( s );
		// normal = normalize( up - dhs * tangent - dhl * right )
		let nx = - dhs * t.x - dhl * t.rx, ny = 1, nz = - dhs * t.z - dhl * t.rz;
		const nl = Math.hypot( nx, ny, nz );
		nx /= nl; ny /= nl; nz /= nl;
		const w = this.world( s, l );
		out.x = w.x;
		out.z = w.z;
		out.y = h;
		out.height = h;
		out.normal = { x: nx, y: ny, z: nz };
		out.surface = this.surface( s );
		out.width = 2 * this.halfWidth( s );
		out.camber = this.camber( s );
		return out;

	}

	sectionAt( s ) {

		const S = this.sections;
		for ( let i = S.length - 1; i >= 0; i -- ) if ( s >= S[ i ].s0 ) return i;
		return 0;

	}

	// nearest centreline sample to a world point (coarse-to-fine), for tools and the camera
	toTrack( x, z, hint = - 1, window = 60 ) {

		const S = this.stride, d = this.data;
		let best = 0, bd = Infinity;
		const a = hint < 0 ? 0 : Math.max( 0, Math.floor( hint - window ) ), b = hint < 0 ? this.n : Math.min( this.n, Math.ceil( hint + window ) );
		for ( let i = a; i < b; i ++ ) {

			const q = ( d[ i * S ] - x ) ** 2 + ( d[ i * S + 2 ] - z ) ** 2;
			if ( q < bd ) { bd = q; best = i; }

		}

		const t = this.tangent( best ), c = this.center( best );
		const along = ( x - c.x ) * t.x + ( z - c.z ) * t.z;
		const s = Math.max( 0, Math.min( this.length, best + along ) );
		const c2 = this.center( s ), t2 = this.tangent( s );
		return { s, l: ( x - c2.x ) * t2.rx + ( z - c2.z ) * t2.rz, d: Math.sqrt( bd ) };

	}

}

// Loading: the index + the float buffer; checks the checksum when a digest function is given (Node: G2)
export async function loadRoute( base = '/' ) {

	const index = await ( await fetch( base + 'route/index.json' ) ).json();
	const r = await fetch( base + 'route/' + index.file );
	if ( ! r.ok ) throw new Error( `route: ${ index.file } HTTP ${ r.status }` );
	return new Route( index, new Float32Array( await r.arrayBuffer() ) );

}
