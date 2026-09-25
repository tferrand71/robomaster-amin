import { useSearchParams } from 'react-router-dom'

// Page shown in the frame: /app/logs?src=<url>, otherwise LOGS_URL.
const LOGS_URL = 'http://10.151.22.135:3001/public-dashboards/409b12aa101247e8af201650f8160d3a'

export default function Logs() {
  const [params] = useSearchParams()
  return <iframe className="logs" title="Logs" src={params.get('src') || LOGS_URL} />
}
