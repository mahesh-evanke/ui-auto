import ModelProviderSettings from "./ModelProviderSettings.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-lg">
      <div>
        <h1 className="font-headline-md text-headline-md text-on-surface">Settings</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Configure the model backend, reference framework, and connected accounts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
        <div className="flex flex-col gap-lg lg:col-span-2">
          <ModelProviderSettings />

          <Card>
            <CardHeader>
              <CardTitle>
                <span className="material-symbols-outlined">folder_managed</span>
                Framework Configuration
              </CardTitle>
              <CardDescription>
                Local test-automation framework studied for conventions (step-definition text, locator file shape).
                Read-only, never modified.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-sm">
              <pre className="log">{`TESTPILOT_REFERENCE_FRAMEWORK_PATH=${process.env.TESTPILOT_REFERENCE_FRAMEWORK_PATH ?? "(default)"}`}</pre>
              <pre className="log">{`OLLAMA_HOST=${process.env.OLLAMA_HOST ?? "http://localhost:11434"}\nTESTPILOT_MODEL=${process.env.TESTPILOT_MODEL ?? "llama3.2"}`}</pre>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Configured via environment variables in <code>.env.local</code>. Restart the dev server after changing these.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-lg">
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="material-symbols-outlined">monitoring</span>
                Environment Status
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-sm font-body-sm text-body-sm">
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">CLI Version</span>
                <span className="font-code-sm text-code-sm text-on-surface">testpilot-agent</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Last Sync</span>
                <span className="text-on-surface">just now</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Active Workers</span>
                <span className="text-on-surface">1</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <span className="material-symbols-outlined text-error">warning</span>
                Danger Zone
              </CardTitle>
              <CardDescription>
                To revoke access, remove TestPilot from your{" "}
                <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer" className="text-primary">
                  GitHub authorized OAuth Apps
                </a>{" "}
                and sign out from the top bar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="https://github.com/settings/applications"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-lg border border-error/30 px-md py-sm font-body-sm text-body-sm text-error no-underline transition-colors hover:bg-error/10"
              >
                Revoke GitHub Access
                <span className="material-symbols-outlined text-[18px]">open_in_new</span>
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
