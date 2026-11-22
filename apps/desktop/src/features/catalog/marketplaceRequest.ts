export function request(method: string, params?: Record<string, unknown>) {
  return (
    window.skaiAgent?.request(method, params) ??
    Promise.resolve({
      v: 1,
      id: `plugins-${method}`,
      ok: false,
      error: {
        code: "BRIDGE_UNAVAILABLE",
        message: "The Electron agent bridge is unavailable.",
      },
    })
  );
}
