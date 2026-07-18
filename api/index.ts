import "dotenv/config";
import express from "express";
import path from "path";
import { db, createTables, createInfectionTable } from "../src/lib/db.js";
import { parse } from "csv-parse/sync";
import { syncGoogleSheets, extractSheetId } from "../sync.js";

export const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize DB safely
let dbInitialized = false;
async function ensureDbInitialized() {
  if (dbInitialized) return;
  try {
    await createTables();
    await createInfectionTable();
    console.log("Database tables verified successfully!");
    dbInitialized = true;
  } catch (error) {
    console.error("Failed to create tables or sync data:", error);
    throw error;
  }
}

// Sync endpoint from Google Sheets (Manual trigger)
app.post("/api/sync", async (req, res) => {
  try {
    await ensureDbInitialized();
    const { sheetId } = req.body || {};
    const cleanId = extractSheetId(sheetId || "");
    if (cleanId) {
      await db.execute({
        sql: "INSERT OR REPLACE INTO vaccine_settings (key, value) VALUES ('sheet_id', ?)",
        args: [cleanId]
      });
    }
    const result = await syncGoogleSheets(cleanId);
    res.json({ status: "success", message: "Synced successfully from Google Sheets", data: result });
  } catch (err: any) {
    res.json({ status: "error", message: err.message });
  }
});

