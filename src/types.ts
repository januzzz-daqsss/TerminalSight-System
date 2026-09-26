export type BayState = "Available" | "Occupied" | "Overstaying";
export type VehicleClass = "Bus" | "UV Express";

export interface Bay {
  id: number;
  type: "Northbound" | "Southbound";
  status: BayState;
  vehicleType?: VehicleClass | null;
  sessionId?: string | null;
  route?: string | null;
  routeDetails?: string[];
  ocrState?: "Detecting" | "Recognized" | "Unknown" | null;
  ocrConfidence?: number | null;
  elapsedSeconds?: number;
  /** seconds remaining (positive = occupied, negative = overstaying) */
  timeRemaining?: number | null;
  audioPlayed?: boolean;
}

export interface Detection {
  id: number;
  time: string;
  vehicle: VehicleClass;
  slot: number;
  action: string;
}
