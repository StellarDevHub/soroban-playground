// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file geoProjection.ts
 * GIS geographic projection engine, polygon coordinate mapping,
 * bounding box spatial math, and SVG vector path generators for satellite weather maps.
 */

import type {
  BoundingBox,
  LatLng,
  PrecipitationContour,
  ScreenPoint,
  WeatherRadarCell,
} from "../../types/insurance";

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates a bounding box encompassing a list of coordinates with optional padding.
 */
export function calculateBoundingBox(
  coordinates: LatLng[],
  paddingFraction = 0.08,
): BoundingBox {
  if (coordinates.length === 0) {
    return { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const c of coordinates) {
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
  }

  const latSpan = Math.max(maxLat - minLat, 0.001);
  const lngSpan = Math.max(maxLng - minLng, 0.001);

  const latPad = latSpan * paddingFraction;
  const lngPad = lngSpan * paddingFraction;

  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
}

/**
 * Projects a geographic (Lat, Lng) coordinate to SVG screen pixel coordinates.
 * Screen coordinates have (0,0) at top-left, so higher latitude maps to smaller y.
 */
export function projectCoordinate(
  coord: LatLng,
  bounds: BoundingBox,
  width: number,
  height: number,
): ScreenPoint {
  const lngSpan = bounds.maxLng - bounds.minLng || 1;
  const latSpan = bounds.maxLat - bounds.minLat || 1;

  const normalizedX = (coord.lng - bounds.minLng) / lngSpan;
  const normalizedY = (bounds.maxLat - coord.lat) / latSpan;

  return {
    x: Math.round(normalizedX * width * 10) / 10,
    y: Math.round(normalizedY * height * 10) / 10,
  };
}

/**
 * Unprojects SVG screen pixel coordinates back to geographic (Lat, Lng).
 */
export function unprojectCoordinate(
  point: ScreenPoint,
  bounds: BoundingBox,
  width: number,
  height: number,
): LatLng {
  const safeWidth = width || 1;
  const safeHeight = height || 1;

  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;

  const lng = bounds.minLng + (point.x / safeWidth) * lngSpan;
  const lat = bounds.maxLat - (point.y / safeHeight) * latSpan;

  return {
    lat: Math.round(lat * 100000) / 100000,
    lng: Math.round(lng * 100000) / 100000,
  };
}

/**
 * Calculates geographic centroid of a polygon.
 */
export function calculateCentroid(coordinates: LatLng[]): LatLng {
  if (coordinates.length === 0) return { lat: 0, lng: 0 };
  if (coordinates.length === 1) return coordinates[0];

  let sumLat = 0;
  let sumLng = 0;

  for (const c of coordinates) {
    sumLat += c.lat;
    sumLng += c.lng;
  }

  return {
    lat: Math.round((sumLat / coordinates.length) * 100000) / 100000,
    lng: Math.round((sumLng / coordinates.length) * 100000) / 100000,
  };
}

/**
 * Ray casting algorithm to determine if a point is inside a polygon.
 */
export function isPointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const x = point.lng;
  const y = point.lat;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Converts polygon geographic coordinates into an SVG path data string ("M x y L x y ... Z").
 */
export function polygonToSvgPath(
  coordinates: LatLng[],
  bounds: BoundingBox,
  width: number,
  height: number,
): string {
  if (coordinates.length === 0) return "";

  return coordinates.reduce((path, coord, idx) => {
    const pt = projectCoordinate(coord, bounds, width, height);
    if (idx === 0) {
      return `M ${pt.x} ${pt.y}`;
    }
    return `${path} L ${pt.x} ${pt.y}`;
  }, "") + " Z";
}

/**
 * Calculates approximate area of a geographic polygon in hectares using the Shoelace formula on spherical projection.
 */
export function calculatePolygonAreaHectares(coordinates: LatLng[]): number {
  if (coordinates.length < 3) return 0;

  let total = 0;
  const len = coordinates.length;

  for (let i = 0; i < len; i++) {
    const c1 = coordinates[i];
    const c2 = coordinates[(i + 1) % len];

    const lat1Rad = (c1.lat * Math.PI) / 180;
    const lat2Rad = (c2.lat * Math.PI) / 180;
    const dLngRad = ((c2.lng - c1.lng) * Math.PI) / 180;

    total += dLngRad * (2 + Math.sin(lat1Rad) + Math.sin(lat2Rad));
  }

  const areaSqMeters = Math.abs((total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2);
  const areaHectares = areaSqMeters / 10000;
  return Math.round(areaHectares * 10) / 10;
}

/**
 * Generates precipitation isohyet contour lines for visualization on the map.
 */
export function generateContourLines(
  bounds: BoundingBox,
  currentRainfallMm: number,
): PrecipitationContour[] {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  const latSpan = bounds.maxLat - bounds.minLat;
  const lngSpan = bounds.maxLng - bounds.minLng;

  // Levels scale with current simulated rainfall
  const baseLevels = [50, 100, 175, 250, 400, 600];
  const contours: PrecipitationContour[] = [];

  const colorMap: Record<number, string> = {
    50: "rgba(56, 189, 248, 0.4)", // light sky blue
    100: "rgba(34, 197, 94, 0.5)", // green
    175: "rgba(234, 179, 8, 0.6)", // yellow
    250: "rgba(249, 115, 22, 0.7)", // orange
    400: "rgba(239, 68, 68, 0.8)", // red
    600: "rgba(168, 85, 247, 0.9)", // purple
  };

  for (const level of baseLevels) {
    if (level > currentRainfallMm * 1.5 && level > 100) continue;

    // Generate smooth elliptical contour ring around rainfall storm cell center
    const radiusFactor = Math.max(0.1, Math.min(0.45, 0.5 - (level / 800) * 0.3));
    const rLat = latSpan * radiusFactor;
    const rLng = lngSpan * radiusFactor * 1.2;

    const ringPoints: LatLng[] = [];
    const steps = 36;
    for (let step = 0; step < steps; step++) {
      const angle = (step / steps) * Math.PI * 2;
      // Add slight organic perturbation
      const noise = 1 + 0.08 * Math.sin(angle * 3) + 0.05 * Math.cos(angle * 5);
      const lat = centerLat + Math.sin(angle) * rLat * noise;
      const lng = centerLng + Math.cos(angle) * rLng * noise;
      ringPoints.push({
        lat: Math.round(lat * 100000) / 100000,
        lng: Math.round(lng * 100000) / 100000,
      });
    }

    contours.push({
      levelMm: level,
      label: `${level} mm`,
      color: colorMap[level] || "rgba(148, 163, 184, 0.5)",
      paths: [ringPoints],
    });
  }

  return contours;
}

/**
 * Generates synthetic Doppler weather radar cells distributed across the bounding box.
 */
export function generateRadarCells(
  bounds: BoundingBox,
  simulatedRainfallMm: number,
  intensityScale = 1.0,
): WeatherRadarCell[] {
  const cells: WeatherRadarCell[] = [];
  const rows = 7;
  const cols = 9;

  const latStep = (bounds.maxLat - bounds.minLat) / (rows + 1);
  const lngStep = (bounds.maxLng - bounds.minLng) / (cols + 1);

  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;

  // Base intensity derived from simulated rainfall
  const baseIntensity = Math.min(100, Math.max(5, (simulatedRainfallMm / 600) * 100));

  let cellIndex = 0;
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const lat = bounds.minLat + r * latStep;
      const lng = bounds.minLng + c * lngStep;

      // Distance from storm center
      const dLat = (lat - centerLat) / (bounds.maxLat - bounds.minLat);
      const dLng = (lng - centerLng) / (bounds.maxLng - bounds.minLng);
      const distSq = dLat * dLat + dLng * dLng;

      // Bell curve falloff
      const rawIntensity = baseIntensity * Math.exp(-distSq * 6) * intensityScale;
      const jitter = (Math.sin(r * 2.5 + c * 3.1) * 0.15 + 1);
      const intensity = Math.min(100, Math.max(0, Math.round(rawIntensity * jitter)));

      if (intensity > 4) {
        cells.push({
          id: `radar-cell-${cellIndex++}`,
          lat: Math.round(lat * 100000) / 100000,
          lng: Math.round(lng * 100000) / 100000,
          intensity,
          precipitationRateMmH: Math.round((intensity / 10) * 10) / 10,
          radiusKm: 4.5,
        });
      }
    }
  }

  return cells;
}

/**
 * Formats a coordinate into human-readable cardinal degrees string.
 */
export function formatCoordinates(coord: LatLng): string {
  const latDir = coord.lat >= 0 ? "N" : "S";
  const lngDir = coord.lng >= 0 ? "E" : "W";
  const absLat = Math.abs(coord.lat).toFixed(4);
  const absLng = Math.abs(coord.lng).toFixed(4);
  return `${absLat}° ${latDir}, ${absLng}° ${lngDir}`;
}
