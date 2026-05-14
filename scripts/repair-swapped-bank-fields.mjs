#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const looksLikeAccountNumber = (value) =>
  typeof value === 'string' && /^[0-9 .-]+$/.test(value.trim()) && /\d{5,}/.test(value);

const looksLikeAccountName = (value) =>
  typeof value === 'string' && /[A-Za-z]/.test(value);

try {
  const vendors = await prisma.vendor.findMany({
    where: {
      bankAccountEditedAt: null,
      bankAccount: { not: null },
      accountName: { not: null },
    },
    select: {
      id: true,
      name: true,
      bankAccount: true,
      accountName: true,
    },
  });

  const swappedVendors = vendors.filter(
    (vendor) =>
      looksLikeAccountName(vendor.bankAccount) &&
      looksLikeAccountNumber(vendor.accountName)
  );

  console.log(
    JSON.stringify(
      {
        checked: vendors.length,
        toRepair: swappedVendors.length,
        sample: swappedVendors.slice(0, 5),
      },
      null,
      2
    )
  );

  for (const vendor of swappedVendors) {
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        bankAccount: vendor.accountName,
        accountName: vendor.bankAccount,
        bankAccountSource: 'sheet',
      },
    });
  }

  console.log(`Repaired ${swappedVendors.length} vendor bank records.`);
} finally {
  await prisma.$disconnect();
}
