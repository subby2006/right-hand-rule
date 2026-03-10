import './App.css'
import RightHandRule from './RightHandRule'

function App() {
  return (
    <main class="app-shell">
      <section class="app-hero">
        <p class="eyebrow">Electromagnetism lab</p>
        <h1>Right-hand rule explorer</h1>
        <p>
          Pick any two of the three vectors, and the app will solve the missing one while
          showing the cross product in an interactive Three.js scene.
        </p>
      </section>

      <RightHandRule />
    </main>
  )
}

export default App
