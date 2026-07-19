import type { Landmark2D } from "../tracking/tracking-types";

const PALM_INDICES = [0, 5, 9, 13, 17] as const;

export function calculatePalmCursor(
  landmarks: readonly Landmark2D[],
): Landmark2D | null {
  const points = PALM_INDICES.map((index) => landmarks[index]).filter(
    (point): point is Landmark2D => point !== undefined,
  );
  if (points.length !== PALM_INDICES.length) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    zRelative: points.reduce((sum, point) => sum + point.zRelative, 0) / points.length,
  };
}
