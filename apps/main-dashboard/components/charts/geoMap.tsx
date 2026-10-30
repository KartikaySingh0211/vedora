"use client";

import React, { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { motion, AnimatePresence } from "framer-motion";

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const ISO2_TO_COUNTRY_NAME: Record<string, string> = {
  US: "United States of America",
  IN: "India",
  GB: "United Kingdom",
  CA: "Canada",
  DE: "Germany",
  FR: "France",
  AU: "Australia",
  JP: "Japan",
  BR: "Brazil",
  SG: "Singapore",
  NL: "Netherlands",
  ES: "Spain",
  IT: "Italy",
  MX: "Mexico",
  AE: "United Arab Emirates",
  KR: "South Korea",
  CN: "China",
  ID: "Indonesia",
  PK: "Pakistan",
  NG: "Nigeria",
  BD: "Bangladesh",
  RU: "Russia",
  ZA: "South Africa",
  TR: "Turkey",
  SA: "Saudi Arabia",
  EG: "Egypt",
  TH: "Thailand",
  VN: "Vietnam",
  PH: "Philippines",
  MY: "Malaysia",
  CO: "Colombia",
  AR: "Argentina",
  PL: "Poland",
  SE: "Sweden",
  CH: "Switzerland",
  BE: "Belgium",
  AT: "Austria",
  CL: "Chile",
  NZ: "New Zealand",
  IE: "Ireland",
  PT: "Portugal",
  NO: "Norway",
  FI: "Finland",
  DK: "Denmark",
  CZ: "Czech Republic",
  GR: "Greece",
  IL: "Israel",
  KE: "Kenya",
  UA: "Ukraine",
};

export interface GeoCountryData {
  name: string;
  visitors: number;
}

interface GeographicalMapProps {
  data?: GeoCountryData[];
  isLoading?: boolean;
}

const GeographicalMap: React.FC<GeographicalMapProps> = ({
  data = [],
  isLoading = false,
}) => {
  const [hovered, setHovered] = useState<{
    name: string;
    visitors: number;
  } | null>(null);

  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Normalize incoming country codes and names
  const normalizedCountryMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of data) {
      const codeOrName = item.name.trim();
      const codeUpper = codeOrName.toUpperCase();
      const resolvedName = ISO2_TO_COUNTRY_NAME[codeUpper] || codeOrName;
      map.set(resolvedName.toLowerCase(), item.visitors);
      map.set(codeOrName.toLowerCase(), item.visitors);
    }
    return map;
  }, [data]);

  const getColor = (countryName: string) => {
    const visitors = normalizedCountryMap.get(countryName.toLowerCase());
    if (!visitors || visitors <= 0) return "#1e293b";
    return "oklch(62.3% 0.214 259.815)";
  };

  const hasTraffic = data.length > 0 && data.some((d) => d.visitors > 0);

  return (
    <div className="relative w-full -ml-[5%] px-0 py-5 overflow-visible">
      {isLoading ? (
        <div className="w-full h-[35vh] flex items-center justify-center text-sm text-gray-500 animate-pulse">
          Loading geography data...
        </div>
      ) : (
        <>
          <ComposableMap
            projection="geoEqualEarth"
            projectionConfig={{ scale: 230, center: [0, 10] }}
            width={1400}
            height={500}
            viewBox="0 0 1400 500"
            preserveAspectRatio="xMidYMid slice"
            style={{
              width: "100%",
              height: "35vh",
              background: "transparent",
              margin: 0,
              padding: 0,
              display: "block",
            }}
          >
            <Geographies geography={geoUrl}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const countryName = geo.properties?.name || "Unknown";
                  const visitors =
                    normalizedCountryMap.get(countryName.toLowerCase()) || 0;
                  const baseColor = getColor(countryName);
                  const isHovered = hovered?.name === countryName;
                  const fillColor = isHovered
                    ? visitors > 0
                      ? baseColor
                      : "#334155"
                    : baseColor;

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onMouseEnter={(e) => {
                        setTooltipPosition({ x: e.pageX, y: e.pageY });
                        setHovered({
                          name: countryName,
                          visitors,
                        });
                      }}
                      onMouseMove={(e) => {
                        setTooltipPosition({ x: e.pageX, y: e.pageY });
                      }}
                      onMouseLeave={() => setHovered(null)}
                      fill={fillColor}
                      stroke="#334155"
                      className="focus:outline-none active:fill-[#ef4444]"
                      style={{
                        outline: "none",
                        transition: "fill 0.3s ease-in-out",
                        cursor: "pointer",
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ComposableMap>

          {!hasTraffic && (
            <div className="text-center mt-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-[#1a1c22] px-3 py-1 rounded-full border border-gray-200 dark:border-gray-800">
                No visitor traffic recorded yet
              </span>
            </div>
          )}
        </>
      )}

      {/* Tooltip with animation */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            key={hovered.name}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed bg-gray-800 text-white text-xs p-2 rounded! shadow-lg pointer-events-none z-9999"
            style={{
              top: tooltipPosition.y,
              left: tooltipPosition.x,
            }}
          >
            <strong>{hovered.name}</strong>
            <br />
            Visitors: <span className="text-green-400">{hovered.visitors}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GeographicalMap;
