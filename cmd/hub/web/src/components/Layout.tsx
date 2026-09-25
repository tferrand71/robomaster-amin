import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { isLoggedIn, logout } from '../auth'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  if (!isLoggedIn()) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  return (
    <div className="layout">
      <nav>
        <span className="brand">ROBOMASTER</span>
        <NavLink to="/" end>Interface</NavLink>
        <NavLink to="/logs">Logs</NavLink>
        <span className="status"><span className="dot" />Robot indisponible</span>
        <button className="logout" onClick={() => { logout(); navigate('/login') }}>Déconnexion</button>
      </nav>
      <Outlet />
    </div>
  )
}
