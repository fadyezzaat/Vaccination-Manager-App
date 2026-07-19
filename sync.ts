import { db } from "./src/lib/db.js";
import { parse } from "csv-parse/sync";

export function extractSheetId(input: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  // Support standard google sheets URL extraction:
  // e.g. https://docs.google.com/spreadsheets/d/1_9vM-3xZ2YJcM-P9K8u_vU_vP_p3/edit#gid=0
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

export async function syncGoogleSheets(customSheetId?: string) {
  let rawSheetId = process.env.VITE_SHEET_ID || "";
  
  if (!rawSheetId) {
    rawSheetId = customSheetId || "";
  }
  
  if (!rawSheetId) {
    try {
      const result = await db.execute({
        sql: "SELECT value FROM vaccine_settings WHERE key = 'sheet_id'",
        args: []
      });
      if (result.rows.length > 0 && result.rows[0].value) {
        rawSheetId = result.rows[0].value as string;
      }
    } catch (e) {
      console.error("Error reading sheet_id from db:", e);
    }
  }

  const sheetId = extractSheetId(rawSheetId);

  if (!sheetId) {
    console.log("VITE_SHEET_ID is not configured and no custom sheet_id provided. Skipping sync.");
    throw new Error("معرف جدول بيانات جوجل (Google Sheet ID) غير مهيأ. يرجى تهيئته أولاً أو إدخال معرف/رابط صحيح.");
  }

  console.log(`Starting sync from Google Sheets (${sheetId}) to Turso...`);

  try {
    // 1. Sync vaccine_employees
    const employeesUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=vaccine_employees`;
    const empResponse = await fetch(employeesUrl);
    
    if (!empResponse.ok) {
      if (empResponse.status === 401) {
        throw new Error(
          "فشل الاتصال بجدول البيانات (كود الاستجابة: 401 - غير مصرح).\n\n" +
          "السبب: جدول بيانات Google الخاص بك مغلق (حصري/Private).\n\n" +
          "الحل للتشغيل والمزامنة:\n" +
          "1. افتح ملف الـ Google Sheets الخاص بك.\n" +
          "2. اضغط على زر 'مشاركة' (Share) في أعلى اليسار.\n" +
          "3. تحت 'الوصول العام' (General Access)، قم بتغيير الاختيار من 'حصري' (Restricted) إلى 'أي شخص لديه الرابط' (Anyone with the link).\n" +
          "4. تأكد من ضبط الصلاحية على 'عارض' (Viewer).\n" +
          "5. اضغط 'حفظ' أو 'تم' (Done) وحاول المزامنة مجدداً."
        );
      }
      throw new Error(`فشل الاتصال بجدول البيانات (كود الاستجابة: ${empResponse.status}). تأكد من إعدادات مشاركة الجدول.`);
    }

    const empCsvText = await empResponse.text();
    if (empCsvText.includes("google.visualization.Query.setResponse") || empCsvText.includes('"status":"error"')) {
      const match = empCsvText.match(/"message"\s*:\s*"([^"]+)"/);
      const googleMsg = match ? match[1] : "الجدول غير موجود أو غير صالح";
      throw new Error(`خطأ في ورقة العمل الأولى: ${googleMsg}. يرجى التأكد من تسمية الورقة الأولى (Tab 1) في ملف Google Sheets الخاص بك باسم "vaccine_employees" باللغة الإنجليزية تماماً.`);
    }
    if (empCsvText.includes("html") || empCsvText.includes("<!DOCTYPE")) {
      throw new Error("تنسيق البيانات غير صحيح. تأكد من ضبط مشاركة الجدول على 'أي شخص لديه الرابط يمكنه العرض' (Anyone with link can view).");
    }

    const empRecords = parse(empCsvText, { columns: true, skip_empty_lines: true });

    await db.execute("DELETE FROM vaccine_employees");

    // Auto-map keys based on column headers
    const firstRow = empRecords[0];
    const keys = firstRow ? Object.keys(firstRow) : [];
    
    let keyMap = {
      nationalId: keys[0] || "",
      name: keys[1] || "",
      category: keys[2] || "",
      phone: keys[3] || "",
      dose1: keys[4] || "",
      dose2: keys[5] || "",
      dose3: keys[6] || "",
      notes: keys[7] || ""
    };

    for (const k of keys) {
      const lowerK = k.toLowerCase().trim();
      if (lowerK.includes('بطاقة') || lowerK.includes('قومي') || lowerK.includes('national') || lowerK.includes('id')) {
        // Exclude serial numbers "م" or "مسلسل"
        if (!lowerK.includes('مسلسل') && lowerK !== 'م' && lowerK !== 'ت') {
          keyMap.nationalId = k;
        }
      } else if (lowerK.includes('الاسم') || lowerK.includes('اسم') || lowerK.includes('name')) {
        keyMap.name = k;
      } else if (lowerK.includes('فئة') || lowerK.includes('وظيفة') || lowerK.includes('قسم') || lowerK.includes('category') || lowerK.includes('job') || lowerK.includes('المهنة')) {
        keyMap.category = k;
      } else if (lowerK.includes('تليفون') || lowerK.includes('هاتف') || lowerK.includes('موبايل') || lowerK.includes('phone') || lowerK.includes('mobile')) {
        keyMap.phone = k;
      } else if (lowerK.includes('الأولى') || lowerK.includes('الاولى') || lowerK.includes('dose1') || lowerK.includes('dose 1') || lowerK.includes('الجرعة 1') || lowerK.includes('الجرعه 1')) {
        keyMap.dose1 = k;
      } else if (lowerK.includes('الثانية') || lowerK.includes('الثانيه') || lowerK.includes('dose2') || lowerK.includes('dose 2') || lowerK.includes('الجرعة 2') || lowerK.includes('الجرعه 2')) {
        keyMap.dose2 = k;
      } else if (lowerK.includes('الثالثة') || lowerK.includes('الثالثه') || lowerK.includes('dose3') || lowerK.includes('dose 3') || lowerK.includes('الجرعة 3') || lowerK.includes('الجرعه 3')) {
        keyMap.dose3 = k;
      } else if (lowerK.includes('ملاحظات') || lowerK.includes('notes') || lowerK.includes('ملاحظه')) {
        keyMap.notes = k;
      }
    }

    // Deduplicate by nationalId, keeping the last occurrence
    const dedupedMap = new Map<string, any>();
    for (const row of empRecords) {
      let nationalId = keyMap.nationalId ? String(row[keyMap.nationalId] || "").trim() : "";
      const name = keyMap.name ? String(row[keyMap.name] || "").trim() : "";
      
      if (!nationalId && name) {
        nationalId = 'TEMP_SYNC_' + Math.random().toString(36).substr(2, 9).toUpperCase();
      }

      if (nationalId && nationalId !== 'رقم البطاقة' && nationalId !== 'National ID') {
        const category = keyMap.category ? String(row[keyMap.category] || "").trim() : "";
        const phone = keyMap.phone ? String(row[keyMap.phone] || "").trim() : "";
        const dose1 = keyMap.dose1 ? String(row[keyMap.dose1] || "").trim() : "";
        const dose2 = keyMap.dose2 ? String(row[keyMap.dose2] || "").trim() : "";
        const dose3 = keyMap.dose3 ? String(row[keyMap.dose3] || "").trim() : "";
        const notes = keyMap.notes ? String(row[keyMap.notes] || "").trim() : "";
        
        dedupedMap.set(nationalId, { name, category, phone, dose1, dose2, dose3, notes });
      }
    }

    let empCount = 0;
    for (const [nationalId, emp] of dedupedMap.entries()) {
      await db.execute({
        sql: "INSERT OR REPLACE INTO vaccine_employees (nationalId, name, category, phone, dose1, dose2, dose3, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [nationalId, emp.name, emp.category, emp.phone, emp.dose1, emp.dose2, emp.dose3, emp.notes]
      });
      empCount++;
    }
    console.log(`Synced ${empCount} records into vaccine_employees.`);

    console.log("Automatic sync from Google Sheets completed successfully!");
    return { status: "success", empCount };
  } catch (error: any) {
    console.error("Failed to sync from Google Sheets:", error);
    throw new Error(error.message || "حدث خطأ أثناء الاتصال بجداول بيانات جوجل.");
  }
}
