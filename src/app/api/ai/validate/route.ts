import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { downloadInvoiceFileToBase64 } from '@/lib/googleDrive';
import { decimalToNumber, formatDecimal } from '@/lib/decimal';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const { itemId, piNumber, driveFileId } = await req.json();

    if (!itemId || !piNumber) {
      return NextResponse.json({ success: false, error: 'itemId and piNumber required' }, { status: 400 });
    }

    const item = await prisma.invoiceItem.findUnique({
      where: { id: itemId },
      include: { invoice: { include: { vendor: true } } }
    });

    if (!item) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    // Historical Recommendation Logic
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const history = await prisma.invoiceItem.findMany({
      where: {
        namaBarang: item.namaBarang,
        createdAt: { gte: threeMonthsAgo },
        id: { not: itemId },
        sourceActive: true,
        invoice: { sourceActive: true },
      },
      include: { invoice: { include: { vendor: true } } },
      orderBy: { hargaPI: 'asc' }
    });

    let rekomendasi = 'Barang pertama kali dibeli.';
    if (history.length > 0) {
      const termurah = history[0];
      const itemHargaPI = decimalToNumber(item.hargaPI);
      const termurahHargaPI = decimalToNumber(termurah.hargaPI);
      const diff = itemHargaPI - termurahHargaPI;
      const pctDiff = termurahHargaPI > 0 ? Math.round((diff / termurahHargaPI) * 100) : 0;
      
      if (diff > 0) {
        rekomendasi = `Lebih mahal ${pctDiff}% dari ${termurah.invoice.vendor.name} (Rp ${formatDecimal(termurah.hargaPI)})`;
      } else if (diff < 0) {
        rekomendasi = `Lebih murah ${Math.abs(pctDiff)}% dari ${termurah.invoice.vendor.name}`;
      } else {
        rekomendasi = `Harga sama dengan ${termurah.invoice.vendor.name}`;
      }
    }

    // Default status if AI can't run
    let finalStatus = 'match';

    // AI OCR
    if (process.env.GEMINI_API_KEY && driveFileId) {
      try {
        const fileData = await downloadInvoiceFileToBase64(driveFileId);
        
        if (fileData) {
          const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
          // Vision model is default in gemini-flash-latest
          const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

          const prompt = `
            Tugas Anda adalah memvalidasi data Invoice. 
            Gambar/PDF yang saya berikan adalah dokumen asli invoice/tagihan dari vendor.
            Nomor invoice yang diminta adalah ${piNumber}. Pertama, pastikan dokumen ini benar-benar invoice ${piNumber}.
            Tulisan tangan "P1", "Pi", "Pl", atau "PI" boleh dianggap awalan "PI" hanya jika angka setelahnya sama persis.
            Contoh: "P126050151" boleh dibaca sebagai "PI26050151", tetapi "P126050157" TIDAK sama dengan "PI26050151".
            Jika nomor invoice dokumen berbeda dari ${piNumber}, JAWAB HANYA DENGAN KATA "DISCREPANCY".
            Jika nomor invoice cocok, cek apakah di dalam dokumen ini terdapat barang dengan deskripsi yang cocok/mendekati "${item.namaBarang}", dengan kuantitas: ${item.qtyPI}, dan harga: Rp${formatDecimal(item.hargaPI)}.
            
            Jika terdapat selisih jumlah kuantitas, atau selisih harga yang cukup mencurigakan antara gambar dengan deskripsi saya, JAWAB HANYA DENGAN KATA "DISCREPANCY". 
            Jika angkanya wajar atau cocok, JAWAB HANYA DENGAN KATA "MATCH".
          `;

          const result = await model.generateContent([
            prompt,
            {
              inlineData: {
                data: fileData.base64,
                mimeType: fileData.mimeType
              }
            }
          ]);
          
          const responseText = (await result.response).text().toUpperCase();
          if (responseText.includes('DISCREPANCY')) {
            finalStatus = 'discrepancy';
          } else {
            finalStatus = 'match';
          }
        }
      } catch (err) {
        console.error('Gemini Vision API error:', err);
        // Fallback or leave as match (or error status)
        finalStatus = 'pending';
      }
    }

    // Save to DB
    await prisma.invoiceItem.update({
      where: { id: itemId },
      data: {
        statusOcr: finalStatus,
        recommendationNote: rekomendasi
      }
    });

    return NextResponse.json({ 
      success: true, 
      status: finalStatus,
      recommendation: rekomendasi
    });

  } catch (error: any) {
    console.error('AI validate error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
