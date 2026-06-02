export type BayState = "Available" | "Occupied" | "Overstaying";
export type VehicleClass = "Bus" | "UV Express";

export interface Bay {
  id: number;
  type: "Northbound" | "Southbound";
  status: BayState;
  vehicleType?: VehicleClass;
  /** seconds remaining (positive = occupied, negative = overstaying) */
  timeRemaining?: number;
  audioPlayed?: boolean;
}

export interface Detection {
  id: number;
  time: string;
  vehicle: VehicleClass;
  slot: number;
  action: string;
}
