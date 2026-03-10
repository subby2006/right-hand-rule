import { For, Show, createEffect, createMemo, onCleanup, onMount } from 'solid-js'
import { createStore } from 'solid-js/store'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const VARIABLE_META = {
  b: { symbol: 'B', name: 'Magnetic field', unit: 'T' },
  v: { symbol: 'v', name: 'Velocity', unit: 'm/s' },
  f: { symbol: 'F', name: 'Magnetic force', unit: 'N' },
}

const VECTOR_COLORS = {
  b: '#39b58f',
  v: '#56a8ff',
  f: '#ff7c5c',
}

const VECTOR_COLOR_VALUES = {
  b: 0x39b58f,
  v: 0x56a8ff,
  f: 0xff7c5c,
}

const DIRECTION_OPTIONS = [
  { id: '+x', label: '+X', description: 'right', vector: new THREE.Vector3(1, 0, 0) },
  { id: '-x', label: '-X', description: 'left', vector: new THREE.Vector3(-1, 0, 0) },
  { id: '+y', label: '+Y', description: 'up', vector: new THREE.Vector3(0, 1, 0) },
  { id: '-y', label: '-Y', description: 'down', vector: new THREE.Vector3(0, -1, 0) },
  { id: '+z', label: '+Z', description: 'toward you', vector: new THREE.Vector3(0, 0, 1) },
  { id: '-z', label: '-Z', description: 'away from you', vector: new THREE.Vector3(0, 0, -1) },
]

const DIRECTION_MAP = Object.fromEntries(
  DIRECTION_OPTIONS.map((option) => [option.id, option.vector.clone()]),
)

const SOLVER_COPY = {
  f: {
    vectorEquation: 'F = v x B',
    magnitudeEquation: '|F| = |v||B|',
    helperText: 'Index finger follows v, middle finger follows B, and your thumb points toward F.',
  },
  v: {
    vectorEquation: 'dir(v) = B x F',
    magnitudeEquation: '|v| = |F| / |B|',
    helperText: 'With B and F known, reverse the cross-product order to recover the velocity direction.',
  },
  b: {
    vectorEquation: 'dir(B) = F x v',
    magnitudeEquation: '|B| = |F| / |v|',
    helperText: 'With F and v known, reverse the cross-product order to recover the field direction.',
  },
}

function parsePositiveNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function findDirectionLabel(vector) {
  const match = DIRECTION_OPTIONS.find((option) => option.vector.equals(vector))
  return match ? match.label : 'custom'
}

function formatMagnitude(value) {
  return Number.isFinite(value) ? value.toFixed(value >= 10 ? 1 : 2) : '--'
}

function formatVector(vector) {
  return `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)})`
}

function makeVectorPayload(key, magnitude, unit, directionId, computed = false) {
  return {
    key,
    magnitude,
    unit,
    vector: unit.clone().multiplyScalar(magnitude),
    directionId,
    directionLabel: findDirectionLabel(unit),
    computed,
  }
}

