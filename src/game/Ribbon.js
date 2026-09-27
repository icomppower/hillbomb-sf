// The trail ribbon: the ridden surface of the course, built from the route authority at load (route.probe is
// what the wheels touch, so the drawn surface is the physics surface). Stair flights get real treads and risers;
// the edges get kerb skirts down into the flattened terrain. One mesh, one material: procedural tarmac, concrete,
// concrete stairs, wooden stairs and landings, and brick, all through the scene lighting; the marine layer's
// wet factor darkens and glosses it.
import { BufferGeometry, BufferAttribute, Mesh } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { SURFACE } from '../sim/route.js';

const LIFT = 0.015; // m above the physics surface (no z-fight with the flattened terrain)
const SKIRT = 0.6; // m kerb face down into the ground
const ACROSS = 4; // quads across the path

export function buildRibbon( route ) {

	const P = [], N = [], UV = [], C = [], I = [];
	const vert = ( x, y, z, nx, ny, nz, u, v, surf, riser = 0 ) => {

		P.push( x, y, z );
		N.push( nx, ny, nz );
		UV.push( u, v );
		C.push( riser, 0, 0, surf / 8 );
		return P.length / 3 - 1;

	};

	const quad = ( a, b, c, d ) => I.push( a, b, c, a, c, d );
	const t = {}, w = {};
	const inFlight = ( s ) => route.flightAt( s ) !== null;

	// ---- the rolling surface between flights: strips across, joined metre by metre
	const stations = [];
	for ( let s = 0; s <= route.length + 1e-6; ) {

		stations.push( Math.min( s, route.length ) );
		const k = Math.abs( route.curvature( s ) );
		s += k > 0.05 ? 0.5 : 1;

	}

	let prev = null;
	for ( const s of stations ) {

		if ( inFlight( s ) && inFlight( s - 0.49 ) && inFlight( s + 0.49 ) ) { prev = null; continue; }
		route.tangent( s, t );
		const e = route.edges( s ), surf = route._i( s, 4 );
		const row = [];
		for ( let k = 0; k <= ACROSS; k ++ ) {

			const l = e.left + ( e.right - e.left ) * k / ACROSS;
			route.world( s, l, 0, w );
			const y = inFlight( s ) ? route.baseHeight( s, l ) : route.probe( s, l ) - route.kickerHeight( s, l );
			const n = route.sample( s, l ).normal;
			row.push( vert( w.x, y + LIFT, w.z, n.x, n.y, n.z, l, s, surf ) );

		}

		// kerb skirts (outward normals)
		const skirt = [];
		for ( const [ k, side ] of [ [ 0, - 1 ], [ ACROSS, 1 ] ] ) {

			const i = row[ k ], x = P[ i * 3 ], y = P[ i * 3 + 1 ], z = P[ i * 3 + 2 ];
			const nx = t.rx * side, nz = t.rz * side;
			skirt.push( [ vert( x, y, z, nx, 0, nz, 0, s, SURFACE.concrete, 1 ), vert( x, y - SKIRT, z, nx, 0, nz, 0, s, SURFACE.concrete, 1 ) ] );

		}

		if ( prev ) {

			for ( let k = 0; k < ACROSS; k ++ ) quad( prev.row[ k ], row[ k ], row[ k + 1 ], prev.row[ k + 1 ] );
			quad( prev.skirt[ 0 ][ 0 ], prev.skirt[ 0 ][ 1 ], skirt[ 0 ][ 1 ], skirt[ 0 ][ 0 ] );
			quad( prev.skirt[ 1 ][ 0 ], skirt[ 1 ][ 0 ], skirt[ 1 ][ 1 ], prev.skirt[ 1 ][ 1 ] );

		}

		prev = { row, skirt };

	}

	// ---- stair flights: a tread and a riser per step
	for ( const f of route.flights ) {

		const surf = f.wood ? SURFACE.woodStairs : SURFACE.stairs;
		let top = f.h0; // the landing above the first riser
		for ( let k = 0; k < f.risers; k ++ ) {

			const sa = f.s0 + k * f.tread, sb = Math.min( f.s1, sa + f.tread );
			const h = f.h0 - f.riser * ( k + 0.5 );
			const ea = route.edges( sa ), eb = route.edges( sb );
			const ta = route.tangent( sa, {} ), tb = route.tangent( sb, {} );
			const ca = route.center( sa, {} ), cb = route.center( sb, {} );
			const at = ( c, tt, l ) => [ c.x + tt.rx * l, c.z + tt.rz * l ];
			const [ ax0, az0 ] = at( ca, ta, ea.left ), [ ax1, az1 ] = at( ca, ta, ea.right );
			const [ bx0, bz0 ] = at( cb, tb, eb.left ), [ bx1, bz1 ] = at( cb, tb, eb.right );
			// riser (faces back up the flight)
			const r0 = vert( ax0, top + LIFT, az0, - ta.x, 0, - ta.z, ea.left, k, surf, 1 ), r1 = vert( ax1, top + LIFT, az1, - ta.x, 0, - ta.z, ea.right, k, surf, 1 );
			const r2 = vert( ax1, h + LIFT, az1, - ta.x, 0, - ta.z, ea.right, k + 0.02, surf, 1 ), r3 = vert( ax0, h + LIFT, az0, - ta.x, 0, - ta.z, ea.left, k + 0.02, surf, 1 );
			quad( r0, r1, r2, r3 );
			// tread
			const q0 = vert( ax0, h + LIFT, az0, 0, 1, 0, ea.left, k, surf ), q1 = vert( ax1, h + LIFT, az1, 0, 1, 0, ea.right, k, surf );
			const q2 = vert( bx1, h + LIFT, bz1, 0, 1, 0, eb.right, k + 1, surf ), q3 = vert( bx0, h + LIFT, bz0, 0, 1, 0, eb.left, k + 1, surf );
			quad( q0, q3, q2, q1 );
			// stringers: the sides of the step down to the ground
			for ( const [ x0, z0, x1, z1, side ] of [ [ ax0, az0, bx0, bz0, - 1 ], [ ax1, az1, bx1, bz1, 1 ] ] ) {

				const nx = ta.rx * side, nz = ta.rz * side;
				const a = vert( x0, h + LIFT, z0, nx, 0, nz, 0, k, SURFACE.concrete, 1 ), b = vert( x1, h + LIFT, z1, nx, 0, nz, 0, k, SURFACE.concrete, 1 );
				const c = vert( x1, h - SKIRT, z1, nx, 0, nz, 0, k, SURFACE.concrete, 1 ), d = vert( x0, h - SKIRT, z0, nx, 0, nz, 0, k, SURFACE.concrete, 1 );
				if ( side < 0 ) quad( a, d, c, b ); else quad( a, b, c, d );

			}

			top = h;

		}

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new BufferAttribute( new Float32Array( P ), 3 ) );
	g.setAttribute( 'normal', new BufferAttribute( new Float32Array( N ), 3 ) );
	g.setAttribute( 'uv', new BufferAttribute( new Float32Array( UV ), 2 ) );
	g.setAttribute( 'color', new BufferAttribute( new Float32Array( C ), 4 ) );
	g.setIndex( new BufferAttribute( P.length / 3 > 65535 ? new Uint32Array( I ) : new Uint16Array( I ), 1 ) );
	g.computeBoundingSphere();
	const material = courseMaterial();
	const mesh = new Mesh( g, material );
	mesh.name = 'course-ribbon';
	mesh.receiveShadow = true;
	mesh.castShadow = true;
	mesh.frustumCulled = false;
	return mesh;

}

