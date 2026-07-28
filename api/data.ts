import type { VercelRequest, VercelResponse } from '@vercel/node'

const API = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json'
const BOROUGHS = new Set(['ALL', 'BRONX', 'BROOKLYN', 'MANHATTAN', 'QUEENS', 'STATEN ISLAND'])
const WINDOWS: Record<string, number> = { '30d': 30, '90d': 90, '1y': 365, '3y': 1095 }
const CENSUS_REPORTER = 'https://api.censusreporter.org/1.0/data/show/latest'

function dateFromDays(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10) + 'T00:00:00'
}

async function query(params: Record<string, string>) {
  const url = new URL(API)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, {
    headers: process.env.SOCRATA_APP_TOKEN ? { 'X-App-Token': process.env.SOCRATA_APP_TOKEN } : {},
  })
  if (!response.ok) throw new Error(`NYC Open Data returned ${response.status}`)
  return response.json()
}

async function populationsFor(zips: string[]) {
  if (!zips.length) return { populations: {} as Record<string, number>, release: '' }
  const populations: Record<string, number> = {}
  let release = 'ACS 2024 5-year'
  const chunks = Array.from({ length: Math.ceil(zips.length / 40) }, (_, index) => zips.slice(index * 40, index * 40 + 40))
  const fetchChunk = async (chunk: string[]): Promise<any[]> => {
    const url = new URL(CENSUS_REPORTER)
    url.searchParams.set('table_ids', 'B01003')
    url.searchParams.set('geo_ids', chunk.map((zip) => `86000US${zip}`).join(','))
    const response = await fetch(url)
    if (response.ok) return [await response.json()]
    if (response.status === 400 && chunk.length > 1) {
      const midpoint = Math.ceil(chunk.length / 2)
      return (await Promise.all([fetchChunk(chunk.slice(0, midpoint)), fetchChunk(chunk.slice(midpoint))])).flat()
    }
    if (response.status === 400) return []
    throw new Error(`Census Reporter returned ${response.status}`)
  }
  const payloads = (await Promise.all(chunks.map(fetchChunk))).flat()
  for (const payload of payloads) {
    release = payload.release?.name ?? release
    for (const [geoid, value] of Object.entries(payload.data ?? {}) as [string, any][]) {
      const population = Number(value?.B01003?.estimate?.B01003001)
      if (Number.isFinite(population) && population > 0) populations[geoid.slice(-5)] = population
    }
  }
  return { populations, release }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const windowKey = typeof req.query.window === 'string' ? req.query.window : '1y'
    const borough = typeof req.query.borough === 'string' ? req.query.borough.toUpperCase() : 'ALL'
    const days = WINDOWS[windowKey] ?? WINDOWS['1y']
    const safeBorough = BOROUGHS.has(borough) ? borough : 'ALL'
    const start = dateFromDays(days)
    const base = [
      `complaint_type = 'Rodent'`,
      `descriptor != 'Mouse Sighting'`,
      `created_date >= '${start}'`,
    ]
    if (safeBorough !== 'ALL') base.push(`borough = '${safeBorough}'`)
    const where = base.join(' AND ')

    const [bins, totals, byBorough, byMonth, zipCounts, descriptors] = await Promise.all([
      query({
        '$select': 'incident_zip,round(latitude,3) as lat,round(longitude,3) as lon,count(*) as count',
        '$where': `${where} AND latitude IS NOT NULL AND longitude IS NOT NULL AND incident_zip IS NOT NULL`,
        '$group': 'incident_zip,round(latitude,3),round(longitude,3)',
        '$limit': '50000',
      }),
      query({ '$select': 'count(*) as count', '$where': where }),
      query({
        '$select': 'borough,count(*) as count',
        '$where': where,
        '$group': 'borough',
        '$order': 'count DESC',
      }),
      query({
        '$select': 'date_trunc_ym(created_date) as month,count(*) as count',
        '$where': where,
        '$group': 'date_trunc_ym(created_date)',
        '$order': 'month ASC',
      }),
      query({
        '$select': 'incident_zip,count(*) as count',
        '$where': `${where} AND incident_zip IS NOT NULL`,
        '$group': 'incident_zip',
        '$order': 'count DESC',
        '$limit': '500',
      }),
      query({
        '$select': 'descriptor,count(*) as count',
        '$where': where,
        '$group': 'descriptor',
        '$order': 'count DESC',
      }),
    ])
    const zips = [...new Set<string>(
      (zipCounts as Array<Record<string, string>>).map((row) => row.incident_zip),
    )].filter((zip) => /^\d{5}$/.test(zip))
    const { populations, release } = await populationsFor(zips)
    const zipStats = zipCounts
      .filter((row: Record<string, string>) => populations[row.incident_zip])
      .map((row: Record<string, string>) => ({
        zip: row.incident_zip,
        count: Number(row.count),
        population: populations[row.incident_zip],
        rate: Number(row.count) * 10000 / populations[row.incident_zip],
      }))
    const coveredComplaints = zipStats.reduce((sum: number, row: { count: number }) => sum + row.count, 0)
    const coveredPopulation = zipStats.reduce((sum: number, row: { population: number }) => sum + row.population, 0)

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      startDate: start.slice(0, 10),
      window: windowKey,
      borough: safeBorough,
      total: Number(totals[0]?.count ?? 0),
      ratePer10k: coveredPopulation ? coveredComplaints * 10000 / coveredPopulation : 0,
      populationSource: release,
      bins: bins.map((row: Record<string, string>) => ({
        lat: Number(row.lat),
        lon: Number(row.lon),
        count: Number(row.count),
        zip: row.incident_zip,
        rate: populations[row.incident_zip] ? Number(row.count) * 10000 / populations[row.incident_zip] : 0,
      })),
      byBorough,
      byMonth,
      zipStats,
      descriptors,
    })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load NYC data' })
  }
}