function buildSolution(form) {
  const missing = form.missing
  const required = Object.keys(VARIABLE_META).filter((key) => key !== missing)
  const vectors = { b: null, v: null, f: null }
  const missingLabels = required.map((key) => VARIABLE_META[key].symbol).join(' and ')

  for (const key of required) {
    const magnitude = parsePositiveNumber(form[`${key}Magnitude`])
    if (!magnitude) {
      return {
        valid: false,
        missing,
        error: `Enter positive magnitudes for ${missingLabels}.`,
        vectors,
        ...SOLVER_COPY[missing],
      }
    }

    const unit = DIRECTION_MAP[form[`${key}Direction`]]?.clone()
    if (!unit) {
      return {
        valid: false,
        missing,
        error: `Choose a direction for ${VARIABLE_META[key].name.toLowerCase()}.`,
        vectors,
        ...SOLVER_COPY[missing],
      }
    }

    vectors[key] = makeVectorPayload(key, magnitude, unit, form[`${key}Direction`])
  }

  let solvedMagnitude = 0
  let solvedUnit = null

  if (missing === 'f') {
    solvedUnit = new THREE.Vector3().crossVectors(vectors.v.unit, vectors.b.unit)
    solvedMagnitude = vectors.v.magnitude * vectors.b.magnitude
  }

  if (missing === 'v') {
    solvedUnit = new THREE.Vector3().crossVectors(vectors.b.unit, vectors.f.unit)
    solvedMagnitude = vectors.f.magnitude / vectors.b.magnitude
  }

  if (missing === 'b') {
    solvedUnit = new THREE.Vector3().crossVectors(vectors.f.unit, vectors.v.unit)
    solvedMagnitude = vectors.f.magnitude / vectors.v.magnitude
  }

  if (!solvedUnit || solvedUnit.lengthSq() === 0) {
    return {
      valid: false,
      missing,
      error: `${VARIABLE_META[required[0]].symbol} and ${VARIABLE_META[required[1]].symbol} cannot be parallel. Pick perpendicular directions so the right-hand rule has a unique answer.`,
      vectors,
      ...SOLVER_COPY[missing],
    }
  }

  solvedUnit.normalize()
  vectors[missing] = makeVectorPayload(
    missing,
    solvedMagnitude,
    solvedUnit,
    findDirectionLabel(solvedUnit),
    true,
  )

  return {
    valid: true,
    missing,
    solved: vectors[missing],
    vectors,
    assumption:
      'Assumes a positive unit charge and perpendicular vectors, so the force magnitude reduces to |F| = |v||B|.',
    ...SOLVER_COPY[missing],
  }
}

