# Ratmap NYC

An interactive heatmap of rat-related complaints reported to NYC 311.

**Live app:** [ratmap-nyc.vercel.app](https://ratmap-nyc.vercel.app/)

## What it shows

- Density of geocoded rat complaints across all five boroughs
- Rolling 30-day, 90-day, one-year, and three-year windows
- Borough filtering
- Raw complaint density and population-normalized complaints per 10,000 residents
- Monthly trend, borough totals, hottest ZIP codes, and complaint mix

The default excludes `Mouse Sighting` records from NYC's broader `Rodent` complaint category. It includes `Rat Sighting`, `Signs of Rodents`, and `Condition Attracting Rodents`.

## Data

[NYC 311 Service Requests from 2020 to Present](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2020-to-Present/erm2-nwe9), updated daily. The app queries NYC Open Data through a cached Vercel function and groups coordinates to roughly 100-meter bins.

Complaints are not a census of rats. Reporting behavior, population density, and 311 awareness all affect the map.

Population normalization uses ACS 2024 five-year ZIP Code Tabulation Area estimates from [Census Reporter](https://censusreporter.org/).

## Development

```bash
npm install
npx vercel dev
```

Optionally set `SOCRATA_APP_TOKEN` for higher API rate limits.

## License

MIT
