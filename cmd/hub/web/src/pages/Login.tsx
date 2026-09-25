import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { isLoggedIn, login } from '../auth'

export default function Login() {
  const navigate = useNavigate()
  // Page the user was sent away from, to go back there once logged in.
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  if (isLoggedIn()) return <Navigate to={from} replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (login(username, password)) navigate(from, { replace: true })
    else { setError(true); setPassword('') }
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">ROBOMASTER</div>
        <h1>Connexion</h1>
        <label>
          <span className="label">Identifiant</span>
          <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>
          <span className="label">Mot de passe</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" required />
        </label>
        {error && <div className="login-error" role="alert">Identifiant ou mot de passe incorrect</div>}
        <button type="submit">Se connecter</button>
      </form>
    </main>
  )
}
