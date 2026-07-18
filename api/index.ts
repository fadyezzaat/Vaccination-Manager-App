let appInstance: any = null;
let initError: any = null;

async function loadApp() {
  if (appInstance) return appInstance;
  try {
    const module = await import("../server");
    appInstance = module.app;
    return appInstance;
  } catch (err: any) {
    initError = err;
    console.error("Initialization Error:", err);
    throw err;
  }
}

export default async function handler(req: any, res: any) {
  try {
    const app = await loadApp();
    return app(req, res);
  } catch (err: any) {
    res.status(500).json({
      status: "error",
      message: "فشل تهيئة الخادم (Server Initialization Failed): " + (err.message || String(err)),
      stack: err.stack,
      initError: initError ? initError.message || String(initError) : null
    });
  }
}

