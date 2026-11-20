// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file geoProjection.node.test.ts
 * Node-based unit test suite for GIS projection math, bounding box algorithms,
 * point-in-polygon hit detection, and SVG path generation.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateBoundingBox,
  calculateCentroid,
  calculatePolygonAreaHectares,
  formatCoordinates,
  generateContourLines,
  generateRadarCells,
  isPointInPolygon,
  polygonToSvgPath,
  projectCoordinate,
  unprojectCoordinate,
} from "../../lib/insurance/geoProjection.ts";
import type { BoundingBox, LatLng } from "../../types/insurance.ts";

test("calculateBoundingBox accurately computes spatial boundaries with padding", () => {
  const points: LatLng[] = [
    { lat: 40.0, lng: -90.0 },
    { lat: 42.0, lng: -90.0 },
    { lat: 42.0, lng: -88.0 },
    { lat: 40.0, lng: -88.0 },
  ];

  const boundsNoPad = calculateBoundingBox(points, 0);
  assert.equal(boundsNoPad.minLat, 40.0);
  assert.equal(boundsNoPad.maxLat, 42.0);
  assert.equal(boundsNoPad.minLng, -90.0);
  assert.equal(boundsNoPad.maxLng, -88.0);

  const boundsWithPad = calculateBoundingBox(points, 0.1);
  assert.ok(boundsWithPad.minLat < 40.0, "Padded minLat must be lower than 40.0");
  assert.ok(boundsWithPad.maxLat > 42.0, "Padded maxLat must be higher than 42.0");
  assert.ok(boundsWithPad.minLng < -90.0, "Padded minLng must be lower than -90.0");
  assert.ok(boundsWithPad.maxLng > -88.0, "Padded maxLng must be higher than -88.0");
});

test("calculateBoundingBox handles empty or single-point coordinates gracefully", () => {
  const emptyBounds = calculateBoundingBox([]);
  assert.equal(emptyBounds.minLat, 0);
  assert.equal(emptyBounds.maxLat, 1);

  const singlePointBounds = calculateBoundingBox([{ lat: 35.5, lng: -105.2 }]);
  assert.ok(singlePointBounds.minLat <= 35.5);
  assert.ok(singlePointBounds.maxLat >= 35.5);
});

test("projectCoordinate and unprojectCoordinate perform high-precision roundtrips", () => {
  const bounds: BoundingBox = {
    minLat: 41.5,
    maxLat: 42.5,
    minLng: -94.0,
    maxLng: -93.0,
  };
  const width = 800;
  const height = 500;

  // Center point
  const coord: LatLng = { lat: 42.0, lng: -93.5 };
  const screenPt = projectCoordinate(coord, bounds, width, height);

  assert.equal(screenPt.x, 400, "Center lng should project to width / 2");
  assert.equal(screenPt.y, 250, "Center lat should project to height / 2");

  // Invert back to geo
  const unprojected = unprojectCoordinate(screenPt, bounds, width, height);
  assert.ok(Math.abs(unprojected.lat - coord.lat) < 0.001, "Latitude must roundtrip");
  assert.ok(Math.abs(unprojected.lng - coord.lng) < 0.001, "Longitude must roundtrip");

  // Top-left boundary: maxLat, minLng -> (0, 0)
  const topLeftCoord: LatLng = { lat: bounds.maxLat, lng: bounds.minLng };
  const topLeftPt = projectCoordinate(topLeftCoord, bounds, width, height);
  assert.equal(topLeftPt.x, 0);
  assert.equal(topLeftPt.y, 0);
});

test("calculateCentroid accurately computes center of mass for parcel coordinates", () => {
  const square: LatLng[] = [
    { lat: 10, lng: 10 },
    { lat: 20, lng: 10 },
    { lat: 20, lng: 20 },
    { lat: 10, lng: 20 },
  ];

  const centroid = calculateCentroid(square);
  assert.equal(centroid.lat, 15);
  assert.equal(centroid.lng, 15);
});

