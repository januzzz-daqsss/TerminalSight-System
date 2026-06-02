import { Bay, Detection } from "./types";

export const initialBays: Bay[] = [
  { id: 1, type: "Northbound", status: "Available", timeRemaining: 0 },
  { id: 2, type: "Northbound", status: "Available", timeRemaining: 0 },
  { id: 3, type: "Northbound", status: "Available", timeRemaining: 0 },
  { id: 4, type: "Northbound", status: "Available", timeRemaining: 0 },
  { id: 5, type: "Northbound", status: "Available", timeRemaining: 0 },
  { id: 6, type: "Southbound", status: "Available", timeRemaining: 0 },
  { id: 7, type: "Southbound", status: "Available", timeRemaining: 0 },
  { id: 8, type: "Southbound", status: "Available", timeRemaining: 0 },
  { id: 9, type: "Southbound", status: "Available", timeRemaining: 0 },
  { id: 10, type: "Southbound", status: "Available", timeRemaining: 0 },
];

export const DETECTIONS: Detection[] = [
  {
    id: 1,
    time: "11:18 PM",
    vehicle: "Bus",
    slot: 10,
    action: "Detected & Docked",
  },
  {
    id: 2,
    time: "11:15 PM",
    vehicle: "UV Express",
    slot: 8,
    action: "Detected & Docked",
  },
  {
    id: 3,
    time: "11:09 PM",
    vehicle: "Bus",
    slot: 6,
    action: "Detected & Docked",
  },
  {
    id: 4,
    time: "11:04 PM",
    vehicle: "UV Express",
    slot: 4,
    action: "Detected & Docked",
  },
  {
    id: 5,
    time: "10:58 PM",
    vehicle: "Bus",
    slot: 1,
    action: "Detected & Docked",
  },
  {
    id: 6,
    time: "10:47 PM",
    vehicle: "UV Express",
    slot: 3,
    action: "Overstay Flagged",
  },
  {
    id: 7,
    time: "10:30 PM",
    vehicle: "Bus",
    slot: 7,
    action: "Overstay Flagged",
  },
];