// uv = ( lateral m, s m ) on the rolling surface; ( lateral m, step index ) on stairs. color.a = surface / 8,
// color.r = 1 on vertical faces (risers, kerbs).
export function courseMaterial() {

	return new Material( {
		name: 'course',
		vertexColors: true,
		side: 'double',
		uniforms: { wet: [ 'f32', 0 ] },
		surface: /* wgsl */`
	let kind = i32( round( in.color.a * 8.0 ) );
	let face = in.color.r;
	let uv = in.uv;
	let n1 = fract( sin( dot( floor( in.P.xz * 9.0 ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	let n2 = fract( sin( dot( floor( in.P.xz * 1.7 ), vec2f( 39.3468, 11.135 ) ) ) * 24634.6345 );
	var albedo = vec3f( 0.2 );
	var rough = 0.85;
	if ( kind == 0 ) {

		// tarmac: dark aggregate, patched
		albedo = vec3f( 0.085, 0.086, 0.09 ) * ( 0.85 + 0.3 * n1 ) * ( 0.9 + 0.2 * n2 );
		// promenade / street markings: a faded edge line
		let edge = step( abs( abs( uv.x ) - 3.9 ), 0.07 );
		albedo = mix( albedo, vec3f( 0.55, 0.52, 0.45 ), edge * 0.6 );
		rough = 0.92;

	} else if ( kind == 1 ) {

		// concrete sidewalk: slabs with expansion joints
		let j = min( fract( uv.y / 1.6 ), 1.0 - fract( uv.y / 1.6 ) );
		let jx = min( fract( uv.x / 1.6 + 0.5 ), 1.0 - fract( uv.x / 1.6 + 0.5 ) );
		albedo = vec3f( 0.36, 0.35, 0.33 ) * ( 0.88 + 0.2 * n1 ) * ( 0.92 + 0.12 * n2 );
		albedo *= mix( 0.55, 1.0, smoothstep( 0.0, 0.015, min( j, jx ) ) );
		rough = 0.85;

	} else if ( kind == 2 ) {

		// concrete steps: pale treads, a darker worn line near each nosing, shadowed risers
		let f = fract( uv.y );
		albedo = vec3f( 0.42, 0.41, 0.38 ) * ( 0.85 + 0.25 * n1 );
		albedo *= mix( 1.0, 0.72, smoothstep( 0.12, 0.0, f ) * ( 1.0 - face ) );
		albedo *= mix( 1.0, 0.8, face );
		rough = 0.82;

	} else if ( kind == 3 || kind == 5 ) {

		// wood: planks across the line (stairs) or along it (landings); grain + per-plank tone
		let along = select( uv.x * 5.0, uv.y * 3.0, kind == 3 ); // stairs: 3 boards per tread; landings: boards along the line
		let plank = floor( along );
		let hp = fract( sin( plank * 91.17 + floor( uv.x * 0.8 ) * 13.1 ) * 43758.5453 );
		let grain = 0.5 + 0.5 * sin( select( uv.y, uv.x, kind == 3 ) * 38.0 + hp * 20.0 + n1 * 2.0 );
		albedo = mix( vec3f( 0.22, 0.13, 0.07 ), vec3f( 0.36, 0.23, 0.13 ), hp * 0.7 + grain * 0.3 );
		let gap = min( fract( along ), 1.0 - fract( along ) );
		albedo *= mix( 0.35, 1.0, smoothstep( 0.0, 0.05, gap ) );
		if ( kind == 3 ) {

			let f = fract( uv.y );
			albedo *= mix( 1.0, 0.7, smoothstep( 0.1, 0.0, f ) * ( 1.0 - face ) );
			albedo *= mix( 1.0, 0.75, face );

		}
		rough = 0.78;

	} else {

		// brick plaza: running bond, mortar joints, per-brick tone
		let bu = vec2f( uv.x / 0.21, uv.y / 0.1 );
		let row = floor( bu.y );
		let bx = bu.x + select( 0.0, 0.5, fract( row * 0.5 ) > 0.25 );
		let hb = fract( sin( floor( bx ) * 17.3 + row * 3.1 ) * 43758.5453 );
		albedo = mix( vec3f( 0.28, 0.1, 0.06 ), vec3f( 0.42, 0.19, 0.12 ), hb );
		let mj = min( min( fract( bx ), 1.0 - fract( bx ) ) * 0.21, min( fract( bu.y ), 1.0 - fract( bu.y ) ) * 0.1 );
		albedo = mix( vec3f( 0.3, 0.29, 0.27 ), albedo, smoothstep( 0.004, 0.009, mj ) );
		rough = 0.86;

	}
	// the marine layer: darker, glossier
	// the marine layer soaks low ground first (the sim's height band, race.js wetAt)
	let wet = min( 1.0, mat.wet * ( 1.0 + max( 0.0, 45.0 - in.P.y ) / 45.0 ) ) * ( 0.75 + 0.25 * n2 );
	albedo *= mix( 1.0, 0.55, wet );
	rough = mix( rough, 0.18, wet * ( 1.0 - face * 0.5 ) );
	s.albedo = albedo;
	s.roughness = rough;
`,
	} );

}
