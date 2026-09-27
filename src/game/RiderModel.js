// A procedural bicycle and rider (SPEC §4), built from engine primitives at boot and posed on the CPU every
// frame into ONE dynamic mesh per rider (one draw + its shadow): frame tubes, spoked wheels, chainring, bars,
// and a rider rig whose hands and feet reach their contact targets (grips, pedals) with two-bone IK. The body
// takes the suspension compression one frame late; flips and the crash tumble are keyframed in code. Lit by the
// scene lighting and shadows like every other mesh. Local frame: x right, y up, z forward; origin on the ground
// under the bottom bracket.
import { BufferGeometry, BufferAttribute, Mesh, Matrix4, Vector3, Quaternion, Color, Euler,
	CylinderGeometry, SphereGeometry, TorusGeometry, BoxGeometry } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';

const WHEEL_R = 0.33;
const WHEELBASE = 1.08;
const AXLE_Y = WHEEL_R;
const BB = new Vector3( 0, 0.3, 0.02 ); // bottom bracket
const CRANK = 0.17;
const SEAT = new Vector3( 0, 0.86, - 0.2 );
const HEAD_TUBE = new Vector3( 0, 0.78, 0.42 );
const BARS = new Vector3( 0, 1.0, 0.36 );
const GRIP_HALF = 0.34;
const THIGH = 0.46, SHIN = 0.47, UPPER_ARM = 0.31, FOREARM = 0.3;

const _m = new Matrix4(), _q = new Quaternion(), _v = new Vector3(), _up = new Vector3( 0, 1, 0 ), _s = new Vector3( 1, 1, 1 );

function toLinear( hex ) {

	const c = new Color( hex );
	return [ Math.pow( c.r, 2.2 ), Math.pow( c.g, 2.2 ), Math.pow( c.b, 2.2 ) ];

}

// one template part: its geometry arrays + a colour; `pose` fills its matrix each frame
function part( geo, color, rough = 0.6 ) {

	const g = geo.index ? geo.toNonIndexed() : geo;
	return { pos: g.attributes.position.array, nor: g.attributes.normal.array, color, rough, m: new Matrix4() };

}

// a cylinder of radius r from a to b (the unit template is along +y, height 1, centred)
function between( m, a, b, r ) {

	_v.subVectors( b, a );
	const len = _v.length() || 1e-4;
	_q.setFromUnitVectors( _up, _v.multiplyScalar( 1 / len ) );
	m.compose( _v.addVectors( a, b ).multiplyScalar( 0.5 ), _q, _s.set( r, len, r ) );
	return m;

}

// two-bone IK: from root toward target with bone lengths a, b; the knee / elbow bends toward `pole`
function ik( root, target, a, b, pole, outJoint ) {

	const d = _v.subVectors( target, root );
	let len = d.length();
	const reach = a + b - 1e-3;
	if ( len > reach ) { d.multiplyScalar( reach / len ); len = reach; }
	const dir = d.clone().normalize();
	// distance along root→target to the joint's foot, and the joint's offset from the line
	const x = ( a * a - b * b + len * len ) / ( 2 * len );
	const h = Math.sqrt( Math.max( 0, a * a - x * x ) );
	const side = pole.clone().sub( root ).addScaledVector( dir, - pole.clone().sub( root ).dot( dir ) ).normalize();
	outJoint.copy( root ).addScaledVector( dir, x ).addScaledVector( side, h );
	return outJoint;

}

export class RiderModel {

