import { NextResponse } from "next/server";
import { listPrompts } from "../../../src/promptStore.js";

/** Every known agent prompt plus its current (disk override or shipped default) content, for the Prompts page. */
export async function GET() {
  return NextResponse.json({ prompts: listPrompts() });
}
