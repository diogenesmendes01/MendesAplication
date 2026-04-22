import { NextResponse } from "next/server";
import { withApiLogging } from "@/lib/with-api-logging";

async function _GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}

export const GET = withApiLogging("health", _GET, { sampling: 0.1 });
