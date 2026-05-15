import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { downloadInvoiceFileToBase64, fileNameMatchesPi } from '@/lib/googleDrive';
import { decimalToNumber, formatDecimal } from '@/lib/decimal';

// Use edge duration if applicable on Vercel to help avoid timeouts
export const maxDuration = 60;

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const { items } = await req.json() as {
      items: { itemId: string; piNumber: string; driveFileId?: string; driveFileName?: string }[];
    };

    if (!items || items.length === 0) {
      return NextResponse.json({ success: false, error: 'Tidak ada items' }, { status: 400 });
    }

    const results: Record<string, { 
      status: string; 
      recommendation: string; 
      ocrReason: string;
      referensi: string;
      priorityScore: number;
      marketPrice: number | null;
    }> = {};

    // OpenAI for market price only
    const openaiKey = process.env.OPENAI_API_KEY;
    const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

    // Gemini for OCR validation (natively supports PDF + images)
    const geminiKey = process.env.GEMINI_API_KEY;
    const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;

    // Process items one at a time (sent 1 per request from frontend)
    for (let i = 0; i < items.length; i += 3) {
      const batch = items.slice(i, i + 3);

      await Promise.all(batch.map(async ({ itemId, piNumber, driveFileId, driveFileName }) => {
        try {
          // Get the item from DB
          const item = await prisma.invoiceItem.findUnique({
            where: { id: itemId },
            include: { invoice: { include: { vendor: true, company: true } } }
          });

          if (!item) {
            results[itemId] = { status: 'pending', recommendation: 'Item tidak ditemukan', ocrReason: '', referensi: '', priorityScore: 0, marketPrice: null };
            return;
          }

          // ==========================================
          // 1. Historical Recommendation (3 months) — PURE, no status info
          // ==========================================
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

          let rekomendasi = 'Barang pertama kali dibeli — belum ada data pembanding histori.';
          if (history.length > 0) {
            const termurah = history[0];
            const termahal = history[history.length - 1];
            const avgPrice = history.reduce((sum, h) => sum + decimalToNumber(h.hargaPI), 0) / history.length;
            const itemHargaPI = decimalToNumber(item.hargaPI);
            const termurahHargaPI = decimalToNumber(termurah.hargaPI);
            const diff = itemHargaPI - termurahHargaPI;
            const pctDiff = termurahHargaPI > 0 ? Math.round((diff / termurahHargaPI) * 100) : 0;
            
            let saran = '';
            if (diff > 0 && pctDiff > 15) {
              saran = `⚠️ Harga ${pctDiff}% lebih mahal dari ${termurah.invoice.vendor.name} (Rp ${formatDecimal(termurah.hargaPI)}). Disarankan negosiasi atau cari vendor alternatif.`;
            } else if (diff > 0) {
              saran = `Harga ${pctDiff}% lebih tinggi dari termurah ${termurah.invoice.vendor.name} (Rp ${formatDecimal(termurah.hargaPI)}), masih dalam batas wajar.`;
            } else if (diff < 0) {
              saran = `✅ Harga ${Math.abs(pctDiff)}% lebih murah dari vendor lain. Harga sudah kompetitif.`;
            } else {
              saran = `Harga sama dengan ${termurah.invoice.vendor.name}. Stabil.`;
            }
            
            rekomendasi = `${saran} Avg 3bln: Rp ${Math.round(avgPrice).toLocaleString('id-ID')} (${history.length}x beli). Range: Rp ${formatDecimal(termurah.hargaPI)} - Rp ${formatDecimal(termahal.hargaPI)}.`;
          }
          
          // Trim to max 300 characters
          if (rekomendasi.length > 300) {
            rekomendasi = rekomendasi.substring(0, 297) + '...';
          }

          // ==========================================
          // 2. Priority Score Calculation
          // ==========================================
          let priorityScore = 0;
          const tempoHari = item.invoice.tempoHari;
          
          if (tempoHari < 0) {
            priorityScore += 40; 
          } else if (tempoHari <= 3) {
            priorityScore += 35;
          } else if (tempoHari <= 7) {
            priorityScore += 25;
          } else if (tempoHari <= 14) {
            priorityScore += 15;
          } else {
            priorityScore += 5;
          }

          const hutang = decimalToNumber(item.invoice.hutang);
          if (hutang >= 50000000) { 
            priorityScore += 30;
          } else if (hutang >= 20000000) {
            priorityScore += 20;
          } else if (hutang >= 5000000) {
            priorityScore += 10;
          } else {
            priorityScore += 5;
          }

          const vendorHistory = await prisma.purchaseInvoice.count({
            where: { 
              vendorId: item.invoice.vendorId,
              createdAt: { gte: threeMonthsAgo }
            }
          });
          if (vendorHistory >= 10) priorityScore += 20;
          else if (vendorHistory >= 5) priorityScore += 15;
          else if (vendorHistory >= 2) priorityScore += 10;
          else priorityScore += 5;

          if (tempoHari < -7) priorityScore += 10;
          else if (tempoHari < 0) priorityScore += 5;

          // ==========================================
          // 3. AI OCR Status, Referensi & Market Price
          // ==========================================
          let statusOcr = 'Valid'; 
          let ocrReason = '';
          let referensi = '';
          let marketPrice: number | null = null;

          // 3a. Market Price Search via OpenAI (text-only, works fine)
          if (openai) {
            try {
              const pricePrompt = `Kamu adalah asisten riset harga. Cari tahu harga pasaran terkini untuk barang: "${item.namaBarang}".
                  
Berikan estimasi harga pasar rata-rata dalam Rupiah (IDR). Pertimbangkan harga dari marketplace Indonesia seperti Tokopedia dan Shopee.

Output WAJIB berupa murni JSON tanpa markdown, dengan struktur:
{
  "estimatedPrice": angka dalam rupiah (contoh: 15000),
  "source": "marketplace/estimasi"
}

Jika tidak bisa memperkirakan, kembalikan: {"estimatedPrice": 0, "source": "unknown"}`;

              const priceResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: pricePrompt }],
                response_format: { type: 'json_object' }
              });
              const priceText = priceResponse.choices[0].message.content || '{}';
              
              try {
                const parsed = JSON.parse(priceText);
                if (parsed.estimatedPrice && parsed.estimatedPrice > 0) {
                  marketPrice = parsed.estimatedPrice;
                }
              } catch {
                console.log('Could not parse market price:', priceText);
              }
            } catch (priceErr) {
              console.warn('Market price search failed:', priceErr);
            }
          }

          // 3b. Validate selected Drive file title before OCR.
          if (driveFileName && !fileNameMatchesPi(driveFileName, piNumber)) {
            statusOcr = 'Tidak Valid';
            ocrReason = `Judul file Drive tidak cocok dengan ${piNumber}. File yang dipakai: ${driveFileName}`;
          }

          // 3c. OCR Document Validation via GEMINI with 3 statuses + Rp 2000 tolerance
          if (genAI && driveFileId && statusOcr !== 'Tidak Valid') {
            try {
              const fileData = await downloadInvoiceFileToBase64(driveFileId);
              
              if (fileData) {
                const bankAccount = item.invoice.vendor.bankAccount || '';
                const bankName = item.invoice.vendor.bankName || '';
                
                const ocrPrompt = `Tugas Anda memvalidasi data Invoice. Bandingkan data berikut dengan dokumen file invoice (Invoice yang diminta: ${piNumber}):
- Item yang dicari: "${item.namaBarang}" (hanya untuk acuan mencari baris)
- Qty pada data: ${item.qtyPI}
- Total Harga Item: Rp${formatDecimal(item.totalHarga)}
${bankAccount ? `- Nomor Rekening data: ${bankAccount}` : '- Nomor Rekening data: TIDAK ADA'}
${bankName ? `- Bank: ${bankName}` : ''}

Validasi dengan ketentuan berikut:

0. Validasi nomor invoice terlebih dahulu:
   - Dokumen HARUS merupakan invoice ${piNumber}.
   - Tulisan tangan "P1", "Pi", "Pl", atau "PI" boleh dianggap sebagai awalan "PI" HANYA jika angka setelahnya sama persis.
   - Contoh: "P126050151" boleh dibaca sebagai "PI26050151".
   - Jika dokumen menunjukkan nomor berbeda, misalnya dokumen "P126050157" sedangkan yang diminta "${piNumber}", maka dokumen SALAH dan kembalikan status ["Tidak Valid"].
   - Jangan lanjut validasi item/rekening jika nomor invoice dokumen berbeda.

1. Temukan baris item yang mirip atau merujuk ke "${item.namaBarang}" pada dokumen.

2. Membandingkan Qty (Jumlah): 
   - PERHATIAN KHUSUS SATUAN BERAT: Kadang dokumen invoice (PDF) menulis satuan dalam "KG" sementara data menggunakan "Gram". 
   - Contoh: "2 Kg" di invoice vs "2000" di data → konversi 1 Kg = 1000 Gram → COCOK.

3. Bandingkan Total Harga: gunakan TOLERANSI selisih Rp 2.000. 
   - Jika selisih Total Harga ≤ Rp 2.000 → dianggap COCOK.
   - Jika selisih > Rp 2.000 → SELISIH.

4. Bandingkan Nomor Rekening:
   - Jika data DAN dokumen KEDUANYA punya rekening, bandingkan apakah cocok.
   - Jika salah SATU tidak punya nomor rekening → "Rekening Tidak Valid"
   - Jika nomor rekening BERBEDA → "Rekening Tidak Valid"

Aturan output:
1. Jika dokumen tidak bisa dibaca atau bukan invoice → kembalikan status ["Tidak Valid"]
2. Lakukan evaluasi secara mandiri untuk Rekening dan Total Harga.
3. JIKA Rekening berbeda/tidak ada di salah satu → tambahkan "Rekening Tidak Valid" ke array status.
4. JIKA Qty/Total melebihi toleransi Rp 2.000 → tambahkan "Selisih" ke array status.
5. JIKA poin 3 dan 4 KEDUANYA terjadi, array HARUS berisi ["Rekening Tidak Valid", "Selisih"].
6. JIKA SEMUA COCOK dan tidak ada poin 3 atau 4 yang terjadi → kembalikan status ["Valid"].

Output WAJIB JSON murni tanpa backtick:
{
  "statuses": ["Valid"] atau bisa multipel misal ["Rekening Tidak Valid", "Selisih"] atau tunggal ["Tidak Valid"],
  "reason": "Kosongkan jika Valid. Jika nomor invoice dokumen berbeda, tulis: Dokumen bukan invoice ${piNumber}; nomor yang terbaca adalah <nomor>. Jika ada masalah lain, gabungkan penjelasannya lebih spesifik maks 60 kata."
}`;

                const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
                
                const result = await model.generateContent([
                  ocrPrompt,
                  {
                    inlineData: {
                      mimeType: fileData.mimeType,
                      data: fileData.base64,
                    }
                  }
                ]);

                const ocrText = result.response.text().trim();
                
                try {
                  const cleanJson = ocrText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
                  const parsed = JSON.parse(cleanJson);
                  
                  let parsedStatuses = parsed.statuses || [parsed.status] || ['Valid'];
                  if (!Array.isArray(parsedStatuses)) parsedStatuses = [parsedStatuses];
                  
                  // Filter valid combinations
                  const validSet = new Set(['Valid', 'Selisih', 'Rekening Tidak Valid', 'Tidak Valid']);
                  let finalStatuses = parsedStatuses.filter((s: string) => validSet.has(s));
                  
                  if (finalStatuses.length === 0) finalStatuses = ['Valid'];
                  // If there's multiple and one of them is Valid (which shouldn't happen based on prompt), remove Valid
                  if (finalStatuses.length > 1 && finalStatuses.includes('Valid')) {
                    finalStatuses = finalStatuses.filter((s: string) => s !== 'Valid');
                  }
                  
                  statusOcr = finalStatuses.join(', ');
                  
                  // Store reason separately — NOT in rekomendasi
                  if (!finalStatuses.includes('Valid') && parsed.reason) {
                    ocrReason = parsed.reason;
                  }
                } catch {
                  console.log('Failed to parse Gemini OCR JSON:', ocrText);
                  let tempStatuses = [];
                  if (ocrText.toLowerCase().includes('rekening tidak valid') || ocrText.toLowerCase().includes('rekening berbeda')) {
                    tempStatuses.push('Rekening Tidak Valid');
                  } 
                  if (ocrText.toLowerCase().includes('selisih')) {
                    tempStatuses.push('Selisih');
                  }
                  
                  if (tempStatuses.length > 0) {
                    statusOcr = tempStatuses.join(', ');
                    ocrReason = 'AI mendeteksi ketidaksesuaian pada dokumen';
                  } else if (ocrText.toLowerCase().includes('tidak valid')) {
                    statusOcr = 'Tidak Valid';
                    ocrReason = 'Dokumen tidak valid atau tidak bisa dibaca';
                  } else {
                    statusOcr = 'Valid';
                  }
                }
              } else {
                statusOcr = 'Tidak Valid';
                ocrReason = 'Gagal mengakses file invoice dari Google Drive';
              }
            } catch (aiErr: any) {
              console.warn('Gemini OCR error for item', itemId, aiErr?.message || aiErr);
              statusOcr = 'Tidak Valid';
              ocrReason = `Error saat membaca dokumen: ${aiErr?.message?.substring(0, 80) || 'Unknown'}`;
            }
          } else if (!genAI) {
            statusOcr = 'Valid';
          }

          // ==========================================
          // 4. Save to DB
          // ==========================================
          await prisma.invoiceItem.update({
            where: { id: itemId },
            data: { 
              statusOcr, 
              ocrReason,
              recommendationNote: rekomendasi,
              marketPrice: marketPrice,
              aiRecommendation: rekomendasi,
              priorityScore: priorityScore,
            }
          });

          results[itemId] = { 
            status: statusOcr, 
            recommendation: rekomendasi,
            ocrReason,
            referensi,
            priorityScore,
            marketPrice,
          };
        } catch (itemErr) {
          console.error('Error processing item', itemId, itemErr);
          results[itemId] = { status: 'pending', recommendation: 'Error saat validasi', ocrReason: '', referensi: '', priorityScore: 0, marketPrice: null };
        }
      }));
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error('Batch AI validation error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