// Main API Endpoint
app.all("/api", async (req, res) => {
  // Both GET query params and POST body could contain action
  const params = { ...req.query, ...req.body };
  const action = params.action;

  try {
    await ensureDbInitialized();

    if (action === "getEmployee") {
      const result = await db.execute({
        sql: "SELECT * FROM vaccine_employees WHERE nationalId = ?",
        args: [params.nationalId]
      });
      if (result.rows.length > 0) {
        const emp = result.rows[0];
        const employeeData = {
          nationalId: emp.nationalId,
          name: emp.name,
          category: emp.category,
          phone: emp.phone,
          dose1: emp.dose1,
          dose2: emp.dose2,
          dose3: emp.dose3,
          notes: emp.notes,
          doses: [] as string[]
        };
        if (emp.dose1) employeeData.doses.push(String(emp.dose1));
        if (emp.dose2) employeeData.doses.push(String(emp.dose2));
        if (emp.dose3) employeeData.doses.push(String(emp.dose3));
        
        res.json({ status: "success", employee: employeeData });
      } else {
        res.json({ status: "error", message: "Employee not found" });
      }
    } 
    else if (action === "getAllEmployees") {
      const result = await db.execute("SELECT * FROM vaccine_employees");
      res.json({ status: "success", employees: result.rows });
    }
    else if (action === "saveEmployee" || action === "saveEmployeeData") {
      const { nationalId, oldNationalId, name, category, phone, dose1, dose2, dose3, notes } = params;
      
      const targetId = oldNationalId || nationalId;
      
      const existing = await db.execute({
        sql: "SELECT * FROM vaccine_employees WHERE nationalId = ?",
        args: [targetId]
      });

      if (existing.rows.length > 0) {
        await db.execute({
          sql: "UPDATE vaccine_employees SET nationalId=?, name=?, category=?, phone=?, dose1=?, dose2=?, dose3=?, notes=? WHERE nationalId=?",
          args: [nationalId, name || "", category || "", phone || "", dose1 || "", dose2 || "", dose3 || "", notes || "", targetId]
        });
        
        if (nationalId !== targetId) {
          await db.execute({
            sql: "UPDATE vaccine_needlesticks SET nationalId=? WHERE nationalId=?",
            args: [nationalId, targetId]
          });
        }
      } else {
        await db.execute({
          sql: "INSERT INTO vaccine_employees (nationalId, name, category, phone, dose1, dose2, dose3, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          args: [nationalId, name || "", category || "", phone || "", dose1 || "", dose2 || "", dose3 || "", notes || ""]
        });
      }
      res.json({ status: "success", message: "Employee saved" });
    }
    else if (action === "saveMultipleEmployees") {
      const employeesArray = typeof params.employees === "string" ? JSON.parse(params.employees) : params.employees;
      if (!employeesArray || !employeesArray.length) {
        res.json({ status: "error", message: "No employees provided" });
        return;
      }

      for (const emp of employeesArray) {
        const existing = await db.execute({
          sql: "SELECT * FROM vaccine_employees WHERE nationalId = ?",
          args: [emp.nationalId]
        });
        if (existing.rows.length > 0) {
           await db.execute({
            sql: "UPDATE vaccine_employees SET name=?, category=?, phone=?, dose1=?, dose2=?, dose3=?, notes=? WHERE nationalId=?",
            args: [emp.name || "", emp.category || "", emp.phone || "", emp.dose1 || "", emp.dose2 || "", emp.dose3 || "", emp.notes || "", emp.nationalId]
          });
        } else {
          await db.execute({
            sql: "INSERT INTO vaccine_employees (nationalId, name, category, phone, dose1, dose2, dose3, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            args: [emp.nationalId, emp.name || "", emp.category || "", emp.phone || "", emp.dose1 || "", emp.dose2 || "", emp.dose3 || "", emp.notes || ""]
          });
        }
      }
      res.json({ status: "success", message: "Employees saved successfully", count: employeesArray.length });
    }
    else if (action === "deleteEmployee") {
      await db.execute({
        sql: "DELETE FROM vaccine_employees WHERE nationalId = ?",
        args: [params.nationalId]
      });
      await db.execute({
        sql: "DELETE FROM vaccine_needlesticks WHERE nationalId = ?",
        args: [params.nationalId]
      });
      res.json({ status: "success", message: "Employee deleted" });
    }
    else if (action === "deleteMultipleEmployees") {
      const nationalIds = typeof params.nationalIds === "string" ? JSON.parse(params.nationalIds) : params.nationalIds;
      if (nationalIds && Array.isArray(nationalIds) && nationalIds.length > 0) {
        for (const id of nationalIds) {
          await db.execute({
            sql: "DELETE FROM vaccine_employees WHERE nationalId = ?",
            args: [id]
          });
          await db.execute({
            sql: "DELETE FROM vaccine_needlesticks WHERE nationalId = ?",
            args: [id]
          });
        }
      }
      res.json({ status: "success", message: "Employees deleted" });
    }
    else if (action === "importEmployees") {
      const employeesArray = typeof params.employees === "string" ? JSON.parse(params.employees) : params.employees;
      if (!employeesArray || !Array.isArray(employeesArray)) {
        res.json({ status: "error", message: "بيانات الموظفين غير صالحة" });
        return;
      }
      
      // Clear existing first
      await db.execute("DELETE FROM vaccine_employees");
      
      let insertedCount = 0;
      for (const emp of employeesArray) {
        const nationalId = String(emp.nationalId || "").trim();
        if (!nationalId) continue;
        await db.execute({
          sql: "INSERT INTO vaccine_employees (nationalId, name, category, phone, dose1, dose2, dose3, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          args: [
            nationalId,
            String(emp.name || "").trim(),
            String(emp.category || "").trim(),
            String(emp.phone || "").trim(),
            String(emp.dose1 || "").trim(),
            String(emp.dose2 || "").trim(),
            String(emp.dose3 || "").trim(),
            String(emp.notes || "").trim()
          ]
        });
        insertedCount++;
      }
      res.json({ status: "success", message: `تم استيراد ${insertedCount} موظف بنجاح`, count: insertedCount });
    }
    else if (action === "importNeedlesticks") {
      const needlesticksArray = typeof params.needlesticks === "string" ? JSON.parse(params.needlesticks) : params.needlesticks;
      if (!needlesticksArray || !Array.isArray(needlesticksArray)) {
        res.json({ status: "error", message: "بيانات حوادث الوخز غير صالحة" });
        return;
      }
      
      // Clear existing first
      await db.execute("DELETE FROM vaccine_needlesticks");
      
      let insertedCount = 0;
      for (const ns of needlesticksArray) {
        const nationalId = String(ns.nationalId || "").trim();
        if (!nationalId) continue;
        await db.execute({
          sql: "INSERT INTO vaccine_needlesticks (nationalId, name, date, time, location, tool, description, vaccineStatus, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          args: [
            nationalId,
            String(ns.name || "").trim(),
            String(ns.date || "").trim(),
            String(ns.time || "").trim(),
            String(ns.location || "").trim(),
            String(ns.tool || "").trim(),
            String(ns.description || "").trim(),
            String(ns.vaccineStatus || "").trim(),
            String(ns.timestamp || "").trim()
          ]
        });
        insertedCount++;
      }
      res.json({ status: "success", message: `تم استيراد ${insertedCount} استمارة وخز بنجاح`, count: insertedCount });
    }
    else if (action === "saveNeedlestick") {
      const timestamp = new Date().toISOString();
      await db.execute({
        sql: "INSERT INTO vaccine_needlesticks (nationalId, name, date, time, location, tool, description, vaccineStatus, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          params.nationalId, params.name, params.date, params.time, 
          params.location, params.tool, params.description, params.vaccineStatus, timestamp
        ]
      });
      res.json({ status: "success", message: "Form saved" });
    }
    else if (action === "getSyncSettings") {
      const result = await db.execute({
        sql: "SELECT value FROM vaccine_settings WHERE key = 'sheet_id'",
        args: []
      });
      const dbSheetId = result.rows.length > 0 ? result.rows[0].value : "";
      const sheetId = process.env.VITE_SHEET_ID || dbSheetId || "";
      res.json({ status: "success", sheetId });
    }
    else if (action === "saveSyncSettings") {
      const { sheetId } = params;
      const cleanId = extractSheetId(sheetId || "");
      await db.execute({
        sql: "INSERT OR REPLACE INTO vaccine_settings (key, value) VALUES ('sheet_id', ?)",
        args: [cleanId]
      });
      res.json({ status: "success", message: "Settings saved successfully" });
    }
    else {
      res.json({ status: "error", message: "Unknown action" });
    }
  } catch (err: any) {
    console.error(err);
    res.json({ status: "error", message: err.message });
  }
});

// Start Server conditionally
if (process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
  async function startServer() {
    const PORT = 3000;
    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  startServer();
}

export default app;
