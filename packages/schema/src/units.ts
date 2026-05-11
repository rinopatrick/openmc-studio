import type { DensityUnit, EnergyUnit, LengthUnit, Quantity } from './model.js';

const lengthToMeters: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
};

const energyToEv: Record<EnergyUnit, number> = {
  eV: 1,
  keV: 1_000,
  MeV: 1_000_000,
};

export function toMeters(quantity: Quantity<LengthUnit>): number {
  return quantity.value * lengthToMeters[quantity.unit];
}

export function fromMeters(value: number, unit: LengthUnit): Quantity<LengthUnit> {
  return { value: value / lengthToMeters[unit], unit };
}

export function toEv(quantity: Quantity<EnergyUnit>): number {
  return quantity.value * energyToEv[quantity.unit];
}

export function fromEv(value: number, unit: EnergyUnit): Quantity<EnergyUnit> {
  return { value: value / energyToEv[unit], unit };
}

export function normalizeDensity(quantity: Quantity<DensityUnit>): Quantity<DensityUnit> {
  if (!Number.isFinite(quantity.value) || quantity.value <= 0) {
    throw new Error('Density must be a positive finite number.');
  }

  return quantity;
}
