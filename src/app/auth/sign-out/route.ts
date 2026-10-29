import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Supabase sign-out failed", error);
    return NextResponse.json({ error: "Unable to sign out." }, { status: 500 });
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
