import { prisma } from '../db/prisma';
import { Clinic } from '@prisma/client';

export async function findClinicByUssdCode(ussdCode: string): Promise<Clinic | null> {
  const clinic = await prisma.clinic.findUnique({ where: { ussdCode } });
  if (!clinic || !clinic.isActive) return null;
  return clinic;
}
