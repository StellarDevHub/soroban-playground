// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file SatelliteWeatherMap.tsx
 * Interactive GIS satellite weather map component displaying insured agricultural
 * parcel polygons, live Doppler rainfall radar sweep overlay, and precipitation isohyet contours.
 */

"use client";

import React, { useId, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Layers,
  MapPin,
  Maximize2,
  Minus,
  Navigation,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Sliders,
  Wind,
} from "lucide-react";
import type {
  AgriculturalParcel,
  BoundingBox,
  MapLayerOptions,
  PrecipitationContour,
  WeatherRadarCell,
} from "../../types/insurance";
import {
  calculateBoundingBox,
  formatCoordinates,
  generateContourLines,
  generateRadarCells,
  polygonToSvgPath,
  projectCoordinate,
  unprojectCoordinate,
} from "../../lib/insurance/geoProjection";

interface SatelliteWeatherMapProps {
  parcels: AgriculturalParcel[];
  selectedParcelId: string | null;
  onSelectParcel: (parcelId: string) => void;
  simulatedRainfallMm: number;
  droughtThresholdMm: number;
  floodThresholdMm: number;
  isDroughtTriggered: boolean;
  isFloodTriggered: boolean;
}

export default function SatelliteWeatherMap({
  parcels,
  selectedParcelId,
  onSelectParcel,
  simulatedRainfallMm,
  droughtThresholdMm,
  floodThresholdMm,
  isDroughtTriggered,
  isFloodTriggered,
}: SatelliteWeatherMapProps) {
  const radarAnimId = useId();
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Map viewport dimensions
  const viewWidth = 840;
  const viewHeight = 520;

  // Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Hover state
  const [hoveredParcel, setHoveredParcel] = useState<AgriculturalParcel | null>(null);
  const [cursorGeo, setCursorGeo] = useState<{ lat: number; lng: number } | null>(null);

  // Layer toggles
  const [layers, setLayers] = useState<MapLayerOptions>({
    showSatellite: true,
    showRadar: true,
    showContours: true,
    showParcels: true,
    showSoilHeatmap: false,
    radarOpacity: 0.65,
    isRadarPlaying: true,
  });

  // Calculate bounding box for all parcels
  const baseBounds: BoundingBox = useMemo(() => {
    const allCoords = parcels.flatMap((p) => p.coordinates);
    return calculateBoundingBox(allCoords, 0.15);
  }, [parcels]);

  // Adjust bounds based on zoom & pan
  const currentBounds: BoundingBox = useMemo(() => {
    const latSpan = (baseBounds.maxLat - baseBounds.minLat) / zoomLevel;
    const lngSpan = (baseBounds.maxLng - baseBounds.minLng) / zoomLevel;
    const centerLat = (baseBounds.minLat + baseBounds.maxLat) / 2 - (panOffset.y / viewHeight) * latSpan;
    const centerLng = (baseBounds.minLng + baseBounds.maxLng) / 2 + (panOffset.x / viewWidth) * lngSpan;

    return {
      minLat: centerLat - latSpan / 2,
      maxLat: centerLat + latSpan / 2,
      minLng: centerLng - lngSpan / 2,
      maxLng: centerLng + lngSpan / 2,
    };
  }, [baseBounds, zoomLevel, panOffset]);

  // Generated weather contours and radar cells
  const contours: PrecipitationContour[] = useMemo(() => {
    return generateContourLines(currentBounds, simulatedRainfallMm);
  }, [currentBounds, simulatedRainfallMm]);

  const radarCells: WeatherRadarCell[] = useMemo(() => {
    return generateRadarCells(currentBounds, simulatedRainfallMm);
  }, [currentBounds, simulatedRainfallMm]);

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }

    if (mapContainerRef.current) {
      const rect = mapContainerRef.current.getBoundingClientRect();
      const screenX = ((e.clientX - rect.left) / rect.width) * viewWidth;
      const screenY = ((e.clientY - rect.top) / rect.height) * viewHeight;
      const geo = unprojectCoordinate(
        { x: screenX, y: screenY },
        currentBounds,
        viewWidth,
        viewHeight,
      );
      setCursorGeo(geo);
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const resetView = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const toggleLayer = (key: keyof MapLayerOptions) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Grid line graticules
  const graticules = useMemo(() => {
    const latLines: { lat: number; y: number }[] = [];
    const lngLines: { lng: number; x: number }[] = [];
    const latStep = (currentBounds.maxLat - currentBounds.minLat) / 4;
    const lngStep = (currentBounds.maxLng - currentBounds.minLng) / 5;

    for (let i = 1; i <= 3; i++) {
      const lat = currentBounds.minLat + i * latStep;
      const pt = projectCoordinate({ lat, lng: currentBounds.minLng }, currentBounds, viewWidth, viewHeight);
      latLines.push({ lat: Math.round(lat * 100) / 100, y: pt.y });
    }

    for (let i = 1; i <= 4; i++) {
      const lng = currentBounds.minLng + i * lngStep;
      const pt = projectCoordinate({ lat: currentBounds.minLat, lng }, currentBounds, viewWidth, viewHeight);
      lngLines.push({ lng: Math.round(lng * 100) / 100, x: pt.x });
    }

    return { latLines, lngLines };
  }, [currentBounds]);

  return (
    <div
      className="relative flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden select-none"
      data-testid="satellite-weather-map-container"
    >
      {/* Map Control Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950/80 border-b border-slate-800 backdrop-blur-sm z-20">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              Satellite Weather Telemetry
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                LIVE ORACLE
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              High-resolution precipitation radar & parcel boundary monitor
            </p>
          </div>
        </div>

        {/* Layer Toggles & Action Controls */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => toggleLayer("showSatellite")}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
              layers.showSatellite
                ? "bg-slate-800 text-sky-400 border border-sky-500/30 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
            data-testid="toggle-layer-satellite"
            title="Toggle Satellite Imagery"
          >
            Satellite
          </button>
          <button
            type="button"
            onClick={() => toggleLayer("showRadar")}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors flex items-center gap-1 ${
              layers.showRadar
                ? "bg-sky-600/30 text-sky-300 border border-sky-500/50 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
            data-testid="toggle-layer-radar"
            title="Toggle Radar Reflectivity"
          >
            <Radio className="w-3 h-3" />
            Radar
          </button>
          <button
            type="button"
            onClick={() => toggleLayer("showContours")}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
              layers.showContours
                ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
            data-testid="toggle-layer-contours"
            title="Toggle Rainfall Isohyet Contours"
          >
            Contours
          </button>
          <button
            type="button"
            onClick={() => toggleLayer("showParcels")}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
              layers.showParcels
                ? "bg-amber-600/30 text-amber-300 border border-amber-500/50 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
            data-testid="toggle-layer-parcels"
            title="Toggle Insured Parcels"
          >
            Parcels
          </button>
        </div>

        {/* Zoom & View Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 3.5))}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            data-testid="map-zoom-in"
            aria-label="Zoom in"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 0.75))}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            data-testid="map-zoom-out"
            aria-label="Zoom out"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={resetView}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            data-testid="map-reset-view"
            title="Reset map view"
            aria-label="Reset view"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Interactive Map Canvas / SVG Area */}
      <div
        ref={mapContainerRef}
        className="relative w-full h-[460px] md:h-[500px] bg-slate-950 overflow-hidden cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        data-testid="interactive-map-viewport"
      >
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
          data-testid="weather-map-svg"
        >
          <defs>
            {/* Topographic Background Gradient */}
            <radialGradient id="satellite-base-grad" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stopColor="#0c1929" />
              <stop offset="60%" stopColor="#06101e" />
              <stop offset="100%" stopColor="#020617" />
            </radialGradient>

            {/* Radar Sweep Animated Gradient */}
            <radialGradient
              id={`radar-sweep-${radarAnimId}`}
              cx="50%"
              cy="50%"
              r="50%"
            >
              <stop offset="0%" stopColor="rgba(56, 189, 248, 0)" />
              <stop offset="70%" stopColor="rgba(56, 189, 248, 0.15)" />
              <stop offset="100%" stopColor="rgba(56, 189, 248, 0.45)" />
            </radialGradient>

            {/* Pulsing Trigger Glow */}
            <filter id="trigger-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* LAYER 1: Satellite & Topographic Base */}
          {layers.showSatellite && (
            <g id="layer-satellite-base">
              <rect
                width={viewWidth}
                height={viewHeight}
                fill="url(#satellite-base-grad)"
              />
              {/* Synthetic Terrain Contours */}
              <circle
                cx={viewWidth * 0.45}
                cy={viewHeight * 0.52}
                r={240}
                fill="none"
                stroke="rgba(30, 58, 138, 0.2)"
                strokeWidth="1.5"
                strokeDasharray="4 8"
              />
              <circle
                cx={viewWidth * 0.45}
                cy={viewHeight * 0.52}
                r={160}
                fill="none"
                stroke="rgba(30, 58, 138, 0.25)"
                strokeWidth="1"
              />
              <circle
                cx={viewWidth * 0.45}
                cy={viewHeight * 0.52}
                r={80}
                fill="none"
                stroke="rgba(30, 58, 138, 0.3)"
                strokeWidth="1"
              />
            </g>
          )}

          {/* Graticule Grid Lines & Labels */}
          <g id="layer-graticules" stroke="rgba(71, 85, 105, 0.3)" strokeWidth="0.75" strokeDasharray="3 3">
            {graticules.latLines.map((gl) => (
              <g key={`lat-${gl.lat}`}>
                <line x1={0} y1={gl.y} x2={viewWidth} y2={gl.y} />
                <text
                  x={12}
                  y={gl.y - 4}
                  fill="rgba(148, 163, 184, 0.5)"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {gl.lat.toFixed(2)}° N
                </text>
              </g>
            ))}
            {graticules.lngLines.map((gl) => (
              <g key={`lng-${gl.lng}`}>
                <line x1={gl.x} y1={0} x2={gl.x} y2={viewHeight} />
                <text
                  x={gl.x + 4}
                  y={viewHeight - 10}
                  fill="rgba(148, 163, 184, 0.5)"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {Math.abs(gl.lng).toFixed(2)}° W
                </text>
              </g>
            ))}
          </g>

          {/* LAYER 2: Precipitation Contours (Isohyets) */}
          {layers.showContours && (
            <g id="layer-precipitation-contours" data-testid="layer-contours">
              {contours.map((contour) =>
                contour.paths.map((pathCoords, pIdx) => {
                  const svgPath = polygonToSvgPath(
                    pathCoords,
                    currentBounds,
                    viewWidth,
                    viewHeight,
                  );
                  return (
                    <g key={`contour-${contour.levelMm}-${pIdx}`}>
                      <path
                        d={svgPath}
                        fill="none"
                        stroke={contour.color}
                        strokeWidth="1.5"
                        strokeDasharray="2 4"
                        opacity={0.8}
                      />
                    </g>
                  );
                }),
              )}
            </g>
          )}

          {/* LAYER 3: Weather Radar Reflectivity */}
          {layers.showRadar && (
            <g
              id="layer-weather-radar"
              opacity={layers.radarOpacity}
              data-testid="layer-radar"
            >
              {/* Radar sweep beam */}
              <circle
                cx={viewWidth / 2}
                cy={viewHeight / 2}
                r={viewWidth * 0.42}
                fill={`url(#radar-sweep-${radarAnimId})`}
                className={layers.isRadarPlaying ? "animate-spin origin-center" : ""}
                style={{ animationDuration: "8s" }}
              />

              {/* Dynamic Doppler precipitation cells */}
              {radarCells.map((cell) => {
                const pt = projectCoordinate(
                  { lat: cell.lat, lng: cell.lng },
                  currentBounds,
                  viewWidth,
                  viewHeight,
                );
                // Color ramp from cyan to yellow to deep red
                let fill = "rgba(56, 189, 248, 0.4)";
                if (cell.intensity > 75) fill = "rgba(239, 68, 68, 0.75)";
                else if (cell.intensity > 55) fill = "rgba(249, 115, 22, 0.65)";
                else if (cell.intensity > 35) fill = "rgba(234, 179, 8, 0.55)";
                else if (cell.intensity > 15) fill = "rgba(34, 197, 94, 0.45)";

                const radius = Math.max(12, (cell.intensity / 100) * 28 * zoomLevel);

                return (
                  <circle
                    key={cell.id}
                    cx={pt.x}
                    cy={pt.y}
                    r={radius}
                    fill={fill}
                    filter="blur(5px)"
                  />
                );
              })}
            </g>
          )}

          {/* LAYER 4: Agricultural Parcel Polygons */}
          {layers.showParcels && (
            <g id="layer-agricultural-parcels" data-testid="layer-parcels">
              {parcels.map((parcel) => {
                const svgPath = polygonToSvgPath(
                  parcel.coordinates,
                  currentBounds,
                  viewWidth,
                  viewHeight,
                );
                const isSelected = parcel.id === selectedParcelId;
                const isHovered = hoveredParcel?.id === parcel.id;
                const centroidPt = projectCoordinate(
                  parcel.centroid,
                  currentBounds,
                  viewWidth,
                  viewHeight,
                );

                // Determine parcel status coloring
                let strokeColor = "#10b981"; // Emerald safe
                let fillColor = "rgba(16, 185, 129, 0.18)";

                if (isDroughtTriggered) {
                  strokeColor = "#f43f5e"; // Rose / red drought
                  fillColor = "rgba(244, 63, 94, 0.35)";
                } else if (isFloodTriggered) {
                  strokeColor = "#3b82f6"; // Blue flood
                  fillColor = "rgba(59, 130, 246, 0.35)";
                } else if (simulatedRainfallMm < parcel.droughtThresholdMm * 1.2) {
                  strokeColor = "#f59e0b"; // Amber warning
                  fillColor = "rgba(245, 158, 11, 0.25)";
                }

                if (isSelected) {
                  strokeColor = "#38bdf8"; // Sky blue highlight
                  fillColor = "rgba(56, 189, 248, 0.38)";
                }

                return (
                  <g
                    key={parcel.id}
                    onClick={() => onSelectParcel(parcel.id)}
                    onMouseEnter={() => setHoveredParcel(parcel)}
                    onMouseLeave={() => setHoveredParcel(null)}
                    className="cursor-pointer transition-all duration-200"
                    data-testid={`parcel-polygon-${parcel.id}`}
                  >
                    <path
                      d={svgPath}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 1.8}
                      filter={isSelected || isDroughtTriggered ? "url(#trigger-glow)" : undefined}
                      className="transition-colors duration-150"
                    />

                    {/* Centroid Marker & Parcel Tag */}
                    <circle
                      cx={centroidPt.x}
                      cy={centroidPt.y}
                      r={isSelected ? 5 : 3.5}
                      fill={strokeColor}
                      stroke="#0f172a"
                      strokeWidth="1.5"
                    />
                    <text
                      x={centroidPt.x}
                      y={centroidPt.y - 10}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={isSelected ? "11" : "10"}
                      fontWeight={isSelected ? "bold" : "normal"}
                      className="pointer-events-none drop-shadow"
                    >
                      {parcel.cropType} ({parcel.areaHectares} ha)
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* Compass Rose */}
          <g transform={`translate(${viewWidth - 45}, 45)`} className="pointer-events-none">
            <circle cx="0" cy="0" r="18" fill="rgba(15, 23, 42, 0.7)" stroke="#334155" strokeWidth="1" />
            <polygon points="0,-14 4,-2 0,0 -4,-2" fill="#ef4444" />
            <polygon points="0,14 4,2 0,0 -4,2" fill="#94a3b8" />
            <text x="0" y="-16" textAnchor="middle" fill="#ef4444" fontSize="9" fontWeight="bold">
              N
            </text>
          </g>
        </svg>

        {/* Live Cursor Coordinate HUD */}
        <div
          className="absolute bottom-3 left-3 px-3 py-1.5 rounded-xl bg-slate-950/85 border border-slate-800 text-[11px] font-mono text-slate-300 backdrop-blur-md flex items-center gap-2 shadow-lg z-10"
          data-testid="cursor-coordinates-hud"
        >
          <MapPin className="w-3.5 h-3.5 text-sky-400" />
          <span>
            {cursorGeo
              ? formatCoordinates(cursorGeo)
              : "Move cursor over map to inspect coordinates"}
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-400 font-medium">
            Zoom: {Math.round(zoomLevel * 100)}%
          </span>
        </div>

        {/* Radar Legend & Status Bar */}
        <div
          className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-slate-950/85 border border-slate-800 text-xs backdrop-blur-md flex items-center gap-2.5 shadow-lg z-10"
          data-testid="radar-legend-bar"
        >
          <span className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
            Radar dBZ:
          </span>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-sky-400" title="Light drizzle" />
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" title="Moderate rain" />
            <span className="w-2.5 h-2.5 rounded-sm bg-yellow-400" title="Heavy rain" />
            <span className="w-2.5 h-2.5 rounded-sm bg-orange-500" title="Intense downpour" />
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-600" title="Severe storm / Flood risk" />
          </div>
          <span className="text-slate-500 text-[10px]">0 → 65+</span>
        </div>

        {/* Hovered Parcel Floating Tooltip */}
        {hoveredParcel && (
          <div
            className="absolute top-4 left-4 p-3 rounded-xl bg-slate-900/95 border border-sky-500/40 text-xs text-white shadow-2xl backdrop-blur-md pointer-events-none z-30 space-y-1 max-w-xs animate-in fade-in"
            data-testid="parcel-hover-tooltip"
          >
            <div className="font-semibold text-sky-400 flex items-center justify-between">
              <span>{hoveredParcel.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300">
                {hoveredParcel.cropType}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 text-[11px] text-slate-300">
              <div>Area: {hoveredParcel.areaHectares} ha</div>
              <div>Elevation: {hoveredParcel.elevationMeters}m</div>
              <div>Coverage: ${hoveredParcel.insuredValue.toLocaleString()} USDC</div>
              <div>Drought Trg: {hoveredParcel.droughtThresholdMm}mm</div>
            </div>
          </div>
        )}
      </div>

      {/* Map Footer Toolbar: Radar animation toggle & Opacity */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950 border-t border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLayers((l) => ({ ...l, isRadarPlaying: !l.isRadarPlaying }))}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            data-testid="radar-play-pause-button"
          >
            {layers.isRadarPlaying ? (
              <>
                <Pause className="w-3 h-3 text-amber-400" />
                <span>Pause Sweep</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 text-emerald-400" />
                <span>Resume Sweep</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <span className="text-[11px]">Radar Opacity:</span>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={layers.radarOpacity}
              onChange={(e) =>
                setLayers((l) => ({ ...l, radarOpacity: parseFloat(e.target.value) }))
              }
              className="w-20 accent-sky-400 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              data-testid="radar-opacity-slider"
              aria-label="Radar opacity"
            />
            <span className="text-[11px] font-mono text-slate-300">
              {Math.round(layers.radarOpacity * 100)}%
            </span>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 font-mono">
          EPSG:4326 WGS-84 • Projection: Mercator
        </div>
      </div>
    </div>
  );
}
