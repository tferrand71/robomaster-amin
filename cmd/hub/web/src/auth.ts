// Client-side login only: it keeps casual visitors out of the UI but does not
// protect the hub's API, which anyone on the network can still call.
const USERNAME = 'root'
const PASSWORD = 'Azerty123!'
const KEY = 'robomaster-auth'

// Storage can be unavailable (private mode, blocked site data): then the user
// just has to log in again on every load.
let loggedIn = (() => {
  try { return sessionStorage.getItem(KEY) === '1' } catch { return false }
})()

export const isLoggedIn = () => loggedIn

export function login(username: string, password: string) {
  if (username !== USERNAME || password !== PASSWORD) return false
  loggedIn = true
  try { sessionStorage.setItem(KEY, '1') } catch { /* see above */ }
  return true
}

export function logout() {
  loggedIn = false
  try { sessionStorage.removeItem(KEY) } catch { /* see above */ }
}
