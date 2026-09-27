// Course furniture (SPEC §2), procedural and placed from the baked route: kickers at the real features (the
// plaza wall, the Montgomery and Sansome kerbs, the lips of the Filbert landings, planters and benches along the
// Embarcadero), the start gate, five checkpoint gates and the finish gantry, the street furniture OSM maps
// along the line (lamps, benches, trees) plus seeded palms and lamps where it maps none, parked cars on
// Montgomery and Sansome, and the F-line rails where the line crosses them. All static: merged into one mesh.
import { BufferGeometry, BufferAttribute, Mesh, Matrix4, Vector3, Quaternion, Euler, Color,
	BoxGeometry, CylinderGeometry, IcosahedronGeometry, ConeGeometry, SphereGeometry } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';

// uv.x markers read by the shader
const PLAIN = 0, LAMP = 2, STRIPES = 3, CHECKER = 4, LEAF = 5;
const lin = ( hex ) => { const c = new Color( hex ); return [ Math.pow( c.r, 2.2 ), Math.pow( c.g, 2.2 ), Math.pow( c.b, 2.2 ) ]; };
const COL = {
	ply: lin( 0xb08a5a ), concrete: lin( 0x9d9a92 ), steel: lin( 0x5c6166 ), dark: lin( 0x202226 ), pole: lin( 0x2e3a33 ),
	orange: lin( 0xff6a13 ), white: lin( 0xf1efe8 ), trunk: lin( 0x5a4332 ), palmTrunk: lin( 0x8a7358 ), leaf: lin( 0x3e6b2e ),
	frond: lin( 0x4d7a2c ), wood: lin( 0x7a5534 ), glass: lin( 0x222a31 ), tyre: lin( 0x111111 ), soil: lin( 0x3a2c20 ),
};
const CAR_PAINT = [ 0xd8d8d4, 0x1d2430, 0x8a1d1d, 0x3b4b5c, 0x6f7275, 0xc9b27c, 0x24452f, 0xefefef ].map( lin );

export class FurnitureBuilder {

	constructor() {

		this.P = []; this.N = []; this.UV = []; this.C = []; this.I = [];

	}

	// add a template geometry under matrix m
	add( geo, m, color, { rough = 0.7, marker = PLAIN } = {} ) {

		const g = geo.index ? geo.toNonIndexed() : geo;
		const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv ? g.attributes.uv.array : null;
		const nm = new Matrix4().copy( m ).invert().transpose(), e = m.elements, f = nm.elements;
		const base = this.P.length / 3;
		for ( let i = 0; i < p.length / 3; i ++ ) {

			const x = p[ i * 3 ], y = p[ i * 3 + 1 ], z = p[ i * 3 + 2 ];
			this.P.push( e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ], e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z + e[ 13 ], e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ] );
			const a = n[ i * 3 ], b = n[ i * 3 + 1 ], c = n[ i * 3 + 2 ];
			const nx = f[ 0 ] * a + f[ 4 ] * b + f[ 8 ] * c, ny = f[ 1 ] * a + f[ 5 ] * b + f[ 9 ] * c, nz = f[ 2 ] * a + f[ 6 ] * b + f[ 10 ] * c;
			const l = Math.hypot( nx, ny, nz ) || 1;
			this.N.push( nx / l, ny / l, nz / l );
			this.UV.push( marker, uv ? uv[ i * 2 + 1 ] : 0 );
			this.C.push( color[ 0 ], color[ 1 ], color[ 2 ], rough );
			this.I.push( base + i );

		}

	}

	// a raw triangle list (already in world space)
	tris( pos, nor, color, { rough = 0.7, marker = PLAIN, v = null } = {} ) {

		const base = this.P.length / 3;
		for ( let i = 0; i < pos.length / 3; i ++ ) {

			this.P.push( pos[ i * 3 ], pos[ i * 3 + 1 ], pos[ i * 3 + 2 ] );
			this.N.push( nor[ i * 3 ], nor[ i * 3 + 1 ], nor[ i * 3 + 2 ] );
			this.UV.push( marker, v ? v[ i ] : 0 );
			this.C.push( color[ 0 ], color[ 1 ], color[ 2 ], rough );
			this.I.push( base + i );

		}

	}

	mesh( material, name ) {

		const g = new BufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( new Float32Array( this.P ), 3 ) );
		g.setAttribute( 'normal', new BufferAttribute( new Float32Array( this.N ), 3 ) );
		g.setAttribute( 'uv', new BufferAttribute( new Float32Array( this.UV ), 2 ) );
		g.setAttribute( 'color', new BufferAttribute( new Float32Array( this.C ), 4 ) );
		g.setIndex( new BufferAttribute( new Uint32Array( this.I ), 1 ) );
		g.computeBoundingSphere();
		const m = new Mesh( g, material );
		m.name = name;
		m.castShadow = true;
		m.receiveShadow = true;
		m.frustumCulled = false;
		return m;

	}

}

