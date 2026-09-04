import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export async function POST() {
  clearSession();
  return NextResponse.json({ ok: true });
}