	constructor( kit ) {

		const skin = toLinear( 0xc99a78 ), dark = toLinear( 0x1c1d20 ), steel = toLinear( 0x8a9096 ), tyre = toLinear( 0x141414 );
		const body = toLinear( kit.body ), accent = toLinear( kit.accent );
		const cyl = ( seg = 7 ) => new CylinderGeometry( 1, 1, 1, seg, 1 );
		this.parts = {
			// bike
			downTube: part( cyl(), accent, 0.35 ), topTube: part( cyl(), accent, 0.35 ), seatTube: part( cyl(), accent, 0.35 ),
			chainL: part( cyl(), accent, 0.35 ), chainR: part( cyl(), accent, 0.35 ), seatStayL: part( cyl(), accent, 0.35 ), seatStayR: part( cyl(), accent, 0.35 ),
			forkL: part( cyl(), steel, 0.3 ), forkR: part( cyl(), steel, 0.3 ), stem: part( cyl(), steel, 0.3 ), bar: part( cyl(), steel, 0.3 ),
			seat: part( new BoxGeometry( 0.12, 0.05, 0.26 ), dark, 0.8 ),
			wheelF: part( new TorusGeometry( WHEEL_R, 0.028, 5, 22 ), tyre, 0.9 ), wheelR: part( new TorusGeometry( WHEEL_R, 0.028, 5, 22 ), tyre, 0.9 ),
			hubF: part( cyl( 6 ), steel, 0.3 ), hubR: part( cyl( 6 ), steel, 0.3 ),
			chainring: part( new CylinderGeometry( 0.1, 0.1, 0.015, 14, 1 ), steel, 0.25 ),
			crankL: part( cyl( 5 ), dark, 0.4 ), crankR: part( cyl( 5 ), dark, 0.4 ),
			pedalL: part( new BoxGeometry( 0.1, 0.025, 0.09 ), dark, 0.7 ), pedalR: part( new BoxGeometry( 0.1, 0.025, 0.09 ), dark, 0.7 ),
			// rider
			pelvis: part( new SphereGeometry( 1, 8, 6 ), dark, 0.8 ),
			torso: part( cyl( 8 ), body, 0.7 ), chest: part( new SphereGeometry( 1, 8, 6 ), body, 0.7 ),
			head: part( new SphereGeometry( 0.1, 10, 8 ), skin, 0.6 ), helmet: part( new SphereGeometry( 0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55 ), accent, 0.35 ),
			thighL: part( cyl(), dark, 0.8 ), thighR: part( cyl(), dark, 0.8 ), shinL: part( cyl(), dark, 0.8 ), shinR: part( cyl(), dark, 0.8 ),
			shoeL: part( new BoxGeometry( 0.1, 0.07, 0.24 ), accent, 0.6 ), shoeR: part( new BoxGeometry( 0.1, 0.07, 0.24 ), accent, 0.6 ),
			upperL: part( cyl(), body, 0.7 ), upperR: part( cyl(), body, 0.7 ), foreL: part( cyl(), skin, 0.6 ), foreR: part( cyl(), skin, 0.6 ),
			handL: part( new SphereGeometry( 0.045, 6, 4 ), dark, 0.7 ), handR: part( new SphereGeometry( 0.045, 6, 4 ), dark, 0.7 ),
		};
		// spokes: a few per wheel (thin cylinders through the hub)
		for ( const w of [ 'F', 'R' ] ) for ( let k = 0; k < 6; k ++ ) this.parts[ `spoke${ w }${ k }` ] = part( cyl( 3 ), steel, 0.3 );

		let n = 0;
		for ( const k in this.parts ) n += this.parts[ k ].pos.length / 3;
		this.vertexCount = n;
		const g = this.geometry = new BufferGeometry();
		this.position = new Float32Array( n * 3 );
		this.normal = new Float32Array( n * 3 );
		const color = new Float32Array( n * 4 );
		let o = 0;
		for ( const k in this.parts ) {

			const p = this.parts[ k ];
			p.offset = o;
			for ( let i = 0; i < p.pos.length / 3; i ++ ) color.set( [ ...p.color, p.rough ], ( o + i ) * 4 );
			o += p.pos.length / 3;

		}

		g.setAttribute( 'position', new BufferAttribute( this.position, 3 ) );
		g.setAttribute( 'normal', new BufferAttribute( this.normal, 3 ) );
		g.setAttribute( 'color', new BufferAttribute( color, 4 ) );
		this.material = new Material( {
			name: 'rider', vertexColors: true, side: 'double',
			surface: /* wgsl */`
	s.albedo = in.color.rgb;
	s.roughness = in.color.a;
	s.metalness = select( 0.0, 0.7, in.color.a < 0.36 );
`,
		} );
		this.mesh = new Mesh( g, this.material );
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = true;
		this.mesh.frustumCulled = false;
		this.mesh.name = 'rider-' + kit.body.toString( 16 );
		this.crank = 0;
		this.wheelSpin = 0;
		this.bodyDip = 0; // suspension compression on the body, one frame late
		this._pendingDip = 0;
		this.pose( { speed: 0, pedal: false, compression: 0.13, steer: 0, trick: 0, rotation: 0, crash: 0, air: false, dt: 0 } );

	}

