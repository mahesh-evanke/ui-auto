/**
 * Shared context for Web UI + API E2E flow. APIs are stored per UI step name.
 */

import type { CapturedApi } from '../../support/networkCapture.js';

export const apisByStepName: Record<string, CapturedApi[]> = {};
export let lastUiStepName: string = '';

export function setApisForStep(stepName: string, apis: CapturedApi[]): void {
    apisByStepName[stepName] = apis;
    lastUiStepName = stepName;
}

export function getApisForStep(stepName: string): CapturedApi[] {
    return apisByStepName[stepName] ?? [];
}

export function clearContext(): void {
    Object.keys(apisByStepName).forEach((k) => delete apisByStepName[k]);
    lastUiStepName = '';
}
