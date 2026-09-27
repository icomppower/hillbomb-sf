// Pooled particle emitters (SPEC §6 speed FX): dust off dry ground, spray off wet ground, and the drizzle
// streaks around the camera while the marine layer is in. CPU pools drawn as camera-facing quads through one
// InstancedMesh each (no allocation per frame). Visual only: never read by the sim.
import { InstancedMesh, PlaneGeometry, Matrix4, Vector3, Quaternion, Color, BufferAttribute } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _c = new Color();

function quadMaterial( name, streak ) {

	return new Material( {
		name,
		lit: false,
		transparent: true,
		depthWrite: false,
		vertexColors: true,
		side: 'double',
		surface: streak ? /* wgsl */`
	let x = abs( in.uv.x - 0.5 ) * 2.0;
	s.albedo = in.color.rgb;
	s.alpha = ( 1.0 - x * x ) * 0.35;
` : /* wgsl */`
	let d = length( in.uv - vec2f( 0.5 ) ) * 2.0;
	s.albedo = in.color.rgb;
	s.alpha = smoothstep( 1.0, 0.2, d ) * 0.55;
`,
	} );

}

export class Particles {

	constructor( count = 320 ) {

		const geo = new PlaneGeometry( 1, 1 );
		const n = geo.attributes.position.count;
		geo.setAttribute( 'color', new BufferAttribute( new Float32Array( n * 4 ).fill( 1 ), 4 ) );
		this.mesh = new InstancedMesh( geo, quadMaterial( 'fx-dust', false ), count );
		this.mesh.frustumCulled = false;
		this.mesh.name = 'fx-particles';
		this.pool = Array.from( { length: count }, () => ( { life: 0, max: 1, p: new Vector3(), v: new Vector3(), size: 0.3, grow: 1, color: new Color() } ) );
		this.next = 0;
		for ( let i = 0; i < count; i ++ ) { this.mesh.setMatrixAt( i, _m.makeScale( 0, 0, 0 ) ); this.mesh.setColorAt( i, _c.setRGB( 1, 1, 1 ) ); }

		// drizzle: streaks that fall around the camera
		const sg = new PlaneGeometry( 0.012, 0.55 );
		sg.setAttribute( 'color', new BufferAttribute( new Float32Array( sg.attributes.position.count * 4 ).fill( 1 ), 4 ) );
		this.rain = new InstancedMesh( sg, quadMaterial( 'fx-drizzle', true ), 360 );
		this.rain.frustumCulled = false;
		this.rain.name = 'fx-drizzle';
		this.drops = Array.from( { length: 360 }, ( _, i ) => ( { p: new Vector3( ( ( i * 7.31 ) % 1 - 0.5 ) * 24, ( ( i * 3.17 ) % 1 ) * 12, ( ( i * 5.77 ) % 1 - 0.5 ) * 24 ) } ) );
		this.rain.count = 0;

	}

	// kind: 'dust' | 'spray' | 'chips' (wood); at a world point with a base velocity
	emit( kind, at, vel, n = 4 ) {

		for ( let k = 0; k < n; k ++ ) {

			const q = this.pool[ this.next ];
			this.next = ( this.next + 1 ) % this.pool.length;
			const r = () => Math.random() - 0.5;
			q.p.copy( at ).add( _p.set( r() * 0.4, Math.random() * 0.1, r() * 0.4 ) );
			q.v.copy( vel ).multiplyScalar( 0.35 ).add( _p.set( r() * 2.2, 0.6 + Math.random() * 1.6, r() * 2.2 ) );
			if ( kind === 'spray' ) { q.color.setRGB( 0.62, 0.66, 0.7 ); q.max = 0.6; q.size = 0.18; q.grow = 1.8; }
			else if ( kind === 'chips' ) { q.color.setRGB( 0.3, 0.2, 0.12 ); q.max = 0.8; q.size = 0.07; q.grow = 0.2; }
			else { q.color.setRGB( 0.42, 0.38, 0.33 ); q.max = 1.3; q.size = 0.28; q.grow = 2.4; }
			q.life = q.max;

		}

	}

	update( dt, camera, drizzle ) {

		_q.copy( camera.quaternion );
		const inst = this.mesh;
		for ( let i = 0; i < this.pool.length; i ++ ) {

			const q = this.pool[ i ];
			if ( q.life <= 0 ) { inst.setMatrixAt( i, _m.makeScale( 0, 0, 0 ) ); continue; }
			q.life -= dt;
			q.v.y -= 2.5 * dt;
			q.v.multiplyScalar( Math.exp( - 2.2 * dt ) );
			q.p.addScaledVector( q.v, dt );
			const u = 1 - Math.max( 0, q.life ) / q.max, size = q.size * ( 1 + q.grow * u ) * ( 1 - u * u );
			inst.setMatrixAt( i, _m.compose( q.p, _q, _s.set( size, size, size ) ) );
			inst.setColorAt( i, q.color );

		}

		inst.instanceMatrix.needsUpdate = true;
		if ( inst.instanceColor ) inst.instanceColor.needsUpdate = true;

		// drizzle wraps in a box around the camera; streaks face the camera's side, fall and slant with the wind
		const n = Math.round( this.drops.length * Math.min( 1, drizzle ) );
		this.rain.count = n;
		if ( n > 0 ) {

			const c = camera.position;
			for ( let i = 0; i < n; i ++ ) {

				const d = this.drops[ i ];
				d.p.y -= 7.5 * dt;
				d.p.x += 0.8 * dt;
				if ( d.p.y < - 3 ) d.p.y += 13;
				const x = c.x + ( ( ( d.p.x - c.x ) % 24 + 36 ) % 24 - 12 ), z = c.z + ( ( ( d.p.z - c.z ) % 24 + 36 ) % 24 - 12 );
				_p.set( x, c.y + d.p.y - 4, z );
				// yaw-only billboard so the streak stays vertical
				const yaw = Math.atan2( c.x - x, c.z - z );
				this.rain.setMatrixAt( i, _m.compose( _p, _q.setFromAxisAngle( _s.set( 0, 1, 0 ), yaw ), _s.set( 1, 1, 1 ) ) );

			}

			this.rain.instanceMatrix.needsUpdate = true;

		}

	}

}
