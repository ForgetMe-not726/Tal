import { NextResponse } from "next/server";
import { listRulesWithVersions } from "@/lib/rules/service";

export async function GET() {
  try {
    return NextResponse.json({ rules: await listRulesWithVersions() });
  } catch (error) {
    console.error("[api/rules] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
