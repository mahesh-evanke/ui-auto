/**
 * Device viewport presets for recording and testing. Used by webio CLI.
 * Keys are device names (case-insensitive match). Value is { width, height } in CSS pixels.
 */
const PRESETS = {
    "iPhone SE": { width: 375, height: 667 },
    "iPhone XR": { width: 414, height: 896 },
    "iPhone 12 Pro": { width: 390, height: 844 },
    "iPhone 14 Pro Max": { width: 430, height: 932 },
    "Pixel 7": { width: 412, height: 915 },
    "Samsung Galaxy S8+": { width: 360, height: 740 },
    "Samsung Galaxy S20 Ultra": { width: 412, height: 915 },
    "iPad Mini": { width: 768, height: 1024 },
    "iPad Air": { width: 820, height: 1180 },
    "iPad Pro": { width: 1024, height: 1366 },
    "Surface Pro 7": { width: 912, height: 1368 },
    "Surface Duo": { width: 540, height: 720 },
    "Galaxy Z Fold 5": { width: 412, height: 915 },
    "Asus Zenbook Fold": { width: 1280, height: 1920 },
    "Samsung Galaxy A51/71": { width: 412, height: 915 },
    "Nest Hub": { width: 1024, height: 600 },
    "Nest Hub Max": { width: 1280, height: 800 },
};

function getViewport(deviceName) {
    if (deviceName == null || String(deviceName).trim() === "") return null;
    const lower = String(deviceName).trim().toLowerCase();
    for (const [name, viewport] of Object.entries(PRESETS)) {
        if (name.toLowerCase() === lower) return viewport;
    }
    return null;
}

function getDeviceNames() {
    return Object.keys(PRESETS);
}

module.exports = { PRESETS, getViewport, getDeviceNames };
