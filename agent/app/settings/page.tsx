import ModelProviderSettings from "./ModelProviderSettings.js";

export default function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <ModelProviderSettings />
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Local Ollama configuration</h3>
        <p className="muted">
          Used when the model provider above is set to Local Ollama. Configured via environment variables in{" "}
          <code>.env.local</code>:
        </p>
        <pre className="log">{`OLLAMA_HOST=${process.env.OLLAMA_HOST ?? "http://localhost:11434"}\nTESTPILOT_MODEL=${process.env.TESTPILOT_MODEL ?? "llama3.2"}`}</pre>
        <p className="muted">Restart the dev server after changing these.</p>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Reference test framework</h3>
        <p className="muted">
          Local test-automation framework studied for conventions (step-definition text, locator file shape). Read-only, never modified.
        </p>
        <pre className="log">{`TESTPILOT_REFERENCE_FRAMEWORK_PATH=${process.env.TESTPILOT_REFERENCE_FRAMEWORK_PATH ?? "(default)"}`}</pre>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>GitHub</h3>
        <p className="muted">
          To revoke access, remove TestPilot from your{" "}
          <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer">
            GitHub authorized OAuth Apps
          </a>{" "}
          and sign out from the top bar.
        </p>
      </div>
    </div>
  );
}