	// state: { speed, pedal, compression, steer (-1..1), trick, rotation (rad, flips so far), crash (s left, 0 = riding),
	//          air, dt, tuck (0..1) }
	pose( st ) {

		const P = this.parts;
		this.wheelSpin -= ( st.speed * st.dt ) / WHEEL_R;
		if ( st.pedal || st.speed > 2 ) this.crank += st.dt * ( st.pedal ? 7.5 : 0.8 * Math.min( 1, st.speed / 20 ) );
		// the body takes last frame's compression (the delay reads as weight)
		this.bodyDip = this._pendingDip;
		this._pendingDip = Math.max( - 0.1, Math.min( 0.4, ( st.compression - 0.13 ) * 0.8 ) );

		// ---- bike (rigid)
		const aF = new Vector3( 0, AXLE_Y, WHEELBASE / 2 ), aR = new Vector3( 0, AXLE_Y, - WHEELBASE / 2 );
		between( P.downTube.m, BB, HEAD_TUBE.clone().add( new Vector3( 0, - 0.08, 0 ) ), 0.024 );
		between( P.topTube.m, SEAT.clone().add( new Vector3( 0, - 0.06, 0.03 ) ), HEAD_TUBE, 0.02 );
		between( P.seatTube.m, BB, SEAT, 0.022 );
		between( P.chainL.m, BB.clone().setX( - 0.05 ), aR.clone().setX( - 0.05 ), 0.013 );
		between( P.chainR.m, BB.clone().setX( 0.05 ), aR.clone().setX( 0.05 ), 0.013 );
		between( P.seatStayL.m, SEAT.clone().add( new Vector3( - 0.04, - 0.08, 0 ) ), aR.clone().setX( - 0.05 ), 0.011 );
		between( P.seatStayR.m, SEAT.clone().add( new Vector3( 0.04, - 0.08, 0 ) ), aR.clone().setX( 0.05 ), 0.011 );
		// the front end turns a little with the steer
		const steerA = st.steer * 0.25;
		const rotSteer = new Matrix4().makeRotationAxis( new Vector3( 0, 1, - 0.3 ).normalize(), steerA );
		const aroundHead = ( v ) => v.clone().sub( HEAD_TUBE ).applyMatrix4( rotSteer ).add( HEAD_TUBE );
		const aFs = aroundHead( aF );
		between( P.forkL.m, aroundHead( HEAD_TUBE.clone().setX( - 0.05 ) ), aFs.clone().setX( aFs.x - 0.05 ), 0.014 );
		between( P.forkR.m, aroundHead( HEAD_TUBE.clone().setX( 0.05 ) ), aFs.clone().setX( aFs.x + 0.05 ), 0.014 );
		const bar = aroundHead( BARS );
		between( P.stem.m, HEAD_TUBE, bar, 0.018 );
		const gl = aroundHead( BARS.clone().setX( - GRIP_HALF ) ), gr = aroundHead( BARS.clone().setX( GRIP_HALF ) );
		between( P.bar.m, gl, gr, 0.013 );
		P.seat.m.makeTranslation( SEAT.x, SEAT.y + 0.01, SEAT.z );
		const wheel = ( m, at, extraYaw ) => {

			m.compose( at, _q.setFromEuler( new Euler( 0, Math.PI / 2 + extraYaw, this.wheelSpin, 'YXZ' ) ), _s.set( 1, 1, 1 ) );

		};
		wheel( P.wheelF.m, aFs, steerA );
		wheel( P.wheelR.m, aR, 0 );
		between( P.hubF.m, aFs.clone().setX( aFs.x - 0.06 ), aFs.clone().setX( aFs.x + 0.06 ), 0.02 );
		between( P.hubR.m, aR.clone().setX( - 0.06 ), aR.clone().setX( 0.06 ), 0.02 );
		for ( const [ w, at, yaw ] of [ [ 'F', aFs, steerA ], [ 'R', aR, 0 ] ] ) for ( let k = 0; k < 6; k ++ ) {

			const a = this.wheelSpin + k * Math.PI / 6;
			const d = new Vector3( 0, Math.cos( a ) * ( WHEEL_R - 0.02 ), Math.sin( a ) * ( WHEEL_R - 0.02 ) ).applyAxisAngle( _up, yaw );
			between( P[ `spoke${ w }${ k }` ].m, at.clone().sub( d ), at.clone().add( d ), 0.004 );

		}

		P.chainring.m.compose( BB.clone().setX( 0.07 ), _q.setFromEuler( new Euler( this.crank, 0, Math.PI / 2 ) ), _s.set( 1, 1, 1 ) );
		const pedal = ( side ) => {

			const a = this.crank + ( side > 0 ? 0 : Math.PI );
			return new Vector3( side * 0.14, BB.y + Math.cos( a ) * CRANK, BB.z + Math.sin( a ) * CRANK );

		};

		const pL = pedal( - 1 ), pR = pedal( 1 );
		between( P.crankL.m, BB.clone().setX( - 0.09 ), pL, 0.014 );
		between( P.crankR.m, BB.clone().setX( 0.09 ), pR, 0.014 );
		P.pedalL.m.makeTranslation( pL.x - 0.03, pL.y, pL.z );
		P.pedalR.m.makeTranslation( pR.x + 0.03, pR.y, pR.z );

		// ---- rider: standing on the pedals, knees and elbows soaking up the compression; tucked in a flip
		const tuck = st.tuck ?? ( st.trick ? 1 : 0 );
		const dip = this.bodyDip + tuck * 0.18;
		const lean = 0.25 + Math.min( 0.35, st.speed / 60 ) + tuck * 0.3; // forward lean
		const pelvis = new Vector3( 0, 1.0 - dip, - 0.12 + lean * 0.1 );
		const shoulder = pelvis.clone().add( new Vector3( 0, Math.cos( lean ) * 0.52, Math.sin( lean ) * 0.52 ) );
		const neck = shoulder.clone().add( new Vector3( 0, 0.08, 0.04 ) );
		P.pelvis.m.compose( pelvis, _q.identity(), _s.set( 0.14, 0.1, 0.12 ) );
		between( P.torso.m, pelvis, shoulder, 0.13 );
		P.chest.m.compose( shoulder.clone().add( new Vector3( 0, - 0.06, 0 ) ), _q.identity(), _s.set( 0.17, 0.11, 0.12 ) );
		const head = neck.clone().add( new Vector3( 0, 0.1, 0.06 + lean * 0.05 ) );
		P.head.m.makeTranslation( head.x, head.y, head.z );
		P.helmet.m.compose( head.clone().add( new Vector3( 0, 0.02, - 0.005 ) ), _q.setFromEuler( new Euler( - 0.25, 0, 0 ) ), _s.set( 1, 1, 1.15 ) );

		const joint = new Vector3();
		for ( const [ side, foot, thigh, shin, shoe ] of [ [ - 1, pL, P.thighL, P.shinL, P.shoeL ], [ 1, pR, P.thighR, P.shinR, P.shoeR ] ] ) {

			const hip = pelvis.clone().add( new Vector3( side * 0.1, - 0.04, 0 ) );
			const target = foot.clone().add( new Vector3( 0, 0.05, 0 ) );
			const knee = ik( hip, target, THIGH, SHIN, hip.clone().add( new Vector3( side * 0.05, 0, 1 ) ), joint ).clone();
			between( thigh.m, hip, knee, 0.058 );
			between( shin.m, knee, target, 0.045 );
			shoe.m.makeTranslation( target.x, target.y - 0.01, target.z + 0.03 );

		}

		for ( const [ side, grip, upper, fore, hand ] of [ [ - 1, gl, P.upperL, P.foreL, P.handL ], [ 1, gr, P.upperR, P.foreR, P.handR ] ] ) {

			const sh = shoulder.clone().add( new Vector3( side * 0.19, - 0.02, 0 ) );
			const target = grip.clone().add( new Vector3( - side * 0.06, 0.02, 0 ) );
			const elbow = ik( sh, target, UPPER_ARM, FOREARM, sh.clone().add( new Vector3( side * 0.6, - 0.2, - 0.4 ) ), joint ).clone();
			between( upper.m, sh, elbow, 0.045 );
			between( fore.m, elbow, target, 0.038 );
			hand.m.makeTranslation( target.x, target.y, target.z );

		}

		// ---- crash: the rider comes off and tumbles ahead of the bike, which goes down on its side
		if ( st.crash > 0 ) {

			const u = 1 - st.crash / 1.7; // 0 → 1 over the crash
			const bikeDown = new Matrix4().compose( new Vector3( 0.1, 0.05, 0 ), new Quaternion().setFromEuler( new Euler( 0, 0.6 * u, Math.PI / 2 * Math.min( 1, u * 3 ) ) ), new Vector3( 1, 1, 1 ) );
			const tumble = new Matrix4().compose( new Vector3( 0.3, - 0.55 * Math.min( 1, u * 2.5 ), 1.2 + u * 1.8 ),
				new Quaternion().setFromEuler( new Euler( u * Math.PI * 3.2, 0.4, 0.8 * u ) ), new Vector3( 1, 1, 1 ) );
			const riderParts = [ 'pelvis', 'torso', 'chest', 'head', 'helmet', 'thighL', 'thighR', 'shinL', 'shinR', 'shoeL', 'shoeR', 'upperL', 'upperR', 'foreL', 'foreR', 'handL', 'handR' ];
			for ( const k in P ) P[ k ].m.premultiply( riderParts.includes( k ) ? tumble : bikeDown );

		}

		this._write();

	}

