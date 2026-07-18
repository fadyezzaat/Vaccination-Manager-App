import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || "file:local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

export const db = createClient({
  url,
  authToken: authToken || undefined,
});

export async function createTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS vaccine_employees (
      nationalId TEXT PRIMARY KEY,
      name TEXT,
      category TEXT,
      phone TEXT,
      dose1 TEXT,
      dose2 TEXT,
      dose3 TEXT,
      notes TEXT
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS vaccine_needlesticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nationalId TEXT,
      name TEXT,
      date TEXT,
      time TEXT,
      location TEXT,
      tool TEXT,
      description TEXT,
      vaccineStatus TEXT,
      timestamp TEXT
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS vaccine_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

export async function createInfectionTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS inf_incidents ( id INTEGER PRIMARY KEY AUTOINCREMENT, incident_type TEXT NOT NULL, report_date TEXT NOT NULL, staff_name TEXT NOT NULL );`);
  console.log("تم التأكد من تصميم جدول مكافحة العدوى بنجاح!");
}

export async function addIncident(type: string, date: string, staff: string) {
  await db.execute({
    sql: "INSERT INTO inf_incidents (incident_type, report_date, staff_name) VALUES (?, ?, ?)",
    args: [type, date, staff],
  });
}
