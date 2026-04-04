import { PENNIVO_VERSION } from "@pennivo/core";

export function App() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backgroundColor: "#1a1a2e",
        color: "#e0e0e0",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            fontSize: "2.5rem",
            fontWeight: 300,
            letterSpacing: "0.1em",
            marginBottom: "0.5rem",
          }}
        >
          Pennivo
        </h1>
        <p style={{ fontSize: "0.875rem", opacity: 0.5 }}>v{PENNIVO_VERSION}</p>
      </div>
    </div>
  );
}
