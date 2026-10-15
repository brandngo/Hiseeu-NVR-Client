"use strict";

// fill these with your nvr's credentials
const NVR_USERNAME="";
const NVR_PASSWORD="";

// fill the NVR_IP with your NVR's local IP address
const NVR_IP = "192.168.50.146";
const NVR_PORT = "10000";
const STREAM_TYPE = 1;  // 0 = main stream, 1 = sub stream

const statusElement = document.getElementById("status");

function setStatus(message) {
  statusElement.textContent = message;
  console.log(message);
}

if (typeof apip2p === "undefined") {
  throw new Error("NVR SDK is not loaded.");
}

if (typeof libde265 === "undefined") {
  throw new Error("libde265 is not loaded.");
}

// Each channel gets its own decoder and renderer.
const cameras = {
  0: {
    canvas: document.getElementById("camera0"),
    decoder: null,
    renderer: null,
    received: 0,
    rendered: 0
  },
  1: {
    canvas: document.getElementById("camera1"),
    decoder: null,
    renderer: null,
    received: 0,
    rendered: 0
  }
};

for (const [channel, camera] of Object.entries(cameras)) {
  if (!camera.canvas) {
    throw new Error(`Missing canvas for channel ${channel}`);
  }

  camera.decoder = new libde265.Decoder();
  camera.renderer = new libde265.RawPlayer(camera.canvas);

  camera.decoder.set_image_callback((image) => {
    camera.renderer.Se(image);
    camera.rendered++;

    if (camera.rendered === 1) {
      console.log(`Channel ${channel}: first image rendered`);
    }
  });
}

// Create one shared NVR connection.
const conn = apip2p.create(0);

conn.preview = {};
conn.playback = {
  player: null,
  video_id: "playback-canvas"
};

window.nvrConn = conn;
window.nvrCameras = cameras;

// Handle the NVR connection event.
apip2p.onconnect = (...args) => {
  console.log("NVR connection event:", ...args);
  setStatus("Connected to NVR. Logging in...");
  apip2p.login(conn, NVR_USERNAME, NVR_PASSWORD);
};

// Login callback arguments are (connection, result).
apip2p.onloginresult = (apiConn, result) => {
  console.log("NVR login result:", result);

  if (result !== 0) {
    setStatus(`NVR login failed: ${result}`);
    return;
  }

  setStatus("Login successful. Opening cameras...");

  // Open both channels using the same stream type.
  apip2p.open_stream(conn, 0, STREAM_TYPE);
  apip2p.open_stream(conn, 1, STREAM_TYPE);
};

// Log stream-open results.
apip2p.onopenstream = (...args) => {
  console.log("NVR stream event:", ...args);
};

// Log SDK errors.
apip2p.onp2perror = (...args) => {
  console.error("NVR SDK error:", ...args);
};

// Route each received packet to its channel's decoder.
apip2p.onrecvframeex = (
  apiConn,
  frameType,
  data,
  dataLen,
  channel,
  width,
  height,
  encoding,
  channels
) => {
  const camera = cameras[channel];
  if (!camera) {
    return;
  }

  if (encoding !== "H265") {
    if (camera.received === 0) {
      console.warn(
        `Channel ${channel}: expected H265, received`,
        encoding
      );
    }
    return;
  }

  camera.received++;

  if (camera.received === 1) {
    camera.canvas.width = width || 640;
    camera.canvas.height = height || 360;

    console.log(`Channel ${channel}: first packet`, {
      frameType,
      dataLen,
      width,
      height,
      encoding
    });
  }

  const bytes = data instanceof Uint8Array
    ? data
    : new Uint8Array(data);

  try {
    camera.decoder.push_data(bytes, 1);

    camera.decoder.decode((result) => {
      if (result !== 0 && result !== undefined) {
        console.warn(
          `Channel ${channel} decoder status:`,
          result
        );
      }
    });
  } catch (error) {
    console.error(
      `Channel ${channel} decoding error:`,
      error
    );
  }
};

// Start the connection once the page has loaded.
window.addEventListener("load", () => {
  setStatus("Connecting to NVR...");

  console.log("Connecting to", NVR_IP, NVR_PORT);
  apip2p.connectbyip(conn, NVR_IP, NVR_PORT);
});

(() => {
  const desiredTitle = "NVR Camera Viewer";

  function enforceTitle() {
    if (document.title !== desiredTitle) {
      document.title = desiredTitle;
    }
  }

  // Set the title immediately.
  enforceTitle();

  // Restore it if an SDK script changes it later.
  const observer = new MutationObserver(enforceTitle);

  observer.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();


document.querySelectorAll(".fullscreen-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    const channel = button.dataset.camera;
    const panel = document.getElementById(`camera-panel-${channel}`);

    if (!panel) return;

    try {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
      } else {
        await panel.requestFullscreen();
      }
    } catch (error) {
      console.error("Unable to enter fullscreen:", error);
    }
  });
});

// Keep button labels in sync, including when the user presses Esc.
document.addEventListener("fullscreenchange", () => {
  document.querySelectorAll(".fullscreen-btn").forEach((button) => {
    const channel = button.dataset.camera;
    const panel = document.getElementById(`camera-panel-${channel}`);
    const isFullscreen = document.fullscreenElement === panel;

    button.textContent = isFullscreen ? "✕ Exit Fullscreen" : "⛶ Fullscreen";
  });
});


(() => {
  const root = document.documentElement;
  const button = document.getElementById("theme-toggle");
  const storageKey = "nvr-theme-preference";
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

  // null means follow the operating system.
  let preference = null;

  try {
    const saved = localStorage.getItem(storageKey);

    if (saved === "light" || saved === "dark") {
      preference = saved;
    }
  } catch (error) {
    console.warn("Theme preference storage unavailable:", error);
  }

  function applyTheme() {
    const theme = preference || (systemTheme.matches ? "dark" : "light");

    root.dataset.theme = theme;

    button.textContent =
      theme === "dark" ? "☀️ Light mode" : "🌙 Dark mode";

    button.setAttribute(
      "aria-label",
      `Switch to ${theme === "dark" ? "light" : "dark"} mode`
    );

    button.title =
      preference === null
        ? "Following system appearance"
        : "Custom appearance preference";
  }

  button.addEventListener("click", () => {
    const currentTheme =
      root.dataset.theme || (systemTheme.matches ? "dark" : "light");

    // Clicking toggles the theme and saves the manual choice.
    preference = currentTheme === "dark" ? "light" : "dark";

    try {
      localStorage.setItem(storageKey, preference);
    } catch (error) {
      console.warn("Could not save theme preference:", error);
    }

    applyTheme();
  });

  // Follow OS changes whenever the user hasn't chosen manually.
  systemTheme.addEventListener("change", () => {
    if (preference === null) {
      applyTheme();
    }
  });

  applyTheme();
})();
