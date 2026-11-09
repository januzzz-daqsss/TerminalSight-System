// Presentation metadata for the current sample setup in detector.py.
// Update this alongside camera/polygon integration when coverage changes.
// This does not configure cameras or change backend occupancy data.
export const SAMPLE_CAMERA_BAYS: Readonly<Record<number, number>> = { 1: 1, 2: 6 };

export function isSampleMonitoredBay(bayId: number): boolean {
    return Object.values(SAMPLE_CAMERA_BAYS).includes(bayId);
}