const M = ( x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0 ) => new Matrix4().compose( new Vector3( x, y, z ),
	new Quaternion().setFromEuler( new Euler( pitch, yaw, roll, 'YXZ' ) ), new Vector3( sx, sy, sz ) );

export function buildFurniture( route, heightAt ) {

	const B = new FurnitureBuilder();
	const box = new BoxGeometry( 1, 1, 1 ), cyl = new CylinderGeometry( 1, 1, 1, 8, 1 ), cyl5 = new CylinderGeometry( 1, 1, 1, 5, 1 );
	const t = {}, w = {};
	const lamps = [];

	// ---- kickers: the physics profile (route.kickerHeight) as a wedge, sides and lip face down to the ground
	for ( const k of route.kickers ) {

		const e = route.edges( k.s );
		const l0 = Math.max( k.l0, e.left ), l1 = Math.min( k.l1, e.right );
		const color = /wall|curb/.test( k.kind ) ? COL.concrete : COL.ply;
		const pos = [], nor = [];
		const pt = ( s, l, lift ) => { route.world( s, l, 0, w ); return [ w.x, route.baseHeight( s, l ) + route.stairOffset( s ) * 0 + lift, w.z ]; };
		const push = ( a, b, c, n ) => { pos.push( ...a, ...b, ...c ); for ( let i = 0; i < 3; i ++ ) nor.push( ...n ); };
		const steps = Math.max( 4, Math.ceil( k.len / 0.25 ) );
		for ( let i = 0; i < steps; i ++ ) {

			const sa = k.s - k.len + k.len * i / steps, sb = k.s - k.len + k.len * ( i + 1 ) / steps;
			const ha = route.kickerHeight( sa, ( l0 + l1 ) / 2 ) + 0.02, hb = route.kickerHeight( Math.min( sb, k.s - 1e-3 ), ( l0 + l1 ) / 2 ) + 0.02;
			const a0 = pt( sa, l0, ha ), a1 = pt( sa, l1, ha ), b0 = pt( sb, l0, hb ), b1 = pt( sb, l1, hb );
			route.tangent( ( sa + sb ) / 2, t );
			const rise = ( hb - ha ) / ( sb - sa ), nl = Math.hypot( 1, rise );
			const n = [ - t.x * rise / nl, 1 / nl, - t.z * rise / nl ];
			push( a0, b1, b0, n ); push( a0, a1, b1, n );
			// sides
			const g0a = pt( sa, l0, 0 ), g0b = pt( sb, l0, 0 ), g1a = pt( sa, l1, 0 ), g1b = pt( sb, l1, 0 );
			push( a0, b0, g0b, [ - t.rx, 0, - t.rz ] ); push( a0, g0b, g0a, [ - t.rx, 0, - t.rz ] );
			push( a1, g1b, b1, [ t.rx, 0, t.rz ] ); push( a1, g1a, g1b, [ t.rx, 0, t.rz ] );

		}

		// the lip face
		route.tangent( k.s, t );
		const hl = route.kickerHeight( k.s - 1e-3, ( l0 + l1 ) / 2 ) + 0.02;
		const q0 = pt( k.s, l0, hl ), q1 = pt( k.s, l1, hl ), g0 = pt( k.s, l0, 0 ), g1 = pt( k.s, l1, 0 );
		push( q0, g1, q1, [ t.x, 0, t.z ] ); push( q0, g0, g1, [ t.x, 0, t.z ] );
		B.tris( pos, nor, color, { rough: 0.75 } );

		// what the kicker leans on: a planter box or a bench just past the lip
		if ( k.kind === 'planter' || k.kind === 'bench' ) {

			const sc = k.s + 1.1, lc = ( l0 + l1 ) / 2;
			route.world( sc, lc, 0, w );
			const y = route.baseHeight( sc, lc ), yaw = route.heading( sc ); // local x across the line
			if ( k.kind === 'planter' ) {

				B.add( box, M( w.x, y + k.h * 0.45, w.z, yaw, l1 - l0, k.h * 0.9, 1.3 ), COL.concrete, { rough: 0.9 } );
				B.add( new IcosahedronGeometry( 1, 1 ), M( w.x, y + k.h + 0.2, w.z, yaw, ( l1 - l0 ) * 0.45, 0.45, 0.6 ), COL.leaf, { rough: 0.95, marker: LEAF } );

			} else {

				B.add( box, M( w.x, y + k.h * 0.8, w.z, yaw, l1 - l0, 0.08, 0.5 ), COL.wood, { rough: 0.8 } );
				for ( const d of [ - 0.4, 0.4 ] ) B.add( box, M( w.x, y + k.h * 0.4, w.z, yaw, 0.08, k.h * 0.8, 0.45 ).multiply( M( d * ( l1 - l0 ) / 0.08, 0, 0 ) ), COL.dark );

			}

		}

	}

	// ---- gates: start, five checkpoints, finish
	const gate = ( s, marker, color, h = 3.3 ) => {

		const e = route.edges( s );
		const lL = Math.max( e.left - 0.35, - ( route.wallLeft( s ) - 0.3 ) ), lR = Math.min( e.right + 0.35, route.wallRight( s ) - 0.3 );
		const yaw = route.heading( s );
		const pL = route.world( s, lL, 0, {} ), pR = route.world( s, lR, 0, {} );
		const yL = route.baseHeight( s, lL ), yR = route.baseHeight( s, lR ), top = Math.max( yL, yR ) + h;
		for ( const [ p, y ] of [ [ pL, yL ], [ pR, yR ] ] ) B.add( cyl, M( p.x, ( y + top ) / 2, p.z, 0, 0.09, top - y, 0.09 ), COL.dark, { rough: 0.5 } );
		const mx = ( pL.x + pR.x ) / 2, mz = ( pL.z + pR.z ) / 2, span = Math.hypot( pR.x - pL.x, pR.z - pL.z );
		const banner = new BoxGeometry( 1, 1, 1 );
		// uv.y across the banner (0..1 along its length) drives the stripes / checker
		B.add( banner, M( mx, top - 0.35, mz, yaw, span, 0.6, 0.06 ), color, { rough: 0.6, marker } );

	};

	gate( 5.4, STRIPES, COL.orange, 3.4 );
	for ( const c of route.checkpoints ) gate( c.s, STRIPES, COL.orange );
	gate( route.length - 0.3, CHECKER, COL.white, 4.2 );

	// ---- street furniture
	const cone = new ConeGeometry( 1, 1, 5, 1 ), ico = new IcosahedronGeometry( 1, 1 ), sph = new SphereGeometry( 1, 8, 5 );
	for ( const p of route.props ) {

		const y = heightAt( p.x, p.z );
		const h = ( ( p.x * 7.13 + p.z * 3.7 ) % 1 + 1 ) % 1; // stable per-prop variation
		if ( p.kind === 'lamp' ) {

			B.add( cyl5, M( p.x, y + 2.6, p.z, 0, 0.07, 5.2, 0.07 ), COL.pole, { rough: 0.5 } );
			B.add( cyl5, M( p.x, y + 5.3, p.z, 0, 0.16, 0.3, 0.16 ), COL.pole, { rough: 0.5 } );
			B.add( sph, M( p.x, y + 5.05, p.z, 0, 0.2, 0.22, 0.2 ), COL.white, { rough: 0.3, marker: LAMP } );
			lamps.push( { x: p.x, y: y + 4.9, z: p.z } );

		} else if ( p.kind === 'tree' ) {

			B.add( cyl5, M( p.x, y + 1.4, p.z, 0, 0.14, 2.8, 0.14 ), COL.trunk, { rough: 0.9 } );
			B.add( ico, M( p.x, y + 3.6 + h * 0.8, p.z, h * 6, 1.9 + h * 0.8, 1.6 + h * 0.6, 1.9 + h * 0.8 ), COL.leaf, { rough: 0.95, marker: LEAF } );

		} else if ( p.kind === 'palm' ) {

			const H = 7 + h * 3;
			B.add( cyl5, M( p.x, y + H / 2, p.z, 0, 0.2, H, 0.2 ), COL.palmTrunk, { rough: 0.9 } );
			for ( let f = 0; f < 8; f ++ ) {

				const a = f / 8 * Math.PI * 2 + h;
				B.add( cone, M( p.x + Math.sin( a ) * 1.3, y + H - 0.3, p.z + Math.cos( a ) * 1.3, a, 0.35, 3.0, 0.08, Math.PI / 2 + 0.35 ), COL.frond, { rough: 0.9, marker: LEAF } );

			}

		} else if ( p.kind === 'bench' ) {

			const yaw = route.heading( route.toTrack( p.x, p.z ).s );
			B.add( box, M( p.x, y + 0.45, p.z, yaw, 1.8, 0.07, 0.45 ), COL.wood, { rough: 0.8 } );
			B.add( box, M( p.x, y + 0.75, p.z, yaw, 1.8, 0.35, 0.05 ).multiply( M( 0, 0, - 4 ) ), COL.wood, { rough: 0.8 } );

		}

	}

	// ---- parked cars
	let ci = 0;
	for ( const o of route.obstacles ) {

		const y = heightAt( o.x, o.z ), paint = CAR_PAINT[ ci ++ % CAR_PAINT.length ];
		B.add( box, M( o.x, y + 0.62, o.z, o.yaw, 1.8, 0.62, 4.4 ), paint, { rough: 0.3 } );
		B.add( box, M( o.x, y + 1.18, o.z, o.yaw, 1.6, 0.5, 2.3 ).multiply( M( 0, 0, - 0.08 ) ), COL.glass, { rough: 0.12 } );
		for ( const [ dx, dz ] of [ [ - 0.82, 1.35 ], [ 0.82, 1.35 ], [ - 0.82, - 1.35 ], [ 0.82, - 1.35 ] ] ) {

			B.add( cyl, M( o.x, y + 0.33, o.z, o.yaw ).multiply( M( dx, 0, dz, 0, 0.33, 0.22, 0.33, 0, Math.PI / 2 ) ), COL.tyre, { rough: 0.9 } );

		}

	}

	// ---- F-line rails where the line crosses the tracks (standard gauge, flush with the surface)
	for ( const r of route.rails ) for ( const d of [ - 0.72, 0.72 ] ) {

		const s = r + d, e = route.edges( s );
		route.world( s, ( e.left + e.right ) / 2, 0, w );
		B.add( box, M( w.x, route.baseHeight( s ) + 0.03, w.z, route.heading( s ), e.right - e.left + 0.6, 0.03, 0.07 ), COL.steel, { rough: 0.25 } );

	}

	const material = new Material( {
		name: 'furniture',
		vertexColors: true,
		surface: /* wgsl */`
	let marker = in.uv.x;
	var albedo = in.color.rgb;
	var rough = in.color.a;
	var emit = vec3f( 0.0 );
	if ( abs( marker - 2.0 ) < 0.5 ) {

		// lamp globe: warm light after dusk
		emit = vec3f( 1.0, 0.78, 0.5 ) * 9.0 * smoothstep( 0.15, 0.75, frame.night );

	} else if ( abs( marker - 3.0 ) < 0.5 ) {

		// banner stripes along its length
		let st = step( 0.5, fract( in.uv.y * 8.0 + in.P.y * 0.0 ) );
		albedo = mix( albedo, vec3f( 0.02 ), st * 0.9 );

	} else if ( abs( marker - 4.0 ) < 0.5 ) {

		// chequered flag
		let q = floor( in.P.xz * 2.4 ) + floor( in.P.y * 2.4 );
		albedo = select( vec3f( 0.02 ), albedo, fract( ( q.x + q.y ) * 0.5 ) < 0.25 );

	} else if ( abs( marker - 5.0 ) < 0.5 ) {

		// foliage: per-position tone
		let h = fract( sin( dot( floor( in.P.xz * 1.3 ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
		albedo *= 0.75 + 0.5 * h;

	}
	s.albedo = albedo;
	s.roughness = rough;
	s.metalness = select( 0.0, 0.5, rough < 0.28 );
	s.emissive = emit;
`,
	} );

	const mesh = B.mesh( material, 'course-furniture' );
	return { mesh, lamps };

}