	_write() {

		const pos = this.position, nor = this.normal, nm = new Matrix4();
		for ( const k in this.parts ) {

			const p = this.parts[ k ], e = p.m.elements, n = p.pos.length / 3;
			// normal matrix: the inverse transpose (non-uniform scale on the tubes)
			nm.copy( p.m ).invert().transpose();
			const f = nm.elements;
			for ( let i = 0; i < n; i ++ ) {

				const x = p.pos[ i * 3 ], y = p.pos[ i * 3 + 1 ], z = p.pos[ i * 3 + 2 ], o = ( p.offset + i ) * 3;
				pos[ o ] = e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ];
				pos[ o + 1 ] = e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z + e[ 13 ];
				pos[ o + 2 ] = e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ];
				const a = p.nor[ i * 3 ], b = p.nor[ i * 3 + 1 ], c = p.nor[ i * 3 + 2 ];
				let nx = f[ 0 ] * a + f[ 4 ] * b + f[ 8 ] * c, ny = f[ 1 ] * a + f[ 5 ] * b + f[ 9 ] * c, nz = f[ 2 ] * a + f[ 6 ] * b + f[ 10 ] * c;
				const l = Math.hypot( nx, ny, nz ) || 1;
				nor[ o ] = nx / l; nor[ o + 1 ] = ny / l; nor[ o + 2 ] = nz / l;

			}

		}

		this.geometry.attributes.position.needsUpdate = true;
		this.geometry.attributes.normal.needsUpdate = true;
		this.geometry.computeBoundingSphere?.();

	}

}
