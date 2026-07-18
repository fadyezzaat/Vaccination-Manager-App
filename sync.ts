import { db } from "./src/lib/db";
import { parse } from "csv-parse/sync";

export async function syncGoogleSheets(customSheetId?: string) {
  let sheetId = process.env.VITE_SHEET_ID;
  
  if (!sheetId) {
    sheetId = customSheetId;
  }
  
  if (!sheetId) {
    try {
      const result = await db.execute({
        sql: "SELECT value FROM vaccine_settings WHERE key = 'sheet_id'",
        args: []
      });
      if (result.rows.length > 0 && result.rows[0].value) {
        sheetId = result.rows[0].value as string;
      }
    } catch (e) {
      console.error("Error reading sheet_id from db:", e);
    }
  }

  if (!sheetId) {
    console.log("VITE_SHEET_ID is not configured and no custom sheet_id provided. Skipping sync.");
    throw new Error("معرف جدول بيانات جوجل (Google Sheet ID) غير مهيأ. يرجى تهيئته أولاً.");
  }

  console.log(`Starting sync from Google Sheets (${sheetId}) to Turso...`);

  try {
    // 1. Sync vaccine_employees
    const employeesUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=vaccine_employees`;
    const empResponse = await fetch(employeesUrl);
    
    if (!empResponse.ok) {
      throw new Error(`فشل الاتصال بجدول البيانات (كود الاستجابة: ${empResponse.status}). تأكد من إعدادات مشاركة الجدول.`);
    }

    const empCsvText = await empResponse.text();
    if (empCsvText.includes("html") || empCsvText.includes("<!DOCTYPE")) {
      throw new Error("تنسيق البيانات غير صحيح. تأكد من ضبط مشاركة الجدول على 'أي شخص لديه الرابط يمكنه العرض' (Anyone with link can view).");
    }

    const empRecords = parse(empCsvText, { columns: true, skip_empty_lines: true });

    await db.execute("DELETE FROM vaccine_employees");

    let empCount = 0;
    for (const row of empRecords) {
      const keys = Object.keys(row);
      if (keys.length === 0) continue;
      const nationalId = String(row[keys[0]] || "").trim();
      const name = String(row[keys[1]] || "").trim();
      const category = String(row[keys[2]] || "").trim();
      const phone = String(row[keys[3]] || "").trim();
      const dose1 = String(row[keys[4]] || "").trim();
      const dose2 = String(row[keys[5]] || "").trim();
      const dose3 = String(row[keys[6]] || "").trim();
      const notes = String(row[keys[7]] || "").trim();

      if (nationalId && nationalId !== 'رقم البطاقة' && nationalId !== 'National ID') {
        await db.execute({
          sql: "INSERT INTO vaccine_employees (nationalId, name, category, phone, dose1, dose2, dose3, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          args: [nationalId, name, category, phone, dose1, dose2, dose3, notes]
        });
        empCount++;
      }
    }
    console.log(`Synced ${empCount} records into vaccine_employees.`);

    // 2. Sync vaccine_needlesticks
    const nsUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=vaccine_needlesticks`;
    const nsResponse = await fetch(nsUrl);
    
    let nsCount = 0;
    if (nsResponse.ok) {
      const nsCsvText = await nsResponse.text();
      // Only parse if it's not HTML error page
      if (!nsCsvText.includes("html") && !nsCsvText.includes("<!DOCTYPE")) {
        const nsRecords = parse(nsCsvText, { columns: true, skip_empty_lines: true });

        await db.execute("DELETE FROM vaccine_needlesticks");

        for (const row of nsRecords) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          const nationalId = String(row[keys[0]] || "").trim();
          const name = String(row[keys[1]] || "").trim();
          const date = String(row[keys[2]] || "").trim();
          const time = String(row[keys[3]] || "").trim();
          const location = String(row[keys[4]] || "").trim();
          const tool = String(row[keys[5]] || "").trim();
          const description = String(row[keys[6]] || "").trim();
          const vaccineStatus = String(row[keys[7]] || "").trim();
          const timestamp = String(row[keys[8]] || "").trim();

          if (nationalId && nationalId !== 'رقم البطاقة' && nationalId !== 'National ID') {
            await db.execute({
              sql: "INSERT INTO vaccine_needlesticks (nationalId, name, date, time, location, tool, description, vaccineStatus, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              args: [nationalId, name, date, time, location, tool, description, vaccineStatus, timestamp]
            });
            nsCount++;
          }
        }
        console.log(`Synced ${nsCount} records into vaccine_needlesticks.`);
      }
    }

    console.log("Automatic sync from Google Sheets completed successfully!");
    return { status: "success", empCount, nsCount };
  } catch (error: any) {
    console.error("Failed to sync from Google Sheets:", error);
    throw new Error(error.message || "حدث خطأ أثناء الاتصال بجداول بيانات جوجل.");
  }
}
