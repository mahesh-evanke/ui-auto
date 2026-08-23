import { NextResponse } from "next/server";
import { getModelSettingsStatus } from "../../../lib/modelSettings.js";

export async function GET() {
  return NextResponse.json(getModelSettingsStatus());
}
