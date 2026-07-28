import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map } from 'maplibre-gl'

type Bin = { lat: number; lon: number; count: number; zip: string; rate: number }
type CountRow = { count: string }
type BoroughRow = CountRow & { borough: string }
type MonthRow = CountRow & { month: string }
type ZipStat = { zip: string; count: number; population: number; rate: number }
type DescriptorRow = CountRow & { descriptor: string }

type Data = {
  generatedAt: string
  startDate: string
  window: string
  borough: string
  total: number
  ratePer10k: number
  populationSource: string
  bins: Bin[]
  byBorough: BoroughRow[]
  byMonth: MonthRow[]
  zipStats: ZipStat[]
  descriptors: DescriptorRow[]
}

const WINDOWS = [
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['1y', '1 year'],
  ['3y', '3 years'],
]
const BOROUGHS = ['ALL', 'MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND']
const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

function number(value: number | string) {
  return Number(value).toLocaleString()
}

function RatMap({ bins, mode }: { bins: Bin[]; mode: 'raw' | 'normalized' }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  const [unsupported, setUnsupported] = useState(false)

  useEffect(() => {
    if (!container.current || map.current) return
    try {
      map.current = new maplibregl.Map({
        container: container.current,
        style: STYLE,
        center: [-73.94, 40.72],
        zoom: 9.8,
        minZoom: 8.7,
        maxZoom: 16,
        attributionControl: false,
      })
    } catch {
      setUnsupported(true)
      return
    }
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const current = map.current
    if (!current) return
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: bins.map((bin) => ({
        type: 'Feature',
        properties: { count: bin.count, rate: bin.rate, weight: mode === 'raw' ? bin.count : bin.rate },
        geometry: { type: 'Point', coordinates: [bin.lon, bin.lat] },
      })),
    }
    const sync = () => {
      const source = current.getSource('complaints') as GeoJSONSource | undefined
      if (source) {
        source.setData(geojson)
        return
      }
      current.addSource('complaints', { type: 'geojson', data: geojson })
      current.addLayer({
        id: 'rat-heat',
        type: 'heatmap',
        source: 'complaints',
        maxzoom: 15,
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, mode === 'raw' ? 80 : 8, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 13, 2.4],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 11, 13, 34],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.82, 15, 0.55],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(37,28,18,0)',
            0.12, '#6f5c2f',
            0.3, '#d5ad43',
            0.52, '#f37735',
            0.72, '#e93635',
            0.9, '#b60b46',
            1, '#fff0db',
          ],
        },
      })
      current.addLayer({
        id: 'rat-points',
        type: 'circle',
        source: 'complaints',
        minzoom: 13,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 2, 100, 11],
          'circle-color': '#ff5d3a',
          'circle-opacity': 0.68,
          'circle-stroke-color': '#fff0db',
          'circle-stroke-width': 0.7,
        },
      })
    }
    current.isStyleLoaded() ? sync() : current.once('load', sync)
  }, [bins, mode])

  return (
    <>
      <div className="map" ref={container} aria-label="Heatmap of NYC rat complaints" />
      {unsupported && <div className="map-fallback">This browser cannot render the WebGL map.<br />The live complaint statistics remain available.</div>}
    </>
  )
}

function Trend({ rows }: { rows: MonthRow[] }) {
  const values = rows.map((row) => Number(row.count))
  const max = Math.max(...values, 1)
  return (
    <div className="trend" aria-label="Monthly complaint trend">
      {rows.map((row) => (
        <div
          className="trend-bar"
          key={row.month}
          style={{ height: `${Math.max(4, (Number(row.count) / max) * 100)}%` }}
          title={`${new Date(row.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}: ${number(row.count)}`}
        />
      ))}
    </div>
  )
}

export default function App() {
  const [windowKey, setWindowKey] = useState('1y')
  const [borough, setBorough] = useState('ALL')
  const [mode, setMode] = useState<'raw' | 'normalized'>('raw')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    fetch(`/api/data?window=${windowKey}&borough=${encodeURIComponent(borough)}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('NYC Open Data is unavailable right now.')
        return response.json()
      })
      .then(setData)
      .catch((reason) => {
        if (reason.name !== 'AbortError') setError(reason.message)
      })
    return () => controller.abort()
  }, [windowKey, borough])

  return (
    <main>
      <RatMap bins={data?.bins ?? []} mode={mode} />
      <header className="brand">
        <div className="rat-mark" aria-hidden="true">R</div>
        <div>
          <h1>Ratmap <span>NYC</span></h1>
          <p>Where New Yorkers report the rats.</p>
        </div>
      </header>

      <section className="controls" aria-label="Map controls">
        <div className="mode-toggle" aria-label="Normalization">
          <button className={mode === 'raw' ? 'active' : ''} onClick={() => setMode('raw')}>Raw</button>
          <button className={mode === 'normalized' ? 'active' : ''} onClick={() => setMode('normalized')}>Per 10k</button>
        </div>
        <label>
          Time range
          <select value={windowKey} onChange={(event) => setWindowKey(event.target.value)}>
            {WINDOWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Borough
          <select value={borough} onChange={(event) => setBorough(event.target.value)}>
            {BOROUGHS.map((value) => <option key={value} value={value}>{value === 'ALL' ? 'All boroughs' : value}</option>)}
          </select>
        </label>
      </section>

      <aside className="panel">
        {error ? <div className="error">{error}</div> : !data ? <div className="loading">Scouting the boroughs…</div> : (
          <>
            <p className="eyebrow">{mode === 'raw' ? '311 RAT COMPLAINTS' : 'COMPLAINTS PER 10K RESIDENTS'}</p>
            <div className="total">{mode === 'raw' ? number(data.total) : data.ratePer10k.toFixed(1)}</div>
            <p className="period">since {new Date(`${data.startDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>

            <div className="section-title"><span>Monthly pulse</span><span>low → high</span></div>
            <Trend rows={data.byMonth} />

            {borough === 'ALL' && mode === 'raw' && (
              <>
                <div className="section-title"><span>By borough</span><span>reports</span></div>
                <ol className="ranking">
                  {data.byBorough.map((row) => (
                    <li key={row.borough}><span>{row.borough}</span><strong>{number(row.count)}</strong></li>
                  ))}
                </ol>
              </>
            )}

            <div className="section-title"><span>Hottest ZIPs</span><span>{mode === 'raw' ? 'reports' : 'per 10k'}</span></div>
            <ol className="ranking zips">
              {[...data.zipStats]
                .sort((a, b) => mode === 'raw' ? b.count - a.count : b.rate - a.rate)
                .slice(0, 5)
                .map((row, index) => (
                <li key={row.zip}><span><i>{index + 1}</i>{row.zip}</span><strong>{mode === 'raw' ? number(row.count) : row.rate.toFixed(1)}</strong></li>
              ))}
            </ol>

            <div className="mix">
              {data.descriptors.map((row) => {
                const pct = data.total ? Math.round(Number(row.count) / data.total * 100) : 0
                return <span key={row.descriptor}>{row.descriptor.replace('Condition Attracting Rodents', 'Attracting conditions')} <b>{pct}%</b></span>
              })}
            </div>
          </>
        )}
      </aside>

      <footer>
        <span>Live NYC 311 Open Data · refreshed hourly</span>
        <span>{mode === 'raw' ? 'Reports are not a census of rats.' : `${data?.populationSource ?? 'ACS'} population estimate.`}</span>
      </footer>
    </main>
  )
}