test("isPointInPolygon accurately detects interior and exterior points", () => {
  const polygon: LatLng[] = [
    { lat: 42.0, lng: -94.0 },
    { lat: 42.5, lng: -94.0 },
    { lat: 42.5, lng: -93.0 },
    { lat: 42.0, lng: -93.0 },
  ];

  // Point clearly inside
  assert.equal(
    isPointInPolygon({ lat: 42.25, lng: -93.5 }, polygon),
    true,
    "Interior point must return true",
  );

  // Point clearly outside (north)
  assert.equal(
    isPointInPolygon({ lat: 43.0, lng: -93.5 }, polygon),
    false,
    "Exterior point must return false",
  );

  // Point clearly outside (east)
  assert.equal(
    isPointInPolygon({ lat: 42.25, lng: -92.5 }, polygon),
    false,
    "Exterior point must return false",
  );
});

test("polygonToSvgPath outputs valid SVG path markup", () => {
  const bounds: BoundingBox = {
    minLat: 40,
    maxLat: 45,
    minLng: -95,
    maxLng: -90,
  };
  const polygon: LatLng[] = [
    { lat: 41, lng: -94 },
    { lat: 43, lng: -94 },
    { lat: 43, lng: -92 },
    { lat: 41, lng: -92 },
  ];

  const svgPath = polygonToSvgPath(polygon, bounds, 800, 500);
  assert.ok(svgPath.startsWith("M "), "Must start with Move to 'M'");
  assert.ok(svgPath.includes(" L "), "Must include Line to 'L'");
  assert.ok(svgPath.endsWith(" Z"), "Must terminate with Close Path 'Z'");
});

test("calculatePolygonAreaHectares calculates positive realistic area", () => {
  // Approximately 0.05 deg x 0.05 deg parcel (~5.5km x ~4.1km ~= ~2,200 ha)
  const parcelCoords: LatLng[] = [
    { lat: 42.0, lng: -93.5 },
    { lat: 42.05, lng: -93.5 },
    { lat: 42.05, lng: -93.45 },
    { lat: 42.0, lng: -93.45 },
  ];

  const areaHa = calculatePolygonAreaHectares(parcelCoords);
  assert.ok(areaHa > 1000, "Parcel area should be > 1000 ha");
  assert.ok(areaHa < 4000, "Parcel area should be < 4000 ha");
});

test("generateContourLines produces multi-level isohyets", () => {
  const bounds: BoundingBox = {
    minLat: 41.8,
    maxLat: 42.4,
    minLng: -93.9,
    maxLng: -93.3,
  };

  const contours = generateContourLines(bounds, 400);
  assert.ok(contours.length >= 3, "Should produce at least 3 contour levels for 400mm rainfall");
  assert.ok(contours.some((c) => c.levelMm === 50));
  assert.ok(contours.some((c) => c.levelMm === 100));

  for (const c of contours) {
    assert.ok(c.label.includes("mm"));
    assert.ok(c.paths[0].length >= 10, "Contour ring must have resolution points");
  }
});

test("generateRadarCells distributes precipitation cells with valid reflectivity", () => {
  const bounds: BoundingBox = {
    minLat: 41.8,
    maxLat: 42.4,
    minLng: -93.9,
    maxLng: -93.3,
  };

  const cells = generateRadarCells(bounds, 350);
  assert.ok(cells.length > 0, "Must generate radar cells for 350mm rainfall");

  for (const cell of cells) {
    assert.ok(cell.intensity >= 0 && cell.intensity <= 100, "Intensity must be 0-100");
    assert.ok(cell.precipitationRateMmH >= 0);
  }
});

test("formatCoordinates formats LatLng into cardinal degrees", () => {
  const coord: LatLng = { lat: 42.062, lng: -93.68 };
  const formatted = formatCoordinates(coord);
  assert.equal(formatted, "42.0620° N, 93.6800° W");

  const southernEastern: LatLng = { lat: -23.5505, lng: 46.6333 };
  const formattedSE = formatCoordinates(southernEastern);
  assert.equal(formattedSE, "23.5505° S, 46.6333° E");
});