export default function RightHandRule() {
  const [form, setForm] = createStore({
    missing: 'f',
    bMagnitude: '1.5',
    bDirection: '+z',
    vMagnitude: '2.2',
    vDirection: '+x',
    fMagnitude: '3.3',
    fDirection: '-y',
  })

  const solution = createMemo(() => buildSolution(form))

  let sceneRef
  let renderer
  let scene
  let camera
  let controls
  let frameId
  let resizeObserver
  let floor
  let guidePlane
  let charge
  let originOrb
  let currentSolution = solution()

  const arrows = {}

  const resizeScene = () => {
    if (!sceneRef || !renderer || !camera) {
      return
    }

    const { clientWidth, clientHeight } = sceneRef
    if (!clientWidth || !clientHeight) {
      return
    }

    renderer.setSize(clientWidth, clientHeight, false)
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
  }

  const updateScene = (nextSolution) => {
    if (!scene) {
      return
    }

    const visibleVectors = Object.values(nextSolution.vectors).filter(Boolean)
    const maxMagnitude = visibleVectors.length
      ? Math.max(...visibleVectors.map((vector) => vector.magnitude))
      : 1

    const scaleLength = (magnitude) => 1.3 + (magnitude / maxMagnitude) * 2.2

    for (const key of Object.keys(VARIABLE_META)) {
      const arrow = arrows[key]
      const vectorData = nextSolution.vectors[key]

      if (!arrow || !vectorData) {
        if (arrow) {
          arrow.visible = false
        }
        continue
      }

      arrow.visible = true
      arrow.setDirection(vectorData.unit.clone())
      arrow.setLength(scaleLength(vectorData.magnitude), 0.34, 0.2)
      arrow.setColor(new THREE.Color(VECTOR_COLORS[key]))
    }

    if (nextSolution.valid) {
      const vUnit = nextSolution.vectors.v.unit
      const bUnit = nextSolution.vectors.b.unit
      const normal = new THREE.Vector3().crossVectors(vUnit, bUnit).normalize()
      const basis = new THREE.Matrix4().makeBasis(vUnit.clone(), bUnit.clone(), normal)

      guidePlane.visible = true
      guidePlane.quaternion.setFromRotationMatrix(basis)
      guidePlane.scale.set(
        scaleLength(nextSolution.vectors.v.magnitude) * 0.52,
        scaleLength(nextSolution.vectors.b.magnitude) * 0.52,
        1,
      )
      guidePlane.position.copy(normal.multiplyScalar(0.05))
    } else {
      guidePlane.visible = false
    }
  }

  const animate = () => {
    frameId = requestAnimationFrame(animate)
    const elapsed = performance.now() * 0.001

    floor.rotation.z = elapsed * 0.04

    if (currentSolution.valid) {
      const velocityOffset = currentSolution.vectors.v.unit
        .clone()
        .multiplyScalar(Math.sin(elapsed * 0.9) * 1.1)
      const forceOffset = currentSolution.vectors.f.unit
        .clone()
        .multiplyScalar((Math.sin(elapsed * 1.8) + 1) * 0.12)

      charge.visible = true
      charge.position.copy(velocityOffset.add(forceOffset))
      originOrb.material.emissiveIntensity = 0.55 + (Math.sin(elapsed * 1.6) + 1) * 0.14
    } else {
      charge.visible = false
      originOrb.material.emissiveIntensity = 0.55
    }

    controls.update()
    renderer.render(scene, camera)
  }

  onMount(() => {
    scene = new THREE.Scene()

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    sceneRef.append(renderer.domElement)

    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    camera.position.set(5.4, 4.2, 6.6)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.minDistance = 4
    controls.maxDistance = 14

    scene.add(new THREE.HemisphereLight(0xfff6df, 0x10314a, 1.25))

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6)
    keyLight.position.set(4, 6, 5)
    scene.add(keyLight)

    floor = new THREE.Mesh(
      new THREE.TorusGeometry(2.35, 0.045, 20, 100),
      new THREE.MeshStandardMaterial({
        color: 0xf8d165,
        transparent: true,
        opacity: 0.35,
        emissive: 0xf3b640,
        emissiveIntensity: 0.18,
      }),
    )
    floor.rotation.x = Math.PI / 2
    scene.add(floor)

    const grid = new THREE.GridHelper(10, 10, 0x21496a, 0x16334c)
    grid.position.y = -1.25
    scene.add(grid)

    guidePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xf8d165,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
      }),
    )
    guidePlane.visible = false
    scene.add(guidePlane)

    originOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 24, 24),
      new THREE.MeshStandardMaterial({
        color: 0xfff6df,
        emissive: 0xffb766,
        emissiveIntensity: 0.55,
        roughness: 0.15,
        metalness: 0.2,
      }),
    )
    scene.add(originOrb)

    charge = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 24, 24),
      new THREE.MeshStandardMaterial({
        color: 0xcff6ff,
        emissive: 0x7de0ff,
        emissiveIntensity: 0.85,
        roughness: 0.2,
        metalness: 0.35,
      }),
    )
    scene.add(charge)

    for (const key of Object.keys(VARIABLE_META)) {
      arrows[key] = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 0),
        2,
        VECTOR_COLOR_VALUES[key],
        0.34,
        0.2,
      )
      scene.add(arrows[key])
    }

    resizeObserver = new ResizeObserver(resizeScene)
    resizeObserver.observe(sceneRef)
    window.addEventListener('resize', resizeScene)

    updateScene(currentSolution)
    resizeScene()
    animate()
  })

  createEffect(() => {
    currentSolution = solution()
    updateScene(currentSolution)
  })

  onCleanup(() => {
    cancelAnimationFrame(frameId)
    resizeObserver?.disconnect()
    window.removeEventListener('resize', resizeScene)
    controls?.dispose()
    renderer?.dispose()
    sceneRef?.replaceChildren()
  })

  return (
    <section class="lab-layout">
      <div class="control-panel">
        <div class="panel-block">
          <p class="eyebrow">Calculator</p>
          <h2>Solve the missing vector</h2>
          <p class="panel-copy">
            Choose the missing electromagnetism variable, then supply magnitudes and axis
            directions for the other two vectors.
          </p>
        </div>

        <div class="panel-block">
          <div class="mode-picker">
            <For each={Object.entries(VARIABLE_META)}>
              {([key, meta]) => (
                <button
                  type="button"
                  classList={{ active: form.missing === key }}
                  onClick={() => setForm('missing', key)}
                >
                  Solve {meta.symbol}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="vector-grid">
          <For each={Object.entries(VARIABLE_META)}>
            {([key, meta]) => {
              const isComputed = () => form.missing === key
              return (
                <article classList={{ 'vector-card': true, computed: isComputed() }}>
                  <div class="vector-card-header">
                    <div>
                      <p>{meta.symbol}</p>
                      <h3>{meta.name}</h3>
                    </div>
                    <span>{isComputed() ? 'Computed' : 'Input'}</span>
                  </div>

                  <label>
                    Magnitude
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={isComputed() ? '' : form[`${key}Magnitude`]}
                      onInput={(event) => setForm(`${key}Magnitude`, event.currentTarget.value)}
                      placeholder={isComputed() ? 'Solved below' : `Enter ${meta.symbol}`}
                      disabled={isComputed()}
                    />
                  </label>

                  <label>
                    Direction
                    <select
                      value={isComputed() ? solution().vectors[key]?.directionId ?? '' : form[`${key}Direction`]}
                      onInput={(event) => setForm(`${key}Direction`, event.currentTarget.value)}
                      disabled={isComputed()}
                    >
                      <option value="" disabled>
                        Select axis
                      </option>
                      <For each={DIRECTION_OPTIONS}>
                        {(option) => (
                          <option value={option.id}>
                            {option.label} ({option.description})
                          </option>
                        )}
                      </For>
                    </select>
                  </label>

                  <Show when={isComputed()}>
                    <div class="computed-readout">
                      <strong>
                        {formatMagnitude(solution().vectors[key]?.magnitude)} {meta.unit}
                      </strong>
                      <span>{solution().vectors[key]?.directionLabel ?? '--'}</span>
                    </div>
                  </Show>
                </article>
              )
            }}
          </For>
        </div>

        <article class="result-card">
          <div class="result-header">
            <div>
              <p class="eyebrow">Result</p>
              <h3>{solution().vectorEquation}</h3>
            </div>
            <span>{solution().magnitudeEquation}</span>
          </div>

          <Show when={solution().valid} fallback={<p class="status-message error">{solution().error}</p>}>
            <div class="result-metrics">
              <div>
                <span>Missing variable</span>
                <strong>{VARIABLE_META[solution().missing].name}</strong>
              </div>
              <div>
                <span>Magnitude</span>
                <strong>
                  {formatMagnitude(solution().solved.magnitude)} {VARIABLE_META[solution().missing].unit}
                </strong>
              </div>
              <div>
                <span>Direction</span>
                <strong>{solution().solved.directionLabel}</strong>
              </div>
            </div>

            <div class="equation-strip">
              <div>
                <span>Vector components</span>
                <strong>{formatVector(solution().solved.vector)}</strong>
              </div>
              <div>
                <span>Interpretation</span>
                <strong>{solution().helperText}</strong>
              </div>
            </div>

            <p class="status-message">{solution().assumption}</p>
          </Show>
        </article>
      </div>

      <div class="scene-panel">
        <div class="scene-header">
          <div>
            <p class="eyebrow">Interactive visual</p>
            <h2>Orbit the cross product in 3D</h2>
          </div>
          <p>
            Drag to rotate. The golden sheet spans <code>v</code> and <code>B</code>; the
            force arrow emerges perpendicular to that plane.
          </p>
        </div>

        <div class="scene-shell">
          <div ref={sceneRef} class="scene-canvas" />
          <div class="scene-legend">
            <For each={Object.entries(VARIABLE_META)}>
              {([key, meta]) => (
                <div class="legend-item">
                  <span class="legend-swatch" style={{ 'background-color': VECTOR_COLORS[key], color: VECTOR_COLORS[key] }} />
                  <div>
                    <strong>{meta.symbol}</strong>
                    <p>{meta.name}</p>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </section>
  )
}


