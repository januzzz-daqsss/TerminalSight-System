export type RoiOverlay = {
    width: number; height: number; normalization: string;
    polygons: { id: string; direction: string; points: [number, number][] }[];
};

/** Browser and SVG use the same decoded dimensions and centered contain fit. */
export function scaledRoi(roi: RoiOverlay | undefined, width: number, height: number) {
    if (!roi || !width || !height || roi.width !== width || roi.height !== height || roi.normalization !== 'x/width, y/height') return [];
    return roi.polygons.map(bay => ({
        id: bay.id,
        points: bay.points.map(([x, y]) => [x * width, y * height] as [number, number]),
    }));
}
