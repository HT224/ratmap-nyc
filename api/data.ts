import type { VercelRequest, VercelResponse } from '@vercel/node'

const API = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json'
const BOROUGHS = new Set(['ALL', 'BRONX', 'BROOKLYN', 'MANHATTAN', 'QUEENS', 'STATEN ISLAND'])
const WINDOWS: Record<string, number> = { '30d': 30, '90d': 90, '1y': 365, '3y': 1095 }

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

    const [bins, totals, byBorough, byMonth, topZips, descriptors] = await Promise.all([
      query({
        '$select': 'round(latitude,3) as lat,round(longitude,3) as lon,count(*) as count',
        '$where': `${where} AND latitude IS NOT NULL AND longitude IS NOT NULL`,
        '$group': 'round(latitude,3),round(longitude,3)',
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
        '$limit': '8',
      }),
      query({
        '$select': 'descriptor,count(*) as count',
        '$where': where,
        '$group': 'descriptor',
        '$order': 'count DESC',
      }),
    ])

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      startDate: start.slice(0, 10),
      window: windowKey,
      borough: safeBorough,
      total: Number(totals[0]?.count ?? 0),
      bins: bins.map((row: Record<string, string>) => ({
        lat: Number(row.lat),
        lon: Number(row.lon),
        count: Number(row.count),
      })),
      byBorough,
      byMonth,
      topZips,
      descriptors,
    })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load NYC data' })
  }
}
